//! Host-side proof model for the first Managed Basket V2 accounting slice.
//!
//! This crate is deliberately not an Anchor/Solana program. It models two
//! integer raw token balances, transferable fungible share units, a delayed
//! manager proposal with a guardian-approved immutable price bound, and one
//! atomic pair fill. It does not model token accounts, signatures, CPI, fees,
//! valuation or production price discovery.

mod accounting;
mod error;
mod model;
mod proposal;

pub use accounting::{gross_shares_for_deposit, pro_rata_amounts, RawBalances};
pub use error::CoreError;
pub use model::{Counterparty, ManagedBasket, ManagedBasketConfig, TimingPolicy};
pub use proposal::{Asset, PairFill, PriceBound, RebalanceProposal};

/// Host-only identifiers. A real program would validate Solana account keys,
/// signatures, owners, mints and canonical ATAs instead.
pub type ActorId = u64;
pub type HolderId = u64;
