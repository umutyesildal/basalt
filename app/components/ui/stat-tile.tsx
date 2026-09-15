import { Fragment, type ReactNode } from "react";

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

/**
 * StatStrip — single-line horizontal stat band with `·` separators
 * (Stax wave-1 micro-detail, docs/stax-analiz/05 §5 S-5): label + mono value
 * pairs joined by a muted dot, for hero footers, card footer rows and
 * section sub-lines where full tiles would be too heavy. Flat by design —
 * no surface of its own; drop it inside any container or Card.
 *
 * The separators are decorative (aria-hidden), values are mono tabular like
 * StatTile, and delta is the same optional right-hand node contract. Opt-in
 * export — the StatTile API above is untouched.
 */
export function StatStrip({
  items,
  className,
}: {
  items: Array<{
    /** Caption rendered as a MicroLabel ("TVL", "Baskets", "Tokens"). */
    label: ReactNode;
    /** The number itself — mono tabular; format at the caller. */
    value: ReactNode;
    /** Optional inline delta node, e.g. <ChangeValue changePct={1.24} />. */
    delta?: ReactNode;
  }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-x-2 gap-y-1",
        className,
      )}
    >
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span aria-hidden className="font-mono text-muted-foreground">
              ·
            </span>
          ) : null}
          <span className="flex items-baseline gap-1.5">
            <MicroLabel variant="muted">{item.label}</MicroLabel>
            <span className="font-mono text-sm leading-5 font-medium tabular-nums text-foreground">
              {item.value}
            </span>
            {item.delta != null ? (
              <span className="font-mono text-xs tabular-nums">
                {item.delta}
              </span>
            ) : null}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
