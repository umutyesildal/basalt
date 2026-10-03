import { apiFetch, apiQuery } from "@/lib/api-client";
import snapshot from "@/lib/data/xstocks.snapshot.json";
import { isSolanaMint, normalizeXStockAssets, parseXStockQuote, parseXStockMarketSession, unavailableXStockQuote, type XStockAsset, type XStockCatalog, type XStockQuote, type XStockMarketSession } from "@/lib/xstock-types";

export * from "@/lib/xstock-types";

/** Exact issuer metadata snapshot. It intentionally contains no prices or quote fallbacks. */
export const XSTOCK_SNAPSHOT: XStockCatalog = {
  data: normalizeXStockAssets(snapshot.data),
  meta: { source: "snapshot", fetchedAt: snapshot.fetchedAt, stale: true, sourceUrl: snapshot.sourceUrl },
};

let catalogCache: { until: number; value: XStockCatalog } | null = null;
let catalogRequest: Promise<XStockCatalog> | null = null;

export async function fetchXStockCatalog(force = false): Promise<XStockCatalog> {
  if (!force && catalogCache && catalogCache.until > Date.now()) return catalogCache.value;
  if (catalogRequest) return catalogRequest;
  catalogRequest = (async () => {
    try {
      const response = await apiFetch("/api/v1/xstocks", { cache: "no-store", signal: AbortSignal.timeout(35_000) });
      if (!response.ok) throw new Error("Catalog unavailable");
      const payload = await response.json() as { data?: unknown; meta?: Record<string, unknown> };
      const data = normalizeXStockAssets(payload.data);
      if (!data.length) throw new Error("Catalog unavailable");
      const meta = payload.meta ?? {};
      const value: XStockCatalog = { data, meta: {
        source: meta.source === "snapshot" || meta.source === "cache" ? meta.source : "issuer",
        fetchedAt: typeof meta.fetchedAt === "string" && Number.isFinite(Date.parse(meta.fetchedAt)) ? meta.fetchedAt : XSTOCK_SNAPSHOT.meta.fetchedAt,
        stale: meta.stale === true, sourceUrl: typeof meta.sourceUrl === "string" && meta.sourceUrl.startsWith("https://") ? meta.sourceUrl : XSTOCK_SNAPSHOT.meta.sourceUrl,
      } };
      catalogCache = { until: Date.now() + 60_000, value };
      return value;
    } catch {
      const value = catalogCache ? { ...catalogCache.value, meta: { ...catalogCache.value.meta, source: "cache" as const, stale: true } } : XSTOCK_SNAPSHOT;
      return value;
    } finally { catalogRequest = null; }
  })();
  return catalogRequest;
}

/** Callers pass only the currently visible page, not the complete issuer catalog. */
export async function fetchXStockPricePage(mints: readonly string[], signal?: AbortSignal): Promise<{ data: XStockQuote[]; marketSession: XStockMarketSession | null }> {
  const requested = [...new Set(mints)].filter(isSolanaMint).slice(0, 100);
  if (!requested.length) return { data: [], marketSession: null };
  try {
    const response = await apiQuery("/api/v1/xstocks/prices", { mints: requested.join(",") }, {
      cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error("Token prices unavailable");
    const payload = await response.json() as { data?: unknown; meta?: { marketSession?: unknown } };
    if (!Array.isArray(payload?.data)) throw new Error("Invalid token price response");
    const rows = payload.data;
    const byMint = new Map(rows.filter((row) => row && typeof row === "object").map((row) => [row.mint, row]));
    return { data: requested.map((mint) => byMint.has(mint) ? parseXStockQuote(byMint.get(mint), mint) : unavailableXStockQuote(mint, "omitted")), marketSession: parseXStockMarketSession(payload.meta?.marketSession) };
  } catch { return { data: requested.map(mint => unavailableXStockQuote(mint, "outage")), marketSession: null }; }
}

export async function fetchXStockPrices(mints: readonly string[], signal?: AbortSignal): Promise<XStockQuote[]> {
  return (await fetchXStockPricePage(mints, signal)).data;
}

/** Familiar names first; all remaining official entries stay searchable and paginated. */
const DISCOVERY = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "SPY", "QQQ", "GLD", "NFLX", "JPM", "V", "WMT", "COST", "UBER"];
export function sortXStocksForDiscovery(assets: readonly XStockAsset[]): XStockAsset[] {
  const rank = (symbol: string) => { const index = DISCOVERY.indexOf(symbol); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  return [...assets].sort((a, b) => rank(a.underlyingSymbol) - rank(b.underlyingSymbol) || a.name.localeCompare(b.name));
}
