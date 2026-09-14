"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import type { TooltipRow } from "@/components/charts/tooltip/tooltip-content";
import { ChartBlockSkeleton, FreshnessBadge, Skeleton } from "@/components/states";
import { RangePills } from "@/components/basket/basket-page-range-pills";
import {
  fetchSpyBenchmarkCloses,
  numericToNumber,
  type BenchmarkCandle,
  type BenchmarkRange,
  type NavInterval,
  type NavHistoryRow,
} from "@/components/basket/basket-api";
import {
  alignBenchmarkSeries,
  type BenchmarkAlignedPoint,
} from "@/components/basket/basket-benchmark";
import {
  fetchBasketEventMarkers,
  sortMarkers,
  type BasketEventMarker,
  type BasketEventType,
} from "@/components/basket/basket-page-events";
import { BasketEventMarkers, eventMarkerColor } from "@/components/basket/basket-page-event-markers";
import { ChangeValue } from "@/components/stocks/change-value";
import { formatAsOf } from "@/lib/format";

/** Ethereal fill ceiling for the chart-1 area (charts only, per style contract). */
const NAV_FILL_OPACITY = 0.06;

/** Chart range windows mapped onto /nav/history from+interval params. */
export const NAV_RANGES = [
  { key: "1D", fromHours: 24, interval: "5m" as NavInterval },
  { key: "7D", fromHours: 24 * 7, interval: "1h" as NavInterval },
  { key: "30D", fromHours: 24 * 30, interval: "1d" as NavInterval },
  { key: "All", fromHours: null, interval: null },
] as const;
export type NavRangeKey = (typeof NAV_RANGES)[number]["key"];

/**
 * Benchmark fetch window per chart range — Yahoo daily-close ranges accepted
 * by the /market overview endpoint, chosen so the window always brackets the
 * NAV range (1D needs the prior close, All takes the widest available).
 */
const BENCHMARK_RANGE: Record<NavRangeKey, BenchmarkRange> = {
  "1D": "5d",
  "7D": "1mo",
  "30D": "3mo",
  All: "1y",
};

/** Benchmark series styling — muted gray dashed per the brand chart contract. */
const BENCHMARK_COLOR = "hsl(var(--muted-foreground))";
const BENCHMARK_DASH_ARRAY = "6 4";

/** ~200ms series fade (ui-plan §0 rule 4); reduced-motion skips to instant. */
const BENCHMARK_FADE_SECONDS = 0.2;

/** Adaptive USD formatting for the share-price axis/tooltip. */
function makeUsdFormatter(maxValue: number): (value: number) => string {
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: maxValue > 0 && maxValue < 1 ? 3 : 2,
  });
  return (value: number) => fmt.format(value);
}

/** Index-point formatter while the normalized overlay drives the y-axis. */
function formatIndexed(value: number): string {
  return value.toFixed(0);
}

const EVENT_LEGEND: { type: BasketEventType; label: string }[] = [
  { type: "Minted", label: "Mint" },
  { type: "Redeemed", label: "Redeem" },
  { type: "FeeAccrued", label: "Fee accrual" },
];

/**
 * History tab — share-price AreaChart (official Bklit composition, ethereal
 * chart-1 series) with indexer event markers (Minted / Redeemed / FeeAccrued)
 * pinned to the time axis, plus range links and provenance badges.
 *
 * The "vs SPYx" toggle overlays the S&P 500 (SPY) daily closes fetched from
 * the same /market/overview endpoint the /market page renders. Both series
 * are indexed to 100 at the first common point (live NAV vs real market
 * data — never a backtest); the toggle only exists while a real benchmark
 * series is available for the selected range.
 *
 * NAV rows come from the parent (range switch drives the parent's
 * /nav/history fetch); event markers and the benchmark closes are fetched
 * here from REST with honest states: a provenance note, a quiet "no events
 * yet" line, never fabricated markers.
 */
export function BasketPageHistory({
  pubkey,
  navRows,
  navSource,
  navFailed,
  asOf,
  range,
  onRangeChange,
}: {
  pubkey: string;
  navRows: NavHistoryRow[] | null;
  navSource: string | null;
  navFailed: boolean;
  asOf: string | null;
  range: NavRangeKey;
  onRangeChange: (range: NavRangeKey) => void;
}) {
  const data = useMemo(
    () =>
      (navRows ?? [])
        .map((row) => ({
          date: new Date(row.ts),
          price: numericToNumber(row.share_price ?? null),
        }))
        .filter(
          (point): point is { date: Date; price: number } =>
            point.price !== null &&
            point.price > 0 &&
            !Number.isNaN(point.date.getTime()),
        ),
    [navRows],
  );

  const formatUsd = useMemo(() => {
    const max = data.reduce((m, p) => Math.max(m, p.price), 0);
    return makeUsdFormatter(max);
  }, [data]);

  // ---- vs SPYx benchmark (optional overlay, never fabricated) ----
  // SPY daily closes from the same /market/overview endpoint the /market page
  // renders, re-fetched per range. Failure or an empty feed degrades to
  // "toggle hidden" — the NAV chart is never blocked by the benchmark.
  const [benchCandles, setBenchCandles] = useState<BenchmarkCandle[] | null>(null);
  const [benchLastCloseTs, setBenchLastCloseTs] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setBenchCandles(null);
    setBenchLastCloseTs(null);

    async function load() {
      try {
        const candles = await fetchSpyBenchmarkCloses(BENCHMARK_RANGE[range], controller.signal);
        setBenchCandles(candles);
        setBenchLastCloseTs(candles.length > 0 ? candles[candles.length - 1].ts : null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setBenchCandles([]);
      }
    }

    void load();
    return () => controller.abort();
  }, [range]);

  // NAV points aligned onto the benchmark closes, both indexed to 100 at the
  // first common point. null ⇒ the overlay does not exist for this window.
  const benchSeries = useMemo<BenchmarkAlignedPoint[] | null>(() => {
    if (benchCandles === null || benchCandles.length === 0) return null;
    return alignBenchmarkSeries(
      data.map((point) => ({ ts: point.date.getTime(), price: point.price })),
      benchCandles,
    );
  }, [benchCandles, data]);
  const benchAvailable = benchSeries !== null;

  // Toggle + ~200ms opacity fade of the overlay (instant under reduced motion).
  // `benchFade` drives the stroke alpha so the fade plays on the SVG path
  // itself, and the plotted data stays normalized until the fade-out settles.
  const [benchOn, setBenchOn] = useState(false);
  const [benchFade, setBenchFade] = useState(0);
  const benchFadeRef = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const target = benchOn ? 1 : 0;
    if (reducedMotion) {
      benchFadeRef.current = target;
      setBenchFade(target);
      return;
    }
    const controls = animate(benchFadeRef.current, target, {
      duration: BENCHMARK_FADE_SECONDS,
      ease: "easeOut",
      onUpdate: (value) => {
        benchFadeRef.current = value;
        setBenchFade(value);
      },
    });
    return () => controls.stop();
  }, [benchOn, reducedMotion]);

  // A range switch can drop the benchmark out of coverage — reset the toggle
  // instead of leaving a pressed button with nothing behind it. Both fetches
  // must have settled first, so transient loading never kills the toggle.
  useEffect(() => {
    if (benchCandles !== null && navRows !== null && !benchAvailable && benchOn) {
      setBenchOn(false);
    }
  }, [benchCandles, navRows, benchAvailable, benchOn]);

  // Overlay drives the plotted data only while its fade is visible; the
  // primary Area keeps its "price" dataKey across the switch so the chart
  // never remounts — the y-domain tween carries USD → indexed instead.
  const overlayActive = benchSeries !== null && benchFade > 0;
  const lastBenchPoint = benchSeries !== null ? benchSeries[benchSeries.length - 1] : null;

  const plotData = useMemo(
    () => (overlayActive && benchSeries ? benchSeries : data),
    [overlayActive, benchSeries, data],
  );

  // ---- event markers (REST, abortable, re-fetched per pubkey) ----
  const [markers, setMarkers] = useState<BasketEventMarker[] | null>(null);
  const [eventsSource, setEventsSource] = useState<string | null>(null);
  const [eventsNote, setEventsNote] = useState<string | null>(null);
  const [eventsFailed, setEventsFailed] = useState(false);
  const [eventsReloadKey, setEventsReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setMarkers(null);
    setEventsFailed(false);
    setEventsNote(null);

    async function load() {
      try {
        const res = await fetchBasketEventMarkers(pubkey, controller.signal);
        setMarkers(sortMarkers(res.markers));
        setEventsSource(res.source);
        setEventsNote(res.note);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setMarkers([]);
        setEventsFailed(true);
      }
    }

    void load();
    return () => controller.abort();
  }, [pubkey, eventsReloadKey]);

  const markerCounts = useMemo(() => {
    const counts = new Map<BasketEventType, number>();
    for (const marker of markers ?? []) {
      counts.set(marker.type, (counts.get(marker.type) ?? 0) + 1);
    }
    return counts;
  }, [markers]);

  // Expand toggle — ~1.6x chart height for a longer look at the series.
  // The height lives on every panel state (loading/empty/chart) so the card
  // never jumps when toggling; the transition is disabled under reduced motion.
  const [expanded, setExpanded] = useState(false);
  const chartHeightClass = expanded ? "h-[512px]" : "h-[320px]";

  // Tooltip: USD share price normally; both indexed series while the overlay
  // is up. The benchmark row reads the value sampled at the nearest close to
  // the hovered snapshot — the two rows always describe the same date.
  const tooltipRows = (point: Record<string, unknown>): TooltipRow[] => {
    const rows: TooltipRow[] = [
      {
        color: "hsl(var(--chart-1))",
        label: overlayActive ? "Basket" : "Share price",
        value:
          typeof point.price === "number" && Number.isFinite(point.price)
            ? overlayActive
              ? point.price.toFixed(2)
              : formatUsd(point.price)
            : "—",
      },
    ];
    if (overlayActive) {
      rows.push({
        color: BENCHMARK_COLOR,
        label: "SPYx",
        value:
          typeof point.spyx === "number" && Number.isFinite(point.spyx)
            ? point.spyx.toFixed(2)
            : "—",
      });
    }
    return rows;
  };

  // Benchmark stroke carries the toggle fade as an alpha on the
  // muted-foreground token — the SVG path opacity animates without a wrapper.
  const benchmarkStroke = `hsl(var(--muted-foreground) / ${Math.min(
    1,
    Math.max(0, benchFade),
  ).toFixed(3)})`;

  return (
    <section aria-label="Share price history" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="space-y-1">
          <p className="section-label">NAV snapshots</p>
          <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
            Share price history
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-0.5">
          <FreshnessBadge source={navSource ?? "onchain-indexed"} asOf={asOf ?? undefined} />
          <RangePills
            options={NAV_RANGES.map((r) => ({ value: r.key, label: r.key }))}
            value={range}
            onChange={onRangeChange}
          />
          {/* vs SPYx overlay toggle — visible only while a real benchmark
              series exists for this range; hidden entirely otherwise. */}
          {benchAvailable ? (
            <button
              type="button"
              aria-pressed={benchOn}
              onClick={() => setBenchOn((v) => !v)}
              title={
                benchOn
                  ? "Hide the SPYx benchmark overlay"
                  : "Overlay S&P 500 (SPY) daily closes — both series indexed to 100 at the window start"
              }
              className={`max-md:min-h-10 rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none ${
                benchOn
                  ? "border-transparent bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
              }`}
            >
              vs SPYx
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Collapse the chart" : "Expand the chart to ~1.6x height"}
            className="max-md:min-h-10 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      <div className="hairline-primary rounded-xl bg-card ring-1 ring-border">
        <div className="p-5">
          {/* Micro change line — only while the overlay is visible, fading with
              it. Basket % comes from ChangeValue (the single direction-color
              source); the benchmark stays muted gray, never direction-colored. */}
          {benchSeries && benchFade > 0 && lastBenchPoint ? (
            <div
              className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1"
              style={{ opacity: benchFade }}
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground">
                Basket
              </span>
              <ChangeValue changePct={lastBenchPoint.price - 100} />
              <span aria-hidden="true" className="font-mono text-[11px] text-muted-foreground">
                ·
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                SPYx
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {lastBenchPoint.spyx >= 0 ? "+" : ""}
                {(lastBenchPoint.spyx - 100).toFixed(2)}%
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                ({range})
              </span>
            </div>
          ) : null}
          {navRows === null ? (
            <div className={`${chartHeightClass} w-full`}>
              <ChartBlockSkeleton label="Loading share price history" />
            </div>
          ) : navFailed ? (
            <div className={`flex ${chartHeightClass} items-center justify-center px-6`}>
              <p className="text-center font-mono text-xs text-muted-foreground">
                Share price history unavailable — switching ranges or reloading retries
              </p>
            </div>
          ) : data.length < 2 ? (
            <div className={`flex ${chartHeightClass} w-full items-center justify-center px-6`} data-slot="basket-nav-chart">
              <p className="text-center font-mono text-xs text-muted-foreground">
                {data.length === 0
                  ? "No share-price snapshots indexed yet"
                  : "One snapshot indexed — a line appears at two"}
              </p>
            </div>
          ) : (
            <div
              className={`${chartHeightClass} w-full transition-[height] duration-200 motion-reduce:transition-none`}
              data-slot="basket-nav-chart"
            >
              <AreaChart
                data={plotData}
                xDataKey="date"
                fitYDomain
                margin={{ top: 12, right: 16, bottom: 28, left: 64 }}
                className="h-full w-full"
              >
                <Grid horizontal />
                <Area
                  dataKey="price"
                  fill="hsl(var(--chart-1))"
                  stroke="hsl(var(--chart-1))"
                  fillOpacity={NAV_FILL_OPACITY}
                  strokeWidth={2}
                />
                {/* Benchmark overlay: line-only (never an area fill, B1), muted
                    gray dashed; opacity rides the ~200ms toggle fade through
                    the stroke alpha. */}
                {overlayActive && benchSeries ? (
                  <Area
                    dataKey="spyx"
                    fill={benchmarkStroke}
                    stroke={benchmarkStroke}
                    fillOpacity={0}
                    strokeWidth={1.5}
                    dashFromIndex={0}
                    dashArray={BENCHMARK_DASH_ARRAY}
                  />
                ) : null}
                {/* Fresh baskets have very few snapshots — cap ticks so the
                    x-axis labels never crowd. */}
                <XAxis numTicks={Math.min(5, Math.max(2, plotData.length))} />
                <YAxis
                  numTicks={5}
                  formatValue={overlayActive ? formatIndexed : formatUsd}
                />
                {markers !== null && markers.length > 0 ? (
                  <BasketEventMarkers markers={markers} />
                ) : null}
                <ChartTooltip rows={tooltipRows} />
              </AreaChart>
            </div>
          )}
        </div>

        {/* event marker strip — legend + provenance, honest when empty */}
        <div className="border-t border-border px-5 py-3">
          {markers === null ? (
            <div className="flex items-center gap-2" aria-busy="true">
              <span className="sr-only">Loading on-chain events</span>
              <Skeleton className="h-3 w-44" />
              <Skeleton className="h-3 w-24" />
            </div>
          ) : eventsFailed ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Event markers unavailable —{" "}
              <button
                type="button"
                onClick={() => setEventsReloadKey((k) => k + 1)}
                className="underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                retry
              </button>{" "}
              reloads the events API
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {EVENT_LEGEND.map(({ type, label }) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                    title={`${type} events on the time axis`}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block size-1.5 rounded-full"
                      style={{ backgroundColor: eventMarkerColor(type) }}
                    />
                    {label}
                    <span className="tabular-nums">{markerCounts.get(type) ?? 0}</span>
                  </span>
                ))}
              </div>
              <FreshnessBadge source={eventsSource ?? ""} />
            </div>
          )}
          {eventsNote ? (
            <p className="mt-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
              {eventsNote}
            </p>
          ) : null}
          {benchAvailable && benchLastCloseTs !== null ? (
            <p className="mt-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
              vs SPYx: S&amp;P 500 (SPY) daily closes · Yahoo Finance — sampled at the nearest
              close, both series indexed to 100 at the window start. Live snapshots vs market
              data, not a backtest. Last close {formatAsOf(benchLastCloseTs)}.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default BasketPageHistory;
