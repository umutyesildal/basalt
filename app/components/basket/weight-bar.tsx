"use client";

import { useState } from "react";

import { logoUrl } from "@/lib/logos";
import { tickerColor } from "@/lib/ticker-color";
import { cn } from "@/lib/utils";

/**
 * WeightBar — the Stax weight strip (docs/stax-analiz/05 §5.3 / §5.8): one
 * horizontal band of blocks whose widths are proportional to constituent
 * weights (`flex-grow: weight`), each block filled with the constituent's
 * color, carrying its logo + mono symbol.
 *
 * Color contract (owner feedback 2026-09-15 — calm + stable): a constituent
 * without an explicit color takes `tickerColor(symbol)` — a deterministic
 * muted hue, so the same ticker is the same color in every basket, every
 * view (lib/ticker-color.ts). The logo-derived variant is documented there;
 * the Parqet CDN's missing CORS header rules it out client-side. Logos come from the Parqet CDN (app/lib/logos.ts);
 * on load failure the block drops to the same letter-chip fallback pattern
 * (deterministic initials on neutral chrome — "logo chips sit on neutral
 * chrome so brand marks float clean").
 *
 * Contrast note: chart fills are mid-luminance in BOTH themes (deepened on
 * white, luminous on the near-black flagship), so label text uses
 * `text-background` — the canvas color itself — which sits on the opposite
 * end of the luminance range from every chart fill in either theme.
 *
 * Accessibility: the strip is a single role="img" with the full composition
 * as its aria-label; per-block labels collapse under it (blocks keep hover
 * titles). Weights under 8% hide their symbol label (too narrow to read);
 * under 5% they also hide the logo (the block is narrower than the mark —
 * rendering it would only clip). title/aria carry the figure either way.
 */

/** One constituent slice. Weight is a plain percent (45 → 45% of the strip). */
export interface WeightBarConstituent {
  symbol: string;
  /** Percent weight; strip width scales with it. Sum need not equal 100. */
  weight: number;
  /** Explicit constituent color (any CSS color); falls back to --chart-1..5 in order. */
  color?: string | null;
  /** Logo URL override; defaults to the Parqet CDN via logoUrl(). */
  logoUrl?: string | null;
}

export interface WeightBarProps {
  constituents: WeightBarConstituent[];
  /** Render the optional % legend row under the strip. Off by default. */
  legend?: boolean;
  className?: string;
}


/** Below this weight the symbol label hides (block too narrow to read). */
const SYMBOL_MIN_WEIGHT = 8;
/** Below this weight the logo hides too (block narrower than the mark). */
const LOGO_MIN_WEIGHT = 5;

/** Strip height lives inside the 28–36px window from the Stax spec. */
const STRIP_CLASS =
  "flex h-8 gap-px overflow-hidden rounded-md" as const;

/** Percent figure with at most one decimal ("45", "7.5") — for labels + aria. */
function formatWeightPct(weight: number): string {
  const rounded = Math.round(weight * 10) / 10;
  return String(rounded);
}

/** Deterministic two-letter initials for the logo-failure chip ("NVDAx" → "NV"). */
function blockInitials(symbol: string): string {
  const letters = symbol.replace(/[^A-Za-z0-9]/g, "");
  return (letters.slice(0, 2) || "·").toUpperCase();
}

/**
 * One weight block: solid constituent color, logo + mono symbol. The logo
 * follows the composition-chips pattern — real mark first, letter chip on
 * load failure — with neutral-chrome initials so they read on any hue.
 */
function WeightBlock({
  constituent,
  color,
}: {
  constituent: WeightBarConstituent;
  color: string;
}) {
  const { symbol, weight } = constituent;
  const [failed, setFailed] = useState(false);
  const showSymbol = weight >= SYMBOL_MIN_WEIGHT;
  const showLogo = weight >= LOGO_MIN_WEIGHT;

  return (
    <div
      title={`${symbol} ${formatWeightPct(weight)}%`}
      aria-hidden="true"
      style={{
        flexGrow: weight,
        flexBasis: 0,
        minWidth: 0,
        backgroundColor: color,
      }}
      className="flex min-w-0 items-center gap-1 overflow-hidden px-1"
    >
      {showLogo && !failed ? (
        // Plain <img> on purpose: external CDN origin, skip next/image.
        <img
          src={constituent.logoUrl ?? logoUrl(symbol)}
          alt=""
          width={14}
          height={14}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-3.5 w-3.5 shrink-0 rounded-full object-cover"
        />
      ) : null}
      {showLogo && failed ? (
        // Letter-chip fallback on neutral chrome (composition-chips pattern).
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-background/80 font-mono text-[6px] font-semibold leading-none text-foreground">
          {blockInitials(symbol)}
        </span>
      ) : null}
      {showSymbol ? (
        <span className="truncate font-mono text-[9px] font-semibold uppercase leading-none tracking-wide text-background">
          {symbol}
        </span>
      ) : null}
    </div>
  );
}

/** Legend row item: color dot + mono micro "SYM 45%". */
function LegendItem({
  constituent,
  color,
}: {
  constituent: WeightBarConstituent;
  color: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        style={{ backgroundColor: color }}
        className="h-1.5 w-1.5 shrink-0 rounded-full"
      />
      <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
        {constituent.symbol} {formatWeightPct(constituent.weight)}%
      </span>
    </span>
  );
}

/**
 * The weight strip. Zero/non-finite weights never render (no phantom blocks);
 * the aria-label carries every figure exactly once.
 */
export function WeightBar({ constituents, legend = false, className }: WeightBarProps) {
  const slices = constituents.filter(
    (c) => Number.isFinite(c.weight) && c.weight > 0,
  );
  if (slices.length === 0) return null;

  const ariaLabel = `Composition: ${slices
    .map((c) => `${c.symbol} ${formatWeightPct(c.weight)}%`)
    .join(", ")}`;

  return (
    <div className={cn("min-w-0", className)}>
      <div role="img" aria-label={ariaLabel} className={STRIP_CLASS}>
        {slices.map((c, i) => (
          <WeightBlock
            key={`${c.symbol}-${i}`}
            constituent={c}
            color={c.color ?? tickerColor(c.symbol)}
          />
        ))}
      </div>
      {legend ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {slices.map((c, i) => (
            <LegendItem
              key={`${c.symbol}-${i}`}
              constituent={c}
              color={c.color ?? tickerColor(c.symbol)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
