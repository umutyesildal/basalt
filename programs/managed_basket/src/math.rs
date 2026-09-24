use anchor_lang::prelude::*;

use crate::state::ManagedBasketError;

pub const BPS_DENOMINATOR: u128 = 10_000;

/// Fee-free host/on-chain share math for the fixed two-asset proof. Deposits
/// are compared to actual pre-deposit raw vault balances, never target weights.
pub fn gross_shares(
    deposits_raw: [u64; 2],
    vault_balances_raw: [u64; 2],
    total_supply_raw: u64,
) -> Result<u64> {
    require!(total_supply_raw > 0, ManagedBasketError::ZeroSupply);

    let mut implied = [0u64; 2];
    for i in 0..2 {
        require!(deposits_raw[i] > 0, ManagedBasketError::ZeroAmount);
        require!(vault_balances_raw[i] > 0, ManagedBasketError::ZeroVault);
        let numerator = (deposits_raw[i] as u128)
            .checked_mul(total_supply_raw as u128)
            .ok_or(ManagedBasketError::MathOverflow)?;
        implied[i] = u64::try_from(numerator / vault_balances_raw[i] as u128)
            .map_err(|_| error!(ManagedBasketError::MathOverflow))?;
    }

    let min_shares = implied[0].min(implied[1]);
    let max_shares = implied[0].max(implied[1]);
    require!(min_shares > 0, ManagedBasketError::ZeroShares);

    // Same exact 1% tolerance as V0: (max - min) * 100 <= min. All
    // intermediate arithmetic is u128 and divisions round down.
    let spread_times_100 = ((max_shares - min_shares) as u128)
        .checked_mul(100)
        .ok_or(ManagedBasketError::MathOverflow)?;
    require!(
        spread_times_100 <= min_shares as u128,
        ManagedBasketError::WeightMismatch
    );
    Ok(min_shares)
}

/// Oracle-free pro-rata raw output with explicit floor rounding.
pub fn redeem_amounts(
    vault_balances_raw: [u64; 2],
    shares_raw: u64,
    total_supply_raw: u64,
) -> Result<[u64; 2]> {
    require!(total_supply_raw > 0, ManagedBasketError::ZeroSupply);
    require!(shares_raw > 0, ManagedBasketError::ZeroRedemption);
    require!(
        shares_raw <= total_supply_raw,
        ManagedBasketError::InsufficientShares
    );
    let mut amounts = [0u64; 2];
    for i in 0..2 {
        let numerator = (vault_balances_raw[i] as u128)
            .checked_mul(shares_raw as u128)
            .ok_or(ManagedBasketError::MathOverflow)?;
        amounts[i] = u64::try_from(numerator / total_supply_raw as u128)
            .map_err(|_| error!(ManagedBasketError::MathOverflow))?;
    }
    Ok(amounts)
}

pub fn validate_weights(weights_bps: [u16; 2]) -> Result<()> {
    require!(
        weights_bps[0] > 0 && weights_bps[1] > 0,
        ManagedBasketError::InvalidWeights
    );
    let sum = weights_bps[0] as u32 + weights_bps[1] as u32;
    require!(sum == 10_000, ManagedBasketError::InvalidWeights);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gross_shares_uses_live_raw_balances_and_one_percent_floor_tolerance() {
        assert_eq!(
            gross_shares([100, 101], [10_000, 10_000], 10_000).unwrap(),
            100
        );
        assert_eq!(
            gross_shares([100, 102], [10_000, 10_000], 10_000),
            Err(error!(ManagedBasketError::WeightMismatch))
        );
        assert_eq!(gross_shares([6, 17], [60, 170], 120).unwrap(), 12);
    }

    #[test]
    fn redemption_floors_each_raw_component() {
        assert_eq!(redeem_amounts([10, 7], 1, 3).unwrap(), [3, 2]);
    }
}
