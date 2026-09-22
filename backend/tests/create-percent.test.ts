import { describe, expect, it } from "vitest";
import { parsePercentToBps } from "../../app/lib/percent";

describe("create allocation boundary", () => {
  it("preserves hundredth-percent precision and the exact program total", () => {
    const weights = ["33.33", "33.33", "33.34"].map(parsePercentToBps);
    expect(weights).toEqual([3333, 3333, 3334]);
    expect(weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0)).toBe(10_000);
  });

  it("rejects amounts that cannot be submitted exactly", () => {
    for (const text of ["0.001", "100.01", "-1", "", "1,5", "Infinity"]) {
      expect(parsePercentToBps(text)).toBeNull();
    }
    expect(parsePercentToBps("0.01")).toBe(1);
    expect(parsePercentToBps("100")).toBe(10_000);
  });
});
