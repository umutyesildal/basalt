import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type http from "node:http";
import { PublicKey } from "@solana/web3.js";
import { createHandler } from "../src/api/server";
import { clearXStockCatalogCache, XSTOCK_CATALOG_SOURCE_URL } from "../src/catalog/xstocks";
import { clearPriceCache, JUPITER_PRICE_URL } from "../src/workers/priceFetch";
import { clearPriceBlockTimes } from "../src/workers/priceBlockTime";
import { XStockQuoteService } from "../src/workers/xstockQuotes";
import { getNyseMarketSession } from "../src/workers/marketSession";

const AAPL = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NOW = new Date("2026-10-03T00:00:00Z");
const OBSERVED_SECONDS = Math.floor(NOW.getTime() / 1_000) - 120;
const BLOCK = 452744576;

function issuerNode(symbol: string, name: string, mint: string) {
  return {
    id: symbol, symbol, name, description: name,
    underlying: { symbol: symbol.slice(0, -1), type: null, currency: "USD" },
    logo: `https://xstocks-metadata.backed.fi/logos/tokens/${symbol}.png`,
    isTradingHalted: false,
    deployments: [{ network: "Solana", address: mint, stablecoins: [{ symbol: "USDC", decimals: 6 }] }],
  };
}
const nodes = [issuerNode("AAPLx", "Apple xStock", AAPL), issuerNode("SPYx", "SP500 xStock", SPY)];
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fixture(options: { quotes?: unknown; quoteStatus?: number; rpcResult?: number | null; catalogFails?: boolean; rpcFails?: boolean } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith(XSTOCK_CATALOG_SOURCE_URL)) {
      if (options.catalogFails) return jsonResponse({}, 503);
      return jsonResponse({ nodes, page: { currentPage: 0, hasNextPage: false } });
    }
    if (url.startsWith(JUPITER_PRICE_URL)) {
      return jsonResponse(options.quotes ?? {
        [AAPL]: {
          usdPrice: 300, decimals: 8, blockId: BLOCK, priceChange24h: -1.5,
          createdAt: "2025-06-10T11:06:56Z",
          stockData: { price: 999, updatedAt: NOW.toISOString() },
          scaledUiConfig: { multiplier: 1, newMultiplier: 2, newMultiplierEffectiveAt: "2026-10-01T00:00:00Z", usdPricePrescaled: 600 },
        },
      }, options.quoteStatus ?? 200);
    }
    if (url === "https://api.mainnet-beta.solana.com") {
      if (options.rpcFails) throw new Error("RPC unavailable");
      const requests = JSON.parse(String(init?.body)) as Array<{ id: number; method: string; params: number[] }>;
      return jsonResponse(requests.map(request => ({ jsonrpc: "2.0", id: request.id, result: options.rpcResult === undefined ? OBSERVED_SECONDS : options.rpcResult })));
    }
    throw new Error(`Unexpected outbound provider: ${url}`);
  };
  return { calls, fetchImpl };
}

const services = new WeakMap<typeof fetch, XStockQuoteService>();
async function request(path: string, fetchImpl: typeof fetch) {
  let service = services.get(fetchImpl);
  if (!service) { service = new XStockQuoteService({ fetchImpl, now: () => NOW, cachePath: null, marketSession: () => ({ ...getNyseMarketSession(new Date("2026-10-02T15:00:00Z")), opensAt: null, closesAt: null, nextOpenAt: null }) }); services.set(fetchImpl, service); }
  let body = "";
  const response = {
    statusCode: 200,
    setHeader() {},
    end(chunk?: string) { body = chunk ?? ""; },
  };
  const req = { method: "GET", url: path, headers: { host: "localhost" } };
  await createHandler({ db: null, fetchImpl, now: () => NOW, xstockQuotes: service })(
    req as http.IncomingMessage,
    response as unknown as http.ServerResponse,
  );
  return { status: response.statusCode, body: JSON.parse(body) };
}

beforeEach(() => {
  clearXStockCatalogCache();
  clearPriceCache();
  clearPriceBlockTimes();
  vi.stubEnv("PRICE_MAINNET_RPC_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("official xStocks HTTP contracts", () => {
  it("serves issuer Solana metadata without a database and keeps ETF enrichment", async () => {
    const upstream = fixture();
    const response = await request("/api/v1/xstocks", upstream.fetchImpl);
    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ source: "issuer", stale: false, fetchedAt: NOW.toISOString() });
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.find((asset: { mint: string }) => asset.mint === SPY))
      .toMatchObject({ symbol: "SPYx", underlyingSymbol: "SPY", assetClass: "etf", network: "solana", decimals: 8 });
    expect(response.body.data[0]).not.toHaveProperty("priceUsd");
    const url = new URL(upstream.calls[0].url);
    expect(url.searchParams.get("network")).toBe("Solana");
    expect(url.searchParams.get("page")).toBe("0");
    expect(url.searchParams.get("pageSize")).toBe("100");
    expect(upstream.calls).toHaveLength(1);
  });

  it("returns the scaled onchain price and separates source time from fetch time", async () => {
    const upstream = fixture();
    const response = await request(`/api/v1/xstocks/prices?mints=${AAPL}`, upstream.fetchImpl);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject([{
      mint: AAPL, priceUsd: 300, source: "jupiter", fetchedAt: NOW.toISOString(),
      observedAt: new Date(OBSERVED_SECONDS * 1_000).toISOString(), blockId: BLOCK,
      decimals: 8, unit: "scaled-ui", change24hPct: -1.5, status: "available",
      stale: false, freshness: "fresh", refreshedAt: NOW.toISOString(), refreshReason: "priced",
    }]);
    expect(response.body.meta).toMatchObject({ source: "jupiter-v3", unit: "scaled-ui", catalogStale: true });
    const rpc = upstream.calls.find(call => call.url === "https://api.mainnet-beta.solana.com")!;
    expect(JSON.parse(String(rpc.init?.body))).toEqual([{ jsonrpc: "2.0", id: BLOCK, method: "getBlockTime", params: [BLOCK] }]);
  });

  it.each([{}, { [AAPL]: { stockData: { price: 999 }, usdPrice: null } }])(
    "keeps omitted or invalid token prices null even when mock fallback is enabled",
    async quotes => {
      vi.stubEnv("PRICE_FALLBACK", "mock");
      const upstream = fixture({ quotes });
      const response = await request(`/api/v1/xstocks/prices?mints=${AAPL}`, upstream.fetchImpl);
      expect(response.status).toBe(200);
      expect(response.body.data[0]).toMatchObject({ priceUsd: null, source: "unavailable", status: "unavailable", fetchedAt: null, observedAt: null });
      expect(upstream.calls).toHaveLength(1);
      expect(upstream.calls.every(call => call.url.startsWith(XSTOCK_CATALOG_SOURCE_URL) || call.url.startsWith(JUPITER_PRICE_URL))).toBe(true);
    },
  );

  it("does not substitute an equity quote or mock after Jupiter authentication failure", async () => {
    vi.stubEnv("PRICE_FALLBACK", "mock");
    const upstream = fixture({ quoteStatus: 401 });
    const response = await request(`/api/v1/xstocks/prices?mints=${AAPL}`, upstream.fetchImpl);
    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ priceUsd: null, source: "unavailable" });
    expect(upstream.calls).toHaveLength(1);
  });

  it("rejects a valid mint outside the issuer catalog before asking for its price", async () => {
    const upstream = fixture();
    const unknown = new PublicKey(Buffer.alloc(32, 42)).toBase58();
    const response = await request(`/api/v1/xstocks/prices?mints=${unknown}`, upstream.fetchImpl);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("UNKNOWN_XSTOCK");
    expect(upstream.calls).toHaveLength(1);
  });

  it.each(["", "not-a-solana-mint", "0OIl!", Array.from({ length: 101 }, (_, index) => new PublicKey(Buffer.alloc(32, index)).toBase58()).join(",")])(
    "rejects missing, malformed or oversized mint requests before any provider call",
    async value => {
      const upstream = fixture();
      const response = await request(`/api/v1/xstocks/prices?mints=${encodeURIComponent(value)}`, upstream.fetchImpl);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_MINTS");
      expect(upstream.calls).toHaveLength(0);
    },
  );

  it("retains the valid price when source time is unknown without inventing a timestamp", async () => {
    const upstream = fixture({ rpcResult: null });
    const response = await request(`/api/v1/xstocks/prices?mints=${AAPL}`, upstream.fetchImpl);
    expect(response.body.data[0]).toMatchObject({ priceUsd: 300, fetchedAt: NOW.toISOString(), observedAt: null });
  });

  it("reports catalog fallback provenance while keeping quote prices independent", async () => {
    const upstream = fixture({ catalogFails: true, quotes: {} });
    const response = await request(`/api/v1/xstocks/prices?mints=${SPY}`, upstream.fetchImpl);
    expect(response.status).toBe(200);
    expect(response.body.meta.catalogStale).toBe(true);
    expect(response.body.data[0]).toMatchObject({ priceUsd: null, status: "unavailable" });
  });

  it("reuses catalog, quote and block-time caches without refreshing source timestamps", async () => {
    const upstream = fixture();
    const path = `/api/v1/xstocks/prices?mints=${AAPL},${AAPL}`;
    const first = await request(path, upstream.fetchImpl);
    const second = await request(path, upstream.fetchImpl);
    expect(first.body.data).toHaveLength(1);
    expect(second.body.data).toEqual(first.body.data);
    expect(upstream.calls).toHaveLength(2);
  });
});
