"use client";

/**
 * Portfolio empty state with suggested baskets.
 *
 * Composed from the same card family as components/states/empty-state.tsx
 * (solid border, mono chip, one-sentence copy, real actions) but adds
 * agent-inspired distribution thinking to the portfolio surface: real
 * "suggested baskets" cards
 * ranked by the existing baskets leaderboard hook (GET /leaderboard/baskets,
 * window=all) plus a "create your first basket" CTA. Suggestions are live
 * indexer data with the est. label — loading, empty and error states are
 * honest; nothing is fabricated to fill the void.
 *
 * Lives outside components/states/ on purpose: it is portfolio-specific
 * composition, not a generic state primitive. The export name is distinct
 * from states' `EmptyState` so the two never collide in one import.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/states";
import { formatRelativeTime, formatUsd, NOT_A_NUMBER_LABEL, truncateAddress } from "@/lib/format";
import { fetchBasketLeaderboard, type BasketLeaderboardEntry } from "@/lib/social-api";
import { cn } from "@/lib/utils";

const SUGGESTION_COUNT = 3;

/** NAV-snapshot estimate — keeps the "est." label from the leaderboard. */
function EstReturn({ roiPct }: { roiPct: number | null }) {
  if (roiPct === null) {
    return (
      <span className="font-mono text-sm tabular-nums text-muted-foreground" title="No estimate yet — needs NAV snapshots">
        {NOT_A_NUMBER_LABEL}
      </span>
    );
  }
  const positive = roiPct >= 0;
  return (
    <span
      className={cn(
        "font-mono text-sm tabular-nums",
        positive ? "text-[hsl(var(--status-positive))]" : "text-[hsl(var(--destructive))]",
      )}
    >
      {positive ? "+" : ""}
      {roiPct.toFixed(2)}%
    </span>
  );
}

/** One suggested basket — same row anatomy as the leaderboard baskets tab. */
function SuggestionCard({ entry }: { entry: BasketLeaderboardEntry }) {
  const navValue = entry.nav.trim() ? Number(entry.nav) : NaN;
  return (
    <Link
      href={`/basket/${entry.basket}`}
      title={`Open basket ${entry.basket}`}
      className="flex flex-col rounded-xl border border-border bg-background p-4 transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">
          {entry.basketName?.trim() || truncateAddress(entry.basket, 4, 4)}
        </span>
        {entry.symbol ? (
          <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10px] uppercase text-accent-foreground">
            {entry.symbol}
          </span>
        ) : null}
      </div>
      <span className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
        {entry.mintCount} {entry.mintCount === 1 ? "mint" : "mints"} ·{" "}
        {entry.holders} {entry.holders === 1 ? "holder" : "holders"}
      </span>
      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border/60 pt-3">
        <span className="flex flex-col">
          <span className="font-mono text-sm tabular-nums text-foreground">
            {Number.isFinite(navValue) ? formatUsd(navValue) : NOT_A_NUMBER_LABEL}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            nav / share
          </span>
        </span>
        <span className="flex flex-col items-end">
          <EstReturn roiPct={entry.returnPct} />
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            est. return · {formatRelativeTime(entry.asOf)}
          </span>
        </span>
      </div>
    </Link>
  );
}

function SuggestionSkeletons() {
  return (
    <div aria-hidden="true" className="grid gap-3 sm:grid-cols-3">
      {Array.from({ length: SUGGESTION_COUNT }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-background p-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-1.5 h-3 w-36" />
          <div className="mt-3 flex justify-between border-t border-border/60 pt-3">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PortfolioEmptyState({ className }: { className?: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<BasketLeaderboardEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    (async () => {
      try {
        const payload = await fetchBasketLeaderboard("all", controller.signal);
        if (controller.signal.aborted) return;
        setItems(payload.items);
        setMessage(payload.note ?? null);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (controller.signal.aborted) return;
        setMessage(
          err instanceof Error ? err.message : "Could not reach the rankings API.",
        );
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <div className={cn("flex flex-col rounded-xl border border-border bg-card p-5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          EMPTY
        </span>
        <p className="text-sm font-medium text-foreground">No positions yet</p>
      </div>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        The indexer returned zero basket share positions for this wallet —
        on-chain balances are the source of truth and nothing is fabricated.
        Mint into a basket to open your first position, or compose one from
        scratch.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button render={<Link href="/create" />} size="sm">
          Create your first basket
        </Button>
        <Button render={<Link href="/explore" />} variant="outline" size="sm">
          Explore baskets
        </Button>
      </div>

      <div className="mt-5 border-t border-border/60 pt-4">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground/80">
          Suggested baskets — all-time ranked
        </p>

        <div className="mt-3">
          {status === "loading" ? <SuggestionSkeletons /> : null}

          {status === "error" ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Suggestions are unavailable right now ({message ?? "rankings API did not respond"}).
              Browse <Link href="/explore" className="underline underline-offset-4">all baskets</Link>{" "}
              instead — nothing is invented to fill this slot.
            </p>
          ) : null}

          {status === "ready" && items.length === 0 ? (
            <p className="text-sm leading-6 text-muted-foreground">
              No ranked baskets yet — NAV snapshots build the board as baskets
              trade. The <Link href="/explore" className="underline underline-offset-4">basket list</Link>{" "}
              is the complete, unranked view.
            </p>
          ) : null}

          {status === "ready" && items.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {items.slice(0, SUGGESTION_COUNT).map((entry) => (
                <SuggestionCard key={entry.basket} entry={entry} />
              ))}
            </div>
          ) : null}
        </div>

        {status === "ready" && items.length > 0 ? (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Ranked by NAV-snapshot return (all-time window). Past performance
            does not guarantee future results.
          </p>
        ) : null}
      </div>
    </div>
  );
}
