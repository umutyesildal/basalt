/**
 * Raw Token-2022 balance accounting for the sequential Jupiter zap.
 *
 * A zap may run more than once after an ambiguous confirmation.  The only
 * balance that belongs to a quote attempt is `post - pre`; using the current
 * full ATA balance would sweep tokens that were already in the wallet.  This
 * module is deliberately pure so the UI can use the same invariants when it
 * retries a leg and when it prepares `mint_in_kind`.
 */

export type RawAmountInput = bigint | string | number;

export type ZapDeltaErrorCode =
  | "invalid-raw-amount"
  | "negative-delta"
  | "zero-delta"
  | "invalid-min-out"
  | "invalid-slippage"
  | "invalid-leg-order"
  | "mint-mismatch"
  | "snapshot-mismatch";

export class ZapBalanceDeltaError extends Error {
  readonly code: ZapDeltaErrorCode;

  constructor(code: ZapDeltaErrorCode, message: string) {
    super(message);
    this.name = "ZapBalanceDeltaError";
    this.code = code;
  }
}

/** Parse a Solana raw amount without ever passing through Number. Zero is a
 * valid account balance, although a completed swap delta must be positive. */
export function parseRawAmount(value: unknown, field = "raw amount"): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new ZapBalanceDeltaError("invalid-raw-amount", `${field} cannot be negative.`);
    }
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ZapBalanceDeltaError(
        "invalid-raw-amount",
        `${field} must be a non-negative safe integer.`,
      );
    }
    return BigInt(value);
  }

  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }

  throw new ZapBalanceDeltaError(
    "invalid-raw-amount",
    `${field} must be a non-negative integer raw amount.`,
  );
}

/**
 * Calculate a positive raw balance delta. This is the function to call when
 * preparing mint amounts: pre-existing wallet inventory is excluded and a
 * zero/negative result can never close a zap.
 */
export function calculateRawDelta(preRaw: unknown, postRaw: unknown): bigint {
  const pre = parseRawAmount(preRaw, "pre-swap balance");
  const post = parseRawAmount(postRaw, "post-swap balance");
  if (post < pre) {
    throw new ZapBalanceDeltaError(
      "negative-delta",
      `post-swap balance ${post} is below pre-swap balance ${pre}.`,
    );
  }
  const delta = post - pre;
  if (delta === 0n) {
    throw new ZapBalanceDeltaError("zero-delta", "swap delivered zero raw units.");
  }
  return delta;
}

/** Internal/recovery variant: zero means the leg is safe to execute. */
function calculateNonNegativeDelta(preRaw: unknown, postRaw: unknown): bigint {
  const pre = parseRawAmount(preRaw, "pre-swap balance");
  const post = parseRawAmount(postRaw, "post-swap balance");
  if (post < pre) {
    throw new ZapBalanceDeltaError(
      "negative-delta",
      `post-swap balance ${post} is below pre-swap balance ${pre}.`,
    );
  }
  return post - pre;
}

export interface ZapLegForDelta {
  readonly index: number;
  readonly outputMint: string;
  readonly expectedOutAmount?: RawAmountInput;
  readonly jupiterQuote?: {
    readonly otherAmountThreshold?: RawAmountInput | null;
  } | null;
}

/** Validate the positional contract between backend legs and basket mints. */
export function validateLegOrdering(
  legs: readonly ZapLegForDelta[],
  constituentMints: readonly string[],
): void {
  if (legs.length !== constituentMints.length) {
    throw new ZapBalanceDeltaError(
      "invalid-leg-order",
      `expected ${constituentMints.length} zap legs, received ${legs.length}.`,
    );
  }

  const seenMints = new Set<string>();
  for (let position = 0; position < legs.length; position += 1) {
    const leg = legs[position];
    if (!Number.isInteger(leg.index) || leg.index !== position) {
      throw new ZapBalanceDeltaError(
        "invalid-leg-order",
        `zap leg at position ${position} has index ${String(leg.index)}.`,
      );
    }
    if (leg.outputMint !== constituentMints[position]) {
      throw new ZapBalanceDeltaError(
        "mint-mismatch",
        `zap leg ${position} output mint does not match the basket constituent.`,
      );
    }
    if (seenMints.has(leg.outputMint)) {
      throw new ZapBalanceDeltaError(
        "invalid-leg-order",
        `zap output mint ${leg.outputMint} appears more than once.`,
      );
    }
    seenMints.add(leg.outputMint);
  }
}

export interface ZapBalanceSnapshotEntry {
  readonly index: number;
  readonly mint: string;
  readonly raw: bigint;
}

export interface ZapBalanceSnapshot {
  readonly entries: readonly ZapBalanceSnapshotEntry[];
}

/** Freeze the pre-swap raw balances for one quote attempt. */
export function createZapBalanceSnapshot(
  constituentMints: readonly string[],
  preBalances: readonly unknown[],
): ZapBalanceSnapshot {
  if (constituentMints.length !== preBalances.length) {
    throw new ZapBalanceDeltaError(
      "snapshot-mismatch",
      `expected ${constituentMints.length} pre-swap balances, received ${preBalances.length}.`,
    );
  }

  const seenMints = new Set<string>();
  const entries = constituentMints.map((mint, index) => {
    if (!mint || seenMints.has(mint)) {
      throw new ZapBalanceDeltaError(
        "snapshot-mismatch",
        "snapshot constituents must contain unique non-empty mint identities.",
      );
    }
    seenMints.add(mint);
    return {
      index,
      mint,
      raw: parseRawAmount(preBalances[index], `pre-swap balance for leg ${index}`),
    };
  });
  return { entries };
}

function snapshotEntryForLeg(
  snapshot: ZapBalanceSnapshot,
  leg: ZapLegForDelta,
): ZapBalanceSnapshotEntry {
  const entry = snapshot.entries[leg.index];
  if (!entry || entry.index !== leg.index) {
    throw new ZapBalanceDeltaError(
      "snapshot-mismatch",
      `no pre-swap snapshot exists for leg ${leg.index}.`,
    );
  }
  if (entry.mint !== leg.outputMint) {
    throw new ZapBalanceDeltaError(
      "mint-mismatch",
      `snapshot mint for leg ${leg.index} does not match the zap output mint.`,
    );
  }
  return entry;
}

/** Compute a positive output delta for a specific ordered leg. */
export function calculateLegDelta(
  snapshot: ZapBalanceSnapshot,
  leg: ZapLegForDelta,
  postRaw: unknown,
): bigint {
  const entry = snapshotEntryForLeg(snapshot, leg);
  return calculateRawDelta(entry.raw, postRaw);
}

function parsePositiveMinOut(value: unknown, label: string): bigint {
  const parsed = parseRawAmount(value, label);
  if (parsed <= 0n) {
    throw new ZapBalanceDeltaError("invalid-min-out", `${label} must be greater than zero.`);
  }
  return parsed;
}

/**
 * Select Jupiter's raw threshold when present. Older/mock quote payloads may
 * omit it, so the exact integer fallback applies the requested slippage to
 * expectedOutAmount and floors the result.
 */
export function minimumRawOutput(leg: ZapLegForDelta, slippageBps: number): bigint {
  const threshold = leg.jupiterQuote?.otherAmountThreshold;
  if (threshold !== undefined && threshold !== null) {
    return parsePositiveMinOut(threshold, "Jupiter otherAmountThreshold");
  }

  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    throw new ZapBalanceDeltaError(
      "invalid-slippage",
      "slippageBps must be an integer between 0 and 9999.",
    );
  }
  const expected = parsePositiveMinOut(leg.expectedOutAmount, "expected output amount");
  const minimum = (expected * BigInt(10_000 - slippageBps)) / 10_000n;
  if (minimum <= 0n) {
    throw new ZapBalanceDeltaError(
      "invalid-min-out",
      "slippage leaves no positive raw minimum output.",
    );
  }
  return minimum;
}

export type LegRecoveryAction = "already-settled" | "execute" | "block-partial";

export interface LegRecoveryResult {
  readonly action: LegRecoveryAction;
  readonly delta: bigint;
  readonly minimumOut: bigint;
}

/**
 * Reconcile balances before retrying a leg. A confirmed minimum delta skips a
 * resend, zero delta is safe to execute, and a positive-but-under-minimum
 * delta is blocked so the UI never blindly duplicates a partial swap.
 */
export function classifyLegRecovery(
  preRaw: unknown,
  postRaw: unknown,
  minimumOutRaw: unknown,
): LegRecoveryResult {
  const minimumOut = parsePositiveMinOut(minimumOutRaw, "minimum output amount");
  const delta = calculateNonNegativeDelta(preRaw, postRaw);
  if (delta >= minimumOut) {
    return { action: "already-settled", delta, minimumOut };
  }
  if (delta === 0n) {
    return { action: "execute", delta, minimumOut };
  }
  return { action: "block-partial", delta, minimumOut };
}
