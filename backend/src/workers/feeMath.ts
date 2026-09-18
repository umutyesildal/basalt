export const BPS_DENOM = 10_000;
export const SECONDS_PER_YEAR = 365 * 24 * 3600;
export const MANAGEMENT_FEE_DENOMINATOR = BigInt(BPS_DENOM * SECONDS_PER_YEAR);

export function entryFee(gross: number, bps: number) {
  return Math.floor((gross * bps) / BPS_DENOM);
}
export function exitFee(shares: number, bps: number) {
  return Math.floor((shares * bps) / BPS_DENOM);
}
export function managementFee(supply: number, bps: number, elapsedSec: number) {
  return Math.floor((supply * bps * elapsedSec) / (BPS_DENOM * SECONDS_PER_YEAR));
}
export function managementFeeWithRemainder(
  supply: bigint,
  bps: number,
  elapsedSec: bigint,
  previousRemainder = 0n,
): { fee: bigint; remainder: bigint } {
  if (supply < 0n || elapsedSec < 0n || !Number.isInteger(bps) || bps < 0) {
    throw new RangeError("management fee inputs must be non-negative integers");
  }
  if (previousRemainder < 0n || previousRemainder >= MANAGEMENT_FEE_DENOMINATOR) {
    throw new RangeError("management fee remainder is outside the canonical denominator");
  }
  const numerator = supply * BigInt(bps) * elapsedSec + previousRemainder;
  return {
    fee: numerator / MANAGEMENT_FEE_DENOMINATOR,
    remainder: numerator % MANAGEMENT_FEE_DENOMINATOR,
  };
}
export function splitFee(fee: number, creatorSplitBps = 9000) {
  const creator = Math.floor((fee * creatorSplitBps) / BPS_DENOM);
  return { creator, treasury: fee - creator };
}

// Tests: see programs/*/tests + backend unit tests
