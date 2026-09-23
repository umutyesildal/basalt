import { logoUrl } from "@/lib/logos";

export interface ConceptAsset {
  symbol: string;
  name: string;
  category: string;
  logoUrl: string;
}

/** Curated presentation catalog for the wallet-free concept builder. */
export const CONCEPT_ASSETS: readonly ConceptAsset[] = [
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

const ASSETS_BY_SYMBOL = new Map(CONCEPT_ASSETS.map((asset) => [asset.symbol, asset]));

export function getConceptAsset(symbol: string): ConceptAsset | undefined {
  return ASSETS_BY_SYMBOL.get(symbol.toUpperCase());
}

export function getConceptAssetName(symbol: string): string {
  return getConceptAsset(symbol)?.name ?? symbol;
}

/** Shared logo helper name for consumers that render the ticker badge. */
export function getConceptAssetLogo(symbol: string): string | null {
  return getConceptAsset(symbol)?.logoUrl ?? null;
}
