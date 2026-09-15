/**
 * Basket category labels for the /explore filter strip.
 *
 * PRESENTATION-LAYER CLASSIFICATION, NOT ON-CHAIN DATA: the basket programs
 * and the indexer store no tags or categories, so each basket is classified
 * deterministically from its constituent xStocks tickers. Never present this
 * as issuer metadata or an on-chain attribute — it is a display heuristic,
 * and unmapped tickers fall back to "Other" instead of guessing.
 *
 * Rule: the heaviest classified constituent decides the category (weights are
 * compared in whatever unit the caller passes — bps or pct, only relative
 * order matters); when weights are missing or null, the first classified
 * ticker in list order wins. Pure functions only, no DOM/React/process.
 */

/** Fallback label for baskets whose constituents map to no known category. */
export const BASKET_CATEGORY_OTHER = "Other";

/**
 * Canonical display order for the filter strip ("All" is prepended by the
 * caller). Unknown categories sort after this list, alphabetically.
 */
const CATEGORY_ORDER = [
  "Index",
  "Tech",
  "Consumer",
  "Finance",
  "Crypto",
  "Health",
  "Energy",
  BASKET_CATEGORY_OTHER,
];

/**
 * Ticker -> category. Keys are uppercase WITHOUT the xStocks "x" suffix
 * ("TSLAx" -> "TSLA"). Covers the 36-stock dev catalog plus the common
 * xStocks names; everything else resolves to "Other".
 */
const TICKER_CATEGORY: Record<string, string> = {
  // Broad-market index products
  SPY: "Index",
  QQQ: "Index",
  IWM: "Index",
  DIA: "Index",
  // Technology
  AAPL: "Tech",
  MSFT: "Tech",
  NVDA: "Tech",
  GOOGL: "Tech",
  META: "Tech",
  AMD: "Tech",
  AVGO: "Tech",
  ORCL: "Tech",
  CRM: "Tech",
  ADBE: "Tech",
  PLTR: "Tech",
  INTC: "Tech",
  QCOM: "Tech",
  TSM: "Tech",
  // Consumer
  TSLA: "Consumer",
  AMZN: "Consumer",
  NFLX: "Consumer",
  DIS: "Consumer",
  NKE: "Consumer",
  MCD: "Consumer",
  SBUX: "Consumer",
  COST: "Consumer",
  WMT: "Consumer",
  UBER: "Consumer",
  ABNB: "Consumer",
  BA: "Consumer",
  KO: "Consumer",
  GME: "Consumer",
  // Finance
  JPM: "Finance",
  BAC: "Finance",
  GS: "Finance",
  MS: "Finance",
  V: "Finance",
  MA: "Finance",
  SCHW: "Finance",
  BLK: "Finance",
  HOOD: "Finance",
  PYPL: "Finance",
  // Crypto-linked operating companies (exchange / treasury)
  COIN: "Crypto",
  MSTR: "Crypto",
  // Health (added with the 24-stock expansion, 2026-09-15)
  PFE: "Health",
  JNJ: "Health",
  // Energy
  XOM: "Energy",
  CVX: "Energy",
};

/** Uppercase ticker without the xStocks "x" suffix ("TSLAx" -> "TSLA"). */
function normalizeTicker(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  return t.length > 1 && t.endsWith("X") ? t.slice(0, -1) : t;
}

/**
 * Deterministic category for one basket from its constituent tickers.
 *
 * @param tickers constituent tickers in list order (any casing, "x" suffix optional);
 *                null/undefined/empty entries are skipped
 * @param weights optional parallel weights in any consistent unit (bps or pct);
 *                missing/non-finite entries count as lowest and lose to any
 *                weighted constituent
 * @returns a category label; BASKET_CATEGORY_OTHER when nothing resolves
 */
export function categoryOf(
  tickers: readonly (string | null | undefined)[],
  weights?: readonly (number | null | undefined)[],
): string {
  let best: { category: string; weight: number } | null = null;
  for (let i = 0; i < tickers.length; i += 1) {
    const raw = tickers[i];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const category = TICKER_CATEGORY[normalizeTicker(raw)];
    if (!category) continue;
    const w = weights?.[i];
    const weight = typeof w === "number" && Number.isFinite(w) ? w : -Infinity;
    // Strict > keeps the earliest ticker on exact weight ties (stable order).
    if (best === null || weight > best.weight) best = { category, weight };
  }
  return best?.category ?? BASKET_CATEGORY_OTHER;
}

/**
 * Comparator putting categories in the canonical strip order; categories
 * outside the list sort last, alphabetically. Stable for use with Array.sort.
 */
export function compareBasketCategories(a: string, b: string): number {
  const ia = CATEGORY_ORDER.indexOf(a);
  const ib = CATEGORY_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}
