"use client";

import type { BasketPerformanceItem } from "@/lib/basket-performance";
import { useBasketPerformance } from "@/lib/use-basket-performance";
import { formatPercent, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export function modelPrice(value: number | null | undefined) {
  return formatUsd(value, { maximumFractionDigits: 2 });
}
export function modelReturn(value: number | null | undefined) {
  return formatPercent(value, { signed: true });
}
export function ReturnValue({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={cn("font-mono tabular-nums", typeof value === "number" && value > 0 ? "text-[hsl(var(--status-positive))]" : typeof value === "number" && value < 0 ? "text-destructive" : "text-muted-foreground", className)}>{modelReturn(value)}</span>;
}
export function BasketMetrics({ basketId, compact = false }: { basketId: string; compact?: boolean }) {
  const { data, status } = useBasketPerformance();
  const item: BasketPerformanceItem | undefined = data?.items.find((entry) => entry.basketId === basketId);
  const loading = status === "loading";
  return (
    <dl className={cn("basket-model-metrics", compact && "basket-model-metrics-compact")} aria-label="Historical model performance" aria-busy={loading}>
      <div><dt>Model price</dt><dd>{loading ? "…" : modelPrice(item?.modelPrice)}</dd></div>
      <div><dt>7D</dt><dd>{loading ? "…" : <ReturnValue value={item?.return7dPct} />}</dd></div>
    </dl>
  );
}
const dateLabel = (date: string) => new Date(date.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** One explanation per surface; individual cards stay quiet. */
export function ModelPerformanceNote({ className }: { className?: string }) {
  const { data, status, retry } = useBasketPerformance();
  const unavailable = status === "error" || data?.status === "unavailable";
  return (
    <div className={cn("model-performance-note", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p aria-live="polite">{status === "loading" ? "Loading market closes…" : unavailable ? "Market data is unavailable right now." : `Sample baskets · Modeled from real stock closes${data?.asOf ? ` · ${dateLabel(data.asOf)}` : ""}`}</p>
        {(unavailable || data?.status === "partial") && <button type="button" onClick={retry} className="min-h-9 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Retry prices</button>}
      </div>
      <details>
        <summary className="inline-flex min-h-9 cursor-pointer items-center underline decoration-border underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">How these numbers work</summary>
        <p className="max-w-2xl leading-6">Each model starts at $100 on {dateLabel(data?.baseDate ?? "2026-09-01")}, buying the displayed mix and holding it without rebalancing. Prices use completed USD stock closes from Yahoo Finance, not xStocks quotes. 7D compares the latest shared close with the close on or before seven calendar days earlier. Dividends, fees and trading costs are excluded. These are historical models, not returns earned by investors.{data?.windowStart && data.asOf ? ` Current comparison: ${dateLabel(data.windowStart)} to ${dateLabel(data.asOf)}.` : ""} <a href="https://help.yahoo.com/kb/SLN2311.html" target="_blank" rel="noreferrer" className="underline underline-offset-4">About the source</a></p>
      </details>
    </div>
  );
}
