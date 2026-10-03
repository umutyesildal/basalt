import { PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearXStockCatalogCache, findXStockAsset, getXStockCatalog, getCachedXStockCatalog,
  XSTOCK_CATALOG_SOURCE_URL, XSTOCK_CATALOG_TTL_MS, XSTOCK_CATALOG_RETRY_MS,
} from "../src/catalog/xstocks.js";

const NOW = new Date("2026-10-03T00:00:00.000Z");
const MINT_A = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const MINT_B = new PublicKey(new Uint8Array(32).fill(8)).toBase58();
const MINT_C = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
const node = (patch: Record<string, unknown> = {}) => ({
  name: "Acme xStock", symbol: "ACMEx", underlyingSymbol: "ACME",
  underlying: { symbol: "ACME", type: null }, logo: "https://example.test/acme.png",
  isTradingHalted: false, deployments: [{ network: "Solana", address: MINT_A }], ...patch,
});
const page = (currentPage: number, hasNextPage: boolean, nodes: unknown[]) => ({ nodes, page: { currentPage, hasNextPage } });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function pages(...bodies: unknown[]) {
  const mock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    return response(bodies[Number(url.searchParams.get("page"))]);
  });
  return { mock, fetchImpl: mock as unknown as typeof fetch };
}
const fail = (async () => { throw new Error("offline"); }) as typeof fetch;

beforeEach(() => clearXStockCatalogCache());
afterEach(() => vi.restoreAllMocks());

describe("official xStocks Solana catalog", () => {
  it("fetches every page, validates Solana deployments and deduplicates repeated mints", async () => {
    const second = node({ symbol: "BETAx", underlyingSymbol: "BETA", name: "Beta xStock", deployments: [{ network: "Solana", address: MINT_B }] });
    const fixture = pages(page(0, true, [node(), node({ deployments: [{ network: "Ethereum", address: "0x123" }] })]), page(1, false, [node(), second]));
    const catalog = await getXStockCatalog({ ...fixture, now: NOW });
    expect(catalog.meta).toEqual({ source: "issuer", stale: false, fetchedAt: NOW.toISOString(), sourceUrl: XSTOCK_CATALOG_SOURCE_URL });
    expect(catalog.data.map((a) => a.mint)).toEqual([MINT_A, MINT_B]);
    expect(fixture.mock).toHaveBeenCalledTimes(2);
    fixture.mock.mock.calls.forEach(([input], index) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(XSTOCK_CATALOG_SOURCE_URL);
      expect(url.searchParams.get("pageSize")).toBe("100");
      expect(url.searchParams.get("network")).toBe("Solana");
      expect(url.searchParams.get("page")).toBe(String(index));
    });
    expect(catalog.data[0]).toMatchObject({ network: "solana", provider: "backed", symbol: "ACMEx", ticker: "ACMEx", underlyingSymbol: "ACME", decimals: null, assetClass: "unknown" });
    expect(Object.keys(catalog.data[0]).some((key) => /price|apy|return/i.test(key))).toBe(false);
  });

  it("never takes a stablecoin address or decimals as the asset mint metadata", async () => {
    const fixture = pages(page(0, false, [node({ deployments: [{ network: "Solana", address: MINT_A, stablecoins: [{ address: MINT_B, decimals: 6 }] }] })]));
    const catalog = await getXStockCatalog({ ...fixture, now: NOW });
    expect(catalog.data[0].mint).toBe(MINT_A);
    expect(catalog.data[0].decimals).toBeNull();
  });

  it.each(["1", "0x1234567890123456789012345678901234567890", "not-a-mint", "0".repeat(32)])("rejects invalid or noncanonical Solana mint %s", async (address) => {
    const catalog = await getXStockCatalog({ ...pages(page(0, false, [node({ deployments: [{ network: "Solana", address }] })])), now: NOW });
    expect(catalog.meta.source).toBe("snapshot");
    expect(catalog.meta.stale).toBe(true);
    expect(catalog.data.some((a) => a.mint === address)).toBe(false);
  });

  it.each([
    { nodes: [] },
    { nodes: {}, page: { currentPage: 0, hasNextPage: false } },
    { nodes: [node()], page: { currentPage: 1, hasNextPage: false } },
    { nodes: [node()], page: { currentPage: 0, hasNextPage: "false" } },
    page(0, true, []),
    page(0, false, []),
    page(0, false, [node({ deployments: {} })]),
    page(0, false, [node({ name: null })]),
  ])("fails closed to the complete snapshot for malformed issuer responses", async (body) => {
    const catalog = await getXStockCatalog({ ...pages(body), now: NOW });
    expect(catalog.meta).toMatchObject({ source: "snapshot", stale: true });
    expect(catalog.data.length).toBeGreaterThan(1000);
  });

  it("does not accept a partial catalog when a later page fails", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      return new URL(String(input)).searchParams.get("page") === "0" ? response(page(0, true, [node()])) : response({ error: "busy" }, 503);
    }) as unknown as typeof fetch;
    const catalog = await getXStockCatalog({ fetchImpl, now: NOW });
    expect(catalog.meta).toMatchObject({ source: "snapshot", stale: true });
    expect(findXStockAsset(catalog, "ACME")).toBeNull();
    const retry = pages(page(0, false, [node()]));
    const recovered = await getXStockCatalog({ ...retry, now: NOW, forceRefresh: true });
    expect(recovered.meta.source).toBe("issuer");
    expect(retry.mock).toHaveBeenCalledOnce();
  });

  it("bounds endless pagination and never presents its partial result as complete", async () => {
    const mock = vi.fn(async (input: string | URL | Request) => response(page(Number(new URL(String(input)).searchParams.get("page")), true, [node()])));
    const catalog = await getXStockCatalog({ fetchImpl: mock as unknown as typeof fetch, now: NOW });
    expect(mock.mock.calls.length).toBeGreaterThan(13);
    expect(mock.mock.calls.length).toBeLessThanOrEqual(64);
    expect(catalog.meta).toMatchObject({ source: "snapshot", stale: true });
    expect(findXStockAsset(catalog, "ACME")).toBeNull();
  });

  it("rejects conflicting metadata for the same mint across pages", async () => {
    const catalog = await getXStockCatalog({ ...pages(page(0, true, [node()]), page(1, false, [node({ symbol: "OTHERx" })])), now: NOW });
    expect(catalog.meta).toMatchObject({ source: "snapshot", stale: true });
  });

  it("keeps halted assets, marks missing status unknown and removes unsafe logo URLs", async () => {
    const fixture = pages(page(0, false, [
      node({ isTradingHalted: true, logo: "javascript:alert(1)" }),
      node({ symbol: "BETAx", underlyingSymbol: "BETA", isTradingHalted: undefined, logo: "https://user:password@example.test/logo.png", deployments: [{ network: "Solana", address: MINT_B }] }),
    ]));
    const catalog = await getXStockCatalog({ ...fixture, now: NOW });
    expect(catalog.data.map((a) => a.status)).toEqual(["halted", "unknown"]);
    expect(catalog.data.map((a) => a.logoUrl)).toEqual([null, null]);
  });

  it("uses explicit issuer types and standalone ETF names without misclassifying Netflix", async () => {
    const fixture = pages(page(0, false, [
      node({ underlying: { type: "Equity" } }),
      node({ symbol: "BETAx", underlyingSymbol: "BETA", name: "A verified ETF xStock", deployments: [{ network: "Solana", address: MINT_B }] }),
      node({ symbol: "NFLXx", underlyingSymbol: "NFLX", name: "Netflix xStock", deployments: [{ network: "Solana", address: MINT_C }] }),
    ]));
    const catalog = await getXStockCatalog({ ...fixture, now: NOW });
    expect(catalog.data.map((a) => a.assetClass)).toEqual(["stock", "etf", "unknown"]);
  });

  it("retains evidence-backed ETF classifications and mint decimals when issuer type is null", async () => {
    const snapshot = await getXStockCatalog({ fetchImpl: fail, now: NOW });
    const spy = findXStockAsset(snapshot, "SPY")!;
    expect(spy.assetClass).toBe("etf");
    const fixture = pages(page(0, false, [node({ name: spy.name, symbol: spy.symbol, underlyingSymbol: spy.underlyingSymbol, deployments: [{ network: "Solana", address: spy.mint }] })]));
    const live = await getXStockCatalog({ ...fixture, now: NOW, forceRefresh: true });
    expect(live.meta.source).toBe("issuer");
    expect(live.data[0]).toMatchObject({ assetClass: "etf", decimals: 8 });
    const replacement = pages(page(0, false, [node({ name: spy.name, symbol: spy.symbol, underlyingSymbol: spy.underlyingSymbol })]));
    const unverifiedMint = await getXStockCatalog({ ...replacement, now: NOW, forceRefresh: true });
    expect(unverifiedMint.data[0]).toMatchObject({ assetClass: "unknown", decimals: null });
  });
});

describe("catalog freshness and lookup", () => {
  it("uses a 15-minute cache and refreshes at the boundary", async () => {
    const fixture = pages(page(0, false, [node()]));
    await getXStockCatalog({ ...fixture, now: NOW });
    const cached = await getXStockCatalog({ ...fixture, now: new Date(NOW.getTime() + XSTOCK_CATALOG_TTL_MS - 1) });
    expect(cached.meta).toMatchObject({ source: "cache", stale: false, fetchedAt: NOW.toISOString() });
    expect(fixture.mock).toHaveBeenCalledOnce();
    await getXStockCatalog({ ...fixture, now: new Date(NOW.getTime() + XSTOCK_CATALOG_TTL_MS) });
    expect(fixture.mock).toHaveBeenCalledTimes(2);
  });

  it("allows forced refresh and returns the complete old cache with stale=true on failure", async () => {
    const fixture = pages(page(0, false, [node()]));
    const initial = await getXStockCatalog({ ...fixture, now: NOW });
    const next = new Date(NOW.getTime() + 1);
    const stale = await getXStockCatalog({ fetchImpl: fail, now: () => next, forceRefresh: true });
    expect(stale.data).toEqual(initial.data);
    expect(stale.meta).toEqual({ ...initial.meta, source: "cache", stale: true });
    const expired = await getXStockCatalog({ fetchImpl: fail, now: new Date(NOW.getTime() + XSTOCK_CATALOG_TTL_MS) });
    expect(expired.meta).toEqual(stale.meta);
  });

  it("shares a single refresh between concurrent callers", async () => {
    let release!: (response: Response) => void;
    const mock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const opts = { fetchImpl: mock as unknown as typeof fetch, now: NOW };
    const first = getXStockCatalog(opts);
    const second = getXStockCatalog({ ...opts, forceRefresh: true });
    expect(mock).toHaveBeenCalledOnce();
    release(response(page(0, false, [node()])));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.meta.source).toBe("issuer");
  });

  it("does not let a cleared in-flight request repopulate the cache", async () => {
    let release!: (response: Response) => void;
    const mock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = getXStockCatalog({ fetchImpl: mock as unknown as typeof fetch, now: NOW });
    clearXStockCatalogCache();
    release(response(page(0, false, [node()])));
    await pending;
    const catalog = await getXStockCatalog({ fetchImpl: fail, now: NOW });
    expect(catalog.meta.source).toBe("snapshot");
  });

  it("keeps caller mutation out of the cache", async () => {
    const fixture = pages(page(0, false, [node()]));
    const initial = await getXStockCatalog({ ...fixture, now: NOW });
    initial.data[0].name = "mutated";
    initial.data.length = 0;
    const cached = await getXStockCatalog({ ...fixture, now: NOW });
    expect(cached.data[0].name).toBe("Acme xStock");
  });

  it("ships a complete metadata-only snapshot with canonical unique Solana mints", async () => {
    const catalog = await getXStockCatalog({ fetchImpl: fail, now: NOW });
    expect(catalog.meta).toMatchObject({ source: "snapshot", stale: true });
    expect(catalog.data).toHaveLength(1271);
    expect(new Set(catalog.data.map((a) => a.mint)).size).toBe(catalog.data.length);
    expect(new Set(catalog.data.map((a) => a.symbol)).size).toBe(catalog.data.length);
    for (const asset of catalog.data) {
      expect(new PublicKey(asset.mint).toBase58()).toBe(asset.mint);
      expect(asset).toMatchObject({ network: "solana", provider: "backed", decimals: 8, sourceUrl: XSTOCK_CATALOG_SOURCE_URL });
      expect(asset.ticker).toBe(asset.symbol);
      expect(Object.keys(asset).some((key) => /price|apy|return/i.test(key))).toBe(false);
    }
    expect(findXStockAsset(catalog, "QQQ")?.assetClass).toBe("etf");
    expect(findXStockAsset(catalog, "NFLX")?.assetClass).toBe("unknown");
    expect(findXStockAsset(catalog, "TBLL")?.status).toBe("halted");
  });

  it("finds token/underlying aliases case-insensitively and mints exactly", async () => {
    const catalog = await getXStockCatalog({ ...pages(page(0, false, [node()])), now: NOW });
    expect(findXStockAsset(catalog, " acme ")?.mint).toBe(MINT_A);
    expect(findXStockAsset(catalog.data, "acmex")?.mint).toBe(MINT_A);
    expect(findXStockAsset(catalog, MINT_A)?.symbol).toBe("ACMEx");
    expect(findXStockAsset(catalog, MINT_A.toLowerCase())).toBeNull();
    expect(findXStockAsset(catalog, "unknown")).toBeNull();
  });

  it("preserves real exchange-qualified issuer aliases", async () => {
    const fixture = pages(page(0, false, [
      node({ symbol: "SHLx", underlyingSymbol: "XETR:SHLD" }),
      node({ symbol: "G.ITx", underlyingSymbol: "MTAA:GM", deployments: [{ network: "Solana", address: MINT_B }] }),
    ]));
    const catalog = await getXStockCatalog({ ...fixture, now: NOW });
    expect(catalog.meta.source).toBe("issuer");
    expect(findXStockAsset(catalog, "xetr:shld")?.symbol).toBe("SHLx");
    expect(findXStockAsset(catalog, "mtaa:gm")?.symbol).toBe("G.ITx");
  });

  it.each([false, true])("backs off failed refreshes without losing stale provenance (previous cache: %s)", async (withCache) => {
    if (withCache) await getXStockCatalog({ ...pages(page(0, false, [node()])), now: NOW });
    const failing = vi.fn(fail);
    const failed = await getXStockCatalog({ fetchImpl: failing, now: NOW, forceRefresh: true });
    expect(failed.meta).toMatchObject({ source: withCache ? "cache" : "snapshot", stale: true });
    const recovery = pages(page(0, false, [node()]));
    const duringBackoff = await getXStockCatalog({ ...recovery, now: new Date(NOW.getTime() + XSTOCK_CATALOG_RETRY_MS - 1) });
    expect(duringBackoff).toEqual(failed);
    expect(recovery.mock).not.toHaveBeenCalled();
    const recovered = await getXStockCatalog({ ...recovery, now: new Date(NOW.getTime() + XSTOCK_CATALOG_RETRY_MS) });
    expect(recovered.meta).toMatchObject({ source: "issuer", stale: false });
    expect(recovery.mock).toHaveBeenCalledOnce();
  });

  it("distinguishes exact Mastercard MAx from the MAX underlying alias", async () => {
    const snapshot = await getXStockCatalog({ fetchImpl: fail, now: NOW });
    const issuerMastercard = findXStockAsset(snapshot, "MAx")!;
    // The current issuer snapshot has no MAXx. Introduce the possible alias
    // collision explicitly instead of pretending it is a verified asset.
    const catalog = [issuerMastercard, {
      ...issuerMastercard, mint: MINT_B, name: "Maximum xStock",
      symbol: "MAXx", ticker: "MAXx", underlyingSymbol: "MAX",
    }];
    const mastercard = findXStockAsset(catalog, "MAx");
    const max = findXStockAsset(catalog, "MAX");
    expect(mastercard?.underlyingSymbol).toBe("MA");
    expect(mastercard?.name).toContain("Mastercard");
    expect(max?.symbol).toBe("MAXx");
    expect(max?.mint).not.toBe(mastercard?.mint);
    expect(findXStockAsset(catalog, "max")?.mint).toBe(max?.mint);
    expect(findXStockAsset(catalog, "maxx")?.mint).toBe(max?.mint);
    expect(findXStockAsset(catalog, "ma")?.mint).toBe(mastercard?.mint);
  });

  it("does not resolve ambiguous underlying aliases to an arbitrary mint", async () => {
    const fixture = pages(page(0, false, [node(), node({ symbol: "ACME2x", deployments: [{ network: "Solana", address: MINT_B }] })]));
    const catalog = await getXStockCatalog({ ...fixture, now: NOW });
    expect(findXStockAsset(catalog, "ACME")).toBeNull();
    expect(findXStockAsset(catalog, "ACMEx")?.mint).toBe(MINT_A);
  });
});


describe("synchronous catalog metadata", () => {
  it("returns the complete stale metadata snapshot with its original date and no prices", () => {
    const first = getCachedXStockCatalog(() => NOW);
    expect(first.meta.source).toBe("snapshot");
    expect(first.meta.stale).toBe(true);
    expect(first.meta.fetchedAt).not.toBe(NOW.toISOString());
    expect(Number.isFinite(Date.parse(first.meta.fetchedAt))).toBe(true);
    expect(first.data).toHaveLength(1271);
    expect(first.data.every((asset) => !Object.keys(asset).some((key) => /price|apy|return/i.test(key)))).toBe(true);
    const name = first.data[0].name;
    first.data[0].name = "modified";
    first.data.pop();
    const second = getCachedXStockCatalog(() => new Date(NOW.getTime() + 60_000));
    expect(second.data).toHaveLength(1271);
    expect(second.data[0].name).toBe(name);
    expect(second.meta).toEqual(first.meta);
  });

  it("returns fresh or stale cached metadata immediately without refetching or changing its age", async () => {
    const fixture = pages(page(0, false, [node()]));
    await getXStockCatalog({ ...fixture, now: NOW });
    const fresh = getCachedXStockCatalog(() => new Date(NOW.getTime() + XSTOCK_CATALOG_TTL_MS - 1));
    const stale = getCachedXStockCatalog(() => new Date(NOW.getTime() + XSTOCK_CATALOG_TTL_MS));
    expect(fresh.meta).toMatchObject({ source: "cache", stale: false, fetchedAt: NOW.toISOString() });
    expect(stale.meta).toEqual({ ...fresh.meta, stale: true });
    expect(fixture.mock).toHaveBeenCalledOnce();
    fresh.data[0].name = "modified";
    expect(getCachedXStockCatalog(() => NOW).data[0].name).toBe("Acme xStock");
  });

  it("preserves failed-refresh provenance even while the last good metadata is inside its TTL", async () => {
    await getXStockCatalog({ ...pages(page(0, false, [node()])), now: NOW });
    await getXStockCatalog({ fetchImpl: fail, now: NOW, forceRefresh: true });
    expect(getCachedXStockCatalog(() => NOW).meta).toMatchObject({ source: "cache", stale: true, fetchedAt: NOW.toISOString() });
  });
});
