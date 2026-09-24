use anchor_lang::{prelude::*, solana_program::hash::hashv};

use crate::{
    math::validate_weights,
    state::{
        ManagedBasket, ManagedBasketError, PriceBoundApproved, RebalanceCancelled,
        RebalanceExpired, RebalanceProposal, RebalanceProposed, PROPOSAL_SEED, STATUS_APPROVED,
        STATUS_CANCELLED, STATUS_EXPIRED, STATUS_PENDING_APPROVAL,
    },
};

pub fn propose_handler(
    ctx: Context<ProposeRebalance>,
    proposal_nonce: u64,
    expected_version: u64,
    target_weights_bps: [u16; 2],
    input_mint: Pubkey,
    max_input_raw: u64,
) -> Result<()> {
    let basket = &mut ctx.accounts.basket;
    require_keys_eq!(
        basket.manager,
        ctx.accounts.manager.key(),
        ManagedBasketError::UnauthorizedManager
    );
    require!(
        basket.guardian != basket.manager,
        ManagedBasketError::RolesMustDiffer
    );
    require!(
        basket.pending_proposal_nonce.is_none(),
        ManagedBasketError::ProposalAlreadyPending
    );
    require!(
        proposal_nonce == basket.next_proposal_nonce,
        ManagedBasketError::WrongProposalNonce
    );
    require!(
        expected_version == basket.allocation_version,
        ManagedBasketError::StaleVersion
    );
    validate_weights(target_weights_bps)?;
    require!(max_input_raw > 0, ManagedBasketError::InvalidProposal);

    let pair_index = basket
        .constituent_mints
        .iter()
        .position(|mint| *mint == input_mint)
        .ok_or(ManagedBasketError::WrongAssetPair)?;
    let output_index = 1usize
        .checked_sub(pair_index)
        .ok_or(ManagedBasketError::WrongAssetPair)?;
    let output_mint = basket.constituent_mints[output_index];
    let clock = Clock::get()?;
    let approval_deadline_slot = clock
        .slot
        .checked_add(basket.approval_ttl_slots)
        .ok_or(ManagedBasketError::MathOverflow)?;

    let commitment_hash = commitment_hash(
        &basket.key(),
        proposal_nonce,
        expected_version,
        input_mint,
        output_mint,
        max_input_raw,
        target_weights_bps,
        approval_deadline_slot,
        basket.notice_duration_slots,
        basket.execution_window_slots,
    );

    let proposal = &mut ctx.accounts.proposal;
    proposal.basket = basket.key();
    proposal.nonce = proposal_nonce;
    proposal.base_version = expected_version;
    proposal.manager = ctx.accounts.manager.key();
    proposal.input_mint = input_mint;
    proposal.output_mint = output_mint;
    proposal.max_input_raw = max_input_raw;
    proposal.min_output_raw = 0;
    proposal.target_weights_bps = target_weights_bps;
    proposal.approval_deadline_slot = approval_deadline_slot;
    proposal.notice_duration_slots = basket.notice_duration_slots;
    proposal.execution_window_slots = basket.execution_window_slots;
    proposal.approved_at_slot = 0;
    proposal.not_before_slot = 0;
    proposal.expires_at_slot = 0;
    proposal.commitment_hash = commitment_hash;
    proposal.proposal_hash = [0; 32];
    proposal.status = STATUS_PENDING_APPROVAL;
    proposal.bump = ctx.bumps.proposal;

    basket.pending_proposal_nonce = Some(proposal_nonce);
    basket.next_proposal_nonce = basket
        .next_proposal_nonce
        .checked_add(1)
        .ok_or(ManagedBasketError::MathOverflow)?;

    emit!(RebalanceProposed {
        basket: basket.key(),
        nonce: proposal_nonce,
        base_version: expected_version,
        commitment_hash,
        input_mint,
        output_mint,
        max_input_raw,
        target_weights_bps,
        approval_deadline_slot,
        notice_duration_slots: proposal.notice_duration_slots,
        execution_window_slots: proposal.execution_window_slots,
    });
    Ok(())
}

pub fn approve_handler(
    ctx: Context<ApprovePriceBound>,
    proposal_nonce: u64,
    min_output_raw: u64,
) -> Result<()> {
    let basket = &ctx.accounts.basket;
    let proposal = &mut ctx.accounts.proposal;
    require_keys_eq!(
        basket.guardian,
        ctx.accounts.guardian.key(),
        ManagedBasketError::UnauthorizedGuardian
    );
    require!(
        basket.pending_proposal_nonce == Some(proposal_nonce)
            && proposal.nonce == proposal_nonce
            && proposal.basket == basket.key(),
        ManagedBasketError::NoPendingProposal
    );
    require!(
        proposal.status == STATUS_PENDING_APPROVAL,
        ManagedBasketError::PriceBoundAlreadyApproved
    );
    require!(min_output_raw > 0, ManagedBasketError::InvalidPriceBound);

    let clock = Clock::get()?;
    require!(
        clock.slot <= proposal.approval_deadline_slot,
        ManagedBasketError::ApprovalDeadlinePassed
    );
    let not_before_slot = clock
        .slot
        .checked_add(proposal.notice_duration_slots)
        .ok_or(ManagedBasketError::MathOverflow)?;
    let expires_at_slot = not_before_slot
        .checked_add(proposal.execution_window_slots)
        .ok_or(ManagedBasketError::MathOverflow)?;
    let final_hash = final_proposal_hash(
        &proposal.commitment_hash,
        min_output_raw,
        clock.slot,
        not_before_slot,
        expires_at_slot,
    );

    proposal.min_output_raw = min_output_raw;
    proposal.approved_at_slot = clock.slot;
    proposal.not_before_slot = not_before_slot;
    proposal.expires_at_slot = expires_at_slot;
    proposal.proposal_hash = final_hash;
    proposal.status = STATUS_APPROVED;

    emit!(PriceBoundApproved {
        basket: basket.key(),
        nonce: proposal_nonce,
        commitment_hash: proposal.commitment_hash,
        proposal_hash: final_hash,
        max_input_raw: proposal.max_input_raw,
        min_output_raw,
        approved_at_slot: clock.slot,
        execute_after_slot: not_before_slot,
        expires_at_slot,
    });
    Ok(())
}

pub fn cancel_handler(ctx: Context<CancelRebalance>, proposal_nonce: u64) -> Result<()> {
    let basket = &mut ctx.accounts.basket;
    let proposal = &mut ctx.accounts.proposal;
    let actor = ctx.accounts.actor.key();
    require!(
        actor == basket.manager || actor == basket.guardian,
        ManagedBasketError::UnauthorizedCanceller
    );
    validate_pending_pair(basket, proposal, proposal_nonce, basket.key())?;
    let proposal_hash = if proposal.status == STATUS_APPROVED {
        proposal.proposal_hash
    } else {
        [0; 32]
    };
    proposal.status = STATUS_CANCELLED;
    basket.pending_proposal_nonce = None;
    emit!(RebalanceCancelled {
        basket: basket.key(),
        nonce: proposal_nonce,
        commitment_hash: proposal.commitment_hash,
        proposal_hash,
    });
    Ok(())
}

pub fn expire_handler(ctx: Context<ExpireRebalance>, proposal_nonce: u64) -> Result<()> {
    let basket = &mut ctx.accounts.basket;
    let proposal = &mut ctx.accounts.proposal;
    validate_pending_pair(basket, proposal, proposal_nonce, basket.key())?;
    let slot = Clock::get()?.slot;
    let expired = match proposal.status {
        STATUS_PENDING_APPROVAL => slot > proposal.approval_deadline_slot,
        STATUS_APPROVED => slot > proposal.expires_at_slot,
        _ => false,
    };
    require!(expired, ManagedBasketError::ProposalNotExpired);
    let proposal_hash = if proposal.status == STATUS_APPROVED {
        proposal.proposal_hash
    } else {
        [0; 32]
    };
    proposal.status = STATUS_EXPIRED;
    basket.pending_proposal_nonce = None;
    emit!(RebalanceExpired {
        basket: basket.key(),
        nonce: proposal_nonce,
        commitment_hash: proposal.commitment_hash,
        proposal_hash,
    });
    Ok(())
}

fn validate_pending_pair(
    basket: &ManagedBasket,
    proposal: &RebalanceProposal,
    proposal_nonce: u64,
    basket_key: Pubkey,
) -> Result<()> {
    require!(
        basket.pending_proposal_nonce == Some(proposal_nonce)
            && proposal.nonce == proposal_nonce
            && proposal.basket == basket_key,
        ManagedBasketError::NoPendingProposal
    );
    require!(
        proposal.status == STATUS_PENDING_APPROVAL || proposal.status == STATUS_APPROVED,
        ManagedBasketError::NoPendingProposal
    );
    Ok(())
}

// Keep each committed protocol field explicit at this security boundary.
#[allow(clippy::too_many_arguments)]
fn commitment_hash(
    basket: &Pubkey,
    nonce: u64,
    base_version: u64,
    input_mint: Pubkey,
    output_mint: Pubkey,
    max_input_raw: u64,
    target_weights_bps: [u16; 2],
    approval_deadline_slot: u64,
    notice_duration_slots: u64,
    execution_window_slots: u64,
) -> [u8; 32] {
    let nonce_bytes = nonce.to_le_bytes();
    let version_bytes = base_version.to_le_bytes();
    let max_input_bytes = max_input_raw.to_le_bytes();
    let weights = [
        target_weights_bps[0].to_le_bytes(),
        target_weights_bps[1].to_le_bytes(),
    ]
    .concat();
    let deadline_bytes = approval_deadline_slot.to_le_bytes();
    let notice_bytes = notice_duration_slots.to_le_bytes();
    let window_bytes = execution_window_slots.to_le_bytes();
    hashv(&[
        b"managed-basket-rebalance-commitment-v1",
        basket.as_ref(),
        &nonce_bytes,
        &version_bytes,
        input_mint.as_ref(),
        output_mint.as_ref(),
        &max_input_bytes,
        &weights,
        &deadline_bytes,
        &notice_bytes,
        &window_bytes,
    ])
    .to_bytes()
}

fn final_proposal_hash(
    commitment: &[u8; 32],
    min_output_raw: u64,
    approved_at_slot: u64,
    not_before_slot: u64,
    expires_at_slot: u64,
) -> [u8; 32] {
    let min_output_bytes = min_output_raw.to_le_bytes();
    let approved_bytes = approved_at_slot.to_le_bytes();
    let not_before_bytes = not_before_slot.to_le_bytes();
    let expires_bytes = expires_at_slot.to_le_bytes();
    hashv(&[
        b"managed-basket-rebalance-approved-v1",
        commitment,
        &min_output_bytes,
        &approved_bytes,
        &not_before_bytes,
        &expires_bytes,
    ])
    .to_bytes()
}

#[derive(Accounts)]
#[instruction(proposal_nonce: u64)]
pub struct ProposeRebalance<'info> {
    #[account(mut)]
    pub manager: Signer<'info>,
    #[account(mut, has_one = manager)]
    pub basket: Account<'info, ManagedBasket>,
    #[account(
        init,
        payer = manager,
        space = 8 + RebalanceProposal::INIT_SPACE,
        seeds = [PROPOSAL_SEED, basket.key().as_ref(), &proposal_nonce.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, RebalanceProposal>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proposal_nonce: u64)]
pub struct ApprovePriceBound<'info> {
    pub guardian: Signer<'info>,
    #[account(mut)]
    pub basket: Account<'info, ManagedBasket>,
    #[account(
        mut,
        seeds = [PROPOSAL_SEED, basket.key().as_ref(), &proposal_nonce.to_le_bytes()],
        bump = proposal.bump,
        has_one = basket
    )]
    pub proposal: Account<'info, RebalanceProposal>,
}

#[derive(Accounts)]
#[instruction(proposal_nonce: u64)]
pub struct CancelRebalance<'info> {
    pub actor: Signer<'info>,
    #[account(mut)]
    pub basket: Account<'info, ManagedBasket>,
    #[account(
        mut,
        seeds = [PROPOSAL_SEED, basket.key().as_ref(), &proposal_nonce.to_le_bytes()],
        bump = proposal.bump,
        has_one = basket
    )]
    pub proposal: Account<'info, RebalanceProposal>,
}

#[derive(Accounts)]
#[instruction(proposal_nonce: u64)]
pub struct ExpireRebalance<'info> {
    #[account(mut)]
    pub basket: Account<'info, ManagedBasket>,
    #[account(
        mut,
        seeds = [PROPOSAL_SEED, basket.key().as_ref(), &proposal_nonce.to_le_bytes()],
        bump = proposal.bump,
        has_one = basket
    )]
    pub proposal: Account<'info, RebalanceProposal>,
}
