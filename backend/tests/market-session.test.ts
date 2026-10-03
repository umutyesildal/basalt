import { afterEach, describe, expect, it, vi } from "vitest";
import type http from "node:http";
import { getNyseMarketSession } from "../src/workers/marketSession";
import { XStockQuoteService } from "../src/workers/xstockQuotes";
import { clearXStockCatalogCache, getCachedXStockCatalog } from "../src/catalog/xstocks";
import { clearPriceCache, fetchPriceQuotes, restoreLastValidPriceQuotes } from "../src/workers/priceFetch";
import { comparePrices } from "../src/workers/priceCompare";
import { createHandler } from "../src/api/server";
const A = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const session = (date: string) => getNyseMarketSession(new Date(date));
const catalog = () => { const all = getCachedXStockCatalog(); return { ...all, data: all.data.filter(asset => asset.mint === A) }; };
afterEach(() => vi.useRealTimers());

describe("NYSE cash-session calendar", () => {
  it("uses inclusive09:30/exclusive16:00NewYork boundaries and correct winter/summer UTC offsets", () => {
    expect(session("2026-01-05T14:29:59Z")).toMatchObject({ status: "closed", reason: "pre-open", nextOpenAt: "2026-01-05T14:30:00.000Z" });
    expect(session("2026-01-05T14:30:00Z").isOpen).toBe(true);
    expect(session("2026-01-05T20:59:59Z").isOpen).toBe(true);
    expect(session("2026-01-05T21:00:00Z").isOpen).toBe(false);
    expect(session("2026-07-06T13:30:00Z")).toMatchObject({ isOpen: true, closesAt: "2026-07-06T20:00:00.000Z" });
    expect(session("2026-07-06T20:00:00Z").isOpen).toBe(false);
  });
  it("moves the next opening across both DST weekends without a fixed UTC offset", () => {
    expect(session("2026-03-06T21:01:00Z").nextOpenAt).toBe("2026-03-09T13:30:00.000Z");
    expect(session("2026-10-30T20:01:00Z").nextOpenAt).toBe("2026-11-02T14:30:00.000Z");
  });
  it("excludes weekends, GoodFriday and observed exchange holidays", () => {
    expect(session("2026-10-03T15:00:00Z")).toMatchObject({ isOpen: false, reason: "weekend", nextOpenAt: "2026-10-05T13:30:00.000Z" });
    expect(session("2026-04-03T15:00:00Z")).toMatchObject({ isOpen: false, reason: "holiday", nextOpenAt: "2026-04-06T13:30:00.000Z" });
    expect(session("2026-07-03T15:00:00Z").reason).toBe("holiday");
    expect(session("2027-06-18T15:00:00Z").reason).toBe("holiday");
    expect(session("2027-12-24T15:00:00Z").reason).toBe("holiday");
    expect(session("2027-12-31T15:00:00Z").isOpen).toBe(true);
  });
  it("honors every published2026-2028early close at13:00NewYork", () => {
    for (const day of ["2026-11-27", "2026-12-24", "2027-11-26", "2028-11-24"]) {
      expect(session(`${day}T17:59:59Z`)).toMatchObject({ isOpen: true, earlyClose: true, closesAt: `${day}T18:00:00.000Z` });
      expect(session(`${day}T18:00:00Z`).isOpen).toBe(false);
    }
    expect(session("2028-07-03T16:59:59Z")).toMatchObject({ isOpen: true, earlyClose: true, closesAt: "2028-07-03T17:00:00.000Z" });
    expect(session("2028-07-03T17:00:00Z")).toMatchObject({ isOpen: false, nextOpenAt: "2028-07-05T13:30:00.000Z" });
  });
  it("fails closed outside the verified calendar or for invalid clocks", () => {
    expect(session("2029-01-02T15:00:00Z")).toMatchObject({ isOpen: false, reason: "calendar-unavailable", nextOpenAt: null });
    expect(getNyseMarketSession(new Date(NaN)).isOpen).toBe(false);
  });
});

describe("closed market quote cache", () => {
  it("start/full/hot/cold reads make no metadata/provider/RPC calls during a closed session", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T15:00:00Z"));
    const fetchQuotes = vi.fn(async () => ({})); const blockTimes = vi.fn(async () => ({})); const refreshCatalog = vi.fn(async () => catalog());
    const service = new XStockQuoteService({ cachePath: null, catalog, fetchQuotes, blockTimes, refreshCatalog, minRequestIntervalMs: 0 });
    service.start(); await service.refreshAll(); await service.refreshHot();
    expect((await service.getQuotes([A]))[0]).toMatchObject({ priceUsd: null, status: "unavailable" });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchQuotes).not.toHaveBeenCalled(); expect(blockTimes).not.toHaveBeenCalled(); expect(refreshCatalog).not.toHaveBeenCalled();
    expect(service.metadata().marketSession.status).toBe("closed"); await service.stop();
  });

  it("the actual price API avoids providers for known and unknown mints outside the session", async () => {
    const fetchImpl = vi.fn(async () => Response.json({}));
    const handler = createHandler({ db: null, now: () => new Date("2026-10-03T15:00:00Z"), fetchImpl });
    for (const mint of [A, "11111111111111111111111111111111"]) {
      let body = ""; const response = { statusCode: 200, setHeader() {}, end(value: string) { body = value; } };
      await handler({ method: "GET", url: `/api/v1/xstocks/prices?mints=${mint}`, headers: { host: "localhost" } } as http.IncomingMessage, response as unknown as http.ServerResponse);
      if (mint === A) { expect(response.statusCode).toBe(200); expect(JSON.parse(body).meta.marketSession.status).toBe("closed"); }
      else expect(response.statusCode).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("wakes at the opening bell instead of waiting for the five-minute interval", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-05T13:29:50Z"));
    const fetchQuotes = vi.fn(async () => ({})); const refreshCatalog = vi.fn(async () => catalog());
    const service = new XStockQuoteService({ cachePath: null, catalog, refreshCatalog, fetchQuotes, minRequestIntervalMs: 0 });
    service.start(); await vi.advanceTimersByTimeAsync(9999); expect(fetchQuotes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(fetchQuotes).toHaveBeenCalledTimes(1); expect(refreshCatalog).toHaveBeenCalledTimes(1);
    await service.stop();
  });

  it("retains an existing quote as stale when the market closes without rewriting timestamps", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T19:59:59Z"));
    const fetchQuotes = vi.fn(async () => ({ [A]: { point: { mint: A, price: 123, source: "jupiter" as const, unit: "scaled-ui" as const, asOf: new Date().toISOString(), blockId: 123 }, outcome: "priced" as const, refreshedAt: new Date().toISOString() } }));
    const service = new XStockQuoteService({ cachePath: null, catalog, refreshCatalog: async () => catalog(), fetchQuotes, blockTimes: async () => ({ 123: "2026-10-02T19:58:00.000Z" }), minRequestIntervalMs: 0 });
    const [before] = await service.getQuotes([A]); expect(before.stale).toBe(false);
    vi.setSystemTime(new Date("2026-10-02T20:00:00Z"));
    const [after] = await service.getQuotes([A]);
    expect(after).toMatchObject({ priceUsd: 123, fetchedAt: before.fetchedAt, observedAt: before.observedAt, stale: true, freshness: "stale" });
    expect(fetchQuotes).toHaveBeenCalledTimes(1); await service.stop();
  });

  it("does not start a paced provider request whose wait crosses the closing bell", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T19:59:58Z"));
    const fetchQuotes = vi.fn(async (mints: string[]) => Object.fromEntries(mints.map(mint => [mint, { point: null, outcome: "omitted" as const, refreshedAt: new Date().toISOString() }])));
    const service = new XStockQuoteService({ cachePath: null, catalog: getCachedXStockCatalog, refreshCatalog: async () => getCachedXStockCatalog(), fetchQuotes, minRequestIntervalMs: 2100 });
    await service.getQuotes([A]);
    const waiting = service.getQuotes(["XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"]);
    await vi.advanceTimersByTimeAsync(2100); await waiting;
    expect(fetchQuotes).toHaveBeenCalledTimes(1); await service.stop();
  });

  it("does not request the next issuer metadata page if the session closes mid-pagination", async () => {
    clearXStockCatalogCache();
    let time = new Date("2026-10-02T19:59:59Z");
    const fetchImpl = vi.fn(async () => {
      time = new Date("2026-10-02T20:00:00Z");
      return Response.json({ nodes: [{ symbol: "AAPLx", name: "Apple xStock", underlyingSymbol: "AAPL", isTradingHalted: false,
        deployments: [{ network: "Solana", address: A }] }], page: { currentPage: 0, hasNextPage: true } });
    });
    const service = new XStockQuoteService({ cachePath: null, catalog, fetchImpl, now: () => time, minRequestIntervalMs: 0 });
    await service.refreshAll(); await new Promise<void>(resolve => setImmediate(resolve));
    expect(fetchImpl).toHaveBeenCalledTimes(1); await service.stop(); clearXStockCatalogCache();
  });

  it("does not start block RPC when an in-flight quote finishes after the closing bell", async () => {
    let time = new Date("2026-10-02T19:59:59Z"); const blockTimes = vi.fn(async () => ({ 123: "2026-10-02T19:58:00.000Z" }));
    const service = new XStockQuoteService({ cachePath: null, catalog, refreshCatalog: async () => catalog(), now: () => time, minRequestIntervalMs: 0, blockTimes,
      fetchQuotes: async () => { time = new Date("2026-10-02T20:00:00Z"); return { [A]: { point: { mint: A, price: 123, source: "jupiter", unit: "scaled-ui", asOf: time.toISOString(), blockId: 123 }, outcome: "priced", refreshedAt: time.toISOString() } }; } });
    expect((await service.getQuotes([A]))[0].priceUsd).toBeNull(); expect(blockTimes).not.toHaveBeenCalled(); await service.stop();
  });
});


describe("shared provider session gate", () => {
  it("direct NAV-style reads reuse the last valid quote after close, including after an open-session outage", async () => {
    clearPriceCache();
    let time = new Date("2026-10-02T19:58:00Z");
    const fetchImpl = vi.fn(async () => Response.json({ [A]: { usdPrice: 123, blockId: 123 } }));
    const original = await fetchPriceQuotes([A], { now: () => time, fetchImpl, fallback: "none" });
    time = new Date("2026-10-02T19:59:00Z");
    const outage = vi.fn(async () => new Response("{}", { status: 503 }));
    expect(await fetchPriceQuotes([A], { now: () => time, fetchImpl: outage, fallback: "none" })).toEqual({});
    time = new Date("2026-10-02T20:00:00Z");
    const closed = await fetchPriceQuotes([A], { now: () => time, fetchImpl, forceRefresh: true, fallback: "none" });
    expect(closed).toEqual(original); expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await fetchPriceQuotes(["unseen"], { now: () => time, fetchImpl, fallback: "mock" })).toMatchObject({ unseen: { price: 0, source: "mock" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1); clearPriceCache();
  });

  it("direct batch loops recheck the market before each outbound batch", async () => {
    clearPriceCache(); let time = new Date("2026-10-02T19:59:59Z");
    const fetchImpl = vi.fn(async () => { time = new Date("2026-10-02T20:00:00Z"); return Response.json({}); });
    await fetchPriceQuotes(Array.from({ length: 151 }, (_, index) => `mint${index}`), { now: () => time, fetchImpl, fallback: "none" });
    expect(fetchImpl).toHaveBeenCalledTimes(1); clearPriceCache();
  });

  it("legacy mainnet comparison serves restored token quotes without metadata, Jupiter, or Yahoo calls closed", async () => {
    clearPriceCache();
    restoreLastValidPriceQuotes([{ mint: A, price: 123, source: "jupiter", unit: "scaled-ui", asOf: "2026-10-02T19:58:00.000Z", blockId: 123 }]);
    const fetchImpl = vi.fn(async () => Response.json({})); const fetchUnderlyingPrice = vi.fn(async () => 999);
    const rows = await comparePrices(["AAPLx"], { market: "mainnet", now: () => new Date("2026-10-03T15:00:00Z"), fetchImpl, fetchUnderlyingPrice });
    expect(rows[0]).toMatchObject({ mint: A, jupiter: 123, yahoo: null, source: "jupiter" });
    expect(fetchImpl).not.toHaveBeenCalled(); expect(fetchUnderlyingPrice).not.toHaveBeenCalled(); clearPriceCache();
  });
});
