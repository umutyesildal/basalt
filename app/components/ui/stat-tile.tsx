import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { MicroLabel } from "./micro-label";

/**
 * StatTile — compact labeled statistic: MicroLabel caption + mono tabular
 * value + optional right-aligned delta. The drop-in shape behind
 * MetricCardSkeleton (components/states/skeleton.tsx): label bar + value bar.
 *
 * Surface decision (card tokens, brand.md layout rules):
 *   card  — full card face: rounded-xl border bg-card + compact p-4 padding
 *           (the canonical p-5 in card.tsx stays for full cards; a tile is
 *           denser by definition).
 *   flush — no surface at all, for tiles that live INSIDE an existing card's
 *           grid rows (the parent already draws the chrome). Default choice
 *           when composing; never stack a tile inside a Card.
 *
 * Numbers are Geist Mono tabular (brand.md); delta accepts any node —
 * typically <ChangeValue changePct={…} /> so direction coloring stays
 * single-sourced.
 */

type StatTileVariant = "card" | "flush";

const SURFACE: Record<StatTileVariant, string> = {
  card: "rounded-xl border border-border bg-card p-4",
  flush: "",
};

export function StatTile({
  label,
  value,
  delta,
  variant = "card",
  labelVariant = "muted",
  valueClassName,
  className,
}: {
  /** Caption rendered as a MicroLabel ("NAV", "24h", "Holders"). */
  label: ReactNode;
  /** The number itself — mono tabular by default; format at the caller. */
  value: ReactNode;
  /** Optional right-aligned delta node, e.g. <ChangeValue changePct={1.24} />. */
  delta?: ReactNode;
  variant?: StatTileVariant;
  /** MicroLabel variant passthrough (positive/negative follow ChangeValue). */
  labelVariant?: "default" | "muted" | "positive" | "negative";
  className?: string;
  /** Escape hatch for the value (e.g. text-2xl for hero-adjacent tiles). */
  valueClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", SURFACE[variant], className)}>
      <MicroLabel variant={labelVariant}>{label}</MicroLabel>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "font-mono text-xl leading-6 font-medium tabular-nums text-foreground",
            valueClassName,
          )}
        >
          {value}
        </span>
        {delta != null ? (
          <span className="font-mono text-xs tabular-nums">{delta}</span>
        ) : null}
      </div>
    </div>
  );
}
