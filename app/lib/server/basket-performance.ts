import { CONCEPT_BASKETS } from "@/lib/concept-samples";
import {
  calculateBasketPerformance,
  parseYahooDailySeries,
  type BasketPerformanceResponse,
  type UnderlyingDailySeries,
} from "@/lib/basket-performance";

if (typeof window !== "undefined") throw new Error("Basket market data must be fetched on the server.");

const YAHOO_ORIGIN = "https://query1.finance.yahoo.com";
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,14}$/;
const CACHE_MS = 5 * 60_000;
const UNAVAILABLE_CACHE_MS = 30_000;
const TIMEOUT_MS = 10_000;
const FETCH_BUDGET_MS = 50_000;
const MAX_CONCURRENCY = 4;
// Fixed history start retains the September anchor as the calendar moves on.
const HISTORY_START_SECONDS = Date.parse("2026-08-22T00:00:00.000Z") / 1000;

const symbolCache = new Map<string, { expiresAt: number; series: UnderlyingDailySeries }>();
const symbolRequests = new Map<string, Promise<UnderlyingDailySeries>>();
let responseCache: { key: string; expiresAt: number; response: BasketPerformanceResponse } | null = null;
let responseRequest: { key: string; promise: Promise<BasketPerformanceResponse> } | null = null;

async function fetchSymbol(symbol: string, now: Date, budgetSignal: AbortSignal): Promise<UnderlyingDailySeries> {
  if (!SYMBOL_RE.test(symbol)) throw new Error("Unsupported underlying symbol.");
  const cached = symbolCache.get(symbol);
  if (cached && cached.expiresAt > now.getTime()) return cached.series;
  const pending = symbolRequests.get(symbol);
  if (pending) return pending;
  const promise = (async () => {
    const url = new URL("/v8/finance/chart/" + encodeURIComponent(symbol), YAHOO_ORIGIN);
    url.searchParams.set("period1", String(HISTORY_START_SECONDS));
    url.searchParams.set("period2", String(Math.floor(now.getTime() / 1000)));
    url.searchParams.set("interval", "1d");
    url.searchParams.set("includePrePost", "false");
    if (url.origin !== YAHOO_ORIGIN || !/^\/v8\/finance\/chart\/[A-Z0-9.%\-]+$/.test(url.pathname)) throw new Error("Unexpected upstream URL.");
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Basalt/0.1)", accept: "application/json" },
      signal: AbortSignal.any([budgetSignal, AbortSignal.timeout(TIMEOUT_MS)]), redirect: "error", cache: "no-store",
    });
    if (!response.ok) throw new Error("Underlying market feed is unavailable.");
    const series = parseYahooDailySeries(symbol, await response.json(), now);
    symbolCache.set(symbol, { series, expiresAt: now.getTime() + CACHE_MS });
    return series;
  })();
  symbolRequests.set(symbol, promise);
  try { return await promise; } finally { symbolRequests.delete(symbol); }
}

export async function getBasketPerformance(): Promise<BasketPerformanceResponse> {
  const key = JSON.stringify(CONCEPT_BASKETS.map((basket) => ({ id: basket.id, allocations: basket.allocations })));
  const now = new Date();
  if (responseCache?.key === key && responseCache.expiresAt > now.getTime()) return responseCache.response;
  if (responseRequest?.key === key) return responseRequest.promise;
  const promise = (async () => {
    const budgetSignal = AbortSignal.timeout(FETCH_BUDGET_MS);
    const symbols = [...new Set(CONCEPT_BASKETS.flatMap((basket) => basket.allocations.map((asset) => asset.symbol)))];
    const underlying: Record<string, UnderlyingDailySeries> = {};
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, symbols.length) }, async () => {
      for (;;) {
        if (budgetSignal.aborted) return;
        const index = next++;
        if (index >= symbols.length) return;
        const symbol = symbols[index];
        try { underlying[symbol] = await fetchSymbol(symbol, now, budgetSignal); } catch { /* Missing inputs fail closed per basket. */ }
      }
    }));
    const response = calculateBasketPerformance(CONCEPT_BASKETS, underlying, new Date().toISOString());
    responseCache = { key, response, expiresAt: Date.now() + (response.status === "ready" ? CACHE_MS : UNAVAILABLE_CACHE_MS) };
    return response;
  })();
  responseRequest = { key, promise };
  try { return await promise; } finally { if (responseRequest?.promise === promise) responseRequest = null; }
}
