"use client";

/**
 * Live proof section — the conversion centerpiece of the "proof beats
 * process" home refresh (NEON FOUNDRY, 2026-09-12): live on-chain evidence
 * placed before any process talk. Two columns plus the merged steps strip:
 *
 *   Left  — "Latest Trades" (owner rename, 2026-09-14): first page of
 *           GET /api/v1/feed (?type=trades), rendered as single-sentence
 *           rows — "<actor> bought 12.5 shares of <basket>" — with a
 *           basket avatar in the sentence and a compact usd-value / time
 *           block on the right.
 *   Right — "Top baskets": GET /api/v1/leaderboard/baskets through an
 *           adaptive window cascade (30d -> 7d -> all-time; the first
 *           window with rows wins) kept entirely internal — the header is
 *           just a link, it no longer labels which window was used.
 *   Below — the three-step PICK · OWN · SHARE strip (StepsStrip, merged
 *           into this section per owner feedback 2026-09-12 so proof and
 *           process live in one band).
 *
 * FIXED FOOTPRINT (owner feedback, 2026-09-14): the trades list used to
 * change height with every refresh — the loading skeleton, the honest
 * empty/error copy and the real rows all had different footprints, a poll
 * returning fewer rows than the window shrank the column, and every
 * section below the band jumped with it. Both columns now share one
 * locked geometry: exactly PREVIEW_ROW_COUNT rows of exactly
 * PREVIEW_ROW_HEIGHT px at PREVIEW_ROW_GAP px, in the ready state, while
 * loading, when a poll returns fewer rows than the window (missing slots
 * render as honest blank row surfaces — never fabricated trades), and in
 * the empty/error states (the copy is centered inside the exact region
 * the rows would occupy). The rows region is therefore always
 * PREVIEW_ROWS_HEIGHT px tall and nothing below this section can ever
 * move when the data refreshes. The two columns are also pixel-equal by
 * construction: same grid cell, same header link, same card face, same
 * row heights.
 *
 * ROLLING WINDOW (owner feedback, 2026-09-12; swap motion RE-INSTATED
 * 2026-09-14 after the full de-animation pass read as "the animation is
 * gone"): every 2.5s the next item from the queue surfaces at the top
 * while the oldest drops off. The fixed footprint from the same day is
 * untouched — slots never change height, so nothing below can move — but
 * a slot whose content changed now enters with a ~200ms ease-out fade-up
 * INSIDE its slot (Web Animations API, transform/opacity only;
 * prefers-reduced-motion swaps instantly). Rows are still keyed by slot,
 * so a tick or a fresh poll swaps row content in place with zero list
 * remount. Ticks pause while the tab is hidden. Real mode rolls over the
 * 12 fetched feed items; the queue restarts from the newest item on every
 * successful poll.
 *
 * DEMO OVERLAY (owner feedback, 2026-09-12): with NEXT_PUBLIC_HOME_DEMO=1
 * the section renders the labeled synthetic datasets from
 * home-demo-data.ts instead of fetching — real usernames + photos, basket
 * names, 1000+ holders — because synthetic DB rows are reaped by
 * positionsSync within ~2 minutes. The repo invariant "never fabricate
 * production-looking data" is preserved: the overlay is clearly chipped
 * ("demo data" mono chip by the header) and flag off = the real data path,
 * unchanged.
 *
 * FRIENDLY PREVIEW (owner feedback, 2026-09-12): a marketing surface, not
 * a terminal. No semantic red here: Minted/Redeemed read as the words
 * "bought"/"sold" (positive green on bought only), basket deltas are green
 * when positive and muted otherwise (a losing basket is stated, not
 * shouted), no badges, and anonymous wallets hide behind "a trader"
 * (ActorLine friendlyFallback). Nothing is fabricated in real mode — the
 * wallet address stays on the label's title attribute, null usdValue
 * renders "—", a null basket name reads "a basket" (pubkey in the title
 * attr), and every figure is still the real on-chain one.
 *
 * Real mode polls silently every 60s while the tab is visible and degrades
 * honestly: skeleton rows while loading, one quiet retry line when the
 * backend is unreachable, one muted line when nothing exists yet — each
 * inside the same fixed footprint. A failed silent refresh keeps the last
 * good list on screen; only a resource that has never loaded shows the
 * error. Column headers are links (/feed, /leaderboard); there are no
 * footer links or freshness stamps anymore.
 *
 * WAVE-2 POLISH (2026-09-14): both columns' rows are card faces —
 * hairline border + faint card wash, solidifying on hover as the row
 * highlight (replacing the bare left-accent hover rows) — and the section
 * fades up once via the page's SectionReveal wrapper. The honest states
 * and datasets are unchanged.
 */

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { DEMO_BASKETS, DEMO_TRADES } from "@/components/home/home-demo-data";
import { StepsStrip } from "@/components/home/steps-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";
import { BasketAvatar } from "@/components/social/basket-avatar";
import { ActorLine } from "@/components/social/avatar";
import {
  formatRelativeTime,
  formatTokenAmount,
  formatUsd,
  truncateAddress,
} from "@/lib/format";
import {
  fetchBasketLeaderboard,
  fetchFeed,
  type BasketLeaderboardEntry,
  type TradeFeedItem,
} from "@/lib/social-api";

/**
 * Demo overlay switch — read once at module scope so Next inlines it at
 * build time and the real-data branch is dead code when the flag is off.
 */
const DEMO = process.env.NEXT_PUBLIC_HOME_DEMO === "1";

/** Silent poll cadence — previews stay fresh without a refresh button. */
const POLL_MS = 60_000;

/**
 * Fixed preview geometry (owner feedback, 2026-09-14) — the single source
 * of truth for both columns. 3 rows x 72px + 2 gaps x 6px = a 228px rows
 * region that every state (loading / ready / short data / empty / error)
 * occupies identically.
 */
const PREVIEW_ROW_COUNT = 3;
const PREVIEW_ROW_HEIGHT = 72;
const PREVIEW_ROW_GAP = 6;
const PREVIEW_ROWS_HEIGHT =
  PREVIEW_ROW_COUNT * PREVIEW_ROW_HEIGHT + (PREVIEW_ROW_COUNT - 1) * PREVIEW_ROW_GAP;

/** How often the rolling window surfaces the next trade. */
const ADVANCE_MS = 2500;

/** Queue size behind the rolling window (the trades fetch limit). */
const FEED_QUEUE_SIZE = 12;

// ---------------------------------------------------------------------------
// Loaders — module-level so their identity is stable and the polling effect
// never re-arms on re-render.
// ---------------------------------------------------------------------------

async function loadRecentTrades(signal: AbortSignal): Promise<TradeFeedItem[]> {
  const payload = await fetchFeed({ type: "trades", limit: FEED_QUEUE_SIZE }, signal);
  // The endpoint already filters to trades; filter defensively anyway so a
  // backend regression can never push a thesis into the proof section.
  return payload.items.filter((item): item is TradeFeedItem => item.kind === "trade");
}

/** Cascade order: 30d first, then 7d, then all-time. */
const BASKETS_WINDOW_CASCADE = ["30d", "7d", "all"] as const;

/**
 * Adaptive window cascade — the first window with rows wins. A quiet devnet
 * board would render an empty 30d column, so the loader walks the fallbacks
 * until something honest shows. The window is intentionally internal now:
 * the header is a plain link and does not label which window was used.
 * One AbortController signal covers the whole cascade — aborting the
 * resource cancels whichever leg is in flight.
 */
async function loadTopBaskets(signal: AbortSignal): Promise<BasketLeaderboardEntry[]> {
  for (const win of BASKETS_WINDOW_CASCADE) {
    const payload = await fetchBasketLeaderboard(win, signal);
    if (payload.items.length > 0) {
      return payload.items;
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Shared polling hook — initial load + visibility-gated silent interval,
// mirroring feed-client's lifecycle (abort on supersede/unmount, in-flight
// poll skip, silent failures keep stale data).
// ---------------------------------------------------------------------------

interface LiveResource<T> {
  data: T | null;
  status: "loading" | "ready" | "error";
  retry: () => void;
}

function useLiveResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  pollMs: number,
): LiveResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LiveResource<T>["status"]>("loading");
  const [attempt, setAttempt] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const hasDataRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      // Abort any in-flight fetch, then start fresh — superseded runs settle
      // as AbortError and never touch state (their guards below).
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      inFlightRef.current = true;
      try {
        const next = await load(controller.signal);
        if (disposed || abortRef.current !== controller) return;
        hasDataRef.current = true;
        setData(next);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (disposed || abortRef.current !== controller) return;
        // A failed silent refresh keeps the last good list on screen; only a
        // resource that has never loaded surfaces the error line.
        if (!hasDataRef.current) setStatus("error");
      } finally {
        if (abortRef.current === controller) inFlightRef.current = false;
      }
    };
    void run();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !inFlightRef.current) void run();
    }, pollMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [load, pollMs, attempt]);

  return { data, status, retry: () => setAttempt((n) => n + 1) };
}

// ---------------------------------------------------------------------------
// Rolling trades queue — shared by demo and real mode. A window of
// PREVIEW_ROW_COUNT rows over a queue of items; every ADVANCE_MS the next
// item surfaces at the top and the oldest drops off the bottom. The swap
// is instant (owner feedback, 2026-09-14): rows are keyed by slot, so a
// tick replaces each row's content in place — no slide, no remount, and
// the fixed row heights mean the swap cannot move anything below.
// ---------------------------------------------------------------------------

interface RollState {
  source: TradeFeedItem[];
  /** The visible window — up to PREVIEW_ROW_COUNT items. */
  rows: TradeFeedItem[];
  /** Monotonic index into `source` of the next item to surface. */
  cursor: number;
}

function initRoll(source: TradeFeedItem[]): RollState {
  return {
    source,
    rows: source.slice(0, PREVIEW_ROW_COUNT),
    cursor: PREVIEW_ROW_COUNT,
  };
}

function useRollingTrades(items: TradeFeedItem[]): TradeFeedItem[] {
  const [roll, setRoll] = useState<RollState>(() => initRoll(items));

  // New source (first demo import / fresh poll) → restart the window from
  // the newest item. Demo data is a stable module const, so this runs once
  // there; in real mode the slot-keyed rows just swap their content.
  useEffect(() => {
    setRoll(initRoll(items));
  }, [items]);

  // Advance one item per tick while the tab is visible. A hidden tab simply
  // skips ticks — the queue holds its position and resumes on return.
  useEffect(() => {
    const source = roll.source;
    if (source.length <= PREVIEW_ROW_COUNT) return undefined;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setRoll((prev) => {
        if (prev.source !== source) return prev;
        const next = source[prev.cursor % source.length];
        return {
          source,
          cursor: prev.cursor + 1,
          rows: [next, ...prev.rows.slice(0, PREVIEW_ROW_COUNT - 1)],
        };
      });
    }, ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [roll.source]);

  return roll.rows;
}

// ---------------------------------------------------------------------------
// Swap fade-up — the slot content entrance (owner feedback, 2026-09-14:
// "animasyon gitmiş... geri istiyor"). When a slot's content identity
// changes (queue tick, fresh poll, leaderboard refresh), the NEW content
// enters with a ~200ms ease-out fade-up measured INSIDE its fixed-height
// slot. Deliberately implemented with the Web Animations API instead of
// state classes: transform/opacity only, so the slot's 72px geometry and
// the 228px region are untouched and nothing below can ever move; no
// re-render, no remount, and the slot keys keep doing the structural work.
// Guards: the first render of a slot never animates (page-load motion
// belongs to SectionReveal, not to every row), identical content does not
// re-animate, `prefers-reduced-motion` swaps instantly, and a missing
// `el.animate` degrades to the instant swap.
// ---------------------------------------------------------------------------

function useSwapFade(ref: RefObject<HTMLElement | null>, identity: unknown) {
  const prevRef = useRef<unknown>(identity);
  useEffect(() => {
    if (prevRef.current === identity) return;
    prevRef.current = identity;
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { opacity: "0", transform: "translateY(4px)" },
        { opacity: "1", transform: "translateY(0px)" },
      ],
      { duration: 200, easing: "ease-out" },
    );
  }, [identity, ref]);
}

// ---------------------------------------------------------------------------
// Fixed-footprint furniture — the shared rows region, the shape-matched
// skeleton, the honest blank row surface and the fixed-state copy block.
// Every state of either column resolves to one of these, so the band's
// height never depends on the data.
// ---------------------------------------------------------------------------

/**
 * The rows region — always exactly PREVIEW_ROWS_HEIGHT px. Both columns
 * render their rows (data, skeleton or blank surfaces) inside this one
 * container, guaranteeing identical footprint and identical row rhythm.
 */
function PreviewRowsRegion({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-col"
      style={{ height: PREVIEW_ROWS_HEIGHT, rowGap: PREVIEW_ROW_GAP }}
    >
      {children}
    </div>
  );
}

/**
 * Honest blank row surface — keeps the fixed footprint when the backend
 * has fewer rows than the preview window. A bordered empty card face: it
 * states nothing, so it can never be mistaken for a trade or a basket.
 */
function BlankPreviewFace() {
  return (
    <div
      aria-hidden="true"
      className="rounded-xl border border-border/50 bg-card/40"
      style={{ height: PREVIEW_ROW_HEIGHT }}
    />
  );
}

/**
 * Loading face — the same card face and the same fixed height as a data
 * row; shape-matched SkeletonShimmer bars stand in for avatar + sentence +
 * figures without inventing any of them. Identical for both columns, so
 * even the loading states are pixel-equal.
 */
function PreviewSkeletonFace() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/30 px-3"
      style={{ height: PREVIEW_ROW_HEIGHT }}
    >
      <SkeletonShimmer width={28} height={28} className="rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonShimmer width={148} height={14} />
        <SkeletonShimmer width="68%" height={12} />
      </div>
    </div>
  );
}

/** Loading state — N fixed skeleton faces inside the fixed region. */
function PreviewSkeletonRegion({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex flex-col"
      style={{ height: PREVIEW_ROWS_HEIGHT, rowGap: PREVIEW_ROW_GAP }}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: PREVIEW_ROW_COUNT }, (_, i) => (
        <PreviewSkeletonFace key={i} />
      ))}
    </div>
  );
}

/**
 * Fixed-footprint block for the honest empty/error copy — the message is
 * vertically centered inside the exact region the rows occupy, so these
 * states change nothing below either.
 */
function PreviewStateBlock({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-col justify-center"
      style={{ height: PREVIEW_ROWS_HEIGHT }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column furniture — linked header label, quiet error.
// ---------------------------------------------------------------------------

/**
 * Mono micro-label wrapped in a link — the whole label is the target, with
 * a hidden ↗ that fades in on hover/focus pointing off the home surface.
 */
function ColumnHeaderLink({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <h3 className="section-label">{label}</h3>
      <span
        aria-hidden="true"
        className="font-mono text-xs text-primary-text opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
      >
        ↗
      </span>
    </Link>
  );
}

/** One quiet muted line + retry — ErrorState is too heavy for a preview.
 *  Rendered inside the fixed PreviewStateBlock, so the error state keeps
 *  the ready-state footprint exactly. */
function QuietError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert">
      <p className="text-xs text-muted-foreground">
        {message}{" "}
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Retry
        </button>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trade rows — the rolling sentence list (demo + real), instant swap.
// ---------------------------------------------------------------------------

/** One trade sentence on a fixed-height card face (owner feedback,
 *  2026-09-14): the height never depends on the content, so a poll or a
 *  queue tick can never move anything below. Content still swaps in place;
 *  a slot whose trade changed enters with the slot-scoped fade-up
 *  (useSwapFade) — motion without motion of the layout. */
function TradeRow({ item }: { item: TradeFeedItem }) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  // `item` as the identity: a queue tick or a poll restart changes which
  // trade a slot holds, and that is exactly when the entrance plays.
  useSwapFade(rowRef, item);
  const minted = item.type === "Minted";
  // Skip the shares phrase when the count is absent/zero rather than
  // fabricating "0 shares bought …".
  const hasShares = Number.isFinite(item.shares) && item.shares > 0;
  return (
    <div
      ref={rowRef}
      className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/40 px-3 transition-colors duration-200 hover:border-border hover:bg-card motion-reduce:transition-none"
      style={{ height: PREVIEW_ROW_HEIGHT }}
    >
      {/* Actor + label, capped so a long displayName truncates before it
          crowds the sentence; friendlyFallback renders anonymous wallets as
          "a trader" (wallet stays on title). */}
      <ActorLine
        wallet={item.wallet}
        handle={item.handle}
        displayName={item.displayName}
        avatarUrl={item.avatarUrl}
        friendlyFallback
        emphasis
        className="max-w-[45%] shrink-0"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        <span
          className={
            minted
              ? "font-medium text-[hsl(var(--status-positive))]"
              : "text-muted-foreground"
          }
        >
          {minted ? "bought" : "sold"}
        </span>
        {hasShares ? ` ${formatTokenAmount(item.shares)} shares of ` : " "}
        <Link
          href={`/basket/${item.basket}`}
          title={item.basket}
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <BasketAvatar basket={item.basket} size={20} />
          <span className="truncate">{item.basketName ?? "a basket"}</span>
        </Link>
      </span>
      {/* Compact two-line right block: USD (em dash when null) over the
          muted relative time. suppressHydrationWarning: demo timestamps are
          computed at module-load time on both server and client, so a
          minute boundary crossed between SSR and hydration may shift the
          relative label by one step — the client value is the correct one. */}
      <span className="shrink-0 text-right">
        <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">
          {item.usdValue !== null ? formatUsd(item.usdValue) : "—"}
        </span>
        <span
          suppressHydrationWarning
          className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {formatRelativeTime(item.ts)}
        </span>
      </span>
    </div>
  );
}

/**
 * The trades list: rolling window over `items`, always PREVIEW_ROW_COUNT
 * slots. Slot keys swap the row content in place (no remount, no motion);
 * when the backend has fewer rows than the window the missing slots render
 * as honest blank surfaces — same face, no fabricated trades.
 */
function TradeRows({ items }: { items: TradeFeedItem[] }) {
  const rows = useRollingTrades(items);
  return (
    <PreviewRowsRegion>
      {Array.from({ length: PREVIEW_ROW_COUNT }, (_, slot) => {
        const item = rows[slot];
        return item ? (
          <TradeRow key={slot} item={item} />
        ) : (
          <BlankPreviewFace key={slot} />
        );
      })}
    </PreviewRowsRegion>
  );
}

// ---------------------------------------------------------------------------
// Baskets rows — shared by demo and real mode.
// ---------------------------------------------------------------------------

/** "+X.XX%" convention — negatives already carry their own sign. */
function formatReturnPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/**
 * One basket on the exact same fixed-height card face as a trade row
 * (owner feedback, 2026-09-14: "boyutları da aynı yapalım") — same border,
 * same horizontal padding, same 72px height; the two-line NAV/holders
 * content is centered inside it. Hover solidifies the face; a poll that
 * surfaces a different basket at a rank enters with the same slot-scoped
 * fade-up as the trades column.
 */
function BasketRow({ entry, index }: { entry: BasketLeaderboardEntry; index: number }) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  // Identity is the basket pubkey, not the entry object: the leaderboard
  // re-polls every 60s into fresh objects, and unchanged content must not
  // re-animate — only an actual reorder at this rank does.
  useSwapFade(rowRef, entry.basket);
  const positive = entry.returnPct >= 0;
  const nav = entry.nav.trim() === "" ? NaN : Number(entry.nav);
  return (
    <div
      ref={rowRef}
      className="flex flex-col justify-center rounded-xl border border-border/50 bg-card/40 px-3 transition-colors duration-200 hover:border-border hover:bg-card motion-reduce:transition-none"
      style={{ height: PREVIEW_ROW_HEIGHT }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground/70"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          {/* The glyph IS the basket logo here — the demo datasets
              deliberately ship no basket images. */}
          <BasketAvatar basket={entry.basket} />
          <Link
            href={`/basket/${entry.basket}`}
            title={entry.basket}
            className="min-w-0 truncate text-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {entry.basketName ?? truncateAddress(entry.basket, 6, 4)}
          </Link>
        </span>
        <span
          className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
            positive ? "text-[hsl(var(--status-positive))]" : "text-muted-foreground"
          }`}
        >
          {formatReturnPct(entry.returnPct)}
        </span>
      </div>
      <p className="mt-1 truncate font-mono text-[11px] tabular-nums text-muted-foreground">
        NAV {Number.isFinite(nav) ? formatUsd(nav) : "—"} ·{" "}
        {entry.holders} {entry.holders === 1 ? "holder" : "holders"}
      </p>
    </div>
  );
}

/**
 * The baskets list: always PREVIEW_ROW_COUNT slots in the same fixed
 * region as the trades column — real entries first, honest blank surfaces
 * for the rest. Slot keys keep refreshes to an in-place content swap.
 */
function BasketsRows({ items }: { items: BasketLeaderboardEntry[] }) {
  return (
    <PreviewRowsRegion>
      {Array.from({ length: PREVIEW_ROW_COUNT }, (_, index) => {
        const entry = items[index];
        return entry ? (
          <BasketRow key={index} entry={entry} index={index} />
        ) : (
          <BlankPreviewFace key={index} />
        );
      })}
    </PreviewRowsRegion>
  );
}

// ---------------------------------------------------------------------------
// Columns — demo (static labeled datasets) and real (polled resources).
// ---------------------------------------------------------------------------

function DemoTradesColumn() {
  return (
    <div>
      <ColumnHeaderLink label="SAMPLE TRADES" href="/feed" />
      <TradeRows items={DEMO_TRADES} />
    </div>
  );
}

function DemoBasketsColumn() {
  return (
    <div>
      <ColumnHeaderLink label="SAMPLE BASKETS" href="/leaderboard" />
      {/* Row parity (owner feedback, 2026-09-12, footprint-locked
          2026-09-14): the full basket dataset stays available for the demo,
          but the preview surfaces only PREVIEW_ROW_COUNT rows so the two
          columns match exactly. */}
      <BasketsRows items={DEMO_BASKETS.slice(0, PREVIEW_ROW_COUNT)} />
    </div>
  );
}

function TradesColumn({ resource }: { resource: LiveResource<TradeFeedItem[]> }) {
  return (
    <div>
      <ColumnHeaderLink label="LATEST TRADES" href="/feed" />
      {resource.status === "loading" ? (
        <PreviewSkeletonRegion label="Loading latest trades" />
      ) : null}
      {resource.status === "error" ? (
        <PreviewStateBlock>
          <QuietError
            message="Couldn't load the latest trades just now."
            onRetry={resource.retry}
          />
        </PreviewStateBlock>
      ) : null}
      {resource.status === "ready" && resource.data ? (
        resource.data.length === 0 ? (
          <PreviewStateBlock>
            <p className="text-sm leading-6 text-muted-foreground">
              No trades yet — be the first to build one.{" "}
              <Link
                href="/create"
                className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Create an index →
              </Link>
            </p>
          </PreviewStateBlock>
        ) : (
          <TradeRows items={resource.data} />
        )
      ) : null}
    </div>
  );
}

function BasketsColumn({ resource }: { resource: LiveResource<BasketLeaderboardEntry[]> }) {
  return (
    <div>
      <ColumnHeaderLink label="TOP BASKETS" href="/leaderboard" />
      {resource.status === "loading" ? (
        <PreviewSkeletonRegion label="Loading top baskets" />
      ) : null}
      {resource.status === "error" ? (
        <PreviewStateBlock>
          <QuietError
            message="Couldn't load the leaderboard just now."
            onRetry={resource.retry}
          />
        </PreviewStateBlock>
      ) : null}
      {resource.status === "ready" && resource.data ? (
        resource.data.length === 0 ? (
          <PreviewStateBlock>
            <p className="text-sm leading-6 text-muted-foreground">
              The board builds as baskets trade.
            </p>
          </PreviewStateBlock>
        ) : (
          // Row parity (owner feedback, 2026-09-12): cap the preview at
          // PREVIEW_ROW_COUNT rows so the baskets column matches the trades
          // column — BasketsRows pads any shortfall with blank surfaces, so
          // the footprint is identical in every case.
          <BasketsRows items={resource.data.slice(0, PREVIEW_ROW_COUNT)} />
        )
      ) : null}
    </div>
  );
}

/** Real-mode columns — the polling hooks live here so the demo overlay
 *  mounts zero fetching machinery. */
function RealColumns() {
  const trades = useLiveResource(loadRecentTrades, POLL_MS);
  const baskets = useLiveResource(loadTopBaskets, POLL_MS);
  return (
    <>
      <TradesColumn resource={trades} />
      <BasketsColumn resource={baskets} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Section.
// ---------------------------------------------------------------------------

/** The mono chip that keeps the demo overlay honest — small, quiet, and
 *  impossible to mistake for live data. */
function DemoChip() {
  return (
    <span
      title="Synthetic demo data — not live activity"
      className="self-start rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:self-end"
    >
      demo data
    </span>
  );
}

export function LiveProofSection() {
  return (
    <section
      aria-labelledby="proof-heading"
      className="border-t border-border py-16 dark:border-border/60"
    >
      {/* Site rhythm: sibling home sections own their container inside the
          page's centered main (flow: 5xl, ledger: 3xl) — this one spans the
          full 6xl content width. */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          id="proof-heading"
          size="eyebrow"
          index={1}
          label={DEMO ? "DEMO PREVIEW" : "VERIFIED ACTIVITY"}
          lead={
            DEMO
              ? "Illustrative basket and trade examples — not live activity."
              : "What people are building and trading right now."
          }
          right={DEMO ? <DemoChip /> : undefined}
        />
        {/* Equal columns (owner feedback, 2026-09-14): same grid cell per
            column, and both columns render the same fixed-height header +
            fixed-footprint rows region — side by side they are pixel-equal;
            stacked on mobile they obey the same rules. */}
        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          {DEMO ? (
            <>
              <DemoTradesColumn />
              <DemoBasketsColumn />
            </>
          ) : (
            <RealColumns />
          )}
        </div>
        {/* Merged steps strip (owner feedback, 2026-09-12): proof above,
            process below — StepsStrip owns its own internal spacing. */}
        <StepsStrip />
      </div>
    </section>
  );
}
