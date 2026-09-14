/**
 * Constituent logo URLs — owner feedback 2026-09-14 ("harf kısaltmaları
 * yerine gerçek logolar").
 *
 * Source: Parqet logo CDN (`assets.parqet.com`), verified live 2026-09-14:
 *   · NVDA / AAPL / MSFT / TSLA / SPY / COIN / MSTR / PLTR / META / AMZN /
 *     GOOGL / ORCL / NFLX → 200 + `image/svg+xml` (consistent 60×60 brand
 *     marks, 0.3–13 KB, `cache-control: public, max-age=86400`)
 *   · unknown symbols → 404 + empty body, so `<img onError>` can fall back
 *     to the letter chip (`?fallback=transparent` keeps unlogoed symbols at
 *     404 instead of a generic placeholder graphic)
 *   · keyless, hotlink-friendly, no auth — see curl log in the task report.
 * Runners-up rejected: financialmodelingprep.com (raster PNG, same 404
 * semantics) and logo.synthfinance.com (unreachable from this environment).
 */
export function logoUrl(symbol: string): string {
  const clean = symbol.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  // xStocks tickers carry an "x" suffix (NVDAx → NVDA). A bare trailing X
  // that belongs to a real symbol just 404s → letter-chip fallback, so this
  // normalization is always safe.
  const bare = clean.length > 1 && clean.endsWith("X") ? clean.slice(0, -1) : clean;
  return `https://assets.parqet.com/logos/symbol/${bare}?fallback=transparent`;
}
