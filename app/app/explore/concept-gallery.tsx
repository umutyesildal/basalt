"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { WeightBar } from "@/components/basket/weight-bar";
import { conceptBasketHref, CONCEPT_BASKETS } from "@/lib/concept-samples";

/** Curated baskets are always available, even when the indexer is offline. */
export function ConceptGallery() {
  return (
    <section aria-labelledby="concept-gallery-title" className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-foreground">
            Concept preview
          </p>
          <h2 id="concept-gallery-title" className="font-display text-2xl font-semibold tracking-tight">
            Explore basket ideas
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Open a sample to see its mix, or shape your own. Samples are illustrative and do not show onchain activity.
          </p>
        </div>
        <Link
          href="/create"
          className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
        >
          Create your own
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CONCEPT_BASKETS.map((basket) => (
          <Link
            key={basket.id}
            href={conceptBasketHref(basket)}
            className="group flex min-h-64 flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {basket.symbol}
                </p>
                <h3 className="mt-1 break-words font-display text-xl font-semibold tracking-tight text-foreground">
                  {basket.name}
                </h3>
              </div>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors group-hover:text-foreground">
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </span>
            </div>

            <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
              {basket.thesis}
            </p>

            <div className="mt-5">
              <WeightBar
                constituents={basket.allocations.map((asset) => ({
                  symbol: asset.symbol,
                  weight: asset.weightBps / 100,
                }))}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/70 pt-3 font-mono text-xs tabular-nums text-muted-foreground">
              {basket.allocations.map((asset) => (
                <span key={asset.symbol}>
                  <span className="text-foreground">{asset.symbol}</span>{" "}
                  {(asset.weightBps / 100).toFixed(asset.weightBps % 100 === 0 ? 0 : 2)}%
                </span>
              ))}
            </div>

            <span className="mt-auto pt-4 text-xs font-medium text-foreground">
              View basket idea <span aria-hidden="true">→</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
