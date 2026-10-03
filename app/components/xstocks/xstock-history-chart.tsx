"use client";

import { useMemo } from "react";
import { curveLinear } from "@visx/curve";
import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { StaticChartPreviewProvider } from "@/components/charts/static-chart-preview-context";
import { formatUsd } from "@/lib/format";
import type { XStockHistory } from "@/lib/xstock-history";

/** The same Bklit price plot powers cards and detail. No synthetic loading curves. */
export function XStockHistoryChart({ history, loading = false, compact = false, label }: { history?: XStockHistory; loading?: boolean; compact?: boolean; label: string }) {
  const data = useMemo(() => history?.points.map(point => ({ date: new Date(point.timestamp), price: point.priceUsd })) ?? [], [history]);
  const height = compact ? "h-16" : "h-64 sm:h-80";
  if (data.length < 2) return <div className={`${height} flex w-full items-center justify-center`} aria-busy={loading}>
    {loading ? <div className="w-full space-y-3 px-2" role="status"><div className="h-px w-full bg-border" /><p className="text-center text-xs text-muted-foreground">Loading chart</p><div className="h-px w-full bg-border" /></div> : <p className="text-xs text-muted-foreground">{compact ? "No chart yet" : "Price history is not available yet."}</p>}
  </div>;
  return <div className={`${height} w-full ${compact ? "pointer-events-none" : ""}`} role="img" aria-label={`${label} price history, ${data.length} daily closes, from ${formatUsd(data[0].price)} to ${formatUsd(data[data.length - 1].price)}`}>
    <StaticChartPreviewProvider><AreaChart data={data} xDataKey="date" fitYDomain animationDuration={0} yDomainTween={false} style={{ touchAction: "pan-y" }} margin={compact ? { top: 3, bottom: 3, left: 0, right: 0 } : { top: 12, bottom: 30, left: 8, right: 8 }} className="h-full w-full">
      {!compact && <Grid horizontal />}
      <Area dataKey="price" fill="hsl(var(--chart-1))" stroke="hsl(var(--chart-1))" fillOpacity={compact ? 0.05 : 0.08} strokeWidth={compact ? 1.5 : 2} curve={curveLinear} animate={false} showHighlight={!compact} />
      {!compact && <XAxis numTicks={4} />}
      {!compact && <ChartTooltip damping={0} rows={point => [{ color: "hsl(var(--chart-1))", label, value: formatUsd(typeof point.price === "number" ? point.price : null) }]} />}
    </AreaChart></StaticChartPreviewProvider>
  </div>;
}
