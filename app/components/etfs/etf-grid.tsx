"use client";

import { useMemo, useState } from "react";

import { AssetCard } from "@/components/cards/asset-card";
import { cn } from "@/lib/utils";

/**
 * One listing row — the whole card is a link to /stock/[ticker] (same pattern
 * as the /stocks cards: native anchor, keyboard accessible, hover ring on the
 * border). Price is live (Jupiter / dev catalog); the sparkline and the 24h/7d
 * changes come from real Yahoo daily closes (lib/price-series.ts) — this
 * component never fabricates or derives new figures, it only sorts and renders.
 */
export interface EtfRow {
  ticker: string;
  /** Static display metadata for known tickers; omitted when unmapped. */
  name?: string;
  provider?: string;
  price: number | null;
  change24h: number | null;
  /** 7-session change from the same Yahoo closes — null renders "7d —". */
  change7d?: number | null;
  /** Underlying daily closes, oldest → newest (empty = chart slot stays empty). */
  sparkline?: number[];
}

const SORTS = [
  { key: "az", label: "A-Z" },
  { key: "price", label: "Price" },
  { key: "change", label: "24h" },
] as const;

type SortKey = (typeof SORTS)[number]["key"];

const PROVIDER_LABEL: Record<string, string> = {
  backed: "Backed Finance",
};

/** Price and 24h sort descending; missing values sink to the end. */
function sortRows(rows: EtfRow[], sort: SortKey): EtfRow[] {
  const copy = [...rows];
  if (sort === "az") {
    return copy.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }
  const value = (row: EtfRow) => (sort === "price" ? row.price : row.change24h);
  return copy.sort((a, b) => (value(b) ?? -Infinity) - (value(a) ?? -Infinity));
}

// Owner feedback 2026-09-14: bigger cards — three columns max, airier gaps,
// same rhythm as the /stocks grid.
const GRID_CLASS = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

/**
 * One listing row — thin adapter over the shared AssetCard (same anatomy as
 * /stocks): ticker headline, ETF name as the one-line context, issuer
 * micro-label top-right, mono token price, and the 7-session sparkline +
 * 24h/7d cells (the chart slot keeps its fixed empty surface when the series
 * feed produced nothing — nothing is fabricated).
 */
function EtfCard({ row }: { row: EtfRow }) {
  return (
    <AssetCard
      href={`/stock/${encodeURIComponent(row.ticker)}`}
      ticker={row.ticker}
      context={row.name ?? null}
      meta={row.provider ? (PROVIDER_LABEL[row.provider] ?? row.provider) : null}
      price={row.price}
      change24h={row.change24h}
      change7d={row.change7d ?? null}
      sparkline={row.sparkline ?? []}
    />
  );
}

export function EtfGrid({ rows }: { rows: EtfRow[] }) {
  const [sort, setSort] = useState<SortKey>("az");
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {rows.length} listed
        </span>
        <nav aria-label="Sort listings" className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort</span>
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={sort === option.key}
              onClick={() => setSort(option.key)}
              className={cn(
                // 40px tall on phones (touch), compact 32px from sm up.
                "inline-flex h-8 max-md:h-10 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                sort === option.key
                  ? "border-primary/60 bg-accent text-accent-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </nav>
      </div>

      <div className={GRID_CLASS}>
        {sorted.map((row) => (
          <EtfCard key={row.ticker} row={row} />
        ))}
      </div>
    </div>
  );
}
