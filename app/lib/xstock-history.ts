import { apiQuery } from "@/lib/api-client";
import { isSolanaMint } from "@/lib/xstock-types";

export type XStockHistoryRange = "7d" | "30d";
export interface XStockHistoryPoint { timestamp: string; priceUsd: number }
export interface XStockHistory {
  mint: string;
  range: XStockHistoryRange;
  windowEnd: string;
  points: XStockHistoryPoint[];
  change7dPct: number | null;
  change30dPct: number | null;
  source: "geckoterminal" | "unavailable";
  unit: "scaled-ui";
  interval: "1d";
  observedAt: string | null;
  fetchedAt: string | null;
  poolAddress: string | null;
  status: "available" | "unavailable" | "loading";
  failure?: "outage";
  refreshing?: boolean;
}
const DAY_MS = 86_400_000;
const dateString = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const windowEnd = (now: number) => new Date(Math.floor(now / DAY_MS) * DAY_MS).toISOString();
export const nextXStockHistoryRefreshAt = (now = Date.now()) => (Math.floor(now / DAY_MS) + 1) * DAY_MS + 1_000;

export function unavailableXStockHistory(mint: string, range: XStockHistoryRange, now = Date.now()): XStockHistory {
  return { mint, range, windowEnd: windowEnd(now), points: [], change7dPct: null, change30dPct: null, source: "unavailable", unit: "scaled-ui", interval: "1d", observedAt: null, fetchedAt: null, poolAddress: null, status: "unavailable" };
}

/** A recent endpoint and the exact calendar-day anchor are required, not merely two prices. */
export function xstockHistoryChange(history: XStockHistory | undefined, range: XStockHistoryRange = "7d", now = Date.now()): number | null {
  if (!history || history.status !== "available" || history.windowEnd !== windowEnd(now)) return null;
  const end = Date.parse(history.windowEnd);
  const start = end - (range === "7d" ? 7 : 30) * DAY_MS;
  const first = history.points.find(point => Date.parse(point.timestamp) === start);
  const last = history.points.find(point => Date.parse(point.timestamp) === end);
  if (!first || !last) return null;
  const reported = range === "7d" ? history.change7dPct : history.change30dPct;
  const calculated = (last.priceUsd / first.priceUsd - 1) * 100;
  return reported !== null && Number.isFinite(reported) && Math.abs(reported - calculated) < 0.0001 ? reported : null;
}

export function parseXStockHistory(input: unknown, mint: string, range: XStockHistoryRange, now = Date.now()): XStockHistory {
  const empty = unavailableXStockHistory(mint, range, now);
  if (!input || typeof input !== "object") return empty;
  const row = input as Record<string, unknown>;
  if (row.mint === mint && row.range === range && row.status === "loading" && row.unit === "scaled-ui") return { ...empty, status: "loading" };
  if (row.mint !== mint || row.range !== range || row.source !== "geckoterminal" || row.unit !== "scaled-ui" || row.interval !== "1d" || row.status !== "available" || !Array.isArray(row.points) || row.points.length > 400) return empty;
  const end = dateString(row.windowEnd);
  if (!end || Date.parse(end) > now || Date.parse(end) % DAY_MS !== 0) return empty;
  const points: XStockHistoryPoint[] = [];
  const seen = new Set<string>();
  for (const candidate of row.points) {
    if (!candidate || typeof candidate !== "object") return empty;
    const point = candidate as Record<string, unknown>;
    const timestamp = dateString(point.timestamp);
    if (!timestamp || Date.parse(timestamp) > Date.parse(end) || Date.parse(timestamp) % DAY_MS !== 0 || typeof point.priceUsd !== "number" || !Number.isFinite(point.priceUsd) || point.priceUsd <= 0 || seen.has(timestamp)) return empty;
    seen.add(timestamp);
    if (Date.parse(timestamp) >= Date.parse(end) - (range === "7d" ? 7 : 30) * DAY_MS) points.push({ timestamp, priceUsd: point.priceUsd });
  }
  points.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return { mint, range, windowEnd: end, points, source: "geckoterminal", unit: "scaled-ui", interval: "1d", status: points.length >= 2 ? "available" : "unavailable", change7dPct: finite(row.change7dPct), change30dPct: finite(row.change30dPct), observedAt: dateString(row.observedAt), fetchedAt: dateString(row.fetchedAt), poolAddress: isSolanaMint(row.poolAddress) ? row.poolAddress : null, refreshing: row.refreshing === true };
}

/** Keep a usable same-range curve through a cold refresh or transport failure only. */
export function mergeXStockHistories(previous: ReadonlyMap<string, XStockHistory>, incoming: readonly XStockHistory[]): Map<string, XStockHistory> {
  const next = new Map(previous);
  for (const row of incoming) {
    const known = previous.get(row.mint);
    const retain = known?.status === "available" && known.range === row.range && (row.status === "loading" || row.failure === "outage");
    next.set(row.mint, retain ? known : row);
  }
  return next;
}

/** Fetch only visible assets. Historical candles are independent of the spot polling session. */
export async function fetchXStockHistory(mints: readonly string[], range: XStockHistoryRange, signal?: AbortSignal): Promise<XStockHistory[]> {
  const requested = [...new Set(mints)].filter(isSolanaMint).slice(0, 24);
  if (!requested.length) return [];
  try {
    const response = await apiQuery("/api/v1/xstocks/history", { mints: requested.join(","), range }, { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error("History unavailable");
    const payload = await response.json() as { data?: unknown };
    if (!Array.isArray(payload.data)) throw new Error("History unavailable");
    const byMint = new Map(payload.data.filter(row => row && typeof row === "object").map(row => [row.mint, row]));
    return requested.map(mint => parseXStockHistory(byMint.get(mint), mint, range));
  } catch { return requested.map(mint => ({ ...unavailableXStockHistory(mint, range), failure: "outage" as const })); }
}
