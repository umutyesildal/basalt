/**
 * Event markers for the basket History chart — indexer `events` rows
 * (BasketCreated / Minted / Redeemed / FeeAccrued) surfaced over REST.
 *
 * Two data paths, both honest about provenance:
 *
 *  1. Spec §8 `GET /api/v1/events?basket=&type=&limit=` — the normative route.
 *     Used when the backend serves it; carries all event types including
 *     FeeAccrued with on-chain share amounts.
 *  2. Social trade feed fallback — `GET /api/v1/feed?type=trades` filtered to
 *     this basket client-side. The feed is built on the same indexer `events`
 *     ledger, so markers stay verified on-chain activity (Minted/Redeemed
 *     only, with estimated USD); it exists because the /events route is not
 *     deployed on every environment yet. The UI labels this path.
 *
 * No fabrication: when neither path yields rows the caller renders a quiet
 * empty note, never synthetic markers.
 */

import { apiFetch } from "@/lib/api-client";
import { fetchFeed } from "@/lib/social-api";

export type BasketEventType = "Minted" | "Redeemed" | "FeeAccrued";

export interface BasketEventMarker {
  /** Transaction signature (dedupe key). */
  sig: string;
  ts: string;
  type: BasketEventType;
  /** Share amount when the payload carries a parseable one; null renders "—". */
  shares: number | null;
  /** Estimated USD — trade-feed path only; the UI labels it "est.". */
  usdValue: number | null;
  /** Provenance of this row: "onchain-events" or "trade-feed". */
  source: string;
}

export interface BasketEventsResult {
  markers: BasketEventMarker[];
  /** Which path served the markers (FreshnessBadge source). */
  source: string;
  /** UI note explaining coverage limits of the path that served the data. */
  note: string | null;
}

const MAX_FEED_PAGES = 3;
const FEED_PAGE_LIMIT = 50;

function isBasketEventType(value: unknown): value is BasketEventType {
  return value === "Minted" || value === "Redeemed" || value === "FeeAccrued";
}

/** Defensive numeric read — null when absent/NaN, never 0-by-default. */
function readNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Path 1 — spec §8 events route. Shape per the events table: rows carry
 * `sig/type/ts` plus a `data` jsonb object whose keys differ per type
 * (netShares/sharesBurned/sharesMinted). Parsed defensively; any row without a
 * known type or timestamp is skipped rather than guessed.
 */
async function fetchEventsRoute(
  pubkey: string,
  signal: AbortSignal,
): Promise<BasketEventsResult | null> {
  let res: Response;
  try {
    res = await apiFetch(
      `/api/v1/events?basket=${encodeURIComponent(pubkey)}&limit=100`,
      { signal, cache: "no-store", headers: { accept: "application/json" } },
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return null;
  }
  if (!res.ok) return null;
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    return null;
  }
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return null;
  const markers: BasketEventMarker[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (!isBasketEventType(record.type)) continue;
    const ts = readString(record.ts);
    const sig = readString(record.sig) ?? `${String(record.type)}-${String(record.ts)}`;
    if (!ts) continue;
    const data =
      record.data && typeof record.data === "object"
        ? (record.data as Record<string, unknown>)
        : {};
    const shares =
      readNumber(data.netShares) ??
      readNumber(data.grossShares) ??
      readNumber(data.sharesBurned) ??
      readNumber(data.sharesMinted);
    markers.push({ sig, ts, type: record.type, shares, usdValue: null, source: "onchain-events" });
  }
  return {
    markers,
    source: "onchain-events",
    note:
      markers.length > 0
        ? null
        : "The indexer has no events for this basket yet — markers appear after the first mint.",
  };
}

/**
 * Path 2 — social trade feed filtered to this basket. Same indexer ledger,
 * Minted/Redeemed only, up to a few most-recent pages (the feed has no basket
 * filter, so coverage is "recent", not "all time" — the note says so).
 */
async function fetchTradeFeedFallback(
  pubkey: string,
  signal: AbortSignal,
): Promise<BasketEventsResult> {
  const markers: BasketEventMarker[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_FEED_PAGES; page += 1) {
    const payload = await fetchFeed(
      { scope: "all", type: "trades", limit: FEED_PAGE_LIMIT, cursor },
      signal,
    );
    for (const item of payload.items) {
      if (item.kind !== "trade" || item.basket !== pubkey) continue;
      markers.push({
        sig: item.sig,
        ts: item.ts,
        type: item.type,
        shares: typeof item.shares === "number" && Number.isFinite(item.shares) ? item.shares : null,
        usdValue:
          typeof item.usdValue === "number" && Number.isFinite(item.usdValue) ? item.usdValue : null,
        source: "trade-feed",
      });
    }
    cursor = payload.nextCursor;
    if (!cursor) break;
  }
  return {
    markers,
    source: "trade-feed",
    note:
      markers.length > 0
        ? "Markers come from the public trade feed (most recent events) — fee accruals are not surfaced on this path yet."
        : "No mint or redeem events for this basket in the recent feed window — markers appear after the first indexed trade.",
  };
}

/**
 * Load event markers for one basket: spec /events route first, trade-feed
 * fallback when the route is not served (404 / unexpected shape).
 */
export async function fetchBasketEventMarkers(
  pubkey: string,
  signal: AbortSignal,
): Promise<BasketEventsResult> {
  const viaRoute = await fetchEventsRoute(pubkey, signal);
  if (viaRoute) return viaRoute;
  return fetchTradeFeedFallback(pubkey, signal);
}

/** Chronological order for chart markers (oldest first). */
export function sortMarkers(markers: BasketEventMarker[]): BasketEventMarker[] {
  return [...markers].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}
