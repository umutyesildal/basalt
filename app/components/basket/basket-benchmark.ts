import type { BenchmarkCandle } from "@/components/basket/basket-api";

/**
 * Pure alignment helpers for the History chart's "vs SPYx" benchmark overlay
 * — the honest version of the Cesto "Backtested Performance vs S&P 500"
 * pattern: live NAV snapshots compared with a REAL benchmark series fetched
 * from the same REST endpoint the /market page renders. Nothing is
 * backtested, interpolated or extended: every plotted benchmark value is an
 * actual daily close, and the overlay is hidden entirely when the series is
 * unavailable.
 *
 * Alignment: the benchmark feed is daily while NAV snapshots are bucketed at
 * 5m/1h/1d, so each NAV point samples the benchmark close at the NEAREST
 * candle (binary search; ties prefer the earlier close). Both series are then
 * indexed to 100 at the first common point, which is the only way two
 * different-priced series can share one y-axis.
 */

/**
 * Max distance between a NAV snapshot and its nearest benchmark candle.
 * Points beyond it (e.g. a basket older than the fetched benchmark window,
 * or a feed gap) are excluded from the overlay instead of being pinned to a
 * stale close — a comparison that silently uses last week's close would be
 * a fabrication.
 */
const MAX_SAMPLE_GAP_MS = 5 * 86_400_000;

/** One NAV snapshot reduced to what alignment needs. */
export type BenchmarkNavPoint = { ts: number; price: number };

/**
 * One plotted overlay point: both series normalized to 100 at the first
 * common point. Type alias (not interface) so the object type keeps its
 * implicit index signature for the chart's `Record<string, unknown>[]` data.
 */
export type BenchmarkAlignedPoint = {
  date: Date;
  /** NAV share price / first aligned NAV price × 100. */
  price: number;
  /** Nearest benchmark close / first aligned benchmark close × 100. */
  spyx: number;
};

/**
 * Benchmark close sampled at the candle nearest to `ts` (binary search over
 * the ascending candle list; ties prefer the earlier close). Returns null
 * only for an empty candle list.
 */
export function nearestBenchmarkClose(
  candles: BenchmarkCandle[],
  ts: number,
): { close: number; gapMs: number } | null {
  if (candles.length === 0) return null;
  let low = 0;
  let high = candles.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (candles[mid].ts <= ts) {
      low = mid;
    } else {
      high = mid;
    }
  }
  const before = candles[low];
  const after = candles[high];
  const gapBefore = Math.abs(ts - before.ts);
  const gapAfter = Math.abs(after.ts - ts);
  return gapBefore <= gapAfter
    ? { close: before.close, gapMs: gapBefore }
    : { close: after.close, gapMs: gapAfter };
}

/**
 * Align the NAV series onto the benchmark closes and index both to 100 at
 * the first common point. NAV points with no benchmark candle within
 * MAX_SAMPLE_GAP_MS are dropped, so the overlay only ever covers the window
 * where both series genuinely exist. Returns null when fewer than two
 * aligned points remain — callers hide the toggle rather than draw a
 * one-point "comparison".
 */
export function alignBenchmarkSeries(
  navPoints: BenchmarkNavPoint[],
  candles: BenchmarkCandle[],
): BenchmarkAlignedPoint[] | null {
  if (navPoints.length < 2 || candles.length === 0) return null;

  const aligned: { date: Date; nav: number; spy: number }[] = [];
  for (const point of navPoints) {
    const sample = nearestBenchmarkClose(candles, point.ts);
    if (sample === null || sample.gapMs > MAX_SAMPLE_GAP_MS) continue;
    aligned.push({
      date: new Date(point.ts),
      nav: point.price,
      spy: sample.close,
    });
  }
  if (aligned.length < 2) return null;

  const navBase = aligned[0].nav;
  const spyBase = aligned[0].spy;
  if (!(navBase > 0) || !(spyBase > 0)) return null;

  return aligned.map((point) => ({
    date: point.date,
    price: (point.nav / navBase) * 100,
    spyx: (point.spy / spyBase) * 100,
  }));
}
