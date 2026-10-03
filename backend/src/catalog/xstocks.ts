import { PublicKey } from "@solana/web3.js";
import snapshotJson from "./xstocks.snapshot.json" with { type: "json" };

/** Issuer metadata only. This catalog never authorizes a trade or supplies a price. */
export interface XStockAsset {
  mint: string;
  symbol: string;
  ticker: string;
  underlyingSymbol: string;
  name: string;
  assetClass: "stock" | "etf" | "unknown";
  decimals: number | null;
  logoUrl: string | null;
  network: "solana";
  provider: "backed";
  status: string;
  sourceUrl: string;
}

export interface CatalogResult {
  data: XStockAsset[];
  meta: {
    source: "issuer" | "snapshot" | "cache";
    fetchedAt: string;
    stale: boolean;
    sourceUrl: string;
  };
}

export interface XStockCatalogOptions {
  fetchImpl?: typeof fetch;
  now?: Date | (() => Date);
  forceRefresh?: boolean;
}

export const XSTOCK_CATALOG_SOURCE_URL = "https://api.xstocks.fi/api/v2/public/assets";
export const XSTOCK_CATALOG_TTL_MS = 15 * 60_000;
export const XSTOCK_CATALOG_RETRY_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 32;
const REQUEST_TIMEOUT_MS = 8_000;
const FETCH_BUDGET_MS = 30_000;
const TICKER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const UNDERLYING_SYMBOL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Snapshot metadata was verified against the issuer's full paginated catalog and
// mainnet getMultipleAccounts on 2026-10-03 (Europe/Berlin). Mint decimals come
// from initialized Token-2022 accounts, never the deployment's stablecoins.
// underlying.type was null throughout. Standalone "ETF" in an issuer name is
// explicit classification evidence; do not match "Netflix" or infer from brands.
// Further ETF evidence: https://assets.backed.fi/products/sp500-xstock,
// /products/nasdaq-xstock, /products/gold-xstock, /products/vanguard-xstock,
// /products/tqqq-xstock, /products/tbll-xstock, /products/russell-2000-xstock,
// /products/ishares-silver-trust-xstock. Further verified product-page overrides
// and their exact links are preserved in snapshot.classification.etfSources and
// docs/assets/xstocks-2026-10-03/additional-etf-sources.json.
// Such enrichments apply only to the same verified mint and symbols. New assets
// without issuer classification/decimals retain unknown/null instead of guessing.
const SNAPSHOT_ASSETS = snapshotJson.data as XStockAsset[];
const SNAPSHOT_BY_MINT = new Map(SNAPSHOT_ASSETS.map((asset) => [asset.mint, asset]));

type Cache = { data: XStockAsset[]; fetchedAt: string; expiresAt: number };
let cache: Cache | null = null;
let failedRefresh: { data: XStockAsset[]; source: "cache" | "snapshot"; fetchedAt: string; retryAfter: number } | null = null;
let inFlight: Promise<CatalogResult> | null = null;
let generation = 0;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function validMint(value: unknown): value is string {
  if (typeof value !== "string" || !MINT_RE.test(value)) return false;
  try { return new PublicKey(value).toBase58() === value; } catch { return false; }
}

function logoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function assetClass(type: unknown, name: string, verified?: XStockAsset): XStockAsset["assetClass"] {
  const normalized = typeof type === "string" ? type.trim().toLowerCase().replace(/[ _-]+/g, " ") : "";
  if (normalized === "etf" || normalized === "exchange traded fund") return "etf";
  if (normalized === "stock" || normalized === "equity") return "stock";
  if (/\bETF\b/i.test(name)) return "etf";
  return verified?.assetClass ?? "unknown";
}

function parseAsset(value: unknown): XStockAsset[] {
  if (!record(value) || !Array.isArray(value.deployments)) throw new Error("Malformed issuer asset.");
  const deployments = value.deployments.filter((deployment) => record(deployment) && deployment.network === "Solana");
  if (deployments.length === 0) return [];
  const symbol = text(value.symbol);
  const name = text(value.name);
  const underlying = record(value.underlying) ? value.underlying : {};
  const underlyingSymbol = text(value.underlyingSymbol) ?? text(underlying.symbol);
  if (!symbol || !TICKER_RE.test(symbol) || !name || !underlyingSymbol || !UNDERLYING_SYMBOL_RE.test(underlyingSymbol)) {
    throw new Error("Incomplete Solana asset metadata.");
  }
  return deployments.map((deployment): XStockAsset => {
    if (!record(deployment) || !validMint(deployment.address)) throw new Error("Invalid issuer Solana mint.");
    const mint = deployment.address;
    const known = SNAPSHOT_BY_MINT.get(mint);
    const verified = known?.symbol === symbol && known.underlyingSymbol === underlyingSymbol ? known : undefined;
    const trading = record(value.trading) ? value.trading : {};
    const halted = typeof value.isTradingHalted === "boolean" ? value.isTradingHalted : trading.isTradingHalted;
    const decimals = typeof deployment.decimals === "number" && Number.isInteger(deployment.decimals)
      && deployment.decimals >= 0 && deployment.decimals <= 255 ? deployment.decimals : verified?.decimals ?? null;
    return {
      mint, symbol, ticker: symbol, underlyingSymbol, name,
      assetClass: assetClass(underlying.type, name, verified), decimals,
      logoUrl: logoUrl(value.logo), network: "solana", provider: "backed",
      status: halted === true ? "halted" : halted === false ? "active" : "unknown",
      sourceUrl: XSTOCK_CATALOG_SOURCE_URL,
    };
  });
}

function result(data: XStockAsset[], source: CatalogResult["meta"]["source"], fetchedAt: string, stale: boolean): CatalogResult {
  // Callers may filter or annotate their response without poisoning the cache.
  return { data: data.map((asset) => ({ ...asset })), meta: { source, fetchedAt, stale, sourceUrl: XSTOCK_CATALOG_SOURCE_URL } };
}

async function fetchIssuerCatalog(fetchImpl: typeof fetch): Promise<XStockAsset[]> {
  const assets = new Map<string, XStockAsset>();
  const budget = AbortSignal.timeout(FETCH_BUDGET_MS);
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(XSTOCK_CATALOG_SOURCE_URL);
    url.searchParams.set("network", "Solana");
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" }, cache: "no-store", redirect: "error",
      signal: AbortSignal.any([budget, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    if (!response.ok) throw new Error("Issuer catalog request failed.");
    const payload: unknown = await response.json();
    if (!record(payload) || !Array.isArray(payload.nodes) || payload.nodes.length > PAGE_SIZE
      || !record(payload.page) || payload.page.currentPage !== page || typeof payload.page.hasNextPage !== "boolean"
      || (payload.page.hasNextPage && payload.nodes.length === 0)) throw new Error("Malformed issuer pagination.");
    for (const node of payload.nodes) {
      for (const asset of parseAsset(node)) {
        const existing = assets.get(asset.mint);
        if (existing && JSON.stringify(existing) !== JSON.stringify(asset)) throw new Error("Conflicting issuer mint metadata.");
        assets.set(asset.mint, asset);
      }
    }
    if (!payload.page.hasNextPage) {
      if (assets.size === 0) throw new Error("Issuer returned no Solana assets.");
      return [...assets.values()].sort((a, b) => a.symbol.localeCompare(b.symbol, "en"));
    }
  }
  throw new Error("Issuer catalog exceeds pagination budget.");
}

export function clearXStockCatalogCache(): void {
  cache = null;
  failedRefresh = null;
  inFlight = null;
  generation++;
}

/** Synchronous metadata for already-known mints; never fetches or mutates cache state. */
export function getCachedXStockCatalog(now: () => Date = () => new Date()): CatalogResult {
  const at = now().getTime();
  if (!Number.isFinite(at)) throw new Error("Invalid catalog clock.");
  if (cache) {
    const stale = failedRefresh !== null || at < Date.parse(cache.fetchedAt) || at >= cache.expiresAt;
    return result(cache.data, "cache", cache.fetchedAt, stale);
  }
  return result(SNAPSHOT_ASSETS, "snapshot", snapshotJson.fetchedAt, true);
}

/** A failed/partial refresh only returns a complete cache or the explicit stale snapshot. */
export async function getXStockCatalog(opts: XStockCatalogOptions = {}): Promise<CatalogResult> {
  const clock = typeof opts.now === "function" ? opts.now : () => opts.now instanceof Date ? opts.now : new Date();
  const now = clock();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid catalog clock.");
  if (!opts.forceRefresh && failedRefresh && now.getTime() < failedRefresh.retryAfter) {
    return result(failedRefresh.data, failedRefresh.source, failedRefresh.fetchedAt, true);
  }
  if (!opts.forceRefresh && !failedRefresh && cache && now.getTime() >= Date.parse(cache.fetchedAt) && now.getTime() < cache.expiresAt) {
    return result(cache.data, "cache", cache.fetchedAt, false);
  }
  if (inFlight) return inFlight;
  const requestGeneration = generation;
  const previous = cache;
  const request = (async (): Promise<CatalogResult> => {
    try {
      const data = await fetchIssuerCatalog(opts.fetchImpl ?? fetch);
      const completedAt = clock();
      const fetchedAt = completedAt.toISOString();
      if (requestGeneration === generation) {
        cache = { data, fetchedAt, expiresAt: completedAt.getTime() + XSTOCK_CATALOG_TTL_MS };
        failedRefresh = null;
      }
      return result(data, "issuer", fetchedAt, false);
    } catch {
      const fallback = previous
        ? { data: previous.data, source: "cache" as const, fetchedAt: previous.fetchedAt }
        : { data: SNAPSHOT_ASSETS, source: "snapshot" as const, fetchedAt: snapshotJson.fetchedAt };
      if (requestGeneration === generation) failedRefresh = { ...fallback, retryAfter: clock().getTime() + XSTOCK_CATALOG_RETRY_MS };
      return result(fallback.data, fallback.source, fallback.fetchedAt, true);
    }
  })();
  inFlight = request;
  try { return await request; } finally { if (inFlight === request) inFlight = null; }
}

/** Token ticker and underlying aliases are case-insensitive; base58 mints are not. */
export function findXStockAsset(catalog: CatalogResult | readonly XStockAsset[], tickerOrMint: string): XStockAsset | null {
  const assets: readonly XStockAsset[] = Array.isArray(catalog) ? catalog : (catalog as CatalogResult).data;
  const query = tickerOrMint.trim();
  const mint = assets.find((asset) => asset.mint === query);
  if (mint) return mint;
  // A canonical token ticker wins over another asset's underlying alias:
  // MAx is Mastercard, while MAX is the underlying symbol of MAXx.
  const exactSymbol = assets.filter((asset) => asset.symbol === query || asset.ticker === query);
  if (exactSymbol.length) return exactSymbol.length === 1 ? exactSymbol[0] : null;
  const upper = query.toUpperCase();
  const underlying = assets.filter((asset) => asset.underlyingSymbol.toUpperCase() === upper);
  if (underlying.length) return underlying.length === 1 ? underlying[0] : null;
  const symbol = assets.filter((asset) => asset.symbol.toUpperCase() === upper || asset.ticker.toUpperCase() === upper);
  return symbol.length === 1 ? symbol[0] : null;
}
