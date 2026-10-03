import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { XStockQuoteService, XSTOCK_FULL_REFRESH_MS, XSTOCK_HOT_REFRESH_MS } from "../src/workers/xstockQuotes";
import { getNyseMarketSession } from "../src/workers/marketSession";
import { getCachedXStockCatalog, type CatalogResult } from "../src/catalog/xstocks";
import type { PriceQuoteResult, PriceRefreshOutcome } from "../src/workers/priceFetch";

const A = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const B = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const C = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const START = Date.parse("2026-10-03T00:00:00Z");
const SOURCE = "2026-09-27T12:00:00.000Z";
const alwaysOpen = () => ({ ...getNyseMarketSession(new Date("2026-10-02T15:00:00Z")), opensAt: null, closesAt: null, nextOpenAt: null });
const catalog = (): CatalogResult => {
  const all = getCachedXStockCatalog();
  return { ...all, data: all.data.filter(asset => [A, B, C].includes(asset.mint)) };
};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  let time = START;
  let outcome: PriceRefreshOutcome = "priced";
  let block = 123;
  const calls: string[][] = [];
  const provider = async (mints: string[]): Promise<Record<string, PriceQuoteResult>> => {
    calls.push(mints);
    return Object.fromEntries(mints.map(mint => [mint, { point: outcome === "priced" ? {
      mint, price: 123.45, source: "jupiter", unit: "scaled-ui", asOf: new Date(time).toISOString(), blockId: block, decimals: 8, change24hPct: 1.2,
    } : null, outcome, refreshedAt: new Date(time).toISOString() }]));
  };
  const options = { now: () => new Date(time), cachePath: null, marketSession: alwaysOpen, catalog, refreshCatalog: async () => catalog(), fetchQuotes: provider,
    blockTimes: async (slots: number[]) => Object.fromEntries(slots.map(slot => [slot, SOURCE])), minRequestIntervalMs: 0 };
  return { options, calls, advance: (ms: number) => { time += ms; }, setOutcome: (value: PriceRefreshOutcome) => { outcome = value; }, setBlock: (value: number) => { block = value; } };
}
afterEach(() => { vi.useRealTimers(); });

describe("cached public token quotes", () => {
  it("returns one scaled token quote and keeps older trade time separate from fresh retrieval", async () => {
    const f = fixture(); const service = new XStockQuoteService(f.options);
    const [quote] = await service.getQuotes([A, A]);
    expect(quote).toMatchObject({ mint: A, priceUsd: 123.45, source: "jupiter", unit: "scaled-ui", fetchedAt: new Date(START).toISOString(),
      observedAt: SOURCE, stale: false, freshness: "fresh", refreshReason: "priced" });
    await service.getQuotes([A]);
    expect(f.calls).toEqual([[A]]);
    expect(service.metadata()).toMatchObject({ refreshIntervalMs: 300000, hotRefreshIntervalMs: 60000, cachedAssetCount: 1, pricedAssetCount: 1 });
    await service.stop();
  });

  it.each(["outage", "omitted"] as const)("retains last valid prices and original timestamps after %s, but never invents an unseen price", async outcome => {
    const f = fixture(); const service = new XStockQuoteService(f.options);
    const [original] = await service.getQuotes([A]);
    f.advance(XSTOCK_HOT_REFRESH_MS); f.setOutcome(outcome);
    await service.refreshHot();
    const [cached] = await service.getQuotes([A]);
    expect(cached).toMatchObject({ priceUsd: original.priceUsd, fetchedAt: original.fetchedAt, observedAt: SOURCE,
      refreshedAt: new Date(START + XSTOCK_HOT_REFRESH_MS).toISOString(), stale: true, freshness: "stale", refreshReason: outcome });
    const [unseen] = await service.getQuotes([B]);
    expect(unseen).toMatchObject({ priceUsd: null, source: "unavailable", fetchedAt: null, observedAt: null, freshness: "unavailable", refreshReason: outcome });
    const count = f.calls.length;
    await service.getQuotes([B]); expect(f.calls).toHaveLength(count);
    await service.stop();
  });

  it("returns expired cached data immediately while one refresh is in flight", async () => {
    const f = fixture(); const gate = deferred<Record<string, PriceQuoteResult>>(); let blocked = false;
    const service = new XStockQuoteService({ ...f.options, fetchQuotes: mints => blocked ? gate.promise : f.options.fetchQuotes(mints) });
    await service.getQuotes([A]); f.advance(60_000); blocked = true;
    const [cached] = await service.getQuotes([A]);
    expect(cached.freshness).toBe("stale"); expect(cached.priceUsd).toBe(123.45);
    gate.resolve(await f.options.fetchQuotes([A]));
    await service.refreshHot();
    expect((await service.getQuotes([A]))[0].freshness).toBe("fresh");
    await service.stop();
  });

  it("deduplicates overlapping visible requests per mint", async () => {
    const f = fixture(); const gate = deferred<void>();
    const service = new XStockQuoteService({ ...f.options, fetchQuotes: async mints => { await gate.promise; return f.options.fetchQuotes(mints); } });
    const a = service.getQuotes([A, B]); const b = service.getQuotes([B, C]);
    await Promise.resolve(); await Promise.resolve(); gate.resolve();
    await Promise.all([a, b]);
    expect(f.calls.flat().sort()).toEqual([A, B, C].sort());
    await service.stop();
  });

  it("does not replace a newer observed block with a lagging provider response", async () => {
    const f = fixture(); const service = new XStockQuoteService(f.options);
    const [original] = await service.getQuotes([A]); f.advance(60_000); f.setBlock(122);
    await service.refreshHot();
    expect((await service.getQuotes([A]))[0]).toMatchObject({ blockId: 123, fetchedAt: original.fetchedAt, stale: true });
    await service.stop();
  });

  it("refreshes only hot mints each minute and expires idle subscriptions", async () => {
    const f = fixture(); const service = new XStockQuoteService(f.options);
    await service.refreshAll(); expect(f.calls.flat()).toHaveLength(3);
    await service.getQuotes([A]); f.advance(60_000); await service.refreshHot();
    expect(f.calls.at(-1)).toEqual([A]);
    f.advance(10 * 60_000); const count = f.calls.length; await service.refreshHot();
    expect(f.calls).toHaveLength(count);
    await service.stop();
  });

  it("runs the catalog pass once per five minutes without overlapping passes, then stops timers", async () => {
    vi.useFakeTimers(); vi.setSystemTime(START);
    const f = fixture(); const service = new XStockQuoteService({ ...f.options, now: () => new Date() });
    service.start(); await service.refreshAll(); expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(XSTOCK_FULL_REFRESH_MS); expect(f.calls).toHaveLength(2);
    await service.stop(); await vi.advanceTimersByTimeAsync(XSTOCK_FULL_REFRESH_MS * 2);
    expect(f.calls).toHaveLength(2); expect(service.isRunning).toBe(false);
  });

  it("paces provider requests globally and delays the next batch after a429reset", async () => {
    vi.useFakeTimers(); vi.setSystemTime(START);
    const f = fixture(); const started: number[] = [];
    const service = new XStockQuoteService({ ...f.options, now: () => new Date(), minRequestIntervalMs: 2100,
      fetchQuotes: async mints => {
        started.push(Date.now());
        return Object.fromEntries(mints.map(mint => [mint, { point: null, outcome: "outage" as const, refreshedAt: new Date().toISOString(), retryAfterMs: 5000 }]));
      } });
    await service.getQuotes([A]);
    const second = service.getQuotes([B]);
    await vi.advanceTimersByTimeAsync(4999); expect(started).toEqual([START]);
    await vi.advanceTimersByTimeAsync(1); await second;
    expect(started).toEqual([START, START + 5000]);
    await service.stop();
  });

  it("rechecks a newly learned rate-limit deadline while another request is already waiting", async () => {
    vi.useFakeTimers(); vi.setSystemTime(START);
    const f = fixture(); const started: number[] = [];
    const service = new XStockQuoteService({ ...f.options, now: () => new Date(), minRequestIntervalMs: 60,
      fetchQuotes: async mints => {
        started.push(Date.now());
        if (started.length === 1) await new Promise<void>(resolve => setTimeout(resolve, 20));
        return Object.fromEntries(mints.map(mint => [mint, { point: null, outcome: "outage" as const, refreshedAt: new Date().toISOString(), retryAfterMs: 240 }]));
      } });
    const first = service.getQuotes([A]); await vi.advanceTimersByTimeAsync(1);
    const second = service.getQuotes([B]); await vi.advanceTimersByTimeAsync(258);
    expect(started).toEqual([START]);
    await vi.advanceTimersByTimeAsync(1); await Promise.all([first, second]);
    expect(started).toEqual([START, START + 260]);
    await service.stop();
  });

  it("a visible cold request is served before the remainder of the full catalog pass", async () => {
    const f = fixture(); const all = getCachedXStockCatalog(); const gate = deferred<void>(); const calls: string[][] = [];
    const target = all.data[75].mint;
    const service = new XStockQuoteService({ ...f.options, catalog: () => all, refreshCatalog: async () => all,
      fetchQuotes: async mints => { calls.push(mints); if (calls.length === 1) await gate.promise; return f.options.fetchQuotes(mints); } });
    const full = service.refreshAll(); for (let i = 0; i < 10 && !calls.length; i++) await Promise.resolve();
    const visible = await service.getQuotes([target]); expect(visible[0].priceUsd).toBe(123.45);
    expect(calls[0]).toHaveLength(50); expect(calls[1]).toEqual([target]);
    gate.resolve(); await full; await service.stop();
  });

  it("bounded cold reads return unavailable while the provider finishes in background", async () => {
    vi.useFakeTimers(); vi.setSystemTime(START);
    const f = fixture(); const gate = deferred<Record<string, PriceQuoteResult>>();
    const service = new XStockQuoteService({ ...f.options, fetchQuotes: () => gate.promise, coldWaitMs: 100 });
    const cold = service.getQuotes([A]); await vi.advanceTimersByTimeAsync(100);
    expect((await cold)[0]).toMatchObject({ priceUsd: null, freshness: "unavailable" });
    gate.resolve(await f.options.fetchQuotes([A])); await service.refreshHot();
    expect((await service.getQuotes([A]))[0].priceUsd).toBe(123.45);
    await service.stop();
  });

  it("aborts an active refresh on shutdown and never queues the next background batch", async () => {
    const all = getCachedXStockCatalog(); let calls = 0;
    const service = new XStockQuoteService({ ...fixture().options, catalog: () => all, refreshCatalog: async () => all,
      fetchQuotes: async (_mints, signal) => { calls++; await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); return {}; } });
    const pass = service.refreshAll();
    for (let i = 0; i < 10 && !calls; i++) await Promise.resolve();
    expect(calls).toBe(1);
    await service.stop(); await pass; expect(calls).toBe(1);
  });

  it("persists public quotes atomically and restores only validated official token identities as stale", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xstock-quotes-")); const path = join(directory, "prices.json");
    try {
      const f = fixture(); const first = new XStockQuoteService({ ...f.options, cachePath: path });
      const [original] = await first.getQuotes([A]); await first.stop();
      const saved = JSON.parse(await readFile(path, "utf8"));
      expect(saved.version).toBe(1); expect(saved.entries).toHaveLength(1); expect(saved.entries[0].point.source).toBe("jupiter");
      const valid = saved.entries[0];
      saved.entries.push({ ...valid, point: { ...valid.point, mint: B, source: "yahoo" } });
      saved.entries.push({ ...valid, point: { ...valid.point, mint: C, asOf: "2099-01-01T00:00:00Z" } });
      saved.entries.push({ ...valid, point: { ...valid.point, mint: "11111111111111111111111111111111" } });
      await writeFile(path, JSON.stringify(saved));
      f.advance(300_000); f.setOutcome("outage");
      const restored = new XStockQuoteService({ ...f.options, cachePath: path });
      await restored.initialize(); expect(restored.metadata().cachedAssetCount).toBe(1);
      const [quote] = await restored.getQuotes([A]);
      expect(quote).toMatchObject({ priceUsd: original.priceUsd, fetchedAt: original.fetchedAt, observedAt: original.observedAt, stale: true });
      await restored.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
