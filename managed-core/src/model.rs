use std::collections::BTreeMap;

use crate::accounting::gross_shares_for_deposit;
use crate::proposal::validate_positive_weights;
use crate::{
    pro_rata_amounts, ActorId, Asset, CoreError, HolderId, PairFill, PriceBound, RawBalances,
    RebalanceProposal,
};

/// A fixed counterparty balance in the host simulation. An RFQ fill always
/// exchanges the basket's canonical pair with this counterparty; there is no
/// recipient argument that could redirect vault assets.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Counterparty {
    pub owner: ActorId,
    pub balances_raw: RawBalances,
}

/// Fixed proposal timing values for a basket. The manager's proposal deadline
/// is measured from proposal creation; notice and execution windows are
/// measured from guardian approval.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TimingPolicy {
    pub approval_ttl_slots: u64,
    pub notice_duration_slots: u64,
    pub execution_window_slots: u64,
}

impl TimingPolicy {
    pub const fn new(
        approval_ttl_slots: u64,
        notice_duration_slots: u64,
        execution_window_slots: u64,
    ) -> Self {
        Self {
            approval_ttl_slots,
            notice_duration_slots,
            execution_window_slots,
        }
    }
}

/// Constructor input grouped to keep the host model's setup explicit and
/// extensible without a long positional argument list.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagedBasketConfig {
    pub manager: ActorId,
    pub guardian: ActorId,
    pub initial_vault_raw: RawBalances,
    pub initial_holders: Vec<(HolderId, u64)>,
    pub target_weights_bps: [u16; 2],
    pub timing: TimingPolicy,
}

impl Counterparty {
    pub const fn new(owner: ActorId, balances_raw: RawBalances) -> Self {
        Self {
            owner,
            balances_raw,
        }
    }
}

/// Simplified common-vault state. Share balances are the economic claim;
/// identity NFT issuance is intentionally outside this accounting proof.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagedBasket {
    manager: ActorId,
    guardian: ActorId,
    vault_raw: RawBalances,
    total_share_supply: u64,
    holders: BTreeMap<HolderId, u64>,
    target_weights_bps: [u16; 2],
    allocation_version: u64,
    next_proposal_nonce: u64,
    pending: Option<RebalanceProposal>,
    approval_ttl_slots: u64,
    notice_duration_slots: u64,
    execution_window_slots: u64,
}

impl ManagedBasket {
    pub fn new(config: ManagedBasketConfig) -> Result<Self, CoreError> {
        let ManagedBasketConfig {
            manager,
            guardian,
            initial_vault_raw: vault_raw,
            initial_holders,
            target_weights_bps,
            timing,
        } = config;
        let TimingPolicy {
            approval_ttl_slots,
            notice_duration_slots,
            execution_window_slots,
        } = timing;
        if manager == guardian {
            return Err(CoreError::ManagerGuardianMustDiffer);
        }
        if !vault_raw.all_positive()
            || approval_ttl_slots == 0
            || notice_duration_slots == 0
            || execution_window_slots == 0
        {
            return Err(CoreError::InvalidConfiguration);
        }
        validate_positive_weights(target_weights_bps)?;
        if initial_holders.is_empty() {
            return Err(CoreError::EmptyHolderSet);
        }

        let mut holders = BTreeMap::new();
        let mut total_share_supply = 0u64;
        for (holder, shares) in &initial_holders {
            if *shares == 0 || holders.contains_key(holder) {
                return Err(CoreError::InvalidConfiguration);
            }
            total_share_supply = total_share_supply
                .checked_add(*shares)
                .ok_or(CoreError::ShareSupplyOverflow)?;
            holders.insert(*holder, *shares);
        }
        if total_share_supply == 0 {
            return Err(CoreError::ZeroSupply);
        }

        Ok(Self {
            manager,
            guardian,
            vault_raw,
            total_share_supply,
            holders,
            target_weights_bps,
            allocation_version: 0,
            next_proposal_nonce: 0,
            pending: None,
            approval_ttl_slots,
            notice_duration_slots,
            execution_window_slots,
        })
    }

    pub const fn vault_raw(&self) -> RawBalances {
        self.vault_raw
    }

    pub const fn total_share_supply(&self) -> u64 {
        self.total_share_supply
    }

    pub const fn target_weights_bps(&self) -> [u16; 2] {
        self.target_weights_bps
    }

    pub const fn allocation_version(&self) -> u64 {
        self.allocation_version
    }

    pub fn holder_shares(&self, holder: HolderId) -> u64 {
        self.holders.get(&holder).copied().unwrap_or(0)
    }

    pub fn pending_proposal(&self) -> Option<&RebalanceProposal> {
        self.pending.as_ref()
    }

    /// Redeem depends only on holder shares and the live raw vault balances.
    /// Proposal status, manager, guardian, oracle and backend are not inputs.
    pub fn redeem(
        &mut self,
        holder: HolderId,
        shares_to_redeem: u64,
    ) -> Result<RawBalances, CoreError> {
        let owned = self.holder_shares(holder);
        if shares_to_redeem == 0 {
            return Err(CoreError::ZeroRedemption);
        }
        if shares_to_redeem > owned {
            return Err(CoreError::InsufficientShares);
        }

        let mut next = self.clone();
        let output = pro_rata_amounts(next.vault_raw, shares_to_redeem, next.total_share_supply)?;
        next.vault_raw.a = next
            .vault_raw
            .a
            .checked_sub(output.a)
            .ok_or(CoreError::ArithmeticOverflow)?;
        next.vault_raw.b = next
            .vault_raw
            .b
            .checked_sub(output.b)
            .ok_or(CoreError::ArithmeticOverflow)?;
        next.total_share_supply = next
            .total_share_supply
            .checked_sub(shares_to_redeem)
            .ok_or(CoreError::ArithmeticOverflow)?;
        let remaining = owned
            .checked_sub(shares_to_redeem)
            .ok_or(CoreError::ArithmeticOverflow)?;
        if remaining == 0 {
            next.holders.remove(&holder);
        } else {
            next.holders.insert(holder, remaining);
        }
        next.check_accounting_invariant()?;
        *self = next;
        Ok(output)
    }

    /// Fee-free host model of `mint_in_kind`. Shares are priced against the
    /// live vault balances before the deposit; target weights do not enter the
    /// calculation. Mutations are committed only if all ratio, balance and
    /// share-supply checks pass.
    pub fn mint_in_kind(
        &mut self,
        holder: HolderId,
        deposits_raw: RawBalances,
    ) -> Result<u64, CoreError> {
        let mut next = self.clone();
        let gross_shares =
            gross_shares_for_deposit(deposits_raw, next.vault_raw, next.total_share_supply)?;
        next.vault_raw.a = next
            .vault_raw
            .a
            .checked_add(deposits_raw.a)
            .ok_or(CoreError::ArithmeticOverflow)?;
        next.vault_raw.b = next
            .vault_raw
            .b
            .checked_add(deposits_raw.b)
            .ok_or(CoreError::ArithmeticOverflow)?;
        next.total_share_supply = next
            .total_share_supply
            .checked_add(gross_shares)
            .ok_or(CoreError::ShareSupplyOverflow)?;
        let holder_shares = next
            .holders
            .get(&holder)
            .copied()
            .unwrap_or(0)
            .checked_add(gross_shares)
            .ok_or(CoreError::ShareSupplyOverflow)?;
        next.holders.insert(holder, holder_shares);
        next.check_accounting_invariant()?;
        *self = next;
        Ok(gross_shares)
    }

    /// Manager proposes a target allocation and exact pair direction. The
    /// proposal is inert until the guardian commits an immutable price bound.
    pub fn propose_rebalance(
        &mut self,
        manager: ActorId,
        expected_version: u64,
        target_weights_bps: [u16; 2],
        input_asset: Asset,
        proposed_max_input_raw: u64,
        current_slot: u64,
    ) -> Result<u64, CoreError> {
        if manager != self.manager {
            return Err(CoreError::UnauthorizedManager);
        }
        if expected_version != self.allocation_version {
            return Err(CoreError::StaleVersion);
        }
        if self.pending.is_some() {
            return Err(CoreError::ProposalAlreadyPending);
        }
        validate_positive_weights(target_weights_bps)?;
        if proposed_max_input_raw == 0 {
            return Err(CoreError::InvalidProposal);
        }

        let nonce = self.next_proposal_nonce;
        let approval_deadline_slot = current_slot
            .checked_add(self.approval_ttl_slots)
            .ok_or(CoreError::ArithmeticOverflow)?;
        self.next_proposal_nonce = self
            .next_proposal_nonce
            .checked_add(1)
            .ok_or(CoreError::ArithmeticOverflow)?;
        self.pending = Some(RebalanceProposal {
            nonce,
            base_version: self.allocation_version,
            target_weights_bps,
            input_asset,
            proposed_max_input_raw,
            proposed_at_slot: current_slot,
            approval_deadline_slot,
            notice_duration_slots: self.notice_duration_slots,
            execution_window_slots: self.execution_window_slots,
            manager,
            price_bound: None,
        });
        Ok(nonce)
    }

    /// Guardian approval fixes the exact input cap and minimum output. The
    /// public delay starts at this point, not at the manager's proposal.
    pub fn approve_price_bound(
        &mut self,
        guardian: ActorId,
        proposal_nonce: u64,
        approved_max_input_raw: u64,
        min_output_raw: u64,
        approval_slot: u64,
    ) -> Result<PriceBound, CoreError> {
        if guardian != self.guardian {
            return Err(CoreError::UnauthorizedGuardian);
        }
        let proposal = self.pending.as_mut().ok_or(CoreError::NoPendingProposal)?;
        if proposal.nonce != proposal_nonce {
            return Err(CoreError::WrongProposalNonce);
        }
        if proposal.price_bound.is_some() {
            return Err(CoreError::PriceBoundAlreadyApproved);
        }
        if approval_slot < proposal.proposed_at_slot
            || approved_max_input_raw == 0
            || approved_max_input_raw != proposal.proposed_max_input_raw
            || min_output_raw == 0
        {
            return Err(CoreError::InvalidPriceBound);
        }
        if approval_slot > proposal.approval_deadline_slot {
            return Err(CoreError::ApprovalDeadlinePassed);
        }

        let execute_after_slot = approval_slot
            .checked_add(proposal.notice_duration_slots)
            .ok_or(CoreError::ArithmeticOverflow)?;
        let expires_at_slot = execute_after_slot
            .checked_add(proposal.execution_window_slots)
            .ok_or(CoreError::ArithmeticOverflow)?;
        let bound = PriceBound {
            max_input_raw: approved_max_input_raw,
            min_output_raw,
            approved_at_slot: approval_slot,
            execute_after_slot,
            expires_at_slot,
        };
        proposal.price_bound = Some(bound);
        Ok(bound)
    }

    /// Manager or guardian may cancel a pending proposal. Cancellation never
    /// blocks or changes the independent redeem path.
    pub fn cancel_proposal(&mut self, actor: ActorId) -> Result<(), CoreError> {
        if actor != self.manager && actor != self.guardian {
            return Err(CoreError::UnauthorizedCanceller);
        }
        if self.pending.take().is_none() {
            return Err(CoreError::NoPendingProposal);
        }
        Ok(())
    }

    /// Anyone may clear an approved proposal once its fill window has ended.
    pub fn expire_proposal(&mut self, current_slot: u64) -> Result<(), CoreError> {
        let proposal = self.pending.as_ref().ok_or(CoreError::NoPendingProposal)?;
        if let Some(bound) = proposal.price_bound {
            if current_slot <= bound.expires_at_slot {
                return Err(CoreError::ProposalNotExpired);
            }
        } else if current_slot <= proposal.approval_deadline_slot {
            return Err(CoreError::ProposalNotExpired);
        }
        self.pending = None;
        Ok(())
    }

    /// Apply one full, bounded RFQ pair fill. All mutations happen on copies
    /// and are committed together only after every check passes. A caller
    /// cannot choose an arbitrary vault recipient or change share supply.
    pub fn fill_rebalance(
        &mut self,
        taker: ActorId,
        counterparty: &mut Counterparty,
        proposal_nonce: u64,
        fill: PairFill,
        current_slot: u64,
    ) -> Result<(), CoreError> {
        let mut next_basket = self.clone();
        let mut next_counterparty = counterparty.clone();
        next_basket.apply_fill(
            taker,
            &mut next_counterparty,
            proposal_nonce,
            fill,
            current_slot,
        )?;
        next_basket.check_accounting_invariant()?;
        *self = next_basket;
        *counterparty = next_counterparty;
        Ok(())
    }

    fn apply_fill(
        &mut self,
        taker: ActorId,
        counterparty: &mut Counterparty,
        proposal_nonce: u64,
        fill: PairFill,
        current_slot: u64,
    ) -> Result<(), CoreError> {
        if taker != counterparty.owner {
            return Err(CoreError::WrongCounterparty);
        }
        let proposal = self.pending.as_ref().ok_or(CoreError::NoPendingProposal)?;
        if proposal.nonce != proposal_nonce {
            return Err(CoreError::WrongProposalNonce);
        }
        if proposal.base_version != self.allocation_version {
            return Err(CoreError::StaleVersion);
        }
        if fill.input_asset != proposal.input_asset {
            return Err(CoreError::WrongAssetPair);
        }
        let bound = proposal.price_bound.ok_or(CoreError::ProposalNotApproved)?;
        if current_slot < bound.execute_after_slot {
            return Err(CoreError::TooEarly);
        }
        if current_slot > bound.expires_at_slot {
            return Err(CoreError::ProposalExpired);
        }
        if fill.input_raw != bound.max_input_raw
            || fill.input_raw == 0
            || fill.output_raw < bound.min_output_raw
            || fill.output_raw == 0
        {
            return Err(CoreError::FillOutsideBounds);
        }

        let output_asset = fill.input_asset.other();
        let vault_input_before = self.vault_raw.get(fill.input_asset);
        if fill.input_raw > vault_input_before {
            return Err(CoreError::InsufficientVaultBalance);
        }
        if fill.input_raw == vault_input_before {
            return Err(CoreError::WouldEmptyConstituent);
        }
        if counterparty.balances_raw.get(output_asset) < fill.output_raw {
            return Err(CoreError::InsufficientCounterpartyBalance);
        }

        let vault_input_after = vault_input_before
            .checked_sub(fill.input_raw)
            .ok_or(CoreError::ArithmeticOverflow)?;
        let vault_output_after = self
            .vault_raw
            .get(output_asset)
            .checked_add(fill.output_raw)
            .ok_or(CoreError::ArithmeticOverflow)?;
        let counterparty_input_after = counterparty
            .balances_raw
            .get(fill.input_asset)
            .checked_add(fill.input_raw)
            .ok_or(CoreError::ArithmeticOverflow)?;
        let counterparty_output_after = counterparty
            .balances_raw
            .get(output_asset)
            .checked_sub(fill.output_raw)
            .ok_or(CoreError::InsufficientCounterpartyBalance)?;

        *self.vault_raw.get_mut(fill.input_asset) = vault_input_after;
        *self.vault_raw.get_mut(output_asset) = vault_output_after;
        *counterparty.balances_raw.get_mut(fill.input_asset) = counterparty_input_after;
        *counterparty.balances_raw.get_mut(output_asset) = counterparty_output_after;
        if !self.vault_raw.all_positive() {
            return Err(CoreError::WouldEmptyConstituent);
        }

        self.target_weights_bps = proposal.target_weights_bps;
        self.allocation_version = self
            .allocation_version
            .checked_add(1)
            .ok_or(CoreError::ArithmeticOverflow)?;
        self.pending = None;
        Ok(())
    }

    fn check_accounting_invariant(&self) -> Result<(), CoreError> {
        let sum = self.holders.values().try_fold(0u64, |total, shares| {
            total
                .checked_add(*shares)
                .ok_or(CoreError::ShareSupplyOverflow)
        })?;
        if sum != self.total_share_supply {
            return Err(CoreError::AccountingInvariant);
        }
        Ok(())
    }
}
