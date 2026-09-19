import { describe, expect, it } from "vitest";

import {
  BPS_DENOMINATOR,
  CREATOR_FEE_SPLIT_BPS,
  PROTOCOL_FEE_SPLIT_LABEL,
  TREASURY_FEE_SPLIT_BPS,
  splitProtocolFee,
} from "../../app/lib/protocol-policy.ts";

describe("client protocol fee policy", () => {
  it("exposes only the canonical V0 90/10 split", () => {
    expect(BPS_DENOMINATOR).toBe(10_000);
    expect(CREATOR_FEE_SPLIT_BPS).toBe(9_000);
    expect(TREASURY_FEE_SPLIT_BPS).toBe(1_000);
    expect(PROTOCOL_FEE_SPLIT_LABEL).toBe("90% creator / 10% treasury");
  });

  it("floors the creator leg and conserves every raw fee share", () => {
    for (const fee of [0n, 1n, 2n, 9n, 10n, 11n, 99n, 10_000n, (1n << 64n) - 1n]) {
      const split = splitProtocolFee(fee);
      expect(split.creator).toBe((fee * 9_000n) / 10_000n);
      expect(split.creator + split.treasury).toBe(fee);
    }
  });

  it("rejects negative fees", () => {
    expect(() => splitProtocolFee(-1n)).toThrow(RangeError);
  });
});
