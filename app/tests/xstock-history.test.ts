import test from "node:test";
import assert from "node:assert/strict";
import { fetchXStockHistory, parseXStockHistory, xstockHistoryChange, mergeXStockHistories, unavailableXStockHistory, nextXStockHistoryRefreshAt } from "../lib/xstock-history";

const A = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const B = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-03T12:00:00Z");
const END = Date.parse("2026-10-03T00:00:00Z");
function row() {
  return { mint: A, range: "7d", windowEnd: new Date(END).toISOString(), points: [{ timestamp: new Date(END - 7 * DAY).toISOString(), priceUsd: 100 }, { timestamp: new Date(END).toISOString(), priceUsd: 110 }], change7dPct: 10, change30dPct: null, source: "geckoterminal", unit: "scaled-ui", interval: "1d", status: "available", poolAddress: B, observedAt: new Date(END).toISOString(), fetchedAt: new Date(NOW).toISOString() };
}

test("accepts verified token closes and exact seven-day anchors", () => {
  const parsed = parseXStockHistory(row(), A, "7d", NOW);
  assert.equal(parsed.status, "available");
  assert.equal(xstockHistoryChange(parsed, "7d", NOW), 10);
  assert.equal(parsed.observedAt, new Date(END).toISOString());
});

test("rejects identity, underlying-source, units, range and malformed prices", () => {
  for (const patch of [{ mint: B }, { source: "yahoo" }, { unit: "raw" }, { range: "30d" }, { points: [{ timestamp: new Date(END).toISOString(), priceUsd: -1 }] }, { points: [{ timestamp: new Date(END + DAY).toISOString(), priceUsd: 100 }] }]) {
    assert.equal(parseXStockHistory({ ...row(), ...patch }, A, "7d", NOW).status, "unavailable");
  }
});

test("does not turn partial, obsolete or unverified-return history into a seven-day return", () => {
  const partial = row(); partial.points[0].timestamp = new Date(END - 6 * DAY).toISOString();
  assert.equal(xstockHistoryChange(parseXStockHistory(partial, A, "7d", NOW), "7d", NOW), null);
  const old = row(); old.windowEnd = new Date(END - DAY).toISOString(); old.points = old.points.map(point => ({ ...point, timestamp: new Date(Date.parse(point.timestamp) - DAY).toISOString() }));
  assert.equal(xstockHistoryChange(parseXStockHistory(old, A, "7d", NOW), "7d", NOW), null);
  assert.equal(xstockHistoryChange(parseXStockHistory({ ...row(), change7dPct: 50 }, A, "7d", NOW), "7d", NOW), null);
  assert.equal(xstockHistoryChange(parseXStockHistory({ ...row(), change7dPct: null }, A, "7d", NOW), "7d", NOW), null);
});

test("rejects duplicate/non-daily candles and clips an overlong response to the selected window", () => {
  assert.equal(parseXStockHistory({ ...row(), points: [...row().points, row().points[0]] }, A, "7d", NOW).status, "unavailable");
  assert.equal(parseXStockHistory({ ...row(), points: [{ timestamp: new Date(END - 1000).toISOString(), priceUsd: 100 }] }, A, "7d", NOW).status, "unavailable");
  const value = parseXStockHistory({ ...row(), points: [{ timestamp: new Date(END - 30 * DAY).toISOString(), priceUsd: 50 }, ...row().points] }, A, "7d", NOW);
  assert.equal(value.points.length, 2);
});

test("monthly change requires its own exact thirty-day anchors", () => {
  const value = parseXStockHistory({ ...row(), range: "30d", change30dPct: 120, points: [{ timestamp: new Date(END - 30 * DAY).toISOString(), priceUsd: 50 }, ...row().points] }, A, "30d", NOW);
  assert.equal(xstockHistoryChange(value, "30d", NOW), 120);
  assert.equal(xstockHistoryChange(value, "7d", NOW), 10);
});

test("cold loading stays distinct from unavailable data without accepting another mint", () => {
  assert.equal(parseXStockHistory({ mint: A, range: "7d", status: "loading", unit: "scaled-ui" }, A, "7d", NOW).status, "loading");
  assert.equal(parseXStockHistory({ mint: B, range: "7d", status: "loading", unit: "scaled-ui" }, A, "7d", NOW).status, "unavailable");
});

test("history requests deduplicate visible mints and keep missing rows empty", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      const parsed = new URL(String(url));
      assert.equal(parsed.pathname, "/api/v1/xstocks/history");
      assert.equal(parsed.searchParams.get("mints"), `${A},${B}`);
      assert.equal(parsed.searchParams.get("range"), "7d");
      return Response.json({ data: [] });
    };
    const rows = await fetchXStockHistory([A, A, B, "invalid"], "7d");
    assert.equal(rows.length, 2);
    assert.ok(rows.every(value => value.status === "unavailable" && value.points.length === 0));
  } finally { globalThis.fetch = original; }
});

test("refreshing keeps known same-range history through loading/outages, but invalid rows clear it", () => {
  const known = parseXStockHistory(row(), A, "7d", NOW);
  const previous = new Map([[A, known]]);
  for (const pending of [{ ...unavailableXStockHistory(A, "7d", NOW), status: "loading" as const }, { ...unavailableXStockHistory(A, "7d", NOW), failure: "outage" as const }]) {
    assert.equal(mergeXStockHistories(previous, [pending]).get(A), known);
  }
  const invalid = parseXStockHistory({ ...row(), mint: B }, A, "7d", NOW);
  assert.equal(mergeXStockHistories(previous, [invalid]).get(A)?.status, "unavailable");
  assert.equal(mergeXStockHistories(previous, [{ ...unavailableXStockHistory(A, "30d", NOW), failure: "outage" }]).get(A)?.points.length, 0);
});

test("network failure is distinguishable from a rejected quote identity", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("offline"); };
    const [value] = await fetchXStockHistory([A], "7d");
    assert.equal(value.failure, "outage");
    assert.equal(value.status, "unavailable");
    assert.equal(parseXStockHistory({ ...row(), unit: "raw" }, A, "7d", NOW).failure, undefined);
  } finally { globalThis.fetch = original; }
});

test("warm history exposes pending refresh and schedules the next completed UTC day", () => {
  const parsed = parseXStockHistory({ ...row(), refreshing: true }, A, "7d", NOW);
  assert.equal(parsed.status, "available");
  assert.equal(parsed.refreshing, true);
  assert.equal(new Date(nextXStockHistoryRefreshAt(NOW)).toISOString(), "2026-10-04T00:00:01.000Z");
  assert.equal(new Date(nextXStockHistoryRefreshAt(Date.parse("2026-10-03T23:59:59.999Z"))).toISOString(), "2026-10-04T00:00:01.000Z");
});
