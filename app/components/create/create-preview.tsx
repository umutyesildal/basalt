"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { formatBpsAsPercent, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CreatePreviewDonut, type CreatePreviewSlice } from "./create-preview-donut";
import type { ConstituentDraft } from "./types";

/** Same palette cycling as the basket About page composition donut. */
function sliceColor(index: number): string {
  return `hsl(var(--chart-${(index % 5) + 1}))`;
}

export interface CreatePreviewProps {
  name: string;
  constituents: ConstituentDraft[];
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  /** Live sum of weightBps — the exact value step-2 validation checks. */
  weightSum: number;
  /** True when weightSum === 10,000 (mirrors the wizard's weights validity). */
  weightsValid: boolean;
  /** Reference-price source for the seed estimate label (may be null). */
  priceSource?: string | null;
  className?: string;
}

/**
 * Live preview panel body (Dalga 2 — Cesto /labs/create "Allocation Breakdown"
 * kalıbı, monochrome uygulama). Everything renders from wizard state only —
 * no fabricated data: an empty selection shows an honest empty ring, the
 * weight total is displayed as a percentage with the same warning
 * language as the WeightsEditor, and the seed estimate appears only once seed
 * amounts exist and is labeled as a reference estimate.
 */
function CreatePreviewContent({
  name,
  constituents,
  entryFeeBps,
  exitFeeBps,
  managementFeeBps,
  weightSum,
  weightsValid,
  priceSource,
}: CreatePreviewProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Colors track the constituent's position in the list (About-page parity),
  // so re-weights never reshuffle a ticker's hue.
  const slices = useMemo<CreatePreviewSlice[]>(
    () =>
      constituents
        .map((c, index) => ({
          key: c.mint,
          label: c.ticker,
          value: c.weightBps,
          color: sliceColor(index),
        }))
        .filter((s) => s.value > 0),
    [constituents],
  );

  // Reference seed estimate — same math as SeedPreview's total row: only when
  // every row is priced; missing prices render an honest em dash.
  const seeded = constituents.some((c) => c.seedRaw > 0n);
  const allPriced =
    constituents.length > 0 &&
    constituents.every(
      (c) => c.priceRef !== null && c.priceRef !== undefined && Number.isFinite(c.priceRef) && c.priceRef > 0,
    );
  const estSeedValue =
    seeded && allPriced
      ? constituents.reduce(
          (acc, c) => acc + (Number(c.seedRaw) / 10 ** c.decimals) * (c.priceRef as number),
          0,
        )
      : null;

  const feeRows: [string, number, string | null][] = [
    ["Entry", entryFeeBps, null],
    ["Exit", exitFeeBps, null],
    ["Mgmt", managementFeeBps, "/yr"],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">
        <p className="section-label">Live preview</p>
        <p
          className={cn(
            "font-display mt-1 truncate text-base font-medium",
            !name.trim() && "text-muted-foreground",
          )}
        >
          {name.trim() || "Untitled basket"}
        </p>
      </div>

      {constituents.length === 0 ? (
        <p className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5 font-mono text-[11px] leading-5 text-muted-foreground">
          Select assets to preview their mix.
        </p>
      ) : (
        <>
          <div className="flex flex-col items-center">
            <CreatePreviewDonut
              slices={slices}
              hoveredKey={hoveredKey}
              onHoverChange={setHoveredKey}
            />
          </div>

          <ul className="divide-y divide-border/60" aria-label="Allocation breakdown">
            {constituents.map((c, index) => (
              <li
                key={c.mint}
                onMouseEnter={() => setHoveredKey(c.mint)}
                onMouseLeave={() => setHoveredKey(null)}
                className={cn(
                  "flex items-center justify-between gap-2 py-1.5 transition-opacity duration-150",
                  hoveredKey !== null && hoveredKey !== c.mint && "opacity-50",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: sliceColor(index) }}
                  />
                  <span className="truncate font-mono text-xs font-medium text-foreground">
                    {c.ticker}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono text-xs tabular-nums",
                    c.weightBps === 0 ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {formatBpsAsPercent(c.weightBps)}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Total
            </span>
            <span
              className={cn(
                "font-mono text-xs tabular-nums",
                weightsValid ? "text-foreground" : "text-destructive",
              )}
            >
              {formatBpsAsPercent(weightSum)} / 100%
            </span>
          </div>
        </>
      )}

      <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3">
        {feeRows.map(([label, value, suffix]) => (
          <div key={label} className="min-w-0">
            <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {label}
            </dt>
            <dd className="mt-0.5 truncate font-mono text-sm tabular-nums text-foreground">
              {formatBpsAsPercent(value)}
              {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      {seeded && (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Est. seed value
          </span>
          {estSeedValue !== null ? (
            <span
              className="font-mono text-xs tabular-nums text-foreground"
              title={priceSource ? `Reference estimate — ${priceSource}` : undefined}
            >
              {formatUsd(estSeedValue)} <span className="text-muted-foreground">(ref.)</span>
            </span>
          ) : (
            <span className="font-mono text-xs tabular-nums text-muted-foreground" title="Some tokens have no reference price yet">
              price unavailable
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Desktop shell — lives in the wizard's right column, sticky via its parent. */
export function CreatePreviewCard(props: CreatePreviewProps) {
  return (
    <aside
      aria-label="Live basket preview"
      className={cn("rounded-xl border border-border bg-card p-5", props.className)}
    >
      <CreatePreviewContent {...props} />
    </aside>
  );
}

/**
 * Mobile shell — a collapsed summary line inside the step flow; expanding it
 * reveals the same live content. Native <details> keeps it keyboard operable
 * with zero JS.
 */
export function CreatePreviewCollapsible(props: CreatePreviewProps) {
  const count = props.constituents.length;
  return (
    <details className={cn("group rounded-xl border border-border bg-card lg:hidden", props.className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="section-label">Preview</span>
        <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
          {count > 0
            ? `${count} ${count === 1 ? "asset" : "assets"} · ${props.weightsValid ? "100%" : `${formatBpsAsPercent(props.weightSum)} of 100%`}`
            : "No assets yet"}
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="border-t border-border px-4 pb-4 pt-3">
        <CreatePreviewContent {...props} />
      </div>
    </details>
  );
}
