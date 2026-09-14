import { cn } from "@/lib/utils";

import { CHANGE_DOWN_CLASS, CHANGE_UP_CLASS } from "@/components/stocks/change-value";

/**
 * The ONE micro scale — the `.section-label` terminal voice from globals.css
 * (0.7rem / weight 500 / 0.22em tracking, 1rem line-height). The home/cards
 * eyebrow scale won as the house standard, so the old 10px MicroLabel variant
 * is gone: MicroLabel compiles to this constant and card-frame's
 * MICRO_LABEL_CLASS reuses it, so every micro-label on the site renders at
 * identical pixels. Change the scale here (or in `.section-label`) — never
 * inline.
 */
export const MICRO_LABEL_SCALE =
  "text-[0.7rem] font-medium leading-4 tracking-[0.22em]";

/**
 * MicroLabel — the secondary micro-typography primitive: mono uppercase at
 * the `.section-label` scale (see MICRO_LABEL_SCALE), for `24h`/`30d`/`APY`-
 * style captions, eyebrow lines and table column heads (ui-plan §1
 * "mikro-tipografi").
 *
 * House rule (brand.md): uppercase + tracked labels ALWAYS use Geist Mono —
 * the font-mono here is mandatory, not decorative.
 *
 * positive/negative reuse the ChangeValue direction classes as the single
 * source of truth (imported, not re-declared): --status-positive for up,
 * --destructive for down. Chart hues never encode direction (globals.css
 * 2026-09-12 amendment) — sage/rose stay inside charts/avatars.
 */

type MicroLabelVariant = "default" | "muted" | "positive" | "negative";
type MicroLabelTag = "span" | "div" | "p";

const VARIANT: Record<MicroLabelVariant, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  // Same classes as ChangeValue — direction semantics live in ONE place.
  positive: CHANGE_UP_CLASS,
  negative: CHANGE_DOWN_CLASS,
};

export function MicroLabel({
  variant = "muted",
  as: Tag = "span",
  className,
  children,
}: {
  /** muted is the resting look for secondary labels; default is foreground. */
  variant?: MicroLabelVariant;
  as?: MicroLabelTag;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "font-mono uppercase",
        MICRO_LABEL_SCALE,
        VARIANT[variant],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
