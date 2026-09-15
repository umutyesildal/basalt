"use client";

/**
 * Activity client — the body of /activity ("Everything, in public",
 * docs/stax-analiz/05 §5.11): three protocol counters, the basket breakdown
 * table and the coming-soon live feed block on one page.
 *
 * Data comes from loadActivityStats (lib/activity-stats.ts) — a single read
 * of GET /api/v1/baskets?sort=aum rolled up into TVL / basket count / 24h.
 * The lifecycle mirrors the home live-proof section: initial load, then a
 * 60s poll gated on document visibility; a failed silent refresh keeps the
 * last good counters on screen and only a resource that has never loaded
 * surfaces the error state. While nothing has loaded the counters show
 * shape-matched shimmer bars, never placeholder numbers.
 *
 * Honesty rules: an empty index publishes ZEROS with the reason as a micro
 * note (Stax publishes zeros too); the fees counter has no endpoint yet, so
 * it publishes 0 with "fees not indexed yet"; a null 24h renders an em dash.
 * The title block is the SectionHeading eyebrow-first rhythm hand-rolled
 * (MicroLabel + .text-display h1) because a single-section page takes no
 * index number and SectionHeader composes no eyebrow slot above the title.
 */

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ErrorState } from "@/components/states";
import { ChangeValue } from "@/components/stocks/change-value";
import { MicroLabel } from "@/components/ui/micro-label";
import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";
import { StatTile } from "@/components/ui/stat-tile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  loadActivityStats,
  FEES_NOTE,
  type ActivityStats,
} from "@/lib/activity-stats";
import {
  formatAsOf,
  formatUsd,
  NOT_A_NUMBER_LABEL,
  truncateAddress,
} from "@/lib/format";

/** Silent poll cadence — counters stay fresh without a refresh button. */
const POLL_MS = 60_000;

/** Skeleton rows in the breakdown table while the first load is in flight. */
const TABLE_SKELETON_ROWS = 5;

// ---------------------------------------------------------------------------
// Polling hook — initial load + visibility-gated silent interval (the
// live-proof-section pattern: abort on supersede/unmount, in-flight poll
// skip, silent failures keep the last good snapshot).
// ---------------------------------------------------------------------------

interface ActivityResource {
  stats: ActivityStats | null;
  status: "loading" | "ready" | "error";
  retry: () => void;
}

function useActivityStats(): ActivityResource {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [status, setStatus] = useState<ActivityResource["status"]>("loading");
  const [attempt, setAttempt] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const hasDataRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      inFlightRef.current = true;
      try {
        const next = await loadActivityStats(controller.signal);
        if (disposed || abortRef.current !== controller) return;
        hasDataRef.current = true;
        setStats(next);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (disposed || abortRef.current !== controller) return;
        // A failed silent refresh keeps the last good counters on screen;
        // only a resource that has never loaded surfaces the error state.
        if (!hasDataRef.current) setStatus("error");
      } finally {
        if (abortRef.current === controller) inFlightRef.current = false;
      }
    };
    void run();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !inFlightRef.current) void run();
    }, POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [attempt]);

  return { stats, status, retry: () => setAttempt((n) => n + 1) };
}

// ---------------------------------------------------------------------------
// Counters — three big tiles. StatTile stays flush (no surface of its own);
// the card face + optional micro note live here so a zero can carry the
// reason it is zero (house rule: publish zeros with the why).
// ---------------------------------------------------------------------------

function CounterTile({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4">
      <StatTile
        variant="flush"
        label={label}
        value={value}
        valueClassName="text-2xl md:text-3xl"
      />
      {note ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** Shimmer bar shaped like the loaded value — no layout shift, no fake data. */
function CounterShimmer() {
  return (
    <span className="block" aria-hidden="true">
      <SkeletonShimmer width={120} height={28} rounded="md" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Basket breakdown table.
// ---------------------------------------------------------------------------

function BreakdownSkeleton() {
  return (
    <div className="divide-y divide-border/40" aria-hidden="true">
      {Array.from({ length: TABLE_SKELETON_ROWS }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3.5">
          <SkeletonShimmer width="11rem" height={14} />
          <span className="ml-auto flex gap-8">
            <SkeletonShimmer width="4.5rem" height={14} />
            <SkeletonShimmer width="5rem" height={14} />
            <SkeletonShimmer width="3.5rem" height={14} />
          </span>
        </div>
      ))}
    </div>
  );
}

function BreakdownTable({ stats }: { stats: ActivityStats }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <MicroLabel>Basket</MicroLabel>
          </TableHead>
          <TableHead className="text-right">
            <MicroLabel>NAV</MicroLabel>
          </TableHead>
          <TableHead className="text-right">
            <MicroLabel>TVL</MicroLabel>
          </TableHead>
          <TableHead className="text-right">
            <MicroLabel>24h</MicroLabel>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stats.baskets.map((b) => (
          <TableRow key={b.pubkey}>
            <TableCell>
              <Link
                href={`/basket/${b.pubkey}`}
                title={b.pubkey}
                className="inline-flex max-w-[16rem] items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="truncate text-sm font-medium text-foreground">
                  {b.name ?? truncateAddress(b.pubkey, 6, 4)}
                </span>
                {b.symbol ? (
                  <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10px] uppercase text-accent-foreground">
                    {b.symbol}
                  </span>
                ) : null}
              </Link>
            </TableCell>
            <TableCell className="text-right font-mono text-sm tabular-nums text-foreground">
              {b.sharePrice !== null ? formatUsd(b.sharePrice) : NOT_A_NUMBER_LABEL}
            </TableCell>
            <TableCell className="text-right font-mono text-sm tabular-nums text-foreground">
              {b.navUsd !== null
                ? formatUsd(b.navUsd, { maximumFractionDigits: 0 })
                : NOT_A_NUMBER_LABEL}
            </TableCell>
            <TableCell className="text-right">
              <ChangeValue changePct={b.return24hPct} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Live feed — the coming-soon block. The shimmer rows are decorative
// placeholders for a feed endpoint that does not exist yet; the sentence
// says so in plain text.
// ---------------------------------------------------------------------------

function LiveFeedBlock() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm leading-6 text-muted-foreground">
        Live transaction feed — coming soon.
      </p>
      <div aria-hidden="true" className="mt-4 space-y-2">
        <SkeletonShimmer width="100%" height={12} />
        <SkeletonShimmer width="86%" height={12} />
        <SkeletonShimmer width="64%" height={12} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page body.
// ---------------------------------------------------------------------------

export default function ActivityClient() {
  const { stats, status, retry } = useActivityStats();
  const empty = stats !== null && stats.basketCount === 0;

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Title block — mono eyebrow (house rule: tracked caps are always
          Geist Mono) above the Chakra caps h1; a single-section page takes
          no index number. */}
      <header className="space-y-1.5">
        <p className="section-label">PROTOCOL ACTIVITY</p>
        <h1 className="text-display text-3xl text-foreground">
          EVERYTHING, IN PUBLIC.
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Counters read from the indexer, not from a marketing deck.
        </p>
      </header>

      {/* Counters */}
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <CounterTile
          label="TOTAL VALUE LOCKED"
          value={
            status === "loading" ? (
              <CounterShimmer />
            ) : stats ? (
              formatUsd(stats.tvlUsd, { maximumFractionDigits: 0 })
            ) : (
              NOT_A_NUMBER_LABEL
            )
          }
          note={empty ? "no baskets indexed yet" : undefined}
        />
        <CounterTile
          label="FEES ACCRUED"
          value={
            status === "loading" ? (
              <CounterShimmer />
            ) : stats ? (
              formatUsd(stats.feesUsd, { maximumFractionDigits: 0 })
            ) : (
              NOT_A_NUMBER_LABEL
            )
          }
          note={stats ? FEES_NOTE : undefined}
        />
        <CounterTile
          label="LIVE BASKETS"
          value={
            status === "loading" ? (
              <CounterShimmer />
            ) : stats ? (
              stats.basketCount
            ) : (
              NOT_A_NUMBER_LABEL
            )
          }
          note={empty ? "nothing indexed yet" : undefined}
        />
      </div>

      {/* First-load failure — a silent refresh never gets here: it keeps the
          last good counters on screen instead. */}
      {status === "error" ? (
        <div className="mt-10">
          <ErrorState
            title="Counters unavailable"
            message="Could not reach the basket API just now."
            onRetry={retry}
          />
        </div>
      ) : null}

      {/* Basket breakdown */}
      <section aria-labelledby="activity-breakdown-heading" className="mt-12">
        <h2 id="activity-breakdown-heading" className="section-label">
          BASKET BREAKDOWN
        </h2>
        <div className="mt-4">
          {status === "loading" ? <BreakdownSkeleton /> : null}
          {stats ? (
            stats.baskets.length === 0 ? (
              <p className="py-3 text-sm leading-6 text-muted-foreground">
                Nothing is indexed yet — the table fills as baskets are created
                on-chain.
              </p>
            ) : (
              <BreakdownTable stats={stats} />
            )
          ) : null}
        </div>
        {stats?.asOf ? (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.22em] tabular-nums text-muted-foreground">
            NAV as of {formatAsOf(stats.asOf)}
          </p>
        ) : null}
      </section>

      {/* Live feed — coming soon */}
      <section aria-labelledby="activity-feed-heading" className="mt-12">
        <h2 id="activity-feed-heading" className="section-label">
          LIVE FEED
        </h2>
        <div className="mt-4">
          <LiveFeedBlock />
        </div>
      </section>
    </div>
  );
}
