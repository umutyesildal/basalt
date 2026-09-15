/**
 * Activity page data access — protocol counters for /activity.
 *
 * Source of truth: GET /api/v1/baskets?sort=aum (the core indexer list,
 * backend listBaskets). Per the basket_rankings matview each row's `nav` is
 * the basket's latest TOTAL NAV in USD (share_price = nav / supply), so the
 * roll-up is arithmetic, not estimation:
 *
 *   TVL          = Σ nav across the list
 *   Live baskets = list length
 *   24h          = the row's return_24h fraction, shown as a percent
 *
 * Fees: the API exposes no protocol-wide fees endpoint (fee accrual lives on
 * basket accounts and is only surfaced per-creator), so `feesUsd` is the
 * published zero paired with FEES_NOTE — the Stax convention of showing a
 * counter at 0 with the reason, instead of hiding it. Nothing here is
 * backfilled or fabricated: an empty list yields zeros and a null asOf.
 *
 * Transport goes through the validated `apiQuery` pair (lib/api-client.ts)
 * with the path as a literal at the call site.
 */

import { apiQuery } from "@/lib/api-client";

/** Literal path (api-client trust rules) — never assembled from input. */
const BASKETS_PATH = "/api/v1/baskets";

/** The backend clamps limit to 1..500 — ask for the full board. */
const BASKETS_LIMIT = 500;

/** Micro note rendered next to the published-zero fees counter. */
export const FEES_NOTE = "fees not indexed yet";

export interface BasketActivityRow {
  pubkey: string;
  /** metadata_json.name when present; null falls back to a truncated pubkey. */
  name: string | null;
  symbol: string | null;
  /** NAV per share (USD). */
  sharePrice: number | null;
  /** Latest total NAV (USD) — the per-basket TVL. */
  navUsd: number | null;
  /** 24h return in percent; null when no 24h-old snapshot exists yet. */
  return24hPct: number | null;
  holders: number | null;
  /** Freshness stamp of the NAV snapshot behind the row. */
  asOf: string | null;
}

export interface ActivityStats {
  baskets: BasketActivityRow[];
  /** Σ per-basket total NAV (USD). */
  tvlUsd: number;
  basketCount: number;
  /** Published zero — there is no fees endpoint yet; see FEES_NOTE. */
  feesUsd: number;
  /** Newest NAV snapshot timestamp across the list (null when none). */
  asOf: string | null;
}

/** Postgres numerics arrive as text; absent/NaN stays null — never 0. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** metadata_json may arrive as object or JSON text — parse defensively. */
function metaObj(mj: unknown): Record<string, unknown> | null {
  if (!mj) return null;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
}

/** First non-empty trimmed string at `key` of the metadata JSON. */
function metaString(mj: unknown, key: string): string | null {
  const v = metaObj(mj)?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Load + roll up the activity counters. Throws on transport/API errors so
 * the caller can keep its last good snapshot (the live-proof pattern: a
 * silent refresh never blanks the board).
 */
export async function loadActivityStats(signal?: AbortSignal): Promise<ActivityStats> {
  const res = await apiQuery(
    BASKETS_PATH,
    { sort: "aum", limit: String(BASKETS_LIMIT) },
    { signal, cache: "no-store", headers: { accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`Basket API responded with HTTP ${res.status}`);
  }
  const payload = (await res.json()) as { data?: Array<Record<string, unknown>> } | null;
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  const baskets: BasketActivityRow[] = rows
    .map((row): BasketActivityRow => {
      // return_24h is a raw fraction ("0.0421" = +4.21%).
      const fraction = toNumber(row.return_24h);
      const asOf = row.asOf ?? row.nav_as_of ?? row.refreshed_at;
      return {
        pubkey: typeof row.pubkey === "string" ? row.pubkey : "",
        name: metaString(row.metadata_json, "name"),
        symbol: metaString(row.metadata_json, "symbol"),
        sharePrice: toNumber(row.share_price),
        navUsd: toNumber(row.nav),
        return24hPct: fraction === null ? null : fraction * 100,
        holders: toNumber(row.holders),
        asOf: typeof asOf === "string" ? asOf : null,
      };
    })
    .filter((b) => b.pubkey !== "");

  // Zeros stay zeros when the list is empty — never a placeholder sum.
  const tvlUsd = baskets.reduce((sum, b) => sum + (b.navUsd ?? 0), 0);
  const stamps = baskets
    .map((b) => b.asOf)
    .filter((ts): ts is string => ts !== null)
    .sort();
  const asOf = stamps.length > 0 ? stamps[stamps.length - 1] : null;

  return {
    baskets,
    tvlUsd,
    basketCount: baskets.length,
    feesUsd: 0,
    asOf,
  };
}
