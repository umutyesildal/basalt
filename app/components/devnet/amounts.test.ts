import { describe, expect, it } from "vitest";
import { budgetDeposits, formatTokenUnitsInput, maximumBudget, parseTokenUnits, percentBps, tokenUnits, U64_MAX, weightedSeed } from "./amounts";

describe("devnet exact amount boundaries", () => {
  it("preserves eight decimal places and rejects precision loss or u64 overflow", () => {
    expect(parseTokenUnits("1000.00000001", 8)).toBe(100_000_000_001n);
    expect(parseTokenUnits("0.000000001", 8)).toBeNull();
    expect(parseTokenUnits("184467440737.09551615", 8)).toBe(U64_MAX);
    expect(parseTokenUnits("184467440737.09551616", 8)).toBeNull();
    expect(parseTokenUnits("1e3", 8)).toBeNull();
    expect(tokenUnits(U64_MAX, 8)).toBe("184467440737.09551615");
  });

  it("accepts canonical commas while rejecting malformed grouping without changing raw precision", () => {
    expect(parseTokenUnits("1,000.00000001", 8)).toBe(100_000_000_001n);
    expect(parseTokenUnits("184,467,440,737.09551615", 8)).toBe(U64_MAX);
    expect(parseTokenUnits("184,467,440,737.09551616", 8)).toBeNull();
    expect(parseTokenUnits("1,000.000001", 6)).toBe(1_000_000_001n);
    for (const input of ["1,00", "12,34,567", "1,,000", "0,001", "1,000.0,1"]) expect(parseTokenUnits(input, 8)).toBeNull();
  });

  it("formats blur and max values without dropping decimal intent or precision", () => {
    expect(formatTokenUnitsInput("1000")).toBe("1,000");
    expect(formatTokenUnitsInput("1000.")).toBe("1,000.");
    expect(formatTokenUnitsInput("1000.00000000")).toBe("1,000.00000000");
    expect(formatTokenUnitsInput("1,000.000001", 6)).toBe("1,000.000001");
    expect(formatTokenUnitsInput("1,00.00")).toBe("1,00.00");
    expect(formatTokenUnitsInput("184467440737.09551615")).toBe("184,467,440,737.09551615");
    expect(formatTokenUnitsInput("184467440737.09551616")).toBe("184467440737.09551616");
  });

  it("splits a seed by positive bps without overspending floor dust", () => {
    const deposits = weightedSeed(100_000_000_001n, [1000, 2000, 3000, 4000]);
    expect(deposits).toEqual([10_000_000_000n, 20_000_000_000n, 30_000_000_000n, 40_000_000_000n]);
    expect(deposits.reduce((sum, raw) => sum + raw, 0n)).toBeLessThanOrEqual(100_000_000_001n);
    expect(percentBps("33.33")).toBe(3333);
    expect(percentBps("33.333")).toBeNull();
  });

  it("uses current vault ratios and limits max by every constituent balance", () => {
    const vaults = [500n, 300n, 200n, 100n];
    const balances = [5000n, 600n, 2000n, 1000n];
    const max = maximumBudget(vaults, balances);
    expect(max).toBe(2200n);
    expect(budgetDeposits(max, vaults)).toEqual([1000n, 600n, 400n, 200n]);
    expect(budgetDeposits(max, vaults).every((raw, i) => raw <= balances[i])).toBe(true);
    expect(maximumBudget([0n, 100n], [100n, 100n])).toBe(0n);
  });
});
