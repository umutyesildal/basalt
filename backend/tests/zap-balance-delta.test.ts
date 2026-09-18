import { describe, expect, it } from "vitest";

import {
  ZapBalanceDeltaError,
  calculateLegDelta,
  calculateRawDelta,
  classifyLegRecovery,
  createZapBalanceSnapshot,
  minimumRawOutput,
  parseRawAmount,
  validateLegOrdering,
  type ZapLegForDelta,
} from "../../app/lib/zap-balance-delta";

const MINT_A = "MintA111111111111111111111111111111111111111";
const MINT_B = "MintB111111111111111111111111111111111111111";

function leg(index: number, outputMint: string, expectedOutAmount = "1000"): ZapLegForDelta {
  return { index, outputMint, expectedOutAmount };
}

function expectCode(fn: () => unknown, code: ZapBalanceDeltaError["code"]): void {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ZapBalanceDeltaError);
    expect((error as ZapBalanceDeltaError).code).toBe(code);
  }
}

describe("zap raw balance delta invariants", () => {
  it("parses raw amounts as BigInt without Number precision loss", () => {
    expect(parseRawAmount("9007199254740993")).toBe(9007199254740993n);
    expect(parseRawAmount(0n)).toBe(0n);
    expect(parseRawAmount(42)).toBe(42n);
  });

  it("rejects malformed, fractional, negative, and unsafe raw amounts", () => {
    for (const value of ["", "01", "1.5", "1e3", "-1", -1n, Number.MAX_SAFE_INTEGER + 1]) {
      expectCode(() => parseRawAmount(value), "invalid-raw-amount");
    }
  });

  it("subtracts pre-existing ATA inventory from the post-swap balance", () => {
    expect(calculateRawDelta("700", "1250")).toBe(550n);
  });

  it("rejects negative and zero deltas instead of preparing a mint", () => {
    expectCode(() => calculateRawDelta("1250", "1200"), "negative-delta");
    expectCode(() => calculateRawDelta("1250", "1250"), "zero-delta");
  });
});

describe("zap leg identity and snapshots", () => {
  it("requires quote leg ordering and output mints to match basket constituents", () => {
    const legs = [leg(0, MINT_A), leg(1, MINT_B)];
    expect(() => validateLegOrdering(legs, [MINT_A, MINT_B])).not.toThrow();
    expectCode(() => validateLegOrdering([leg(1, MINT_A), leg(0, MINT_B)], [MINT_A, MINT_B]), "invalid-leg-order");
    expectCode(() => validateLegOrdering([leg(0, MINT_B), leg(1, MINT_A)], [MINT_A, MINT_B]), "mint-mismatch");
    expectCode(() => validateLegOrdering([leg(0, MINT_A), leg(1, MINT_A)], [MINT_A, MINT_A]), "invalid-leg-order");
  });

  it("freezes pre-swap balances and calculates a leg delta by mint identity", () => {
    const snapshot = createZapBalanceSnapshot([MINT_A, MINT_B], ["100", "900"]);
    expect(calculateLegDelta(snapshot, leg(0, MINT_A), "650")).toBe(550n);
    expectCode(() => calculateLegDelta(snapshot, leg(0, MINT_B), "650"), "mint-mismatch");
    expectCode(() => calculateLegDelta(snapshot, leg(2, MINT_A), "650"), "snapshot-mismatch");
  });

  it("rejects a snapshot with missing, duplicate, or mismatched balances", () => {
    expectCode(() => createZapBalanceSnapshot([MINT_A, MINT_B], ["1"]), "snapshot-mismatch");
    expectCode(() => createZapBalanceSnapshot([MINT_A, MINT_A], ["1", "2"]), "snapshot-mismatch");
    expectCode(() => createZapBalanceSnapshot([MINT_A], ["-1"]), "invalid-raw-amount");
  });
});

describe("zap minimum raw output", () => {
  it("prefers Jupiter otherAmountThreshold when present", () => {
    const quoted: ZapLegForDelta = {
      ...leg(0, MINT_A, "100000"),
      jupiterQuote: { otherAmountThreshold: "98765" },
    };
    expect(minimumRawOutput(quoted, 500)).toBe(98765n);
  });

  it("uses an integer, floored slippage fallback when Jupiter omits the threshold", () => {
    expect(minimumRawOutput(leg(0, MINT_A, "1001"), 50)).toBe(995n);
    expect(minimumRawOutput(leg(0, MINT_A, "1001"), 0)).toBe(1001n);
  });

  it("keeps the fallback exact for amounts above Number.MAX_SAFE_INTEGER", () => {
    const expected = 9007199254740993n;
    expect(minimumRawOutput(leg(0, MINT_A, expected), 1)).toBe(
      (expected * 9999n) / 10000n,
    );
  });

  it("rejects invalid thresholds, slippage, and a zero minimum after slippage", () => {
    expectCode(
      () => minimumRawOutput({ ...leg(0, MINT_A), jupiterQuote: { otherAmountThreshold: "0" } }, 50),
      "invalid-min-out",
    );
    expectCode(
      () => minimumRawOutput({ ...leg(0, MINT_A), jupiterQuote: { otherAmountThreshold: "-1" } }, 50),
      "invalid-raw-amount",
    );
    expectCode(() => minimumRawOutput(leg(0, MINT_A), 10001), "invalid-slippage");
    expectCode(() => minimumRawOutput(leg(0, MINT_A, "1"), 10000), "invalid-slippage");
  });
});

describe("zap retry reconciliation", () => {
  it("skips a leg already settled at or above minimum output", () => {
    expect(classifyLegRecovery("100", "1150", "1000")).toEqual({
      action: "already-settled",
      delta: 1050n,
      minimumOut: 1000n,
    });
  });

  it("allows execution only when no output arrived", () => {
    expect(classifyLegRecovery("100", "100", "1000")).toEqual({
      action: "execute",
      delta: 0n,
      minimumOut: 1000n,
    });
  });

  it("blocks a positive partial delta to prevent blind duplicate swaps", () => {
    expect(classifyLegRecovery("100", "700", "1000")).toEqual({
      action: "block-partial",
      delta: 600n,
      minimumOut: 1000n,
    });
  });

  it("rejects a balance rollback during reconciliation", () => {
    expectCode(() => classifyLegRecovery("1000", "999", "100"), "negative-delta");
    expectCode(() => classifyLegRecovery("100", "100", "0"), "invalid-min-out");
  });
});
