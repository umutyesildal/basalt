import type { ReactNode } from "react";

/**
 * SectionHeader — the shared section header, so pages stop hand-rolling
 * eyebrow + lead + right-slot stacks.
 *
 *   label  Display-face tracked-caps heading text (applies the .text-display
 *          utility from globals.css — the single source of truth for Chakra
 *          Petch caps: weight 600, 0.06em tracking).
 *   lead   One muted line under the label.
 *   right  Right-aligned slot (freshness badge, range buttons). When set, the
 *          header becomes the flex row used by page titles; without it the
 *          header is the plain vertical stack used by home sections.
 *
 * Sizes (all display face via the two utilities):
 *   eyebrow — xs muted tracked caps (section eyebrows, e.g. Flow).
 *   display — xl→2xl foreground tracked caps (inscription lines, e.g. Ledger).
 *   title   — page-title scale via .font-display (the h1 row with `right`).
 */

type SectionHeaderSize = "eyebrow" | "display" | "title";

const LABEL: Record<SectionHeaderSize, string> = {
  eyebrow: "text-display text-xs text-muted-foreground",
  display: "text-display text-xl text-foreground md:text-2xl",
  title: "font-display text-3xl font-semibold text-foreground",
};

const LEAD: Record<SectionHeaderSize, string> = {
  eyebrow: "text-base leading-7",
  display: "text-base leading-7",
  title: "max-w-2xl text-sm leading-6",
};

export function SectionHeader({
  id,
  label,
  lead,
  right,
  index,
  size = "eyebrow",
  as: Tag = "h2",
  className,
}: {
  /** Heading id — pair with a section's aria-labelledby. */
  id?: string;
  label: string;
  /**
   * Optional section number for the editorial "> 01 — LABEL" pattern
   * (Stax-inspired, docs/stax-analiz/05 §5.2). Zero-padded (`index={1}`
   * renders "> 01 —"), and the `>` is plain text in the label, not an
   * icon. When set on the eyebrow size, the label switches from the
   * display face to the mono micro-label (.section-label) — house rule:
   * uppercase tracked micro-labels are ALWAYS mono. Other sizes keep
   * their face and only take the text prefix, so existing callers that
   * omit the prop are pixel-identical to before.
   */
  index?: number;
  lead?: string;
  right?: ReactNode;
  size?: SectionHeaderSize;
  as?: "h1" | "h2";
  /** Overrides the <header> classes when `right` is set. */
  className?: string;
}) {
  const indexedLabel =
    index != null ? `> ${String(index).padStart(2, "0")} — ${label}` : label;
  const labelClass =
    index != null && size === "eyebrow" ? "section-label" : LABEL[size];

  return (
    <header
      className={
        right
          ? (className ?? "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between")
          : className
      }
    >
      <div className={right ? "space-y-1.5" : undefined}>
        <Tag id={id} className={labelClass}>
          {indexedLabel}
        </Tag>
        {lead ? (
          <p
            className={`${LEAD[size]}${right ? "" : " mt-3"} text-muted-foreground`}
          >
            {lead}
          </p>
        ) : null}
      </div>
      {right}
    </header>
  );
}
