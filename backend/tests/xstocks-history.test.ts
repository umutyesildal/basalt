import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type http from "node:http";
import { PublicKey } from "@solana/web3.js";
import { createHandler } from "../src/api/server";
import { clearXStockCatalogCache, getCachedXStockCatalog } from "../src/catalog/xstocks";
import { HISTORY_DAY_MS as DAY, XStockHistoryService, selectHistoryPool, parseMultiplierEvents, historicalMultiplier, normalizedHistoryPoints, historyReturn } from "../src/workers/xstockHistory";
import proof from "../../docs/assets/xstocks-history-2026-10-03/unit-proof.json";

const AAPL = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const POOL = "CKwJZwm7oj3nu4653N1EpDrqXbXAYXoPFiPeEnLouF8y";
const OTHER = new PublicKey(Buffer.alloc(32, 42)).toBase58();
const NOW = new Date("2026-10-03T12:00:00Z"); // Saturday: explicit historical reads remain allowed.
const END = Date.parse("2026-10-03T00:00:00Z");
const asset = getCachedXStockCatalog().data.find(row => row.mint === AAPL)!;
const pool = { address: POOL, base: AAPL, quote: USDC, liquidityUsd: 50_000, volume24hUsd: 3000, createdAt: END - 100 * DAY };
const json = (body: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers });
function poolRow(options: { mint?: string; quoteSide?: boolean; address?: string; age?: number; liquidity?: number; volume?: number; other?: string } = {}) {
  const mint = options.mint ?? AAPL, other = options.other ?? USDC, address = options.address ?? POOL;
  return { id: `solana_${address}`, attributes: { address, reserve_in_usd: String(options.liquidity ?? 50_000), volume_usd: { h24: String(options.volume ?? 3000) }, pool_created_at: new Date(END - (options.age ?? 100) * DAY).toISOString() },
    relationships: { base_token: { data: { id: `solana_${options.quoteSide ? other : mint}` } }, quote_token: { data: { id: `solana_${options.quoteSide ? mint : other}` } } } };
}
function candlePayload(rows?: number[][], quoteSide = false) {
  return { data: { attributes: { ohlcv_list: rows ?? Array.from({ length: 31 }, (_, i) => [(END / 1000) - (31 - i) * 86400, 100 + i, 100 + i, 100 + i, 100 + i, 10]) } },
    meta: { base: { address: quoteSide ? USDC : AAPL }, quote: { address: quoteSide ? AAPL : USDC } } };
}
const closedCandle = (end: number, price: number, volume = 1) => [end / 1000 - 86400, price, price, price, price, volume];
function fixture(options: { quoteSide?: boolean; multipliers?: unknown; pools?: unknown; candles?: unknown; fail?: () => boolean; pause?: Promise<void> } = {}) {
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (options.fail?.()) return json({}, 503);
    if (url.includes("/multiplier/history")) return json(options.multipliers ?? { page: { currentPage: 0, hasNextPage: false }, nodes: [] });
    if (url.includes("/tokens/")) return json(options.pools ?? { data: [poolRow({ quoteSide: options.quoteSide })] });
    if (url.includes("/ohlcv/")) { if (options.pause) await options.pause; return json(options.candles ?? candlePayload(undefined, options.quoteSide)); }
    throw new Error(`Unexpected network request: ${url}`);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  return fetchImpl;
}
const directories: string[] = [];
beforeEach(() => clearXStockCatalogCache());
afterEach(async () => { vi.useRealTimers(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

// These tests validate external data semantics, not display-only formatting.
describe("verified Solana history units and boundaries", () => {
  it("selects the exact token on either side and prefers established liquid pools", () => {
    const selected = selectHistoryPool({ data: [poolRow({ mint: OTHER, liquidity: 9_000_000 }), poolRow({ other: OTHER, liquidity: 9_000_000 }), poolRow({ address: OTHER, age: 2, liquidity: 9_000_000 }), poolRow({ quoteSide: true })] }, AAPL, END);
    expect(selected).toMatchObject({ address: POOL, base: USDC, quote: AAPL });
  });
  it("rejects missing liquidity, negative recent volume, and forged pool identity", () => {
    const forged = { ...poolRow(), id: `solana_${OTHER}` };
    expect(selectHistoryPool({ data: [poolRow({ liquidity: 999 }), poolRow({ volume: -1 }), forged] }, AAPL, END)).toBeNull();
  });
  it("keeps liquid pools eligible when the last 24 hours had no trades but historical candles exist", async () => {
    expect(selectHistoryPool({ data: [poolRow({ volume: 0 })] }, AAPL, END)).toMatchObject({ address: POOL, volume24hUsd: 0 });
    const fetchImpl = fixture({ pools: { data: [poolRow({ volume: 0 })] } });
    const service = new XStockHistoryService({ fetchImpl, now: () => NOW, cachePath: null });
    const result = await service.getHistories([AAPL], "7d");
    expect(result.data[0].status).toBe("available"); expect(result.data[0].points).toHaveLength(8);
  });
  it("proves NFLX raw token units against a real swap and divides by the historical split multiplier", () => {
    const rawDelta = BigInt(proof.nflx.poolPostRawAmount) - BigInt(proof.nflx.poolPreRawAmount);
    expect(Number(rawDelta) / 10 ** proof.nflx.tokenDecimals).toBe(Number(proof.nflx.gtFromTokenAmount));
    expect(Number(proof.nflx.gtFromTokenAmount) * proof.nflx.effectiveMultiplier).toBeCloseTo(proof.nflx.scaledUiSwapAmount, 12);
    expect(proof.nflx.gtPriceUsdPerUnscaledToken / proof.nflx.effectiveMultiplier).toBeCloseTo(proof.nflx.scaledUiPriceUsd, 10);
    const events = parseMultiplierEvents(proof.nflx.issuerMultiplierResponse.nodes);
    const points = normalizedHistoryPoints(proof.nflx.ohlcvSample, { ...pool, address: proof.nflx.pool, base: proof.nflx.mint }, proof.nflx.mint, events, END);
    const rawLatest = proof.nflx.ohlcvSample.data.attributes.ohlcv_list[0];
    expect(points.find(p => Date.parse(p.timestamp) === (rawLatest[0] + 86400) * 1000)?.priceUsd).toBeCloseTo(rawLatest[4] / 10, 10);
  });
  it("uses each QQQ candle's effective dividend multiplier, not today's multiplier for all dates", () => {
    const events = parseMultiplierEvents(proof.qqq.issuerMultiplierResponse.nodes);
    const before = Date.parse("2026-09-19T00:00:00Z"), after = Date.parse("2026-09-20T00:00:00Z");
    const payload = candlePayload([closedCandle(before, 750), closedCandle(after, 750)]); payload.meta.base.address = proof.qqq.mint;
    const points = normalizedHistoryPoints(payload, { ...pool, base: proof.qqq.mint }, proof.qqq.mint, events, END);
    expect(points[0].priceUsd).toBeCloseTo(750 / 1.0027250296551051, 10);
    expect(points[1].priceUsd).toBeCloseTo(750 / 1.0034560758968376, 10);
    expect(historicalMultiplier(events, Date.parse("2026-09-19T23:00:00Z"))).toBe(1.0034560758968376);
  });
  it("accepts a complete empty launch history and fails closed on broken or duplicate event chains", () => {
    expect(historicalMultiplier(parseMultiplierEvents([]), END)).toBe(1);
    expect(() => parseMultiplierEvents([{ activationDateTime: NOW.toISOString(), multiplier: 3, previousMultiplier: 2 }])).toThrow("Incomplete");
    const event = { activationDateTime: NOW.toISOString(), multiplier: 1, previousMultiplier: 1 };
    expect(() => parseMultiplierEvents([event, event])).toThrow("Incomplete");
  });
  it("converts starts to close boundaries, drops unfinished and no-trade candles without filling gaps", () => {
    const points = normalizedHistoryPoints(candlePayload([closedCandle(END - 2 * DAY, 90), closedCandle(END - DAY, 95, 0), closedCandle(END, 100), closedCandle(END + DAY, 200)]), pool, AAPL, [], END);
    expect(points).toEqual([{ timestamp: new Date(END - 2 * DAY).toISOString(), priceUsd: 90 }, { timestamp: new Date(END).toISOString(), priceUsd: 100 }]);
  });
  it("rejects conflicting timestamps, malformed OHLC and mismatched token metadata", () => {
    expect(() => normalizedHistoryPoints(candlePayload([closedCandle(END, 100), closedCandle(END, 101)]), pool, AAPL, [], END)).toThrow("Conflicting");
    expect(() => normalizedHistoryPoints(candlePayload([[END / 1000 - 86400, 100, 99, 100, 100, 1]]), pool, AAPL, [], END)).toThrow("OHLCV");
    const wrong = candlePayload(); wrong.meta.base.address = OTHER;
    expect(() => normalizedHistoryPoints(wrong, pool, AAPL, [], END)).toThrow("mismatch");
  });
  it("returns a percentage only when the exact requested calendar anchors both exist", () => {
    const points = normalizedHistoryPoints(candlePayload(), pool, AAPL, [], END);
    expect(historyReturn(points, END, 7)).toBeCloseTo((130 / 123 - 1) * 100, 10);
    expect(historyReturn(points, END, 30)).toBeCloseTo(30, 10);
    expect(historyReturn(points.filter(p => Date.parse(p.timestamp) !== END - 7 * DAY), END, 7)).toBeNull();
    expect(historyReturn(points, END + DAY, 7)).toBeNull();
  });
});

describe("historical cache and provider contracts", () => {
  it("requests exact quote-side mint in USD, with empty-interval filling disabled, even on a closed Saturday", async () => {
    const fetchImpl = fixture({ quoteSide: true });
    const service = new XStockHistoryService({ fetchImpl, now: () => NOW, cachePath: null });
    const result = await service.getHistories([AAPL], "7d");
    expect(result.data[0]).toMatchObject({ status: "available", refreshing: false, source: "geckoterminal", unit: "scaled-ui", range: "7d", windowEnd: new Date(END).toISOString(), observedAt: new Date(END).toISOString(), fetchedAt: NOW.toISOString() });
    expect(result.data[0].points).toHaveLength(8);
    const request = new URL(String(fetchImpl.mock.calls.find((c: unknown[]) => String(c[0]).includes("/ohlcv/"))![0]));
    expect(Object.fromEntries(request.searchParams)).toMatchObject({ token: AAPL, currency: "usd", include_empty_intervals: "false", before_timestamp: String(END / 1000) });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await service.getHistories([AAPL], "30d");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("deduplicates in-flight work across ranges and returns loading within the request budget", async () => {
    let release!: () => void; const pause = new Promise<void>(resolve => { release = resolve; });
    const fetchImpl = fixture({ pause });
    const service = new XStockHistoryService({ fetchImpl, now: () => NOW, cachePath: null, waitMs: 1 });
    const [a, b] = await Promise.all([service.getHistories([AAPL, AAPL], "7d"), service.getHistories([AAPL], "30d")]);
    expect(a.data).toHaveLength(1); expect(a.data[0]).toMatchObject({ status: "loading", refreshing: true, points: [] }); expect(b.meta.pending).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    release(); await new Promise(resolve => setTimeout(resolve, 0));
    const ready = await service.getHistories([AAPL], "7d");
    expect(ready.data[0].status).toBe("available"); expect(ready.meta.pending).toBe(0);
  });
  it.each([{ page: { currentPage: 0, hasNextPage: true }, nodes: [] }, { page: { currentPage: 1, hasNextPage: false }, nodes: [] }, { page: { currentPage: 0, hasNextPage: false }, nodes: [{ multiplier: 2, previousMultiplier: 9, activationDateTime: NOW.toISOString() }] }])("fails closed on unfinished or malformed issuer multiplier history", async multipliers => {
    const fetchImpl = fixture({ multipliers }); const service = new XStockHistoryService({ fetchImpl, now: () => NOW, cachePath: null });
    const result = await service.getHistories([AAPL], "7d");
    expect(result.data[0]).toMatchObject({ status: "unavailable", points: [], change7dPct: null });
    expect(fetchImpl.mock.calls.some((c: unknown[]) => String(c[0]).includes("/ohlcv/"))).toBe(false);
  });
  it("rechecks a provider backoff deadline while the next queued request is already waiting", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const spy = getCachedXStockCatalog().data.find(row => row.symbol === "SPYx")!;
    const starts: number[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/multiplier/history")) return json({ page: { currentPage: 0, hasNextPage: false }, nodes: [] });
      starts.push(Date.now());
      if (starts.length === 1) { await new Promise(resolve => setTimeout(resolve, 20)); return json({}, 429, { "retry-after": "1" }); }
      return json({ data: [] });
    }) as unknown as typeof fetch;
    const service = new XStockHistoryService({ fetchImpl, now: () => NOW, cachePath: null, assets: () => [asset, spy], minRequestIntervalMs: 100, waitMs: 0 });
    const request = service.getHistories([AAPL, spy.mint], "7d");
    await vi.advanceTimersByTimeAsync(100);
    await request;
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(920);
    expect(starts).toEqual([NOW.getTime(), NOW.getTime() + 1020]);
    expect((await service.getHistories([AAPL, spy.mint], "7d")).meta.pending).toBe(0);
  });
  it("negative-caches provider absence instead of repeating failed work on every poll", async () => {
    let now = NOW; const fetchImpl = fixture({ pools: { data: [] } });
    const service = new XStockHistoryService({ fetchImpl, now: () => now, cachePath: null });
    await service.getHistories([AAPL], "7d"); await service.getHistories([AAPL], "7d"); expect(fetchImpl).toHaveBeenCalledTimes(2);
    now = new Date(now.getTime() + 60_001); await service.getHistories([AAPL], "7d"); expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it("refreshes immediately across UTC midnight even if the old cache is only seconds old, then cools failed retries", async () => {
    let now = new Date(END - 15_000), failed = false;
    const fetchImpl = fixture({ fail: () => failed });
    const service = new XStockHistoryService({ fetchImpl, now: () => now, cachePath: null });
    const previous = await service.getHistories([AAPL], "7d");
    expect(previous.data[0].windowEnd).toBe(new Date(END - DAY).toISOString());
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    failed = true; now = new Date(END + 1000);
    const crossing = await service.getHistories([AAPL], "7d");
    expect(crossing.data[0]).toMatchObject({ refreshing: true, change7dPct: null, fetchedAt: new Date(END - 15_000).toISOString() });
    await vi.waitFor(async () => expect((await service.getHistories([AAPL], "7d")).meta.pending).toBe(0));
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    now = new Date(END + 50_000); await service.getHistories([AAPL], "7d");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
  it("restores verified public history from disk and retains original dates during an outage and rollover", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xstock-history-")); directories.push(dir); const cachePath = join(dir, "history.json");
    const original = new XStockHistoryService({ fetchImpl: fixture(), now: () => NOW, cachePath });
    const initial = await original.getHistories([AAPL], "30d");
    let now = NOW; let failed = false; const fetchImpl = fixture({ fail: () => failed });
    const restored = new XStockHistoryService({ fetchImpl, now: () => now, cachePath });
    expect((await restored.getHistories([AAPL], "30d")).data).toEqual(initial.data); expect(fetchImpl).not.toHaveBeenCalled();
    failed = true; now = new Date(NOW.getTime() + DAY);
    const pending = await restored.getHistories([AAPL], "7d"); expect(pending.data[0].refreshing).toBe(true);
    await vi.waitFor(async () => expect((await restored.getHistories([AAPL], "7d")).meta.pending).toBe(0), { timeout: 3000, interval: 5 });
    const stale = await restored.getHistories([AAPL], "7d");
    expect(stale.data[0]).toMatchObject({ status: "available", refreshing: false, change7dPct: null, observedAt: new Date(END).toISOString(), fetchedAt: NOW.toISOString() });
    expect(stale.data[0].points).toHaveLength(7); const count = fetchImpl.mock.calls.length;
    await restored.getHistories([AAPL], "7d"); expect(fetchImpl).toHaveBeenCalledTimes(count);
    now = new Date(now.getTime() + 60_001); await restored.getHistories([AAPL], "7d");
    await vi.waitFor(async () => expect((await restored.getHistories([AAPL], "7d")).meta.pending).toBe(0), { timeout: 3000, interval: 5 });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(count);
  });
  it("does not trust malformed persisted historical prices", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xstock-history-invalid-")); directories.push(dir); const cachePath = join(dir, "history.json");
    const initial = new XStockHistoryService({ fetchImpl: fixture(), now: () => NOW, cachePath }); await initial.getHistories([AAPL], "7d");
    const persisted = JSON.parse(await readFile(cachePath, "utf8")); persisted.histories[0].points[0].priceUsd = -1;
    await writeFile(cachePath, JSON.stringify(persisted)); const fetchImpl = fixture({ fail: () => true });
    const restored = new XStockHistoryService({ fetchImpl, now: () => NOW, cachePath });
    expect((await restored.getHistories([AAPL], "7d")).data[0].points).toEqual([]); expect(fetchImpl).toHaveBeenCalled();
  });
});

async function request(path: string, fetchImpl: typeof fetch) {
  let body = ""; const res = { statusCode: 200, setHeader() {}, end(chunk?: string) { body = chunk ?? ""; } };
  await createHandler({ db: null, fetchImpl, now: () => NOW })({ method: "GET", url: path, headers: { host: "localhost" } } as http.IncomingMessage, res as unknown as http.ServerResponse);
  return { status: res.statusCode, body: JSON.parse(body) };
}
describe("history HTTP endpoint", () => {
  it("serves a real-shaped cached-catalog request without DB or catalog/RPC/Jupiter calls", async () => {
    const fetchImpl = fixture(); const result = await request(`/api/v1/xstocks/history?mints=${AAPL},${AAPL}&range=30d`, fetchImpl);
    expect(result.status).toBe(200); expect(result.body.data).toHaveLength(1); expect(result.body.data[0].points).toHaveLength(31);
    expect(result.body.meta).toMatchObject({ range: "30d", windowEnd: new Date(END).toISOString(), pending: 0, timestampSemantics: "completed-utc-day-close" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it.each(["", "garbage", Array.from({ length: 25 }, (_, i) => new PublicKey(Buffer.alloc(32, i)).toBase58()).join(",")])("rejects missing/malformed/oversized mints before network work", async mints => {
    const fetchImpl = fixture(); const result = await request(`/api/v1/xstocks/history?mints=${encodeURIComponent(mints)}`, fetchImpl);
    expect(result.status).toBe(400); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects unknown official mints and unsupported ranges before network work", async () => {
    const fetchImpl = fixture(); expect((await request(`/api/v1/xstocks/history?mints=${OTHER}`, fetchImpl)).body.error.code).toBe("UNKNOWN_XSTOCK");
    expect((await request(`/api/v1/xstocks/history?mints=${AAPL}&range=1y`, fetchImpl)).body.error.code).toBe("INVALID_HISTORY_QUERY"); expect(fetchImpl).not.toHaveBeenCalled();
  });
});
