"use client";

import { Layers3 } from "lucide-react";
import { useState } from "react";

import { PieCenter } from "@/components/charts/pie-center";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBpsAsPercent, formatUsd, NOT_A_NUMBER_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface StockMixAsset {
  id: string;
  label: string;
  symbol: string;
  weightBps: number | null;
  logoSrc: string;
  color: string;
  secondaryLabel?: string;
  /** Only supplied actual or explicitly illustrative dollars may be displayed. */
  amountUsd?: number | null;
  title?: string;
}

const validWeight = (value: number | null): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 10_000;

/** The same allocation card serves concept examples and exact onchain composition. */
export function StockMixCard({
  assets,
  title = "Stock mix",
  description,
  className,
}: {
  assets: StockMixAsset[];
  title?: string;
  description?: string;
  className?: string;
}) {
  const completeWeights = assets.length > 0 && assets.every(asset => validWeight(asset.weightBps)) &&
    assets.reduce((sum, asset) => sum + (asset.weightBps ?? 0), 0) === 10_000;
  const chartData = completeWeights ? assets.map(asset => ({
    label: asset.symbol,
    value: asset.weightBps! / 100,
    color: asset.color,
  })) : [];

  return (
    <Card className={cn("self-start", className)}>
      <CardHeader>
        <CardTitle className="font-display text-xl">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">Asset details are not available yet.</p>
        ) : (
          <div className="grid items-center gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
            <figure className="mx-auto" aria-label={`Basket composition: ${assets.map(asset => `${asset.symbol} ${validWeight(asset.weightBps) ? formatBpsAsPercent(asset.weightBps) : "weight unavailable"}`).join(", ")}`}>
              {completeWeights ? (
                <PieChart data={chartData} size={220} innerRadius={68} hoverOffset={4}>
                  {chartData.map((slice, index) => <PieSlice key={`${slice.label}-${index}`} index={index} animate={false} hoverEffect="none" showGlow={false} />)}
                  <PieCenter defaultLabel="Assets" suffix="">
                    {({ data, isHovered }) => (
                      <span className="text-center font-mono text-xs font-medium leading-5 tabular-nums text-foreground">
                        {isHovered ? <>{data.label}<br />{formatBpsAsPercent(Math.round(data.value * 100))}</> : `${assets.length} ${assets.length === 1 ? "asset" : "assets"}`}
                      </span>
                    )}
                  </PieCenter>
                </PieChart>
              ) : (
                <div className="flex size-[220px] items-center justify-center rounded-full border border-border">
                  <span className="max-w-32 text-center text-xs leading-5 text-muted-foreground">Allocation weights are not available yet.</span>
                </div>
              )}
              <figcaption className="sr-only">{completeWeights ? "Allocation weights add up to one hundred percent." : "The chart is unavailable until every allocation weight is verified."}</figcaption>
            </figure>

            <ul className="min-w-0 divide-y divide-border/70" aria-label="Asset allocations">
              {assets.map(asset => (
                <li key={asset.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" title={asset.title}>
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: asset.color }} />
                  <AssetLogo key={asset.logoSrc} src={asset.logoSrc} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{asset.label}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{asset.secondaryLabel || asset.symbol}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-sm tabular-nums text-foreground">{validWeight(asset.weightBps) ? formatBpsAsPercent(asset.weightBps) : NOT_A_NUMBER_LABEL}</span>
                    {typeof asset.amountUsd === "number" && Number.isFinite(asset.amountUsd) && asset.amountUsd >= 0 && (
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatUsd(asset.amountUsd)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssetLogo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background" aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" width={40} height={40} loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : <Layers3 className="size-4 text-muted-foreground" aria-hidden="true" />}
    </span>
  );
}
