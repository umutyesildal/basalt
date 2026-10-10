"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { BasketMetrics, ModelPerformanceNote } from "@/components/basket/basket-performance";
import Image from "next/image";
import { getBasketCover } from "@/lib/basket-covers";
import { BasketXShareButton } from "@/components/preview/basket-x-share-button";
import { BasketImageButton } from "@/components/preview/basket-image-button";
import { CreationCelebration } from "@/components/preview/creation-celebration";
import { findBasketPerformanceSample } from "@/lib/basket-share-performance";
import { StockMixCard } from "@/components/basket/stock-mix-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getConceptAsset, getConceptAssetName } from "@/lib/concept-assets";
import { type ConceptBasket } from "@/lib/concept-basket";
import { conceptCopyHref, conceptPreviewHref } from "@/lib/concept-share";
import { formatBpsAsPercent, formatUsd } from "@/lib/format";
import { allocationColor } from "@/lib/allocation-colors";
import { cn } from "@/lib/utils";
import { devnetCreateHref } from "@/lib/devnet-links";
import { basketPublicLink, ensureBasketPublicLink } from "@/lib/basket-social-share";

export default function ConceptPreviewClient({ basket, created = false, publicHref }: { basket: ConceptBasket | null; created?: boolean; publicHref?: string }) {
  const sample = basket ? findBasketPerformanceSample(basket) : undefined;
  const [copying, setCopying] = useState(false);
  const copyRequest = useRef(0);
  const [shareUrl, setShareUrl] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [showCopyFallback, setShowCopyFallback] = useState(false);
  const shareLinkInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setShareStatus("");
    setShowCopyFallback(false);
    if (!basket) return;
    copyRequest.current += 1;
    setCopying(false);
    setShareUrl(publicHref ? new URL(publicHref, window.location.origin).href : basketPublicLink(basket, window.location.origin));
    return () => { copyRequest.current += 1; };
  }, [basket, publicHref]);

  useEffect(() => {
    if (showCopyFallback) shareLinkInput.current?.focus();
  }, [showCopyFallback]);

  const mixAssets = useMemo(
    () => basket?.assets.map(asset => ({
      id: asset.mint ?? asset.symbol,
      label: getConceptAssetName(asset.symbol, asset.mint),
      symbol: asset.symbol,
      weightBps: asset.weightBps,
      logoSrc: getConceptAsset(asset.symbol, asset.mint)?.logoUrl ?? "",
      color: allocationColor(asset.symbol, asset.mint),
      amountUsd: (basket.amountUsd * asset.weightBps) / 10_000,
    })) ?? [],
    [basket],
  );

  async function copyShareLink() {
    if (!basket || copying) return;
    const request = ++copyRequest.current;
    setCopying(true); setShareStatus(""); setShowCopyFallback(false);
    let link: string;
    try {
      link = await ensureBasketPublicLink(basket, window.location.origin);
    } catch {
      if (request === copyRequest.current) {
        setShareStatus("Couldn't create a short link. Try again.");
        setCopying(false);
      }
      return;
    }
    if (request !== copyRequest.current) return;
    setShareUrl(link);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(link);
      if (request === copyRequest.current) setShareStatus("Link copied");
    } catch {
      if (request === copyRequest.current) {
        setShowCopyFallback(true); setShareStatus("Select and copy the link below.");
      }
    } finally { if (request === copyRequest.current) setCopying(false); }
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
            <CardTitle className="font-display text-3xl">This basket link no longer works</CardTitle>
            <CardDescription className="max-w-prose text-sm leading-6">
              Create a new basket link to try again.
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
      <CreationCelebration created={created} previewHref={conceptPreviewHref(basket)} />
      <div className="flex flex-col gap-6 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <Link
            href="/explore"
            className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Explore
          </Link>
          <div className="flex min-w-0 items-start gap-4">
            <div className="size-16 shrink-0 overflow-hidden rounded-lg sm:size-20">
              <Image src={getBasketCover(basket.coverId).src} alt="" width={80} height={80} className="size-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="break-words font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                {basket.name}
              </h1>
              {basket.thesis ? (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{basket.thesis}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {sample && <div className="space-y-2"><div className="max-w-xs"><BasketMetrics basketId={sample.id} /></div><ModelPerformanceNote /></div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <StockMixCard assets={mixAssets} className="basalt-arrive" />

        <div className="space-y-6">
          <Card className="basalt-arrive basalt-arrive-later">
            <CardHeader>
              <CardDescription>Example amount</CardDescription>
              <CardTitle className="font-mono text-3xl tabular-nums">{formatUsd(basket.amountUsd)}</CardTitle>
            </CardHeader>
            <CardContent className="border-t border-border pt-4">
              <dl className="grid gap-3 text-sm">
                <FeeRow label="Management fee" value={basket.fees.managementBps} annual />
                <FeeRow label="Entry fee" value={basket.fees.entryBps} />
                <FeeRow label="Exit fee" value={basket.fees.exitBps} />
              </dl>
            </CardContent>
          </Card>

          <Card aria-label="Basket actions">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href={conceptCopyHref(basket)} className={cn(buttonVariants(), "basalt-cta min-h-11 w-full gap-2")}>
                Use this mix
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </Link>
              <BasketImageButton basket={basket} />
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="ghost" onClick={copyShareLink} disabled={!shareUrl || copying} className="min-h-11 gap-2 px-2 text-xs">
                  {shareStatus === "Link copied" ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
                  {copying ? "Creating link…" : shareStatus === "Link copied" ? "Copied" : "Copy link"}
                </Button>
                <BasketXShareButton basket={basket} variant="ghost" className="min-h-11 gap-1.5 px-2 text-xs" />
              </div>
              {showCopyFallback && <div>
                <label htmlFor="preview-share-link" className="sr-only">Basket preview link</label>
                <input
                  ref={shareLinkInput}
                  id="preview-share-link"
                  type="url"
                  readOnly
                  value={shareUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>}
              <p aria-live="polite" className={cn("text-xs leading-5 text-muted-foreground", !showCopyFallback && (!shareStatus || shareStatus === "Link copied") && "sr-only")}>
                {shareStatus}
              </p>
              <div className="border-t border-border/70 pt-2">
                <Link href={devnetCreateHref({ name: basket.name, thesis: basket.thesis, managementFeeBps: basket.fees.managementBps, coverId: basket.coverId })} className="inline-flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Create on devnet<ArrowUpRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  );
}

function FeeRow({ label, value, annual = false }: { label: string; value: number; annual?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <dt className="font-medium text-foreground">{label}</dt>
      </div>
      <dd className="shrink-0 font-mono tabular-nums text-foreground">
        {formatBpsAsPercent(value)}{annual ? "/yr" : ""}
      </dd>
    </div>
  );
}
