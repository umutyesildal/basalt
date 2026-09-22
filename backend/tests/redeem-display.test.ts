import { describe, expect, it } from "vitest";
import {
  computeRedeemPreview,
  formatRawShares6,
  parseShareAmount6,
} from "../../app/components/basket/basket-math";

describe("redeem share input and displayed consequences", () => {
  it("converts human shares to exact six-decimal raw units", () => {
    expect(parseShareAmount6("1.5")).toBe(1_500_000n);
    expect(parseShareAmount6("0.000001")).toBe(1n);
    expect(parseShareAmount6(formatRawShares6(1_234_567n))).toBe(1_234_567n);
    expect(parseShareAmount6("0.0000001")).toBeNull();
    expect(parseShareAmount6("1e6")).toBeNull();
    expect(parseShareAmount6("18446744073709.551616")).toBeNull();
  });

  it("discloses all shares leaving the wallet and floors the actual exit fee", () => {
    const shares = parseShareAmount6("1");
    expect(shares).toBe(1_000_000n);
    const preview = computeRedeemPreview([550_000_000n], 10_000_000n, shares!, 50);
    expect(preview).toEqual({
      exitFee: 5_000n,
      burn: 995_000n,
      outs: [54_725_000n],
    });
    expect(preview!.exitFee + preview!.burn).toBe(shares);
  });
});
