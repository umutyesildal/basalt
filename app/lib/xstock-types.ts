/** Public issuer metadata and Solana token quotes. Neither authorizes a transaction. */
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

export interface XStockCatalog {
  data: XStockAsset[];
  meta: { source: "issuer" | "snapshot" | "cache"; fetchedAt: string; stale: boolean; sourceUrl: string };
}

export interface XStockQuote {
  mint: string;
  priceUsd: number | null;
  source: "jupiter" | "unavailable";
  fetchedAt: string | null;
  observedAt: string | null;
  blockId: number | null;
  unit: "scaled-ui";
  change24hPct: number | null;
  status: "available" | "unavailable";
  stale?: boolean;
  freshness?: "fresh" | "stale" | "unavailable";
  refreshedAt?: string | null;
  refreshReason?: "priced" | "omitted" | "outage" | null;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decode length, not just alphabet: a Solana public key is exactly 32 bytes. */
export function isSolanaMint(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (decoded > 0n) { bytes += 1; decoded >>= 8n; }
  const zeros = value.match(/^1*/)?.[0].length ?? 0;
  return bytes + zeros === 32;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; }
}

export function parseXStockAsset(input: unknown): XStockAsset | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  if (!isSolanaMint(row.mint) || row.network !== "solana" || row.provider !== "backed") return null;
  if (typeof row.symbol !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.:-]{0,24}$/.test(row.symbol)) return null;
  if (typeof row.underlyingSymbol !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.:-]{0,24}$/.test(row.underlyingSymbol)) return null;
  if (typeof row.name !== "string" || !row.name.trim() || row.name.length > 240) return null;
  const sourceUrl = httpsUrl(row.sourceUrl);
  if (!sourceUrl) return null;
  return {
    mint: row.mint, symbol: row.symbol, ticker: row.symbol, underlyingSymbol: row.underlyingSymbol,
    name: row.name, network: "solana", provider: "backed",
    assetClass: row.assetClass === "stock" || row.assetClass === "etf" ? row.assetClass : "unknown",
    decimals: Number.isInteger(row.decimals) && (row.decimals as number) >= 0 && (row.decimals as number) <= 18 ? row.decimals as number : null,
    logoUrl: httpsUrl(row.logoUrl), status: typeof row.status === "string" ? row.status : "unknown", sourceUrl,
  };
}

export function normalizeXStockAssets(input: unknown): XStockAsset[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.flatMap((candidate) => {
    const row = parseXStockAsset(candidate);
    if (!row || seen.has(row.mint)) return [];
    seen.add(row.mint);
    return [row];
  });
}

interface SearchableAsset {
  symbol: string;
  underlyingSymbol?: string;
  tokenSymbol?: string;
  name: string;
  category?: string;
  assetClass?: string;
  mint?: string;
}

/** Short ticker queries must not match random characters inside a base58 mint. */
export function matchesAssetSearch(asset: SearchableAsset, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean);
  const text = `${asset.symbol} ${asset.underlyingSymbol ?? ""} ${asset.tokenSymbol ?? ""} ${asset.name} ${asset.category ?? ""} ${asset.assetClass ?? ""}`.toLocaleLowerCase("en-US");
  const mint = asset.mint?.toLocaleLowerCase("en-US") ?? "";
  return terms.every((term) => text.includes(term) || (term.length >= 8 && mint.includes(term)));
}

export function assetSearchRank(asset: SearchableAsset, query: string): number {
  const folded = query.trim().toLocaleLowerCase("en-US");
  return folded && [asset.symbol, asset.underlyingSymbol, asset.tokenSymbol].some((symbol) => symbol?.toLocaleLowerCase("en-US") === folded) ? 0 : 1;
}

/** Search the entire metadata catalog before pagination; quote availability never hides assets. */
export function filterXStocks(assets: readonly XStockAsset[], query: string, assetClass: "all" | "stock" | "etf" = "all"): XStockAsset[] {
  return assets.filter((asset) => (assetClass === "all" || asset.assetClass === assetClass) && matchesAssetSearch(asset, query))
    .sort((a, b) => assetSearchRank(a, query) - assetSearchRank(b, query));
}

export function findXStock(assets: readonly XStockAsset[], identifier: string): XStockAsset | undefined {
  const folded = identifier.toUpperCase();
  return assets.find((asset) => asset.mint === identifier)
    ?? assets.find((asset) => asset.symbol === identifier)
    ?? assets.find((asset) => asset.underlyingSymbol.toUpperCase() === folded)
    ?? assets.find((asset) => asset.symbol.toUpperCase() === folded);
}

export function unavailableXStockQuote(mint: string, reason: XStockQuote["refreshReason"] = null): XStockQuote {
  return { mint, priceUsd: null, source: "unavailable", fetchedAt: null, observedAt: null, blockId: null, unit: "scaled-ui", change24hPct: null, status: "unavailable", stale: false, freshness: "unavailable", refreshedAt: null, refreshReason: reason };
}

export function parseXStockQuote(input: unknown, expectedMint: string): XStockQuote {
  const missing = unavailableXStockQuote(expectedMint);
  if (!input || typeof input !== "object") return missing;
  const row = input as Record<string, unknown>;
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
  const refreshReason = row.refreshReason === "priced" || row.refreshReason === "omitted" || row.refreshReason === "outage" ? row.refreshReason : null;
  if (row.mint === expectedMint && row.source === "unavailable" && row.status === "unavailable" && row.priceUsd === null && row.unit === "scaled-ui") {
    return { ...unavailableXStockQuote(expectedMint, refreshReason), refreshedAt: date(row.refreshedAt) };
  }
  if (row.mint !== expectedMint || row.source !== "jupiter" || row.unit !== "scaled-ui" || row.status !== "available") return missing;
  if (typeof row.priceUsd !== "number" || !Number.isFinite(row.priceUsd) || row.priceUsd <= 0) return missing;
  return {
    mint: expectedMint, priceUsd: row.priceUsd, source: "jupiter", unit: "scaled-ui", status: "available",
    fetchedAt: date(row.fetchedAt), observedAt: date(row.observedAt),
    blockId: Number.isSafeInteger(row.blockId) && (row.blockId as number) >= 0 ? row.blockId as number : null,
    stale: row.stale === true || row.freshness === "stale",
    freshness: row.stale === true || row.freshness === "stale" ? "stale" : "fresh",
    refreshedAt: date(row.refreshedAt), refreshReason,
    change24hPct: typeof row.change24hPct === "number" && Number.isFinite(row.change24hPct) ? row.change24hPct : null,
  };
}

/** A failed refresh must not erase a known same-mint token quote or advance its source time. */
export function mergeXStockQuotes(previous: ReadonlyMap<string, XStockQuote>, incoming: readonly XStockQuote[]): Map<string, XStockQuote> {
  return new Map(incoming.map(quote => {
    const known = previous.get(quote.mint);
    if (quote.status === "unavailable" && known?.status === "available"
      && (quote.refreshReason === "outage" || quote.refreshReason === "omitted")) {
      return [quote.mint, { ...known, stale: true, freshness: "stale" as const,
        refreshedAt: quote.refreshedAt ?? null, refreshReason: quote.refreshReason }];
    }
    return [quote.mint, quote];
  }));
}

/** A 24-hour change should not accompany an old or untraceable source price. */
export function currentXStockChange(quote: XStockQuote | undefined, now = Date.now()): number | null {
  if (!quote || quote.status !== "available" || quote.stale || !quote.observedAt) return null;
  const age = now - Date.parse(quote.observedAt);
  return Number.isFinite(age) && age >= 0 && age < 86_400_000 ? quote.change24hPct : null;
}


export interface XStockMarketSession {
  status: "open" | "closed";
  isOpen: boolean;
  nextOpenAt: string | null;
}
export function parseXStockMarketSession(input: unknown): XStockMarketSession | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  if (row.status !== "open" && row.status !== "closed") return null;
  if (row.isOpen !== (row.status === "open")) return null;
  return { status: row.status, isOpen: row.isOpen, nextOpenAt: typeof row.nextOpenAt === "string" && Number.isFinite(Date.parse(row.nextOpenAt)) ? row.nextOpenAt : null };
}
