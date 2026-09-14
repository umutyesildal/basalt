import { ChangeValue } from "@/components/stocks/change-value";
import { MicroLabel, MICRO_LABEL_SCALE } from "@/components/ui/micro-label";
import { cn } from "@/lib/utils";

/**
 * Shared card frame for the /explore, /stocks and /etfs grids (Cesto-derived
 * card anatomy, monochrome chrome — docs/ui-plan.md §1):
 * the whole card is ONE link, hover gives a slight lift plus a border
 * brighten (no shadow — monochrome chrome, token-only), 150ms ease-out,
 * with a visible focus ring. No interactive element may live inside.
 *
 * Grid rhythm is owned by the pages: `grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
 */
export const CARD_LINK_CLASS = cn(
  // Content-card radius scale: rounded-xl (owner radius rule — chips are md,
  // pills are full; never mixed sm/lg on cards).
  "group flex h-full flex-col rounded-xl border border-border bg-card p-5",
  "transition-[border-color,transform] duration-150 ease-out",
  "hover:-translate-y-0.5 hover:border-primary/60",
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
);

/**
 * Micro-label (ui-plan §1 mikro-tipografi) — the ONE micro scale lives in
 * MICRO_LABEL_SCALE (components/ui/micro-label.tsx, the `.section-label`
 * terminal voice: 0.7rem / weight 500 / 0.22em tracking); this string adds
 * only the chrome on top of it, so AssetCard/BasketCard spans and StatCell's
 * MicroLabel render at identical pixels.
 *
 * StatCell renders the MicroLabel component directly (the scale ships in its
 * base); AssetCard/BasketCard keep consuming this string (their props are
 * frozen). Both resolve to the one recipe below.
 */
export const MICRO_LABEL_CLASS = cn(
  "font-mono uppercase text-muted-foreground",
  MICRO_LABEL_SCALE,
);

/**
 * One 30d/24h stat cell: micro-label over the value. Values are colored via
 * the single-source ChangeValue. The caller hides the whole cell when the
 * figure does not exist — an empty cell is never rendered (no fabrication).
 */
export function StatCell({
  label,
  changePct,
}: {
  label: string;
  /** Percent change; the caller only renders this cell when non-null. */
  changePct: number;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <MicroLabel>{label}</MicroLabel>
      <ChangeValue changePct={changePct} />
    </span>
  );
}

/**
 * Gray vs-SPY delta — deliberately NOT direction-colored: it is a relative
 * comparison against the benchmark, not a directional change (ChangeValue
 * stays the single source for directional figures). Sign always shown.
 */
export function BenchmarkDelta({
  value,
  window: win,
}: {
  value: number | null;
  window: "24h" | "30d";
}) {
  if (value === null) {
    return (
      <span
        className="text-muted-foreground"
        title={`No ${win} comparison — needs both the basket ${win} return and the SPY ${win} close.`}
      >
        —
      </span>
    );
  }
  const positive = value >= 0;
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        positive ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {positive ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}
