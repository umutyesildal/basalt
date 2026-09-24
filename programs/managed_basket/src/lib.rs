//! Managed Basket V2 two-asset mock prototype.
//!
//! This program is separate from immutable Basalt V0. It creates one Token-2022
//! fungible share mint and a separate supply-one identity NFT, supports
//! fee-free in-kind mint/redeem, and executes one delayed guardian-bounded RFQ
//! pair fill. It has no arbitrary CPI, manager withdrawal or redeem gate.
//! Identity NFT metadata and production fee accrual are not implemented.

use anchor_lang::prelude::*;

pub mod create;
pub mod execution;
pub mod math;
pub mod proposal;
pub mod shares;
pub mod state;
pub mod token;

pub(crate) use create::__client_accounts_create_managed_basket;
pub use create::CreateManagedBasket;
pub(crate) use execution::__client_accounts_fill_rebalance;
pub use execution::FillRebalance;
pub(crate) use proposal::{
    __client_accounts_approve_price_bound, __client_accounts_cancel_rebalance,
    __client_accounts_expire_rebalance, __client_accounts_propose_rebalance,
};
pub use proposal::{ApprovePriceBound, CancelRebalance, ExpireRebalance, ProposeRebalance};
pub(crate) use shares::{__client_accounts_mint_in_kind, __client_accounts_redeem_in_kind};
pub use shares::{MintInKind, RedeemInKind};
pub use state::{ManagedBasket, RebalanceProposal};

declare_id!("CZ3eG8JutryawXTcA1h97PMrhAGuWzsrYSgssMH43cKL");

#[program]
pub mod managed_basket {
    use super::*;

    pub fn create_managed_basket(
        ctx: Context<CreateManagedBasket>,
        basket_nonce: u64,
        target_weights_bps: [u16; 2],
        seed_amounts_raw: [u64; 2],
        approval_ttl_slots: u64,
        notice_duration_slots: u64,
        execution_window_slots: u64,
    ) -> Result<()> {
        create::handler(
            ctx,
            basket_nonce,
            target_weights_bps,
            seed_amounts_raw,
            approval_ttl_slots,
            notice_duration_slots,
            execution_window_slots,
        )
    }

    pub fn mint_in_kind(ctx: Context<MintInKind>, deposits_raw: [u64; 2]) -> Result<()> {
        shares::mint_handler(ctx, deposits_raw)
    }

    pub fn redeem_in_kind(ctx: Context<RedeemInKind>, shares_to_redeem_raw: u64) -> Result<()> {
        shares::redeem_handler(ctx, shares_to_redeem_raw)
    }

    pub fn propose_rebalance(
        ctx: Context<ProposeRebalance>,
        proposal_nonce: u64,
        expected_version: u64,
        target_weights_bps: [u16; 2],
        input_mint: Pubkey,
        max_input_raw: u64,
    ) -> Result<()> {
        proposal::propose_handler(
            ctx,
            proposal_nonce,
            expected_version,
            target_weights_bps,
            input_mint,
            max_input_raw,
        )
    }

    pub fn approve_price_bound(
        ctx: Context<ApprovePriceBound>,
        proposal_nonce: u64,
        min_output_raw: u64,
    ) -> Result<()> {
        proposal::approve_handler(ctx, proposal_nonce, min_output_raw)
    }

    pub fn cancel_rebalance(ctx: Context<CancelRebalance>, proposal_nonce: u64) -> Result<()> {
        proposal::cancel_handler(ctx, proposal_nonce)
    }

    pub fn expire_rebalance(ctx: Context<ExpireRebalance>, proposal_nonce: u64) -> Result<()> {
        proposal::expire_handler(ctx, proposal_nonce)
    }

    pub fn fill_rebalance(
        ctx: Context<FillRebalance>,
        proposal_nonce: u64,
        input_raw: u64,
        output_raw: u64,
    ) -> Result<()> {
        execution::fill_handler(ctx, proposal_nonce, input_raw, output_raw)
    }
}
