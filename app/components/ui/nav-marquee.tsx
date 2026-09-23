"use client";

/**
 * Nav marquee — the page-top ticker strip, mounted as the LAST child INSIDE
 * the sticky <header> (site-header.tsx) so it travels with the sticky chrome
 * on every page. Cells read: SYMBOL · NAV price · window return, separated by
 * hairline dividers, scrolling in one infinite CSS track (motion.css).
 *
 * DATA — real sources only: GET /api/v1/leaderboard/baskets via the same
 * adaptive window cascade as the home live-proof band (30d -> 7d -> all;
 * the first window with rows wins; the window stays internal, same precedent
 * as live-proof). The endpoint exposes no 24h window, so the change chip is
 * the fetched window's returnPct — it is never labeled "24h". Per entry:
 *  - label: symbol, falling back to basketName, then a truncated address
 *    (the same hierarchy the leaderboard rows use);
 *  - price: NAV per share parsed BigInt-safe ("—" when the string is empty —
 *    never fabricated);
 *  - change: returnPct with the direction colors imported from
 *    change-value.tsx (CHANGE_UP_CLASS / CHANGE_DOWN_CLASS — single source,
 *    never redefined here).
 * Silent 60s poll while the tab is visible; a failed refresh keeps the last
 * good strip on screen (live-proof's useLiveResource discipline).
 *
 * DEMO (NEXT_PUBLIC_HOME_DEMO=1): renders the labeled DEMO_BASKETS dataset
 * statically — demo mode never touches the network (lib/demo-mode.ts).
 *
 * MOTION: the cell list renders TWICE inside one flex track;
 * `@keyframes marquee` translates the track by exactly -50% (one copy's
 * width) for a seamless `linear infinite` loop, with the duration scaled to
 * the cell count. Hover or keyboard focus within pauses via
 * animation-play-state. Under prefers-reduced-motion the track freezes at 0
 * and the duplicate copy is display:none — exactly one static copy remains.
 * The second copy is aria-hidden in every state.
 *
 * STATES — the band is always exactly h-9, so it never collapses and never
 * shifts the page: loading = existing SkeletonShimmer cells; ready-but-empty
 * or never-loaded-error = an empty band under the hairline (honest — the
 * strip states nothing rather than inventing figures).
 */

import { useEffect, useRef, useState } from "react";

import { DEMO_BASKETS } from "@/components/home/home-demo-data";
import { CHANGE_DOWN_CLASS, CHANGE_UP_CLASS } from "@/components/stocks/change-value";
// Class-string usage contract (motion.css header): a module using only the
// class strings imports the stylesheet once — this owns the marquee
// keyframes/pause rules (SkeletonShimmer's chain would pull it anyway, but
// the marquee styles should not depend on the skeleton import).
import "@/components/ui/motion.css";
import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";
import { isDemoMode } from "@/lib/demo-mode";
import { formatTokenAmount, truncateAddress } from "@/lib/format";
import { fetchBasketLeaderboard, type BasketLeaderboardEntry } from "@/lib/social-api";
import { cn } from "@/lib/utils";
import { CLUSTER } from "@/lib/wallet";

/**
 * Demo overlay switch — read once at module scope so Next inlines it at
 * build time and the real-data branch is dead code when the flag is off
 * (same pattern as live-proof-section).
 */
const DEMO = isDemoMode();
const DEVNET_PREVIEW = CLUSTER === "devnet" || CLUSTER === "localnet";

/** Silent poll cadence — matches the home live-proof band. */
const POLL_MS = 60_000;

/** Cascade order — identical to live-proof's (first window with rows wins). */
const WINDOW_CASCADE = ["30d", "7d", "all"] as const;

/** Ticker cap — the strip surfaces the top of the board, not all of it. */
const MAX_ITEMS = 12;

/**
 * A ticker needs enough cells to overflow the viewport or the -50% loop
 * shows a trailing gap before the wrap. Short boards repeat their (real)
 * sequence — the same entries, just looped sooner.
 */
const MIN_CELLS = 8;

// ---------------------------------------------------------------------------
// Loader — module-level so its identity is stable and the polling effect
// never re-arms on re-render.
// ---------------------------------------------------------------------------

async function loadTickerEntries(signal: AbortSignal): Promise<BasketLeaderboardEntry[]> {
  for (const win of WINDOW_CASCADE) {
    const payload = await fetchBasketLeaderboard(win, signal);
    if (payload.items.length > 0) {
      return payload.items.slice(0, MAX_ITEMS);
    }
  }
  return [];
}

/**
 * Polling hook — initial load + visibility-gated silent interval, mirroring
 * live-proof's lifecycle (abort on supersede/unmount, in-flight poll skip,
 * silent failures keep the last good list; only a resource that has never
 * loaded moves to "error").
 */
function useTickerEntries(): { entries: BasketLeaderboardEntry[] | null; status: "loading" | "ready" | "error" } {
  const [entries, setEntries] = useState<BasketLeaderboardEntry[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const hasDataRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      // Abort any in-flight fetch, then start fresh — superseded runs settle
      // as AbortError and never touch state.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      inFlightRef.current = true;
      try {
        const next = await loadTickerEntries(controller.signal);
        if (disposed || abortRef.current !== controller) return;
        hasDataRef.current = true;
        setEntries(next);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (disposed || abortRef.current !== controller) return;
        // A failed silent refresh keeps the last good strip on screen; only a
        // resource that has never loaded falls back to the empty band.
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
  }, []);

  return { entries, status };
}

// ---------------------------------------------------------------------------
// Cells.
// ---------------------------------------------------------------------------

/**
 * One loop copy of the strip: the entries repeated until the copy plausibly
 * overflows a wide viewport — the -50% translate needs one copy to cover the
 * viewport or the loop shows a trailing gap before the wrap. Same real
 * entries, just looped sooner on a short board; nothing new is invented.
 */
function buildLoopCells(entries: BasketLeaderboardEntry[]): BasketLeaderboardEntry[] {
  if (entries.length === 0) return [];
  const copies = Math.max(1, Math.ceil(MIN_CELLS / entries.length));
  return Array.from({ length: copies }, () => entries).flat();
}

/**
 * One ticker cell: hairline divider · SYMBOL · NAV · window return. Label
 * hierarchy mirrors the leaderboard rows (ticker chip -> name -> truncated
 * address); the basket pubkey stays on the title attribute.
 */
function TickerCell({ entry }: { entry: BasketLeaderboardEntry }) {
  const aum = entry.aum.trim() === "" ? NaN : Number(entry.aum);
  const label =
    entry.symbol?.trim() || entry.basketName?.trim() || truncateAddress(entry.basket, 6, 4);
  const hasChange = Number.isFinite(entry.returnPct);
  return (
    <li className="flex shrink-0 items-center">
      {/* Leading divider also stitches the copy-to-copy seam of the loop. */}
      <span aria-hidden="true" className="mx-4 h-3 w-px shrink-0 bg-border/60" />
      <span className="flex items-baseline gap-2" title={entry.basket}>
        <span className="font-mono text-[11px] font-medium uppercase tracking-wide text-foreground">
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-foreground/80">
          {Number.isFinite(aum) ? `AUM $${formatTokenAmount(aum)}` : "AUM —"}
        </span>
        {/* Direction colors are the change-value.tsx constants — the one
            place direction styling is defined (house rule). */}
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            hasChange
              ? entry.returnPct >= 0
                ? CHANGE_UP_CLASS
                : CHANGE_DOWN_CLASS
              : "text-muted-foreground",
          )}
        >
          {hasChange
            ? `${entry.returnPct >= 0 ? "+" : ""}${entry.returnPct.toFixed(2)}%`
            : "—"}
        </span>
      </span>
    </li>
  );
}

/** One copy of the cell list. The duplicate copy is aria-hidden and is
 *  display:none'd under prefers-reduced-motion (motion.css). */
function TickerCopy({
  cells,
  duplicate = false,
  reserveDemoLabel = false,
}: {
  cells: BasketLeaderboardEntry[];
  duplicate?: boolean;
  reserveDemoLabel?: boolean;
}) {
  return (
    <ul
      aria-hidden={duplicate || undefined}
      className={cn(
        "flex items-center",
        duplicate && "basalt-marquee-copy-alt",
        reserveDemoLabel && "pl-16",
      )}
    >
      {cells.map((entry, index) => (
        <TickerCell key={index} entry={entry} />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Band furniture.
// ---------------------------------------------------------------------------

/** Loading face — the existing shimmer pattern, no fabricated figures. */
function TickerSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading ticker"
      className="flex h-9 items-center gap-8 overflow-hidden px-4"
    >
      <span className="sr-only">Loading ticker</span>
      {Array.from({ length: 6 }, (_, index) => (
        <SkeletonShimmer key={index} width={110} height={12} />
      ))}
    </div>
  );
}

/**
 * The band — fixed h-9 in every state so mounting it under the header can
 * never shift the page. The track holds the cell list twice; the CSS
 * animation (motion.css) translates it by -50% for the seamless loop and
 * scales its duration to the cell count for a steady pace.
 */
function TickerBand({ cells, loading }: { cells: BasketLeaderboardEntry[]; loading: boolean }) {
  if (loading) {
    return (
      <div
        className="basalt-marquee overflow-hidden border-b border-border/40 bg-background"
        role="region"
        aria-label="Top baskets ticker"
      >
        <TickerSkeleton />
      </div>
    );
  }
  if (cells.length === 0) {
    // Honest empty/error band: the hairline strip stays at its fixed height
    // with nothing in it — the board is empty or the backend is unreachable.
    return (
      <div
        className="basalt-marquee overflow-hidden border-b border-border/40 bg-background"
        role="region"
        aria-label="Top baskets ticker"
      >
        <div aria-hidden="true" className="h-9" />
      </div>
    );
  }
  if (cells.length === 1) {
    const entry = cells[0];
    const label = entry.symbol?.trim() || entry.basketName?.trim() || "Strategy basket";
    const aum = Number(entry.aum);
    return (
      <div className="basalt-marquee flex h-9 items-center gap-3 overflow-hidden border-b border-border/40 bg-background px-4 font-mono text-[11px]" role="region" aria-label="Indexed basket summary">
        <span className="shrink-0 text-primary">{DEVNET_PREVIEW ? "DEVNET MOCK" : "BASKET"}</span>
        <span className="truncate text-foreground">{label}</span>
        <span className="shrink-0 text-muted-foreground">{Number.isFinite(aum) ? `${DEVNET_PREVIEW ? "Est. value" : "AUM"} $${formatTokenAmount(aum)}` : "Value unavailable"}</span>
        <span className="ml-auto hidden shrink-0 text-muted-foreground sm:inline">1 indexed basket</span>
      </div>
    );
  }
  // Duration scales with content so the pace stays steady; the min keeps
  // short boards from whipping.
  const duration = Math.max(30, cells.length * 4);
  const loopCells = buildLoopCells(cells);
  return (
    <div
      className="basalt-marquee relative overflow-hidden border-b border-border/40 bg-background"
      role="region"
      aria-label={DEMO ? "Demo basket ticker" : "Top baskets ticker"}
    >
      <div
        className="basalt-marquee-track flex h-9 w-max items-center"
        style={{ animationDuration: `${duration}s` }}
      >
        <TickerCopy cells={loopCells} reserveDemoLabel={DEMO} />
        <TickerCopy cells={loopCells} duplicate reserveDemoLabel={DEMO} />
      </div>
      {DEMO ? (
        <span className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
          demo
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports — demo (static labeled dataset) and real (polled resource) split,
// so the demo overlay mounts zero fetching machinery (live-proof pattern).
// ---------------------------------------------------------------------------

/** Real mode — the polling hook lives here so demo mode never fetches. */
function RealTicker() {
  const { entries, status } = useTickerEntries();
  return <TickerBand cells={entries ?? []} loading={status === "loading"} />;
}

export function NavMarquee() {
  if (DEMO) {
    return <TickerBand cells={DEMO_BASKETS.slice(0, MAX_ITEMS)} loading={false} />;
  }
  return <RealTicker />;
}
