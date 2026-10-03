import { beforeEach, describe, expect, it } from "vitest";
import { clearPriceCache, fetchPriceQuoteResults as actualFetchResults, fetchPriceQuotes as actualFetchQuotes, parseJupiterPrice, PRICE_CACHE_TTL_MS, type FetchPricesOptions } from "../src/workers/priceFetch";
import { clearPriceBlockTimes, getPriceBlockTimes } from "../src/workers/priceBlockTime";
import { getNyseMarketSession } from "../src/workers/marketSession";
const alwaysOpen = () => ({ ...getNyseMarketSession(new Date("2026-10-02T15:00:00Z")), opensAt: null, closesAt: null, nextOpenAt: null });
const fetchPriceQuotes = (mints: string[], opts: FetchPricesOptions = {}) => actualFetchQuotes(mints, { ...opts, marketSession: alwaysOpen });
const fetchPriceQuoteResults = (mints: string[], opts: FetchPricesOptions = {}) => actualFetchResults(mints, { ...opts, marketSession: alwaysOpen });
import { computeNavExact } from "../src/workers/navEngine";
const now = () => new Date("2026-10-02T22:40:00Z");
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { clearPriceCache(); clearPriceBlockTimes(); });
describe("real xStock token pricing", () => {
  it("uses already-scaled usdPrice, never stockData reference or a second multiplier", () => {
    const q = parseJupiterPrice("AAPL", { usdPrice: 333.6010298111938, blockId: 452744576,
      decimals: 8, stockData: { price: 999 }, createdAt: "2025-06-01T00:00:00Z",
      scaledUiConfig: { multiplier: 1.0026642075893797, newMultiplier: 1.0032690125398187,
        newMultiplierEffectiveAt: "2026-08-08T00:30:00Z", usdPricePrescaled: 334.69157576094307 } }, now())!;
    expect(q.price).toBe(333.6010298111938);
    expect(q.multiplier).toBe(1.0032690125398187);
    expect(q.price * q.multiplier!).toBeCloseTo(q.rawUnitPrice!, 9);
    expect(q.asOf).toBe(now().toISOString());
    expect(q.unit).toBe("scaled-ui");
    expect(Number(computeNavExact(["1.0032690125398187"], [q.price]))).toBeCloseTo(q.rawUnitPrice!, 5);
  });
  it("preserves the old multiplier before its scheduled activation", () => {
    expect(parseJupiterPrice("A", { usdPrice: 5, scaledUiConfig: { multiplier: 2, newMultiplier: 4,
      newMultiplierEffectiveAt: "2027-01-01T00:00:00Z" } }, now())?.multiplier).toBe(2);
  });
  it("rejects zero, negative, nonfinite or underlying-only prices", () => {
    for (const usdPrice of [0, -1, NaN, Infinity, "123", null, undefined]) {
      expect(parseJupiterPrice("A", { usdPrice, stockData: { price: 100 } }, now())).toBeNull();
    }
  });
  it("batches at fifty mints and caches overlapping queries per mint", async () => {
    const batches: string[][] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const mints = new URL(String(url)).searchParams.get("ids")!.split(",");
      batches.push(mints);
      return response(Object.fromEntries(mints.map(mint => [mint, { usdPrice: 10 }])));
    }) as typeof fetch;
    const mints = Array.from({ length: 121 }, (_, i) => `mint${i}`);
    const quotes = await fetchPriceQuotes(mints, { fetchImpl, now, fallback: "none" });
    expect(Object.keys(quotes)).toHaveLength(121);
    expect(batches.map(batch => batch.length)).toEqual([50, 50, 21]);
    await fetchPriceQuotes(mints.slice(20, 80), { fetchImpl, now });
    expect(batches).toHaveLength(3);
  });
  it("does not cache mock fallbacks as real prices or relabel expired quotes after failure", async () => {
    const fetchImpl = (async () => response({ A: { usdPrice: 12 } })) as typeof fetch;
    await fetchPriceQuotes(["A"], { fetchImpl, now });
    const failed = (async () => response({}, 401)) as typeof fetch;
    const later = () => new Date(now().getTime() + PRICE_CACHE_TTL_MS + 1);
    expect(await fetchPriceQuotes(["A"], { fetchImpl: failed, now: later, fallback: "mock" })).toMatchObject({ A: { source: "mock", price: 0 } });
    expect(await fetchPriceQuotes(["A"], { fetchImpl: failed, now: later, fallback: "none" })).toEqual({});
  });
  it("deduplicates concurrent calls and never trusts extra response mints", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; await Promise.resolve(); return response({ A: { usdPrice: 1 }, INJECTED: { usdPrice: 999 } }); }) as typeof fetch;
    const [a, b] = await Promise.all([fetchPriceQuotes(["A"], { fetchImpl, now }), fetchPriceQuotes(["A"], { fetchImpl, now })]);
    expect(calls).toBe(1); expect(a).toEqual(b); expect(a.INJECTED).toBeUndefined();
  });
  it.each([200, 503])("older overlapping completion (%s) cannot regress a newer cached quote", async (status) => {
    let finish!: (response: Response) => void;
    const delayed = new Promise<Response>(resolve => { finish = resolve; });
    const fetchImpl = (async (url) => String(url).includes("%2C") ? delayed : response({ A: { usdPrice: 123 } })) as typeof fetch;
    const older = fetchPriceQuotes(["A", "B"], { fetchImpl, now });
    await fetchPriceQuotes(["A"], { fetchImpl, now });
    finish(response({ A: { usdPrice: 1 } }, status));
    await older;
    expect((await fetchPriceQuotes(["A"], { fetchImpl, now })).A.price).toBe(123);
  });
  it("distinguishes metadata-only responses from provider outages and honors rate-limit retry headers", async () => {
    const metadata = await fetchPriceQuoteResults(["A"], { fetchImpl: (async () => response({ A: { decimals: 8, stockData: { price: 100 } } })) as typeof fetch, now, forceRefresh: true });
    expect(metadata.A).toMatchObject({ point: null, outcome: "omitted", refreshedAt: now().toISOString() });
    const rateLimited = await fetchPriceQuoteResults(["A"], { fetchImpl: (async () => new Response("{}", { status: 429, headers: { "Retry-After": "3" } })) as typeof fetch, now, forceRefresh: true });
    expect(rateLimited.A).toMatchObject({ point: null, outcome: "outage", retryAfterMs: 3250 });
  });
  it("keeps API keys server-side in request headers", async () => {
    const fetchImpl = (async (url, init) => {
      expect(String(url)).not.toContain("test-key");
      expect(init?.headers).toEqual({ "x-api-key": "test-key" });
      return response({});
    }) as typeof fetch;
    await fetchPriceQuotes(["A"], { fetchImpl, now, apiKey: "test-key" });
  });
});
describe("source block timestamps", () => {
  it("batches slots, caches immutable block times and rejects future or missing timestamps", async () => {
    let calls = 0;
    const fetchImpl = (async (_url, init) => {
      calls++;
      const requests = JSON.parse(String(init?.body));
      expect(requests.map((r: { method: string }) => r.method)).toEqual(["getBlockTime", "getBlockTime", "getBlockTime"]);
      return response([{ id: 123, result: 1790980102 }, { id: 124, result: null }, { id: 125, result: 9999999999 }]);
    }) as typeof fetch;
    const result = await getPriceBlockTimes([123, 123, 124, 125], { fetchImpl, now });
    expect(result).toEqual({ 123: "2026-10-02T22:28:22.000Z", 124: null, 125: null });
    expect(await getPriceBlockTimes([123], { fetchImpl, now })).toEqual({ 123: result[123] });
    expect(calls).toBe(1);
  });
  it("preserves a known immutable timestamp when an older overlapping lookup fails", async () => {
    let finish!: (response: Response) => void;
    const delayed = new Promise<Response>(resolve => { finish = resolve; });
    const fetchImpl = (async (_url, init) => JSON.parse(String(init?.body)).length > 1
      ? delayed : response([{ id: 123, result: 1790980102 }])) as typeof fetch;
    const older = getPriceBlockTimes([123, 124], { fetchImpl, now });
    await getPriceBlockTimes([123], { fetchImpl, now });
    finish(response([{ id: 123, result: null }, { id: 124, result: null }]));
    await older;
    expect((await getPriceBlockTimes([123], { fetchImpl, now }))[123]).toBe("2026-10-02T22:28:22.000Z");
  });
  it("never substitutes fetchedAt on an RPC outage", async () => {
    const fetchImpl = (async () => { throw new Error("offline"); }) as typeof fetch;
    expect(await getPriceBlockTimes([123], { fetchImpl, now })).toEqual({ 123: null });
  });
});
