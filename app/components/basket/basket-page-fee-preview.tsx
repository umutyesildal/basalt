"use client";

import type { ReactNode } from "react";

/**
 * Live fee-preview block under a trade amount input. Rows are plain strings
 * computed by the caller with the exact spec math (basalt-v0-spec.md §5–§6:
 * floor(gross × bps / 10_000) for entry, floor(B × bps / 10_000) for exit).
 * HONESTY RULE: pass `rows = null` whenever the input is invalid or a figure
 * cannot be computed from real data — the block disappears entirely rather
 * than showing an estimate it cannot stand behind.
 */

export interface FeePreviewRow {
  label: string;
  value: string;
  /** The outcome row ("net shares") — slightly bolder. */
  emphasis?: boolean;
}

export function TradeFeePreview({
  rows,
  label = "Fee preview",
  footer,
  className = "",
}: {
  rows: FeePreviewRow[] | null;
  label?: string;
  /** Optional quiet footnote under the rows (provenance / rounding note). */
  footer?: ReactNode;
  className?: string;
}) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className={className} data-slot="trade-fee-preview">
      <p className="section-label pb-1.5">{label}</p>
      <dl className="grid gap-1 rounded-xl border border-border bg-muted/20 p-3 font-mono text-xs tabular-nums">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className={row.emphasis ? "font-medium text-foreground" : undefined}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {footer ? (
        <p className="pt-1.5 font-mono text-[11px] leading-4 text-muted-foreground">{footer}</p>
      ) : null}
    </div>
  );
}
