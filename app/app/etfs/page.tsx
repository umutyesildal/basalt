import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EtfGrid, type EtfRow } from "@/components/etfs/etf-grid";
import { EtfGridShimmerSkeleton } from "@/app/etfs/grid-skeleton";
import { EmptyState, FreshnessBadge } from "@/components/states";
import {
  fetchMockXStockCatalog,
  type MockCatalogEntry,
} from "@/lib/xstock-catalog";
import { apiFetch, apiQuery } from "@/lib/api-client";
import {
  fetchDailyCloseSeries,
  mapLimit,
  underlyingFromPriceSource,
  type DailyCloseSeries,
} from "@/lib/price-series";

export const metadata: Metadata = {
  // absolute: the root layout appends "· Basalt" via its title template — a
  // plain string here would render "Tokenized ETFs — Basalt · Basalt".
  title: { absolute: "Basalt | Tokenized ETFs" },
  description: "The tokenized ETF tickers listed on Basalt today.",
};

/**
 * Display metadata for xStock registry tickers that are tokenized ETFs (fund
 * trackers) rather than single-stock tokens. Configuration, not live data —
 * the backend registry carries no asset-class field yet, so new ETF tickers
 * are added here when they ship. Anything not in this map is filtered out.
 */
const ETF_META: Record<string, { name: string }> = {
  SPYx: { name: "S&P 500 index tracker" },
};

interface XStockRow {
  ticker: string;
  mint?: string;
  yahooSymbol?: string;
  provider?: string;
  status?: string;
}

interface CompareRow {
  ticker: string;
  jupiter: number | null;
}

interface ComparePayload {
  data?: CompareRow[];
  ts?: string;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await apiFetch(path, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** `getJson` for routes that take query parameters (literal path + params). */
async function getJsonQuery<T>(
  path: string,
  params: Record<string, string>,
): Promise<T | null> {
  try {
    const res = await apiQuery(path, params, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Latest Yahoo close across a series batch — feeds FreshnessBadge `asOf`. */
function maxSeriesTs(seriesList: (DailyCloseSeries | null)[]): number | undefined {
  const max = seriesList.reduce<number>(
    (acc, s) => Math.max(acc, s?.lastTs ?? 0),
    0,
  );
  return max > 0 ? max : undefined;
}

/**
 * Dev-catalog path: build rows from GET /api/v1/xstocks/mock (deterministic
 * dev-catalog prices, labeled mock). Prices are mock; the 7-session sparkline
 * and 24h/7d changes still come from real Yahoo daily closes for the
 * underlying (lib/price-series.ts — real data only). Returns null when the
 * catalog route is unreachable — the caller then uses the live flow.
 */
async function etfRowsFromCatalog(): Promise<{
  rows: EtfRow[];
  seriesAsOf?: number;
} | null> {
  const catalog = await fetchMockXStockCatalog();
  if (!catalog) return null;
  const catalogEntries = catalog.filter(
    (entry) => ETF_META[entry.ticker] !== undefined,
  );
  if (catalogEntries.length === 0) return null;

  const baseRows = catalogEntries.map((entry: MockCatalogEntry) => ({
    ticker: entry.ticker,
    name: ETF_META[entry.ticker]?.name,
    provider: "mock (dev catalog)",
    price: entry.priceUsd,
    change24h: null,
    /** Real underlying for the series fallback ("mock:msft" → "MSFT"). */
    underlying: underlyingFromPriceSource(entry.priceSource),
  }));

  const seriesList = await mapLimit(baseRows, 4, (row) =>
    fetchDailyCloseSeries(row.ticker, row.underlying),
  );
  const rows: EtfRow[] = baseRows.map((row, i) => ({
    ticker: row.ticker,
    name: row.name,
    provider: row.provider,
    price: row.price,
    change24h: seriesList[i]?.changePct24h ?? null,
    change7d: seriesList[i]?.changePct7d ?? null,
    sparkline: seriesList[i]?.closes ?? [],
  }));
  return { rows, seriesAsOf: maxSeriesTs(seriesList) };
}

/**
 * Listing body: prefer the devnet dev catalog for prices (mock, labeled);
 * otherwise fall back to the live registry flow — instrument registry, ETF-type
 * tickers only, live token price (Jupiter) and the 24h/7d changes plus the
 * 7-session sparkline from real Yahoo daily closes (never the simulated
 * xStock series). Renders its own header so the FreshnessBadge only appears
 * once real metadata exists.
 */
async function EtfListing() {
  const catalog = await etfRowsFromCatalog();

  if (catalog) {
    const hasSeries = catalog.rows.some((row) => (row.sparkline?.length ?? 0) >= 2);
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="tokenized-etfs" className="font-display text-sm font-medium">
            Tokenized ETFs on Basalt
          </h2>
          <FreshnessBadge
            source={
              hasSeries
                ? "dev catalog · mock prices · Yahoo closes"
                : "dev catalog · mock prices (not live)"
            }
            asOf={catalog.seriesAsOf}
          />
        </div>
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
          Devnet showcase: prices are deterministic dev-catalog values (mock — not live
          market data). The mini chart and the 24h/7d changes are Yahoo daily closes
          for the underlying ETF.
        </p>
        <EtfGrid rows={catalog.rows} />
      </div>
    );
  }

  const xstocksRes = await getJson<{ data?: XStockRow[] }>("/api/v1/xstocks");

  if (xstocksRes?.data == null) {
    return (
      <EmptyState
        chip="API UNREACHABLE"
        title="Instrument list unavailable"
        description="/api/v1/xstocks could not be reached, so no listing can be shown right now."
        action={
          <Link
            href="/providers"
            className="text-xs underline underline-offset-4 hover:text-foreground"
          >
            Check provider status
          </Link>
        }
      />
    );
  }

  const listed = xstocksRes.data.filter((row) => ETF_META[row.ticker] !== undefined);

  if (listed.length === 0) {
    return (
      <EmptyState
        chip="EMPTY"
        title="No tokenized ETFs listed yet"
        description="The instrument registry currently lists no ETF-type tickers. Single-stock tokens are not shown here."
        action={
          <Link
            href="/providers"
            className="text-xs underline underline-offset-4 hover:text-foreground"
          >
            View instrument registry
          </Link>
        }
      />
    );
  }

  const tickers = listed.map((row) => row.ticker).join(",");
  const [compareRes, seriesList] = await Promise.all([
    getJsonQuery<ComparePayload>("/api/v1/prices/compare", { tickers }),
    mapLimit(listed, 4, (row) => fetchDailyCloseSeries(row.ticker)),
  ]);

  const priceByTicker = new Map((compareRes?.data ?? []).map((c) => [c.ticker, c.jupiter]));

  const rows: EtfRow[] = listed.map((row, i) => {
    const series = seriesList[i];
    return {
      ticker: row.ticker,
      name: ETF_META[row.ticker]?.name,
      provider: row.provider,
      price: priceByTicker.get(row.ticker) ?? null,
      // Yahoo daily closes only — the xStock series is simulated and never quoted.
      change24h: series?.changePct24h ?? null,
      change7d: series?.changePct7d ?? null,
      sparkline: series?.closes ?? [],
    };
  });

  const compareTs = compareRes?.ts ? Date.parse(compareRes.ts) : 0;
  const seriesTs = maxSeriesTs(seriesList) ?? 0;
  const asOf = Math.max(seriesTs, compareTs) || undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="tokenized-etfs" className="font-display text-sm font-medium">
          Tokenized ETFs on Basalt
        </h2>
        <FreshnessBadge source="Jupiter · Yahoo Finance" asOf={asOf} />
      </div>
      <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
        Token prices are Jupiter quotes for the token; the mini chart and the 24h/7d
        changes are Yahoo daily closes for the underlying ETF (7d = last five sessions).
      </p>
      <EtfGrid rows={rows} />
    </div>
  );
}

export default function EtfsPage() {
  return (
    <div>
      <header className="pb-8">
        <h1 className="font-display text-3xl font-semibold">Tokenized ETFs</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          The tokenized ETF tickers Basalt lists today.
        </p>
      </header>

      {/* Live listing, right under the intro; streams after the fetches resolve.
          The Traditional vs tokenized comparison lives on the home landing now. */}
      <section aria-label="Tokenized ETFs on Basalt" className="border-t border-border py-8">
        <Suspense fallback={<EtfGridShimmerSkeleton />}>
          <EtfListing />
        </Suspense>
      </section>
    </div>
  );
}
