import { describe, expect, it } from "vitest";
import {
  BASKET_RETURN_BASELINE_TOLERANCE_MS,
  BASKET_RETURN_MAX_AGE_MS,
  indexedShareReturnPct,
  returnSnapshot,
  snapshotDecimal,
  snapshotTime,
  type ReturnSnapshot,
} from "../src/api/basket-returns";

const NOW = new Date("2026-10-02T12:00:00Z");
const WEEK = 7 * 24 * 60 * 60_000;
const current = (patch: Partial<ReturnSnapshot> = {}): ReturnSnapshot => ({
  nav: "100", supply: "1000000", sharePrice: "0.0001", ts: NOW.toISOString(), ...patch,
});
const baseline = (patch: Partial<ReturnSnapshot> = {}): ReturnSnapshot => ({
  ...current(), ts: new Date(NOW.getTime() - WEEK).toISOString(), ...patch,
});
const pct = (cur = current(), base = baseline(), window: number | null = WEEK) =>
  indexedShareReturnPct(cur, base, NOW, window);

describe("indexed basket share-price returns", () => {
  it("deposit doubles NAV and raw supply without changing investor return", () => {
    expect(pct(current({ nav: "200", supply: "2000000" }))).toBe("0");
  });
  it("proportional withdrawal changes NAV and raw supply without changing return", () => {
    expect(pct(current({ nav: "50", supply: "500000" }))).toBe("0");
  });
  it("captures genuine reference price appreciation", () => {
    expect(pct(current({ nav: "104.21", sharePrice: "0.00010421" }))).toBe("4.21");
  });
  it("includes share dilution in reference price return", () => {
    expect(pct(current({ supply: "2000000", sharePrice: "0.00005" }))).toBe("-50");
  });
  it("preserves huge exact decimal values without Number conversion", () => {
    const big = "900719925474099312345678";
    expect(pct(current({ nav: big, sharePrice: "110000000000000000000" }),
      baseline({ nav: big, sharePrice: "100000000000000000000" }))).toBe("10");
    expect(snapshotDecimal(big)).toBe(big);
  });
  it("supports a real zero current share price as a 100% loss", () => {
    expect(pct(current({ nav: "0", sharePrice: "0" }))).toBe("-100");
  });
  it.each([
    { supply: "0" }, { supply: null }, { sharePrice: "0" },
    { sharePrice: null }, { nav: null }, { nav: "-1" }, { ts: null },
  ])("missing or invalid baseline %j stays unavailable", (patch) => {
    expect(pct(current(), baseline(patch))).toBeNull();
  });
  it.each([{ supply: "0" }, { sharePrice: null }, { nav: "-1" }, { ts: null }])(
    "invalid latest %j stays unavailable", (patch) => {
      expect(pct(current(patch))).toBeNull();
    },
  );
  it("rejects stale and future latest snapshots", () => {
    expect(pct(current({ ts: new Date(NOW.getTime() - BASKET_RETURN_MAX_AGE_MS - 1).toISOString() }))).toBeNull();
    expect(pct(current({ ts: new Date(NOW.getTime() + 1).toISOString() }))).toBeNull();
  });
  it("accepts the freshness and one-hour baseline boundaries", () => {
    const curMs = NOW.getTime() - BASKET_RETURN_MAX_AGE_MS;
    expect(pct(current({ ts: new Date(curMs).toISOString() }),
      baseline({ ts: new Date(curMs - WEEK - BASKET_RETURN_BASELINE_TOLERANCE_MS).toISOString() }))).toBe("0");
  });
  it("rejects a partial week and a baseline beyond the cutoff tolerance", () => {
    expect(pct(current(), baseline({ ts: new Date(NOW.getTime() - WEEK + 1).toISOString() }))).toBeNull();
    expect(pct(current(), baseline({ ts: new Date(NOW.getTime() - WEEK - BASKET_RETURN_BASELINE_TOLERANCE_MS - 1).toISOString() }))).toBeNull();
  });
  it("one snapshot is not inception history", () => {
    expect(pct(current(), current(), null)).toBeNull();
    expect(pct(current(), baseline(), null)).toBe("0");
  });
  it.each(["NaN", "Infinity", "-Infinity", "", "invalid"])(
    "rejects non-finite decimal text %s", (value) => {
      expect(snapshotDecimal(value)).toBeNull();
    },
  );
  it("normalizes PostgreSQL Date timestamps and preserves decimal/raw-supply strings", () => {
    const row = returnSnapshot({
      cur_nav: "9007199254740993.123456789012",
      cur_supply: "9007199254740993",
      cur_share_price: "0.0001", cur_ts: NOW,
    }, "cur_");
    expect(row).toEqual({
      nav: "9007199254740993.123456789012", supply: "9007199254740993",
      sharePrice: "0.0001", ts: NOW.toISOString(),
    });
    expect(snapshotTime("bad date")).toBeNull();
  });
});
