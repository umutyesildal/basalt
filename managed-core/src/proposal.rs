use crate::{ActorId, CoreError};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Asset {
    A,
    B,
}

impl Asset {
    pub const fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }
}

/// A guardian-approved bound becomes immutable when approved. The notice
/// period starts at that approval slot, so the public delay covers the exact
/// executable terms.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PriceBound {
    pub max_input_raw: u64,
    pub min_output_raw: u64,
    pub approved_at_slot: u64,
    pub execute_after_slot: u64,
    pub expires_at_slot: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RebalanceProposal {
    pub nonce: u64,
    pub base_version: u64,
    pub target_weights_bps: [u16; 2],
    pub input_asset: Asset,
    pub proposed_max_input_raw: u64,
    pub proposed_at_slot: u64,
    pub approval_deadline_slot: u64,
    pub notice_duration_slots: u64,
    pub execution_window_slots: u64,
    pub manager: ActorId,
    pub price_bound: Option<PriceBound>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PairFill {
    pub input_asset: Asset,
    pub input_raw: u64,
    pub output_raw: u64,
}

pub(crate) fn validate_positive_weights(weights: [u16; 2]) -> Result<(), CoreError> {
    if weights[0] == 0 || weights[1] == 0 {
        return Err(CoreError::InvalidWeights);
    }
    let sum = weights[0] as u32 + weights[1] as u32;
    if sum != 10_000 {
        return Err(CoreError::InvalidWeights);
    }
    Ok(())
}
