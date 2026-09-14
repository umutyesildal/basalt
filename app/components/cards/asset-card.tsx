"use client";

import Link from "next/link";
import { useState } from "react";

import { tickerAvatarIndex, tickerInitials } from "@/components/cards/composition-chips";
import { CARD_LINK_CLASS, MICRO_LABEL_CLASS, StatCell } from "@/components/cards/card-frame";
import { MiniSparkline } from "@/components/cards/sparkline";
import { ChangeValue } from "@/components/stocks/change-value";
import { logoUrl } from "@/lib/logos";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Fallback letter-chip palette — the same five ethereal chart tokens as
 * composition-chips (ui-plan §0), so a ticker without a logo lands on the
 * same hue everywhere (chips row, card headline). The slot itself comes from
 * the shared tickerAvatarIndex hash.
 */
const FALLBACK_TOKEN_CLASSES = [
  // chart-1 sage · chart-2 rose · chart-3 powder blue · chart-4 sand · chart-5 lavender
  "text-[hsl(var(--chart-1))] bg-[hsl(var(--chart-1)/0.14)] border-[hsl(var(--chart-1)/0.45)]",
  "text-[hsl(var(--chart-2))] bg-[hsl(var(--chart-2)/0.14)] border-[hsl(var(--chart-2)/0.45)]",
  "text-[hsl(var(--chart-3))] bg-[hsl(var(--chart-3)/0.14)] border-[hsl(var(--chart-3)/0.45)]",
  "text-[hsl(var(--chart-4))] bg-[hsl(var(--chart-4)/0.14)] border-[hsl(var(--chart-4)/0.45)]",
  "text-[hsl(var(--chart-5))] bg-[hsl(var(--chart-5)/0.14)] border-[hsl(var(--chart-5)/0.45)]",
] as const;

/** Fixed 28px logo cell — reserved up front so the headline never shifts. */
const LOGO_CELL_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-muted";
const FALLBACK_CHIP_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold leading-none";

/**
 * Headline avatar (owner feedback 2026-09-14: "bunlara doğru LOGOLARI
 * koyalım tesla nvidia falan") — the issuer's real logo from the Parqet CDN
 * (app/lib/logos.ts; SPYx resolves to the SPY mark via the trailing-x strip),
 * dropping to the ethereal two-letter chip on load failure. Same fallback
 * spirit as composition-chips: neutral chrome for logos, deterministic
 * ethereal hue for letters.
 */
function TickerLogo({ ticker }: { ticker: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        title={ticker}
        aria-hidden="true"
        className={cn(FALLBACK_CHIP_CLASS, FALLBACK_TOKEN_CLASSES[tickerAvatarIndex(ticker)])}
      >
        {tickerInitials(ticker)}
      </span>
    );
  }

  return (
    <span title={ticker} aria-hidden="true" className={LOGO_CELL_CLASS}>
      {/* Plain <img> on purpose: external origin, skip next/image optimization. */}
      <img
        src={logoUrl(ticker)}
        alt=""
        width={28}
        height={28}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

/** Direction hue for the mini chart: the 7d figure decides (≥ 0 green, < 0 red); the series endpoints are the same closes, so they deputize when the figure is missing. */
function sparklineTone(change7d: number | null, series: number[]): "up" | "down" {
  if (change7d !== null) return change7d >= 0 ? "up" : "down";
  if (series.length >= 2) return series[series.length - 1] >= series[0] ? "up" : "down";
  return "up";
}

/**
 * Shared asset card — same card anatomy as the basket card, for single
 * tokenized instruments (/stocks, /etfs): [logo] ticker headline, one-line
 * context (company/ETF name when known, else the provider label — never a
 * fabricated name), mono token price, and a bottom row with a 7-session
 * sparkline plus 24h/7d change cells. Owner feedback 2026-09-14: the chart
 * takes its direction color from the 7d change (green ≥ 0, red < 0 — the
 * same tokens ChangeValue uses) instead of the yellow chart-1 data hue, and
 * the headline carries the issuer's real logo. The sparkline slot keeps a
 * fixed 36px surface even when no real series exists, so every card renders
 * at one size; the "7d" cell then reads "—" (the mini chart must be visible
 * on both listings, real data only).
 */
export interface AssetCardProps {
  href: string;
  /** Display ticker ("TSLAx") — the asset's name-first headline. */
  ticker: string;
  /** Single-line context under the ticker; omitted when nothing is known. */
  context?: string | null;
  /** Top-right micro-label (issuer / data provenance); omitted when empty. */
  meta?: string | null;
  /** Last token price; null renders an em dash, never a guess. */
  price: number | null;
  /** 24h change in percent; the cell is hidden when null. */
  change24h?: number | null;
  /** 7-session (≈7 calendar days) change in percent; null renders "7d —". */
  change7d?: number | null;
  /** Underlying daily closes, oldest → newest; below two points the chart slot stays an empty surface. */
  sparkline?: number[];
}

export function AssetCard({
  href,
  ticker,
  context,
  meta,
  price,
  change24h = null,
  change7d = null,
  sparkline,
}: AssetCardProps) {
  const series = sparkline ?? [];
  const hasSeries = series.length >= 2;
  const tone = sparklineTone(change7d, series);
  return (
    <Link
      href={href}
      title={`Open ${ticker}`}
      className={CARD_LINK_CLASS}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <TickerLogo ticker={ticker} />
          <span className="min-w-0">
            <span className="block truncate font-mono text-base font-semibold text-foreground">
              {ticker}
            </span>
            {context ? (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {context}
              </span>
            ) : null}
          </span>
        </div>
        {meta ? (
          <span
            title="Tokenized instrument issuer"
            className={cn("shrink-0", MICRO_LABEL_CLASS)}
          >
            {meta}
          </span>
        ) : null}
      </div>

      <span className="mt-5 block font-mono text-3xl tabular-nums text-foreground">
        {price !== null ? formatUsd(price) : "—"}
      </span>

      <div className="mt-auto pt-4">
        <div className="flex items-end justify-between gap-3 border-t border-border/60 pt-3">
          {/* Fixed 36px chart slot — reserved even without a series so card height never shifts. */}
          <span
            aria-hidden="true"
            className={cn(
              "block h-9 min-w-0 flex-1",
              !hasSeries && "max-w-[9rem] rounded-sm bg-muted/40",
            )}
          >
            {hasSeries ? (
              <MiniSparkline points={series} tone={tone} className="h-9 w-full" />
            ) : null}
          </span>
          <span className="flex shrink-0 items-end gap-4">
            {change24h !== null ? <StatCell label="24h" changePct={change24h} /> : null}
            <span className="flex flex-col gap-0.5">
              <span className={MICRO_LABEL_CLASS}>7d</span>
              <ChangeValue changePct={change7d} />
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}
