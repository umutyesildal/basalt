import assert from "node:assert/strict";
import test from "node:test";
import { calculateBasketPerformance, parseYahooDailySeries, type BasketPerformanceDefinition, type UnderlyingDailySeries } from "./basket-performance";

const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"];
const basket: BasketPerformanceDefinition = { id: "model", allocations: [{ symbol: "A", weightBps: 5000 }, { symbol: "B", weightBps: 5000 }] };
function series(symbol: string, prices: number[], calendar = dates): UnderlyingDailySeries {
  return { symbol, currency: "USD", candles: calendar.map((date, index) => ({ date, close: prices[index] })) };
}
function inputs(): Record<string, UnderlyingDailySeries> {
  return { A: series("A", [10, 12, 14, 20, 22, 24, 26, 28, 30]), B: series("B", dates.map(() => 20)) };
}
const fetchedAt = "2026-09-14T22:00:00.000Z";

test("fixed quantities retain September base and use seven calendar days across a holiday", () => {
  const result = calculateBasketPerformance([basket], inputs(), fetchedAt);
  assert.equal(result.status, "ready");
  assert.equal(result.baseDate, "2026-09-01");
  assert.equal(result.items[0].series[0].value, 100);
  assert.equal(result.asOf, "2026-09-14");
  assert.equal(result.windowStart, "2026-09-04");
  assert.equal(result.items[0].modelPrice, 200);
  assert.equal(result.items[0].return7dPct, 33.333333);
  // Reweighting at the weekly baseline would incorrectly produce 25%.
  assert.notEqual(result.items[0].return7dPct, 25);
});

test("longer history does not move the model base", () => {
  const data = inputs();
  Object.values(data).forEach((entry) => entry.candles.unshift({ date: "2026-08-31", close: 1 }));
  assert.equal(calculateBasketPerformance([basket], data, fetchedAt).items[0].modelPrice, 200);
});

test("a weekly loss stays negative while the September model base remains fixed", () => {
  const data = inputs();
  data.A.candles[data.A.candles.length - 1].close = 16;
  const result = calculateBasketPerformance([basket], data, fetchedAt);
  assert.equal(result.items[0].modelPrice, 130);
  assert.equal(result.windowStart, "2026-09-04");
  assert.equal(result.items[0].return7dPct, -13.333333);
  assert.equal(result.items[0].series[0].value, 100);
});

test("one missing constituent fails only its basket without substituting zero", () => {
  const missing: BasketPerformanceDefinition = { id: "missing", allocations: [{ symbol: "A", weightBps: 5000 }, { symbol: "C", weightBps: 5000 }] };
  const result = calculateBasketPerformance([basket, missing], inputs(), fetchedAt);
  assert.equal(result.status, "partial");
  assert.equal(result.items[0].status, "ready");
  assert.equal(result.items[1].modelPrice, null);
  assert.equal(result.items[1].return7dPct, null);
  assert.deepEqual(result.items[1].series, []);
});

test("all ranked models share current and weekly baseline dates", () => {
  const other: BasketPerformanceDefinition = { id: "other", allocations: [{ symbol: "A", weightBps: 5000 }, { symbol: "C", weightBps: 5000 }] };
  const result = calculateBasketPerformance([basket, other], { ...inputs(), C: series("C", Array(8).fill(40), dates.slice(0, -1)) }, fetchedAt);
  assert.equal(result.status, "ready");
  assert.equal(result.asOf, "2026-09-11");
  assert.equal(result.windowStart, "2026-09-04");
  assert.ok(result.items.every((entry) => entry.asOf === result.asOf && entry.windowStart === result.windowStart));
});

test("prices older than four calendar days fail closed", () => {
  const result = calculateBasketPerformance([basket], inputs(), "2026-09-19T22:00:00.000Z");
  assert.equal(result.status, "unavailable");
  assert.equal(result.items[0].modelPrice, null);
  assert.match(result.items[0].reason!, /stale/);
});

test("a stale constituent excludes its own model without blocking complete models", () => {
  const other: BasketPerformanceDefinition = { id: "stale", allocations: [{ symbol: "A", weightBps: 5000 }, { symbol: "C", weightBps: 5000 }] };
  const result = calculateBasketPerformance([basket, other], { ...inputs(), C: series("C", Array(4).fill(40), dates.slice(0, 4)) }, fetchedAt);
  assert.equal(result.status, "partial");
  assert.equal(result.items[0].asOf, "2026-09-14");
  assert.equal(result.items[1].modelPrice, null);
});

test("missing anchor or seven-day history yields no model metric", () => {
  for (const selected of [dates.slice(4), dates.slice(0, 3)]) {
    const result = calculateBasketPerformance([basket], { A: series("A", selected.map(() => 10), selected), B: series("B", selected.map(() => 20), selected) }, "2026-09-03T22:00:00.000Z");
    assert.equal(result.status, "unavailable");
    assert.equal(result.items[0].return7dPct, null);
  }
});

test("non-USD, zero and malformed weights cannot produce a model", () => {
  const data = inputs();
  data.B.currency = "GBP";
  assert.equal(calculateBasketPerformance([basket], data, fetchedAt).status, "unavailable");
  data.B.currency = "USD";
  data.B.candles = data.B.candles.map((candle) => ({ ...candle, close: 0 }));
  assert.equal(calculateBasketPerformance([basket], data, fetchedAt).status, "unavailable");
  assert.equal(calculateBasketPerformance([{ ...basket, allocations: [{ symbol: "A", weightBps: 10000 }] }], inputs(), fetchedAt).status, "unavailable");
});

function yahooPayload() {
  return { chart: { result: [{ meta: { symbol: "A", currency: "USD", exchangeTimezoneName: "America/New_York", currentTradingPeriod: { regular: { start: Date.parse("2026-10-02T13:30:00Z") / 1000, end: Date.parse("2026-10-02T20:00:00Z") / 1000 } } }, timestamp: [Date.parse("2026-10-01T13:30:00Z") / 1000, Date.parse("2026-10-02T13:30:00Z") / 1000, Date.parse("2026-10-03T13:30:00Z") / 1000], indicators: { quote: [{ close: [10, 11, 12] }] } }] } };
}

test("an in-progress current-day Yahoo close and future candle are excluded", () => {
  assert.deepEqual(parseYahooDailySeries("A", yahooPayload(), new Date("2026-10-02T15:00:00Z")).candles, [{ date: "2026-10-01", close: 10 }]);
});

test("today becomes eligible only after the regular close and settling buffer", () => {
  assert.equal(parseYahooDailySeries("A", yahooPayload(), new Date("2026-10-02T20:04:59Z")).candles.length, 1);
  assert.equal(parseYahooDailySeries("A", yahooPayload(), new Date("2026-10-02T20:05:00Z")).candles.length, 2);
});

test("Yahoo null, zero, mismatched symbol and currency are rejected", () => {
  const payload = yahooPayload();
  payload.chart.result[0].indicators.quote[0].close = [0, 0, 0];
  assert.throws(() => parseYahooDailySeries("A", payload, new Date(fetchedAt)));
  assert.throws(() => parseYahooDailySeries("B", yahooPayload(), new Date(fetchedAt)), /symbol/);
  const foreign = yahooPayload();
  foreign.chart.result[0].meta.currency = "EUR";
  assert.throws(() => parseYahooDailySeries("A", foreign, new Date(fetchedAt)), /USD/);
});
