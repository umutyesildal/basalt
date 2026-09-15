"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { EmptyState, FreshnessBadge } from "@/components/states";
import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";
import { cn } from "@/lib/utils";
import { StockCard } from "@/components/stocks/stock-card";
import {
  MOCK_XSTOCK_FALLBACK,
  fetchMockXStockCatalog,
  type MockCatalogEntry,
} from "@/lib/xstock-catalog";
import {
  fetchDailyCloseSeries,
  mapLimit,
  underlyingFromPriceSource,
  type DailyCloseSeries,
} from "@/lib/price-series";

/**
 * Where the grid's rows came from — shown verbatim in the freshness badge:
 *  - "catalog": the backend dev catalog (/api/v1/xstocks/mock, 36 mock
 *    xStocks with deterministic dev-catalog prices, explicitly not live) —
 *    plus real Yahoo daily closes for the 7d sparkline / changes;
 *  - "static": the built-in ticker list with no prices, used only when the
 *    API is unreachable.
 */
type DataSource = "catalog" | "static";

type GridStatus = "loading" | "error" | "empty" | "ready";

interface StockCardData {
  ticker: string;
  provider: string;
  /** Dev-catalog USD price — null renders an em dash, never a guess. */
  price: number | null;
  /** 24h change from underlying equity closes (Yahoo) — null hides the cell. */
  changePct: number | null;
  /** 7-session change from the same closes — null renders the "7d —" surface. */
  change7d: number | null;
  /** Underlying daily closes, oldest → newest (empty = no chart slot fill). */
  sparkline: number[];
}

/** Bounded concurrency for the per-ticker series batch (dev catalog = 12). */
const SERIES_CONCURRENCY = 4;

const filterButtonClasses = (active: boolean) =>
  cn(
    // 40px tall on phones (touch), back to the compact 32px from sm up.
    "inline-flex h-8 max-md:h-10 items-center rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    active
      ? "border-primary/60 bg-accent text-accent-foreground"
      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
  );

const SOURCE_BADGE: Record<DataSource, string> = {
  catalog: "dev catalog · mock prices (not live)",
  static: "static dev list — API unreachable",
};

// Owner feedback 2026-09-14: bigger cards — three columns max, airier gaps.
const GRID_CLASS = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

/**
 * /stocks grid — renders N tokenized stocks from the backend dev catalog
 * (GET /api/v1/xstocks/mock — the 36-stock mock xStock universe). Prices come
 * from the catalog; the 7-session sparkline and 24h/7d changes come per
 * ticker from real Yahoo daily closes (GET /api/v1/prices/chart?range=5d,
 * fetched with bounded concurrency — lib/price-series.ts). When the API is
 * unreachable it degrades to the built-in static ticker list with no prices,
 * labeled "static dev list — API unreachable". The grid wraps at any N;
 * nothing assumes a fixed count.
 */
export function StocksGrid() {
  const [status, setStatus] = useState<GridStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cards, setCards] = useState<StockCardData[]>([]);
  const [dataSource, setDataSource] = useState<DataSource>("catalog");
  const [seriesAsOf, setSeriesAsOf] = useState<number | undefined>(undefined);
  const [providerFilter, setProviderFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    setProviderFilter("all");
    setSeriesAsOf(undefined);
    try {
      const catalog = await fetchMockXStockCatalog();
      let entries: MockCatalogEntry[];
      let source: DataSource;
      if (catalog) {
        entries = catalog;
        source = "catalog";
      } else {
        // Backend unreachable (or empty payload) — static ticker list, no prices.
        entries = [...MOCK_XSTOCK_FALLBACK];
        source = "static";
      }
      setDataSource(source);

      if (entries.length === 0) {
        setCards([]);
        setStatus("empty");
        return;
      }

      // Real underlying series per ticker; the static fallback skips the
      // batch — the same unreachable backend would only produce failures.
      let seriesList: (DailyCloseSeries | null)[] = entries.map(() => null);
      if (source === "catalog") {
        seriesList = await mapLimit(entries, SERIES_CONCURRENCY, (entry) =>
          fetchDailyCloseSeries(entry.ticker, underlyingFromPriceSource(entry.priceSource)),
        );
      }

      let asOf = 0;
      setCards(
        entries.map((entry, i) => {
          const series = seriesList[i];
          if (series?.lastTs && series.lastTs > asOf) asOf = series.lastTs;
          return {
            ticker: entry.ticker,
            provider:
              entry.priceUsd !== null ? "mock xStock · dev catalog" : "static dev list",
            price: entry.priceUsd,
            changePct: series?.changePct24h ?? null,
            change7d: series?.changePct7d ?? null,
            sparkline: series?.closes ?? [],
          };
        }),
      );
      if (asOf > 0) setSeriesAsOf(asOf);
      setStatus("ready");
    } catch (error) {
      setCards([]);
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "The stock catalog did not respond.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providers = useMemo(
    () => Array.from(new Set(cards.map((c) => c.provider))).sort((a, b) => a.localeCompare(b)),
    [cards],
  );
  const visible = useMemo(
    () =>
      providerFilter === "all" ? cards : cards.filter((c) => c.provider === providerFilter),
    [cards, providerFilter],
  );
  const hasSeries = useMemo(() => cards.some((c) => c.sparkline.length >= 2), [cards]);

  if (status === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading tokenized stocks"
        className={GRID_CLASS}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} aria-hidden="true" className="rounded-xl border border-border bg-card p-5">
            {/* Headline = [28px logo circle] ticker + context column (AssetCard anatomy). */}
            <div className="flex items-center gap-2.5">
              <SkeletonShimmer
                width="1.75rem"
                height="1.75rem"
                rounded="none"
                className="shrink-0 rounded-full"
              />
              <div className="min-w-0 space-y-1.5">
                <SkeletonShimmer width="4.5rem" height="1.25rem" />
                <SkeletonShimmer width="6rem" height="0.75rem" />
              </div>
            </div>
            <SkeletonShimmer width="7rem" height="1.75rem" className="mt-5" />
            <SkeletonShimmer height="2.25rem" className="mt-4" />
          </div>
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <EmptyState
        chip="UNAVAILABLE"
        title="Tokenized stocks unavailable"
        description={errorMessage ?? "The dev catalog did not respond."}
      />
    );
  }

  if (status === "empty") {
    return (
      <EmptyState
        chip="EMPTY"
        title="No tokenized stocks listed"
        description="The dev catalog responded but lists no instruments yet."
        action={
          <Link
            href="/providers"
            className="rounded-sm text-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Check data providers
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {providers.length >= 2 ? (
          <nav aria-label="Filter by provider" className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Provider</span>
            <button
              type="button"
              aria-pressed={providerFilter === "all"}
              className={filterButtonClasses(providerFilter === "all")}
              onClick={() => setProviderFilter("all")}
            >
              All
            </button>
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={providerFilter === p}
                className={filterButtonClasses(providerFilter === p)}
                onClick={() => setProviderFilter(p)}
              >
                {p}
              </button>
            ))}
          </nav>
        ) : (
          <span />
        )}
        <FreshnessBadge
          source={
            dataSource === "catalog" && hasSeries
              ? "dev catalog · mock prices · Yahoo closes"
              : SOURCE_BADGE[dataSource]
          }
          asOf={seriesAsOf}
        />
      </div>

      {/* data-source/data-count make the grid's provenance assertable in DOM checks. */}
      <div
        data-source={dataSource}
        data-count={visible.length}
        className={GRID_CLASS}
      >
        {visible.map((card) => (
          <StockCard
            key={card.ticker}
            ticker={card.ticker}
            provider={card.provider}
            price={card.price}
            changePct={card.changePct}
            change7d={card.change7d}
            sparkline={card.sparkline}
          />
        ))}
      </div>
    </div>
  );
}
