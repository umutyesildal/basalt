import { AssetCard } from "@/components/cards/asset-card";

/**
 * One tokenized stock in the /stocks grid — thin adapter over the shared
 * AssetCard (components/cards/asset-card.tsx): ticker headline, provider as
 * the one-line context, mono token price (Jupiter / dev catalog), 24h + 7d
 * changes and the 7-session sparkline — all derived from real Yahoo daily
 * closes for the underlying equity via lib/price-series.ts (the dev catalog
 * carries no series; missing figures render the honest "7d —" surface). The
 * dev catalog carries no company names, so the provider string stays the
 * honest context line.
 */
export function StockCard({
  ticker,
  provider,
  price,
  changePct,
  change7d,
  sparkline,
}: {
  ticker: string;
  provider: string;
  /** Last token price (Jupiter / dev catalog) — null renders an em dash, never a guess. */
  price: number | null;
  /** 24h change in percent from underlying equity closes — null hides the cell. */
  changePct: number | null;
  /** 7-session change in percent from the same closes — null renders "7d —". */
  change7d: number | null;
  /** Underlying equity daily closes, oldest → newest (may be empty). */
  sparkline: number[];
}) {
  return (
    <AssetCard
      href={`/stock/${encodeURIComponent(ticker)}`}
      ticker={ticker}
      context={provider}
      price={price}
      change24h={changePct}
      change7d={change7d}
      sparkline={sparkline}
    />
  );
}
