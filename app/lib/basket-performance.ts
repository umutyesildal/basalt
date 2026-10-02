export const MODEL_BASE_DATE = "2026-09-01";
export const MODEL_BASE_VALUE = 100 as const;
const DAY_MS = 86_400_000;
const MAX_CLOSE_AGE_DAYS = 4;

export interface BasketPerformanceItem {
  basketId: string;
  status: "ready" | "unavailable";
  modelPrice: number | null;
  return7dPct: number | null;
  asOf: string | null;
  windowStart: string | null;
  series: { date: string; value: number }[];
  reason?: string;
}

export interface BasketPerformanceResponse {
  status: "ready" | "partial" | "unavailable";
  source: "Yahoo Finance";
  fetchedAt: string;
  baseDate: string;
  baseValue: 100;
  asOf: string | null;
  windowStart: string | null;
  items: BasketPerformanceItem[];
  methodology: string;
}

export interface BasketPerformanceDefinition {
  id: string;
  allocations: readonly { symbol: string; weightBps: number }[];
}

export interface UnderlyingDailySeries {
  symbol: string;
  currency: string;
  candles: { date: string; close: number }[];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function marketDate(time: Date | number, timeZone = "America/New_York"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(time);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayNumber(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const milliseconds = Date.parse(date + "T00:00:00.000Z");
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === date
    ? milliseconds / DAY_MS : NaN;
}

/** Keep real, positive USD closes from completed regular trading sessions only. */
export function parseYahooDailySeries(symbol: string, payload: unknown, now: Date): UnderlyingDailySeries {
  const chart = record(record(payload).chart);
  const results = chart.result;
  const result = record(Array.isArray(results) ? results[0] : null);
  const meta = record(result.meta);
  if (meta.currency !== "USD") throw new Error("Underlying currency is not USD.");
  if (typeof meta.symbol === "string" && meta.symbol !== symbol) throw new Error("Underlying symbol does not match.");
  const timeZone = meta.exchangeTimezoneName;
  if (typeof timeZone !== "string") throw new Error("Exchange timezone is unavailable.");
  const today = marketDate(now, timeZone);
  const regular = record(record(meta.currentTradingPeriod).regular);
  const regularStart = typeof regular.start === "number" ? regular.start * 1000 : NaN;
  const regularEnd = typeof regular.end === "number" ? regular.end * 1000 : NaN;
  const regularDate = Number.isFinite(regularStart) ? marketDate(regularStart, timeZone) : null;
  const todayComplete = regularDate === today && Number.isFinite(regularEnd)
    && now.getTime() >= regularEnd + 5 * 60_000;
  const timestamps = result.timestamp;
  const quotes = record(result.indicators).quote;
  const closes = record(Array.isArray(quotes) ? quotes[0] : null).close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) throw new Error("Daily closes are unavailable.");
  const byDate = new Map<string, number>();
  timestamps.forEach((timestamp: unknown, index: number) => {
    const close: unknown = closes[index];
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)
      || typeof close !== "number" || !Number.isFinite(close) || close <= 0) return;
    const date = marketDate(timestamp * 1000, timeZone);
    if (date > today || (date === today && !todayComplete)) return;
    byDate.set(date, close);
  });
  if (byDate.size === 0) throw new Error("No completed daily closes are available.");
  return { symbol, currency: "USD", candles: [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close })) };
}

function unavailable(basketId: string, reason: string): BasketPerformanceItem {
  return { basketId, status: "unavailable", modelPrice: null, return7dPct: null, asOf: null, windowStart: null, series: [], reason };
}

/** Fixed quantities established at the base close, with no periodic rebalancing. */
export function calculateBasketPerformance(
  baskets: readonly BasketPerformanceDefinition[],
  underlying: Readonly<Record<string, UnderlyingDailySeries | undefined>>,
  fetchedAt: string,
  today = marketDate(new Date(fetchedAt)),
): BasketPerformanceResponse {
  const failures = new Map<string, string>();
  const prices = new Map<string, Map<string, number>>();
  const eligible = baskets.filter((basket) => {
    const symbols = basket.allocations.map((asset) => asset.symbol);
    if (symbols.length < 2 || symbols.length > 20 || new Set(symbols).size !== symbols.length
      || basket.allocations.some((asset) => !Number.isInteger(asset.weightBps) || asset.weightBps <= 0)
      || basket.allocations.reduce((sum, asset) => sum + asset.weightBps, 0) !== 10_000) {
      failures.set(basket.id, "Basket weights are incomplete.");
      return false;
    }
    for (const symbol of symbols) {
      const series = underlying[symbol];
      if (!series || series.currency !== "USD" || series.symbol !== symbol) {
        failures.set(basket.id, `Underlying closes are unavailable for ${symbol}.`);
        return false;
      }
      const closes = new Map(series.candles.filter((candle) => Number.isFinite(dayNumber(candle.date))
        && candle.date <= today && Number.isFinite(candle.close) && candle.close > 0)
        .map((candle) => [candle.date, candle.close]));
      if (closes.size === 0) {
        failures.set(basket.id, `Underlying closes are unavailable for ${symbol}.`);
        return false;
      }
      const latest = [...closes.keys()].sort().at(-1)!;
      if (dayNumber(today) - dayNumber(latest) > MAX_CLOSE_AGE_DAYS) {
        failures.set(basket.id, `Completed underlying closes are stale for ${symbol}.`);
        return false;
      }
      if (![...closes.keys()].some((date) => date >= MODEL_BASE_DATE && dayNumber(date) - dayNumber(MODEL_BASE_DATE) <= 4)) {
        failures.set(basket.id, `The fixed September base close is unavailable for ${symbol}.`);
        return false;
      }
      prices.set(symbol, closes);
    }
    return true;
  });

  const symbols = [...new Set(eligible.flatMap((basket) => basket.allocations.map((asset) => asset.symbol)))];
  const commonDates = symbols.length ? [...(prices.get(symbols[0])?.keys() ?? [])]
    .filter((date) => symbols.every((symbol) => prices.get(symbol)?.has(date))).sort() : [];
  const baseDate = commonDates.find((date) => date >= MODEL_BASE_DATE
    && dayNumber(date) - dayNumber(MODEL_BASE_DATE) <= 4) ?? MODEL_BASE_DATE;
  const hasBase = commonDates.includes(baseDate);
  const asOf = commonDates.at(-1) ?? null;
  const target = asOf ? dayNumber(asOf) - 7 : NaN;
  const windowStart = commonDates.filter((date) => date >= baseDate && dayNumber(date) <= target).at(-1) ?? null;
  let sharedFailure: string | null = null;
  if (!hasBase) sharedFailure = "The fixed September base close is unavailable.";
  else if (!asOf || dayNumber(today) - dayNumber(asOf) > MAX_CLOSE_AGE_DAYS) sharedFailure = "Completed underlying closes are stale.";
  else if (!windowStart || target - dayNumber(windowStart) > MAX_CLOSE_AGE_DAYS) sharedFailure = "A complete seven-calendar-day baseline is unavailable.";

  const items = baskets.map((basket): BasketPerformanceItem => {
    const failure = failures.get(basket.id) ?? sharedFailure;
    if (failure || !asOf || !windowStart) return unavailable(basket.id, failure ?? "Underlying closes are unavailable.");
    const quantities = basket.allocations.map((asset) => ({
      symbol: asset.symbol,
      units: MODEL_BASE_VALUE * asset.weightBps / 10_000 / prices.get(asset.symbol)!.get(baseDate)!,
    }));
    const valueAt = (date: string) => quantities.reduce((sum, asset) => sum + asset.units * prices.get(asset.symbol)!.get(date)!, 0);
    const value = valueAt(asOf);
    const baseline = valueAt(windowStart);
    if (!Number.isFinite(value) || !Number.isFinite(baseline) || value <= 0 || baseline <= 0) return unavailable(basket.id, "The model value could not be calculated.");
    return {
      basketId: basket.id, status: "ready", modelPrice: Number(value.toFixed(8)),
      return7dPct: Number(((value / baseline - 1) * 100).toFixed(6)), asOf, windowStart,
      series: commonDates.filter((date) => date >= baseDate).map((date) => ({ date, value: date === baseDate ? MODEL_BASE_VALUE : Number(valueAt(date).toFixed(8)) })),
    };
  });
  const ready = items.filter((item) => item.status === "ready").length;
  return {
    status: ready === 0 ? "unavailable" : ready === items.length ? "ready" : "partial",
    source: "Yahoo Finance", fetchedAt, baseDate, baseValue: MODEL_BASE_VALUE,
    asOf: ready ? asOf : null, windowStart: ready ? windowStart : null, items,
    methodology: `Illustrative buy-and-hold model, starting at 100 on ${baseDate}, with quantities fixed by the basket weights at that close. Uses completed, split-adjusted USD underlying stock and ETF daily closes, not xStocks quotes or deployed basket NAV. Seven-day price return compares the latest common close with the latest common close on or before seven calendar days earlier. Dividends, fees, trading costs and slippage are excluded. Missing or stale closes are unavailable.`,
  };
}
