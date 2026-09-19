/**
 * Protocol-wide policy values that are safe to consume from the client.
 *
 * V0 does not offer a per-factory or per-basket fee split. The factory's
 * `creator_fee_split_bps` field and `init_factory` argument remain in the
 * legacy ABI, but the on-chain programs accept and use only this canonical
 * 90/10 policy. Keep display copy and exact client-side previews derived from
 * the same values rather than retyping percentages in individual components.
 */

export const BPS_DENOMINATOR = 10_000;
export const CREATOR_FEE_SPLIT_BPS = 9_000;
export const TREASURY_FEE_SPLIT_BPS =
  BPS_DENOMINATOR - CREATOR_FEE_SPLIT_BPS;

export const CREATOR_FEE_SPLIT_PERCENT =
  CREATOR_FEE_SPLIT_BPS / 100;
export const TREASURY_FEE_SPLIT_PERCENT =
  TREASURY_FEE_SPLIT_BPS / 100;

export const PROTOCOL_FEE_SPLIT = Object.freeze({
  creatorBps: CREATOR_FEE_SPLIT_BPS,
  treasuryBps: TREASURY_FEE_SPLIT_BPS,
  creatorPercent: CREATOR_FEE_SPLIT_PERCENT,
  treasuryPercent: TREASURY_FEE_SPLIT_PERCENT,
});

export const PROTOCOL_FEE_SPLIT_LABEL = `${CREATOR_FEE_SPLIT_PERCENT}% creator / ${TREASURY_FEE_SPLIT_PERCENT}% treasury`;
export const PROTOCOL_FEE_SPLIT_SHORT_LABEL = `${CREATOR_FEE_SPLIT_PERCENT}/${TREASURY_FEE_SPLIT_PERCENT}`;
export const CREATOR_FEE_SHARE_LABEL = `${CREATOR_FEE_SPLIT_PERCENT}% of fees`;
export const TREASURY_FEE_SHARE_LABEL = `${TREASURY_FEE_SPLIT_PERCENT}% of fees`;

export interface ProtocolFeeSplit {
  creator: bigint;
  treasury: bigint;
}

/**
 * Split an exact raw share-fee amount using the V0 protocol policy.
 *
 * The creator leg is floored and the treasury receives the exact remainder,
 * including any split dust. BigInt keeps this helper exact at u64-sized
 * amounts and mirrors the on-chain conservation rule.
 */
export function splitProtocolFee(fee: bigint): ProtocolFeeSplit {
  if (fee < 0n) {
    throw new RangeError("fee must be non-negative");
  }

  const creator =
    (fee * BigInt(CREATOR_FEE_SPLIT_BPS)) / BigInt(BPS_DENOMINATOR);
  return { creator, treasury: fee - creator };
}
