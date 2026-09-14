import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { MicroLabel } from "./micro-label";

/**
 * SectionHeading — the eyebrow-first section header pattern: MicroLabel
 * eyebrow, display-face tracked-caps title, optional right-aligned action.
 *
 * Name note: `section-header.tsx` (SectionHeader) already exists and is
 * consumed across home/pages — this file deliberately does NOT touch or
 * replace it. SectionHeading is the mono-eyebrow variant for the Wave-2
 * card/grid upgrades (ui-plan §2); SectionHeader keeps owning page titles
 * and display eyebrows. Pick ONE per section, never nest them.
 *
 * Rhythm: place inside the site container `mx-auto max-w-6xl px-4 sm:px-6`
 * (the "6xl rhythm"); vertical breathing room belongs to the section, not
 * this header. With `right` set the header becomes the end-aligned flex row
 * used above grids (action sits on the baseline of the title, like the
 * range links above Explore).
 */

export function SectionHeading({
  eyebrow,
  title,
  right,
  as: Tag = "h2",
  id,
  className,
}: {
  /** Mono micro-eyebrow above the title, e.g. "01 — PICK". */
  eyebrow: ReactNode;
  /** Display-face tracked-caps title (same scale as SectionHeader "display"). */
  title: ReactNode;
  /** Right-aligned action slot (range links, FreshnessBadge, quiet button). */
  right?: ReactNode;
  as?: "h1" | "h2" | "h3";
  /** Heading id — pair with the section's aria-labelledby. */
  id?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1.5">
        {eyebrow != null ? <MicroLabel>{eyebrow}</MicroLabel> : null}
        <Tag id={id} className="text-display text-xl text-foreground md:text-2xl">
          {title}
        </Tag>
      </div>
      {right}
    </div>
  );
}
