/**
 * Daily-close price series for the listing cards (/stocks, /etfs).
 *
 * Two backend routes, both serving REAL Yahoo Finance daily bars for the
 * underlying equity — never a simulated series:
 *
 *  1. GET /api/v1/prices/chart?ticker=<t>&range=5d → data.yahoo.candles.
 *     The backend maps display tickers via its YAHOO_MAP (TSLAx→TSLA,
 *     AAPLx→AAPL, NVDAx→NVDA, SPYx→SPY). The chart payload also carries an
 *     `xStock` series — that one is SIMULATED (backend jitter around the
 *     Yahoo close) and is deliberately never read here, same rule the /stock
 *     detail page already follows.
 *
 *  2. Fallback for tickers outside YAHOO_MAP: GET
 *     /api/v1/prices/yahoo?symbol=<U>&range=5d, where <U> is the underlying
 *     derived from the dev catalog priceSource slug ("mock:msft" → "MSFT") —
 *     the exact resolution backend/src/catalog/mockStocks.ts
 *     MOCK_SLUG_TO_TICKER pins (slug === lowercase real ticker for all 12
 *     catalog entries). The backend itself quotes mock xStocks from the real
 *     market through that same table, so the underlying series is the honest
 *     figure for a mock ticker.
 *
 * "7d" convention: range=5d returns the last five daily sessions — the
 * standard one-week trading window (5 sessions ≈ 7 calendar days).
 * changePct7d = (last − first) / first × 100 over that window;
 * changePct24h uses the last two closes. Every figure comes from the same
 * real closes. Failures resolve to null and the card renders its honest
 * empty surface ("7d —") — nothing is fabricated.
 */

import { apiQuery } from "@/lib/api-client";

export interface DailyCloseSeries {
  ticker: string;
  /** Real underlying daily closes, oldest → newest (empty when no data). */
  closes: number[];
  /** Last-close vs previous-close, percent. */
  changePct24h: number | null;
  /** Last-close vs first close of the 5-session window, percent. */
  changePct7d: number | null;
  /** Last candle epoch ms — feeds FreshnessBadge `asOf`. */
  lastTs: number | null;
}

interface ChartCandle {
  ts?: unknown;
  close?: unknown;
}

interface YahooCandles {
  candles?: ChartCandle[];
}

interface ChartPayload {
  data?: { yahoo?: YahooCandles | null } | null;
}

interface YahooProxyPayload {
  data?: YahooCandles | null;
}

const CHART_TIMEOUT_MS = 8000;

/** Dev catalog priceSource ("mock:msft") → real underlying symbol ("MSFT"). */
export function underlyingFromPriceSource(priceSource: string): string | undefined {
  if (!priceSource.startsWith("mock:")) return undefined;
  const slug = priceSource.slice("mock:".length).trim();
  return /^[a-z0-9.\-]+$/i.test(slug) ? slug.toUpperCase() : undefined;
}

function pctChange(first: number, last: number): number | null {
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return ((last - first) / first) * 100;
}

function toSeries(ticker: string, candles: ChartCandle[]): DailyCloseSeries {
  const closes: number[] = [];
  let lastTs: number | null = null;
  for (const candle of candles) {
    if (typeof candle.close === "number" && Number.isFinite(candle.close)) {
      closes.push(candle.close);
    }
    if (typeof candle.ts === "number") lastTs = candle.ts;
  }
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const first = closes[0];
  return {
    ticker,
    closes,
    changePct24h: last !== undefined && prev !== undefined ? pctChange(prev, last) : null,
    changePct7d: last !== undefined && first !== undefined ? pctChange(first, last) : null,
    lastTs,
  };
}

/** Fresh init per request — a shared AbortSignal would time both fetches as one. */
function jsonInit(): RequestInit {
  return {
    cache: "no-store",
    signal: AbortSignal.timeout(CHART_TIMEOUT_MS),
    headers: { accept: "application/json" },
  };
}

async function fetchJson(request: Promise<Response>): Promise<unknown | null> {
  try {
    const res = await request;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function candlesOf(payload: unknown): ChartCandle[] {
  const yahoo = (payload as ChartPayload | null)?.data?.yahoo;
  return Array.isArray(yahoo?.candles) ? yahoo.candles : [];
}

function proxyCandlesOf(payload: unknown): ChartCandle[] {
  const data = (payload as YahooProxyPayload | null)?.data;
  return Array.isArray(data?.candles) ? data.candles : [];
}

/**
 * Fetch the real underlying daily-close series for one ticker. Pass
 * `underlyingSymbol` (from `underlyingFromPriceSource`) when the display
 * ticker is a dev-catalog mock outside the backend YAHOO_MAP. Returns null on
 * any failure (API unreachable, non-OK status, no usable closes) — the caller
 * renders the honest empty surface, never a placeholder series.
 */
export async function fetchDailyCloseSeries(
  ticker: string,
  underlyingSymbol?: string,
): Promise<DailyCloseSeries | null> {
  const chartJson = await fetchJson(
    apiQuery("/api/v1/prices/chart", { ticker, range: "5d" }, jsonInit()),
  );
  const fromChart = toSeries(ticker, candlesOf(chartJson));
  if (fromChart.closes.length >= 2) return fromChart;

  if (underlyingSymbol) {
    const proxyJson = await fetchJson(
      apiQuery("/api/v1/prices/yahoo", { symbol: underlyingSymbol, range: "5d" }, jsonInit()),
    );
    const fromProxy = toSeries(ticker, proxyCandlesOf(proxyJson));
    if (fromProxy.closes.length >= 2) return fromProxy;
  }

  return fromChart.closes.length > 0 ? fromChart : null;
}

/**
 * Order-preserving bounded-concurrency map — a listing batch of 20+ symbols
 * must not open that many parallel sockets. The worker is expected to settle
 * its own errors (fetchDailyCloseSeries already resolves to null on failure),
 * so one bad symbol never fails the batch.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(lanes);
  return results;
}
