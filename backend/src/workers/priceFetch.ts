/** Jupiter Price V3: USD per scaled UI token. NAV only; never gates redeem.
 * `usdPrice` is already multiplier-adjusted. `stockData.price` is a separate
 * underlying-equity reference and is deliberately ignored.
 * https://developers.jup.ag/docs/price
 */
import { getNyseMarketSession, type MarketSession } from "./marketSession.js";

export type PriceSource = "jupiter" | "mock" | "yahoo";
export interface PricePoint {
  mint: string;
  price: number;
  source: PriceSource;
  /** Retrieval time, NOT the time of the source trade. */
  asOf: string;
  unit?: "scaled-ui";
  blockId?: number;
  decimals?: number;
  change24hPct?: number;
  rawUnitPrice?: number;
  multiplier?: number;
}
export type PriceQuoteMap = Record<string, PricePoint>;
export interface PriceMap { [mint: string]: number }
export const PRICE_CACHE_TTL_MS = 30_000;
export const JUPITER_PRICE_URL = "https://api.jup.ag/price/v3";
export const JUPITER_PRICE_BATCH_SIZE = 50;
const MAX_CACHE_ENTRIES = 4096;
export type PriceRefreshOutcome = "priced" | "omitted" | "outage";
export interface PriceQuoteResult { point: PricePoint | null; outcome: PriceRefreshOutcome; refreshedAt: string; retryAfterMs?: number }
const cache = new Map<string, { point: PricePoint | null; fetchedAt: number; requestOrder: number; outcome: PriceRefreshOutcome; retryAfterMs?: number }>();
const pending = new Map<string, Promise<void>>();
const lastValid = new Map<string, PricePoint>();
let requestOrder = 0;
let cacheGeneration = 0;
export function clearPriceCache(): void { cache.clear(); pending.clear(); lastValid.clear(); cacheGeneration++; }
export interface FetchPricesOptions {
  now?: () => Date;
  fetchImpl?: typeof fetch;
  fallback?: "mock" | "none";
  forceRefresh?: boolean;
  /** Server-side only. Public reads may work without a key; 401 fails closed. */
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Explicit injection for tests; production follows the NYSE cash session. */
  marketSession?: (now: Date) => MarketSession;
}
function marketOpen(opts: FetchPricesOptions): boolean {
  return (opts.marketSession ?? getNyseMarketSession)((opts.now ?? (() => new Date()))()).isOpen;
}
/** Restore only previously validated public quotes for closed-session NAV reads. */
export function restoreLastValidPriceQuotes(points: PricePoint[]): void {
  for (const point of points) {
    if (point.source !== "jupiter" || point.unit !== "scaled-ui" || !Number.isFinite(point.price) || point.price <= 0 || !Number.isFinite(Date.parse(point.asOf))) continue;
    const old = lastValid.get(point.mint);
    if (old && ((old.blockId && point.blockId && old.blockId > point.blockId) || Date.parse(old.asOf) > Date.parse(point.asOf))) continue;
    lastValid.set(point.mint, { ...point });
  }
  while (lastValid.size > MAX_CACHE_ENTRIES) lastValid.delete(lastValid.keys().next().value!);
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
export function parseJupiterPrice(mint: string, value: unknown, now: Date): PricePoint | null {
  const entry = object(value);
  const price = positive(entry?.usdPrice);
  if (!entry || price === null) return null;
  const point: PricePoint = { mint, price, source: "jupiter", asOf: now.toISOString(), unit: "scaled-ui" };
  if (Number.isSafeInteger(entry.blockId) && (entry.blockId as number) > 0) point.blockId = entry.blockId as number;
  if (Number.isInteger(entry.decimals) && (entry.decimals as number) >= 0 && (entry.decimals as number) <= 18) point.decimals = entry.decimals as number;
  if (typeof entry.priceChange24h === "number" && Number.isFinite(entry.priceChange24h)) point.change24hPct = entry.priceChange24h;
  const config = object(entry.scaledUiConfig);
  if (config) {
    const scheduledAt = typeof config.newMultiplierEffectiveAt === "string" ? Date.parse(config.newMultiplierEffectiveAt) : NaN;
    const effective = Number.isFinite(scheduledAt) && now.getTime() >= scheduledAt ? config.newMultiplier : config.multiplier;
    const multiplier = positive(effective);
    const rawUnitPrice = positive(config.usdPricePrescaled);
    if (multiplier !== null) point.multiplier = multiplier;
    if (rawUnitPrice !== null) point.rawUnitPrice = rawUnitPrice;
  }
  return point;
}
function mockPoint(mint: string, price: number, asOf: string): PricePoint {
  return { mint, price, source: "mock", asOf };
}
async function fetchBatch(mints: string[], opts: FetchPricesOptions): Promise<void> {
  if (!marketOpen(opts)) return;
  const key = [...mints].sort().join(",");
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const order = ++requestOrder;
  const generation = cacheGeneration;
  const job = (async () => {
    let body: Record<string, unknown> | null = null;
    let retryAfterMs: number | undefined;
    try {
      const apiKey = opts.apiKey ?? process.env.JUPITER_API_KEY;
      const response = await (opts.fetchImpl ?? fetch)(`${JUPITER_PRICE_URL}?ids=${encodeURIComponent(mints.join(","))}`, {
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 8_000)]) : AbortSignal.timeout(opts.timeoutMs ?? 8_000),
        ...(apiKey ? { headers: { "x-api-key": apiKey } } : {}),
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          const seconds = retry === null ? NaN : Number(retry);
          const retryDate = retry === null ? NaN : Date.parse(retry);
          const reset = Number(response.headers.get("x-ratelimit-reset")) * 1_000;
          const delays = [Number.isFinite(seconds) ? seconds * 1_000 : retryDate - Date.now(), reset - Date.now()]
            .filter(delay => Number.isFinite(delay) && delay > 0);
          retryAfterMs = Math.min(60_000, delays.length ? Math.max(...delays) + 250 : 10_000);
        }
        throw new Error(`HTTP ${response.status}`);
      }
      body = object(await response.json());
      if (!body) throw new Error("invalid response");
    } catch (error) {
      // Do not log credentials, response bodies or URLs containing secrets.
      console.warn("[priceFetch] Jupiter V3 unavailable:", error instanceof Error ? error.message : "request failed");
    }
    if (!marketOpen(opts)) return;
    const at = (opts.now ?? (() => new Date()))();
    for (const mint of mints) {
      const current = cache.get(mint);
      if (generation !== cacheGeneration || (current && current.requestOrder > order)) continue;
      let point = parseJupiterPrice(mint, body?.[mint], at);
      const previousValid = lastValid.get(mint);
      if (point?.blockId && previousValid?.blockId && point.blockId < previousValid.blockId) point = null;
      if (point) restoreLastValidPriceQuotes([point]);
      cache.set(mint, { point, fetchedAt: at.getTime(), requestOrder: order, outcome: point ? "priced" : body ? "omitted" : "outage", ...(retryAfterMs ? { retryAfterMs } : {}) });
    }
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  })();
  pending.set(key, job);
  try { await job; } finally { if (pending.get(key) === job) pending.delete(key); }
}
/** Per-mint cache, <=50 mints per request, at most two simultaneous batches.
 * Missing/invalid prices remain absent. A failed refresh never serves an old
 * price with a new timestamp; negative results also have a short cache TTL.
 */
export async function fetchPriceQuotes(mints: string[], opts: FetchPricesOptions = {}): Promise<PriceQuoteMap> {
  const unique = [...new Set(mints)].filter(m => typeof m === "string" && m.length > 0);
  const now = (opts.now ?? (() => new Date()))();
  const missing = unique.filter(m => {
    const hit = cache.get(m);
    return opts.forceRefresh || !hit || now.getTime() - hit.fetchedAt >= PRICE_CACHE_TTL_MS || now.getTime() < hit.fetchedAt;
  });
  for (let i = 0; i < missing.length && marketOpen(opts); i += JUPITER_PRICE_BATCH_SIZE * 2) {
    await Promise.all([
      missing.slice(i, i + JUPITER_PRICE_BATCH_SIZE),
      missing.slice(i + JUPITER_PRICE_BATCH_SIZE, i + JUPITER_PRICE_BATCH_SIZE * 2),
    ].filter(batch => batch.length > 0).map(batch => fetchBatch(batch, opts)));
  }
  const points: PriceQuoteMap = {};
  const mode = opts.fallback ?? (process.env.PRICE_FALLBACK === "mock" ? "mock" : "none");
  for (const mint of unique) {
    const point = marketOpen(opts) ? cache.get(mint)?.point : lastValid.get(mint);
    if (point) points[mint] = { ...point };
    else if (mode === "mock") points[mint] = mockPoint(mint, 0, now.toISOString());
  }
  return points;
}
/** Provider outcome is separate from a usable quote: an omitted mint is not an HTTP outage. */
export async function fetchPriceQuoteResults(mints: string[], opts: FetchPricesOptions = {}): Promise<Record<string, PriceQuoteResult>> {
  await fetchPriceQuotes(mints, { ...opts, fallback: "none" });
  return Object.fromEntries([...new Set(mints)].map(mint => {
    const entry = cache.get(mint);
    return [mint, { point: entry?.point ? { ...entry.point } : null, outcome: entry?.outcome ?? "outage",
      refreshedAt: entry ? new Date(entry.fetchedAt).toISOString() : (opts.now ?? (() => new Date()))().toISOString(),
      ...(entry?.retryAfterMs ? { retryAfterMs: entry.retryAfterMs } : {}) }];
  }));
}
/** Legacy wrapper for dev helpers. Public APIs expose missing prices as null. */
export async function fetchPrices(mints: string[], opts: FetchPricesOptions = {}): Promise<PriceMap> {
  const quotes = await fetchPriceQuotes(mints, opts);
  return Object.fromEntries(mints.map(mint => [mint, quotes[mint]?.price ?? 0]));
}
export function mockPrices(mints: string[], price = 100): PriceMap {
  return Object.fromEntries(mints.map(mint => [mint, price]));
}
export function mockPriceQuotes(mints: string[], price = 0, now: () => Date = () => new Date()): PriceQuoteMap {
  return Object.fromEntries(mints.map(mint => [mint, mockPoint(mint, price, now().toISOString())]));
}
