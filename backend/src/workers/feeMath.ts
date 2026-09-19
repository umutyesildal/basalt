export const BPS_DENOM = 10_000;
export const SECONDS_PER_YEAR = 365 * 24 * 3600;
export const MANAGEMENT_FEE_DENOMINATOR = BigInt(BPS_DENOM * SECONDS_PER_YEAR);

/**
 * V0's immutable fee policy: 90% of fee shares go to the creator and the
 * remainder goes to the treasury. Keep this in one backend module so the
 * indexer cannot silently diverge from the economic helpers.
 */
export const CREATOR_FEE_SPLIT_BPS = 9_000;
export const CREATOR_FEE_SPLIT_BPS_BIGINT = BigInt(CREATOR_FEE_SPLIT_BPS);

function assertBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOM) {
    throw new RangeError("fee bps must be an integer from 0 through 10000");
  }
}

export function entryFee(gross: number, bps: number) {
  assertBps(bps);
  return Math.floor((gross * bps) / BPS_DENOM);
}
export function exitFee(shares: number, bps: number) {
  assertBps(bps);
  return Math.floor((shares * bps) / BPS_DENOM);
}
export function managementFee(supply: number, bps: number, elapsedSec: number) {
  assertBps(bps);
  return Math.floor((supply * bps * elapsedSec) / (BPS_DENOM * SECONDS_PER_YEAR));
}
export function managementFeeWithRemainder(
  supply: bigint,
  bps: number,
  elapsedSec: bigint,
  previousRemainder = 0n,
): { fee: bigint; remainder: bigint } {
  if (supply < 0n || elapsedSec < 0n) {
    throw new RangeError("management fee inputs are outside the canonical domain");
  }
  assertBps(bps);
  // Match accrue_fee_internal: a zero-supply or zero-rate checkpoint clears
  // carried numerator dust instead of preserving a remainder that can never
  // be charged against the inactive state.
  if (supply === 0n || bps === 0) {
    return { fee: 0n, remainder: 0n };
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
/**
 * Split a fee represented as raw integer shares. The creator allocation is
 * floored and every remainder unit stays with the treasury.
 */
export function splitFeeBigInt(fee: bigint): { creator: bigint; treasury: bigint } {
  if (fee < 0n) throw new RangeError("fee must be a non-negative integer");
  const creator = (fee * CREATOR_FEE_SPLIT_BPS_BIGINT) / BigInt(BPS_DENOM);
  return { creator, treasury: fee - creator };
}

/** Number-facing wrapper around the canonical BigInt fee split. */
export function splitFee(fee: number): { creator: number; treasury: number } {
  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new RangeError("fee must be a non-negative safe integer");
  }
  const split = splitFeeBigInt(BigInt(fee));
  return { creator: Number(split.creator), treasury: Number(split.treasury) };
}

// Tests: see programs/*/tests + backend unit tests
