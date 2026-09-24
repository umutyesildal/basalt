"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, Copy, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PieCenter } from "@/components/charts/pie-center";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getConceptAsset, getConceptAssetName } from "@/lib/concept-assets";
import { type ConceptBasket } from "@/lib/concept-basket";
import { conceptCopyHref, conceptPreviewHref } from "@/lib/concept-share";
import { formatBpsAsPercent, formatUsd } from "@/lib/format";
import { tickerColor } from "@/lib/ticker-color";
import { cn } from "@/lib/utils";

export default function ConceptPreviewClient({ basket }: { basket: ConceptBasket | null }) {
  const [shareUrl, setShareUrl] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [showFullLink, setShowFullLink] = useState(false);

  useEffect(() => {
    if (!basket) return;
    setShareUrl(`${window.location.origin}${conceptPreviewHref(basket)}`);
  }, [basket]);

  const chartData = useMemo(
    () => basket?.assets.map((asset) => ({
      label: asset.symbol,
      value: asset.weightBps / 100,
      color: tickerColor(asset.symbol),
    })) ?? [],
    [basket],
  );

  async function copyShareLink() {
    if (!shareUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("Link copied");
    } catch {
      setShowFullLink(true);
      setShareStatus("Select and copy the link below");
    }
  }

  if (!basket) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        <Link
          href="/explore"
          className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to explore
        </Link>
        <Card>
          <CardHeader className="space-y-3">
            <span className="w-fit rounded-md border border-border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Preview unavailable
            </span>
            <CardTitle className="font-display text-3xl">This link needs a fresh basket preview</CardTitle>
            <CardDescription className="max-w-prose text-sm leading-6">
              The basket details are missing, incomplete, or no longer supported. Start a new preview and share its link again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Link href="/create" className={buttonVariants()}>Create a basket</Link>
            <Link href="/explore" className={buttonVariants({ variant: "outline" })}>Explore ideas</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-8">
      <div className="flex flex-col gap-6 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-3">
          <Link
            href="/explore"
            className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Explore
          </Link>
          <div>
            <span className="inline-flex rounded-md border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-foreground">
              Concept preview
            </span>
            <h1 className="mt-3 break-words font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {basket.name}
            </h1>
            {basket.thesis ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{basket.thesis}</p>
            ) : null}
          </div>
        </div>
        <Link href={conceptCopyHref(basket)} className={cn(buttonVariants(), "basalt-cta min-h-10 gap-2 self-start md:self-auto")}>
          Use this mix
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <Card className="basalt-arrive self-start">
          <CardHeader>
            <CardDescription>Composition</CardDescription>
            <CardTitle className="font-display text-xl">A clear view of the mix</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid items-center gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
              <figure className="mx-auto" aria-label={`Basket composition: ${basket.assets.map((asset) => `${asset.symbol} ${formatBpsAsPercent(asset.weightBps)}`).join(", ")}`}>
                <PieChart data={chartData} size={220} innerRadius={68} hoverOffset={4}>
                  {chartData.map((slice, index) => (
                    <PieSlice key={slice.label} index={index} animate={false} hoverEffect="none" showGlow={false} />
                  ))}
                  <PieCenter defaultLabel="Assets" suffix="">
                    {({ data, isHovered }) => (
                      <span className="text-center font-mono text-xs font-medium leading-5 tabular-nums text-foreground">
                        {isHovered ? <>{data.label}<br />{formatBpsAsPercent(Math.round(data.value * 100))}</> : `${basket.assets.length} assets`}
                      </span>
                    )}
                  </PieCenter>
                </PieChart>
                <figcaption className="sr-only">Illustrative allocation weights add up to one hundred percent.</figcaption>
              </figure>

              <ul className="divide-y divide-border/70" aria-label="Asset allocations">
                {basket.assets.map((asset) => (
                  <li key={asset.symbol} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <AssetMark symbol={asset.symbol} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {getConceptAssetName(asset.symbol)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{asset.symbol}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm tabular-nums text-foreground">
                        {formatBpsAsPercent(asset.weightBps)}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatUsd((basket.amountUsd * asset.weightBps) / 10_000)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="basalt-arrive basalt-arrive-later">
            <CardHeader>
              <CardDescription>Example amount</CardDescription>
              <CardTitle className="font-display text-3xl tabular-nums">{formatUsd(basket.amountUsd)}</CardTitle>
              <CardDescription>Illustrative allocation across the assets below.</CardDescription>
            </CardHeader>
            <CardContent className="border-t border-border pt-4">
              <dl className="grid gap-3 text-sm">
                <FeeRow label="Entry" value={basket.fees.entryBps} description="Applied when shares are created." />
                <FeeRow label="Exit" value={basket.fees.exitBps} description="Applied when shares are redeemed." />
                <FeeRow label="Management" value={basket.fees.managementBps} description="Annual rate, accrued over time." annual />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Share2 aria-hidden="true" className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Share this idea</CardTitle>
              </div>
              <CardDescription>Send your mix to anyone.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button onClick={copyShareLink} disabled={!shareUrl} className="min-h-10 w-full gap-2">
                {shareStatus === "Link copied" ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
                {shareStatus === "Link copied" ? "Link copied" : "Copy basket link"}
              </Button>
              <button type="button" onClick={() => setShowFullLink((show) => !show)} aria-expanded={showFullLink} className="min-h-9 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {showFullLink ? "Hide full link" : "Show full link"}
              </button>
              {showFullLink && <>
                <label htmlFor="preview-share-link" className="sr-only">Basket preview link</label>
                <input
                  id="preview-share-link"
                  type="url"
                  readOnly
                  value={shareUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </>}
              <p aria-live="polite" className="min-h-5 text-xs leading-5 text-muted-foreground">
                {shareStatus || "Anyone with the link can open this basket."}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="border-t border-border pt-5 text-sm leading-6 text-muted-foreground">
        This is a planning preview. It does not buy assets or deploy an onchain basket.
      </p>
    </div>
  );
}

function FeeRow({ label, value, description, annual = false }: { label: string; value: number; description: string; annual?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <dt className="font-medium text-foreground">{label}</dt>
        <dd className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</dd>
      </div>
      <span className="shrink-0 font-mono tabular-nums text-foreground">
        {formatBpsAsPercent(value)}{annual ? "/yr" : ""}
      </span>
    </div>
  );
}

function AssetMark({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  const asset = getConceptAsset(symbol);
  const initials = symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();

  if (!asset?.logoUrl || failed) {
    return (
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted font-mono text-xs font-semibold text-foreground">
        {initials}
      </span>
    );
  }

  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
      <img src={asset.logoUrl} alt="" width={40} height={40} loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
    </span>
  );
}
