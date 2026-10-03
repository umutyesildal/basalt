import { logoUrl } from "@/lib/logos";
import { XSTOCK_SNAPSHOT, sortXStocksForDiscovery } from "@/lib/xstock-catalog";
import type { XStockAsset } from "@/lib/xstock-types";

export interface ConceptAsset {
  symbol: string;
  name: string;
  category: string;
  logoUrl: string;
  mint?: string;
  tokenSymbol?: string;
  assetClass?: "stock" | "etf" | "unknown";
}

/** Retained metadata for every previously shared basket link. */
export const LEGACY_CONCEPT_ASSETS: readonly ConceptAsset[] = [
  { symbol: "ABNB", name: "Airbnb", category: "Travel", logoUrl: logoUrl("ABNB") },
  { symbol: "AAPL", name: "Apple", category: "Technology", logoUrl: logoUrl("AAPL") },
  { symbol: "AMZN", name: "Amazon", category: "Technology", logoUrl: logoUrl("AMZN") },
  { symbol: "ADBE", name: "Adobe", category: "Software", logoUrl: logoUrl("ADBE") },
  { symbol: "AMD", name: "AMD", category: "Technology", logoUrl: logoUrl("AMD") },
  { symbol: "AVGO", name: "Broadcom", category: "Technology", logoUrl: logoUrl("AVGO") },
  { symbol: "BA", name: "Boeing", category: "Industrials", logoUrl: logoUrl("BA") },
  { symbol: "COIN", name: "Coinbase", category: "Digital economy", logoUrl: logoUrl("COIN") },
  { symbol: "COST", name: "Costco", category: "Consumer", logoUrl: logoUrl("COST") },
  { symbol: "CRM", name: "Salesforce", category: "Software", logoUrl: logoUrl("CRM") },
  { symbol: "CVX", name: "Chevron", category: "Energy", logoUrl: logoUrl("CVX") },
  { symbol: "DIS", name: "Disney", category: "Media", logoUrl: logoUrl("DIS") },
  { symbol: "GM", name: "General Motors", category: "Mobility", logoUrl: logoUrl("GM") },
  { symbol: "GME", name: "GameStop", category: "Retail", logoUrl: logoUrl("GME") },
  { symbol: "GOOGL", name: "Alphabet", category: "Technology", logoUrl: logoUrl("GOOGL") },
  { symbol: "HON", name: "Honeywell", category: "Industrials", logoUrl: logoUrl("HON") },
  { symbol: "HOOD", name: "Robinhood", category: "Financials", logoUrl: logoUrl("HOOD") },
  { symbol: "INTC", name: "Intel", category: "Technology", logoUrl: logoUrl("INTC") },
  { symbol: "JNJ", name: "Johnson & Johnson", category: "Healthcare", logoUrl: logoUrl("JNJ") },
  { symbol: "JPM", name: "JPMorgan Chase", category: "Financials", logoUrl: logoUrl("JPM") },
  { symbol: "KO", name: "Coca-Cola", category: "Consumer", logoUrl: logoUrl("KO") },
  { symbol: "MA", name: "Mastercard", category: "Financials", logoUrl: logoUrl("MA") },
  { symbol: "MCD", name: "McDonald’s", category: "Consumer", logoUrl: logoUrl("MCD") },
  { symbol: "META", name: "Meta Platforms", category: "Technology", logoUrl: logoUrl("META") },
  { symbol: "MSTR", name: "Strategy", category: "Digital economy", logoUrl: logoUrl("MSTR") },
  { symbol: "MSFT", name: "Microsoft", category: "Technology", logoUrl: logoUrl("MSFT") },
  { symbol: "NKE", name: "Nike", category: "Consumer", logoUrl: logoUrl("NKE") },
  { symbol: "NFLX", name: "Netflix", category: "Media", logoUrl: logoUrl("NFLX") },
  { symbol: "NVDA", name: "NVIDIA", category: "Technology", logoUrl: logoUrl("NVDA") },
  { symbol: "ORCL", name: "Oracle", category: "Software", logoUrl: logoUrl("ORCL") },
  { symbol: "PFE", name: "Pfizer", category: "Healthcare", logoUrl: logoUrl("PFE") },
  { symbol: "PLTR", name: "Palantir", category: "Software", logoUrl: logoUrl("PLTR") },
  { symbol: "QCOM", name: "Qualcomm", category: "Technology", logoUrl: logoUrl("QCOM") },
  { symbol: "QQQ", name: "Nasdaq 100", category: "Index", logoUrl: logoUrl("QQQ") },
  { symbol: "SPY", name: "S&P 500", category: "Index", logoUrl: logoUrl("SPY") },
  { symbol: "TSM", name: "Taiwan Semiconductor", category: "Technology", logoUrl: logoUrl("TSM") },
  { symbol: "UBER", name: "Uber", category: "Mobility", logoUrl: logoUrl("UBER") },
  { symbol: "V", name: "Visa", category: "Financials", logoUrl: logoUrl("V") },
  { symbol: "WMT", name: "Walmart", category: "Consumer", logoUrl: logoUrl("WMT") },
  { symbol: "XOM", name: "Exxon Mobil", category: "Energy", logoUrl: logoUrl("XOM") },
  { symbol: "TSLA", name: "Tesla", category: "Mobility", logoUrl: logoUrl("TSLA") },
] as const;

/** Official issuer assets are selectable; legacy metadata remains resolvable for old links. */
export function toConceptAsset(asset: XStockAsset): ConceptAsset {
  return {
    symbol: asset.underlyingSymbol.toUpperCase(),
    name: asset.name.replace(/ xStock$/i, ""),
    category: asset.assetClass === "etf" ? "ETF" : asset.assetClass === "stock" ? "Stock" : "xStock",
    logoUrl: asset.logoUrl ?? logoUrl(asset.underlyingSymbol),
    mint: asset.mint,
    tokenSymbol: asset.symbol,
    assetClass: asset.assetClass,
  };
}

export const DISCOVERY_ASSETS: readonly ConceptAsset[] = sortXStocksForDiscovery(XSTOCK_SNAPSHOT.data).map(toConceptAsset);
const ASSETS_BY_SYMBOL = new Map(LEGACY_CONCEPT_ASSETS.map((asset) => [asset.symbol, asset]));
for (const asset of DISCOVERY_ASSETS) ASSETS_BY_SYMBOL.set(asset.symbol, { ...ASSETS_BY_SYMBOL.get(asset.symbol), ...asset });
const ASSETS_BY_MINT = new Map(DISCOVERY_ASSETS.filter((asset) => asset.mint).map((asset) => [asset.mint!, asset]));
export const CONCEPT_ASSETS: readonly ConceptAsset[] = [...ASSETS_BY_SYMBOL.values()];

/** Runtime metadata enriches names and logos. Link validity never depends on this cache. */
export function registerConceptAssets(assets: readonly XStockAsset[]): void {
  for (const row of assets) {
    const asset = toConceptAsset(row);
    ASSETS_BY_SYMBOL.set(asset.symbol, asset);
    if (asset.mint) ASSETS_BY_MINT.set(asset.mint, asset);
  }
}

/** A mint-bearing draft must not inherit unrelated metadata from its text symbol. */
export function getConceptAsset(symbol: string, mint?: string): ConceptAsset | undefined {
  return mint === undefined ? ASSETS_BY_SYMBOL.get(symbol.toUpperCase()) : ASSETS_BY_MINT.get(mint);
}

/** Unknown future pairs remain shareable; a contradiction with known issuer identity does not. */
export function hasConceptAssetIdentityConflict(symbol: string, mint: string): boolean {
  const bySymbol = ASSETS_BY_SYMBOL.get(symbol.toUpperCase());
  const byMint = ASSETS_BY_MINT.get(mint);
  return Boolean((bySymbol?.mint && bySymbol.mint !== mint) || (byMint && byMint.symbol !== symbol.toUpperCase()));
}

export function getConceptAssetName(symbol: string, mint?: string): string {
  return getConceptAsset(symbol, mint)?.name ?? symbol;
}

export function getConceptAssetLogo(symbol: string, mint?: string): string | null {
  return getConceptAsset(symbol, mint)?.logoUrl ?? null;
}
