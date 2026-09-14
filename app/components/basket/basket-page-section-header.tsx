import type { ReactNode } from "react";

/**
 * Shared section-header rhythm for the basket page tabs (About / History /
 * Risk / Thesis): a mono eyebrow micro-label over a display-face title, with
 * the provenance/annotation line pinned right. One component so every section
 * on the page lands on the same baseline grid.
 *
 * Server-compatible (no hooks) — usable from client tabs too.
 */
export function BasketSectionHeader({
  eyebrow,
  title,
  note,
}: {
  eyebrow: string;
  title: string;
  /** Right-aligned annotation (provenance, counts, caveats). */
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-4">
      <div className="space-y-1">
        <p className="section-label">{eyebrow}</p>
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </div>
      {note ? (
        <div className="pb-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
          {note}
        </div>
      ) : null}
    </div>
  );
}
