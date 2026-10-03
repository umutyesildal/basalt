"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { XStockHistoryChart } from "@/components/xstocks/xstock-history-chart";
import { useXStockHistory } from "@/components/xstocks/use-xstock-history";
import { formatPercent, formatUsd } from "@/lib/format";
import { xstockHistoryChange, type XStockHistoryRange } from "@/lib/xstock-history";
import type { XStockQuote } from "@/lib/xstock-types";

export function XStockMarketChart({ mint, symbol, quote }: { mint: string; symbol: string; quote?: XStockQuote }) {
  const [range, setRange] = useState<XStockHistoryRange>("7d");
  const [refresh, setRefresh] = useState(0);
  const { history, loading } = useXStockHistory(mint, range, refresh);
  const series = history.get(mint);
  const change = xstockHistoryChange(series, range);
  const period = range === "7d" ? "7D" : "1M";
  const date = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return <Card className="gap-0 overflow-hidden">
    <div className="flex flex-wrap items-end justify-between gap-5 px-5 pb-6 pt-6 sm:px-7">
      <div><p className="text-xs text-muted-foreground">Price</p><div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2"><span className="font-display text-4xl font-semibold tabular-nums sm:text-5xl">{formatUsd(quote?.priceUsd)}</span>{change !== null && <span className={`font-mono text-sm tabular-nums ${change < 0 ? "text-destructive" : "text-[hsl(var(--status-positive))]"}`}>{formatPercent(change, { signed: true })}<span className="ml-2 text-xs text-muted-foreground">{period}</span></span>}</div></div>
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Price chart period">{(["7d", "30d"] as const).map(value => <button type="button" key={value} aria-pressed={value === range} onClick={() => setRange(value)} className={`min-h-10 min-w-12 rounded-md px-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${value === range ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{value === "7d" ? "7D" : "1M"}</button>)}</div>
    </div>
    <div className="px-3 pb-3 sm:px-5"><XStockHistoryChart history={series} loading={loading && (!series || series.status === "loading")} label={symbol} /></div>
    <div className="flex items-start justify-between gap-4 border-t border-border px-5 py-1 sm:px-7">
      <details className="min-w-0 flex-1 text-xs text-muted-foreground"><summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text">Price details <span aria-hidden="true">+</span></summary>
        <dl className="grid gap-3 pb-5 sm:grid-cols-2"><div><dt>Spot source</dt><dd className="mt-1 text-foreground">{quote?.source === "jupiter" ? "Jupiter" : "Unavailable"}</dd></div>{quote?.observedAt && <div><dt>Price observed</dt><dd className="mt-1 text-foreground">{date(quote.observedAt)} UTC</dd></div>}{quote?.fetchedAt && <div><dt>Price retrieved</dt><dd className="mt-1 text-foreground">{date(quote.fetchedAt)} UTC</dd></div>}<div><dt>Chart</dt><dd className="mt-1 text-foreground">{series?.source === "geckoterminal" ? "Daily Solana token closes from GeckoTerminal" : "Token history unavailable"}</dd></div>{series?.poolAddress && <div className="sm:col-span-2"><a href={`https://www.geckoterminal.com/solana/pools/${series.poolAddress}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text">View trading pool</a></div>}</dl>
      </details>
      {!loading && series?.status === "unavailable" && <button type="button" onClick={() => setRefresh(value => value + 1)} className="min-h-11 rounded-sm text-xs text-muted-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text">Retry chart</button>}
    </div>
  </Card>;
}
