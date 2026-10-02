/**
 * Indexed reference performance. share_price stays USD per RAW share unit.
 * NAV runs every minute: current observations expire after 15 minutes and
 * window baselines must be at/before the cutoff, within one hour of it.
 * These indexer quality rules never gate mint or redeem.
 */
import { decimalToFixedUnits, NAV_SCALE, pctReturnExact } from "../workers/navEngine.js";

export const BASKET_RETURN_MAX_AGE_MS = 15 * 60_000;
export const BASKET_RETURN_BASELINE_TOLERANCE_MS = 60 * 60_000;

/** Trusted static fragment. Every caller uses the fixed current alias cur. */
export const BASKET_RETURN_CURRENT_SQL = `cur.supply > 0
    AND cur.nav >= 0 AND cur.share_price >= 0
    AND cur.nav::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND cur.share_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND cur.ts <= NOW() AND cur.ts >= NOW() - interval '15 minutes'`;

export interface ReturnSnapshot {
  nav: string | null;
  supply: string | null;
  sharePrice: string | null;
  ts: string | null;
}

/** Validate exact NUMERIC text without a Number round-trip. */
export function snapshotDecimal(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const text = value.trim();
  try {
    decimalToFixedUnits(text, NAV_SCALE);
    return text;
  } catch {
    return null;
  }
}

export function snapshotTime(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function rawSupply(value: unknown): string | null {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

export function returnSnapshot(row: Record<string, unknown>, prefix: string): ReturnSnapshot {
  return {
    nav: snapshotDecimal(row[prefix + "nav"]),
    supply: rawSupply(row[prefix + "supply"]),
    sharePrice: snapshotDecimal(row[prefix + "share_price"]),
    ts: snapshotTime(row[prefix + "ts"]),
  };
}

export function snapshotIsFresh(snapshot: ReturnSnapshot, now: Date): boolean {
  if (snapshot.ts === null || !Number.isFinite(now.getTime())) return false;
  const age = now.getTime() - new Date(snapshot.ts).getTime();
  return age >= 0 && age <= BASKET_RETURN_MAX_AGE_MS;
}

function usablePrice(snapshot: ReturnSnapshot, baseline: boolean): boolean {
  if (snapshot.supply === null || BigInt(snapshot.supply) <= 0n ||
      snapshot.nav === null || snapshot.sharePrice === null || snapshot.ts === null) return false;
  const nav = decimalToFixedUnits(snapshot.nav, NAV_SCALE);
  const price = decimalToFixedUnits(snapshot.sharePrice, NAV_SCALE);
  return nav >= 0n && (baseline ? price > 0n : price >= 0n);
}

/** Percent string; null means no trustworthy complete return window. */
export function indexedShareReturnPct(
  current: ReturnSnapshot,
  baseline: ReturnSnapshot,
  now: Date,
  windowMs: number | null,
): string | null {
  if (!snapshotIsFresh(current, now) || !usablePrice(current, false) || !usablePrice(baseline, true)) return null;
  const currentMs = new Date(current.ts!).getTime();
  const baselineMs = new Date(baseline.ts!).getTime();
  if (windowMs === null) {
    if (baselineMs >= currentMs) return null; // one observation is not history
  } else {
    const cutoff = currentMs - windowMs;
    if (baselineMs > cutoff || baselineMs < cutoff - BASKET_RETURN_BASELINE_TOLERANCE_MS) return null;
  }
  return pctReturnExact(current.sharePrice!, baseline.sharePrice!);
}
