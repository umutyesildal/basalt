use crate::CoreError;

/// Raw token units for the two fixed mock constituents in this host proof.
/// No UI multiplier, price or floating-point conversion is applied.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RawBalances {
    pub a: u64,
    pub b: u64,
}

impl RawBalances {
    pub const fn new(a: u64, b: u64) -> Self {
        Self { a, b }
    }

    pub const fn get(self, asset: crate::Asset) -> u64 {
        match asset {
            crate::Asset::A => self.a,
            crate::Asset::B => self.b,
        }
    }

    pub fn get_mut(&mut self, asset: crate::Asset) -> &mut u64 {
        match asset {
            crate::Asset::A => &mut self.a,
            crate::Asset::B => &mut self.b,
        }
    }

    pub const fn all_positive(self) -> bool {
        self.a > 0 && self.b > 0
    }
}

/// Oracle-free entitlement in raw units. Every asset uses the same floor
/// rule; any integer dust remains in the common vault for remaining holders.
pub fn pro_rata_amounts(
    vault_raw: RawBalances,
    shares_to_redeem: u64,
    total_share_supply: u64,
) -> Result<RawBalances, CoreError> {
    if total_share_supply == 0 {
        return Err(CoreError::ZeroSupply);
    }
    if shares_to_redeem == 0 {
        return Err(CoreError::ZeroRedemption);
    }
    if shares_to_redeem > total_share_supply {
        return Err(CoreError::InsufficientShares);
    }

    let amount = |raw: u64| -> Result<u64, CoreError> {
        let numerator = (raw as u128)
            .checked_mul(shares_to_redeem as u128)
            .ok_or(CoreError::ArithmeticOverflow)?;
        u64::try_from(numerator / total_share_supply as u128)
            .map_err(|_| CoreError::ArithmeticOverflow)
    };

    Ok(RawBalances::new(amount(vault_raw.a)?, amount(vault_raw.b)?))
}

/// Calculate fee-free in-kind mint shares from the basket's live pre-deposit
/// vault balances. For each constituent, the deposit implies
/// `floor(deposit_raw * supply / vault_raw)` shares. The minimum implied amount
/// is minted; the maximum/minimum spread may differ by at most 1% of the
/// minimum, matching the explicit V0 tolerance rule without floating point:
/// `(max - min) * 100 <= min`.
///
/// This function deliberately takes no target weights. The proof's two raw
/// balances use a common mock scale; production UI valuation must account for
/// each mint's decimals and price separately.
pub fn gross_shares_for_deposit(
    deposits_raw: RawBalances,
    vault_raw: RawBalances,
    total_share_supply: u64,
) -> Result<u64, CoreError> {
    if total_share_supply == 0 {
        return Err(CoreError::ZeroSupply);
    }
    if !vault_raw.all_positive() {
        return Err(CoreError::ZeroVaultBalance);
    }
    if deposits_raw.a == 0 || deposits_raw.b == 0 {
        return Err(CoreError::ZeroDeposit);
    }

    let implied_a = implied_shares(deposits_raw.a, vault_raw.a, total_share_supply)?;
    let implied_b = implied_shares(deposits_raw.b, vault_raw.b, total_share_supply)?;
    let min_implied = implied_a.min(implied_b);
    let max_implied = implied_a.max(implied_b);
    if min_implied == 0 {
        return Err(CoreError::ZeroMintShares);
    }

    let spread_times_100 = ((max_implied - min_implied) as u128)
        .checked_mul(100)
        .ok_or(CoreError::ArithmeticOverflow)?;
    if spread_times_100 > min_implied as u128 {
        return Err(CoreError::DepositRatioMismatch);
    }

    Ok(min_implied)
}

fn implied_shares(
    deposit_raw: u64,
    vault_raw: u64,
    total_share_supply: u64,
) -> Result<u64, CoreError> {
    let numerator = (deposit_raw as u128)
        .checked_mul(total_share_supply as u128)
        .ok_or(CoreError::ArithmeticOverflow)?;
    u64::try_from(numerator / vault_raw as u128).map_err(|_| CoreError::ArithmeticOverflow)
}
