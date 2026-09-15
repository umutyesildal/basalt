"use client";

import { useState } from "react";

import { logoUrl } from "@/lib/logos";
import { cn } from "@/lib/utils";

/**
 * Composition avatar-chips (Cesto card anatomy, docs/ui-plan.md §1): one
 * circle per constituent. Primary render is the issuer's real logo from the
 * Parqet CDN (app/lib/logos.ts — owner feedback 2026-09-14, "harf
 * kısaltmaları yerine gerçek logolar"); the ticker-hash ethereal letter chip
 * is only the offline/error FALLBACK and keeps its original color logic
 * unchanged (deterministic per ticker, string hash, five fixed tokens, order
 * per ui-plan §0: chart-1 sage · chart-2 rose · chart-3 blue · chart-4 sand ·
 * chart-5 lavender). Logo chips sit on neutral chrome (muted bg + hairline
 * border) so brand marks float clean; the brand colors themselves are the
 * color variety. Chips live inside data territory, so chart hues stay
 * sanctioned for the fallback.
 *
 * Since the Stax WeightBar landed (components/basket/weight-bar.tsx), these
 * chips are the WEIGHTS-LESS composition render: BasketCard shows the weight
 * strip when weight data exists and these chips only when it does not — the
 * two never stack (one card, one composition representation). This module's
 * API is frozen: AssetCard imports tickerAvatarIndex/tickerInitials from here.
 */
const AVATAR_TOKENS = [
  {
    // chart-1 — sage
    text: "text-[hsl(var(--chart-1))]",
    bg: "bg-[hsl(var(--chart-1)/0.14)]",
    border: "border-[hsl(var(--chart-1)/0.45)]",
  },
  {
    // chart-2 — rose
    text: "text-[hsl(var(--chart-2))]",
    bg: "bg-[hsl(var(--chart-2)/0.14)]",
    border: "border-[hsl(var(--chart-2)/0.45)]",
  },
  {
    // chart-3 — powder blue
    text: "text-[hsl(var(--chart-3))]",
    bg: "bg-[hsl(var(--chart-3)/0.14)]",
    border: "border-[hsl(var(--chart-3)/0.45)]",
  },
  {
    // chart-4 — sand
    text: "text-[hsl(var(--chart-4))]",
    bg: "bg-[hsl(var(--chart-4)/0.14)]",
    border: "border-[hsl(var(--chart-4)/0.45)]",
  },
  {
    // chart-5 — lavender
    text: "text-[hsl(var(--chart-5))]",
    bg: "bg-[hsl(var(--chart-5)/0.14)]",
    border: "border-[hsl(var(--chart-5)/0.45)]",
  },
] as const;

/** Deterministic ticker → palette slot. Same ticker always gets the same hue. */
export function tickerAvatarIndex(ticker: string): number {
  let hash = 0;
  for (let i = 0; i < ticker.length; i += 1) {
    hash = (hash * 31 + ticker.charCodeAt(i)) >>> 0;
  }
  return hash % AVATAR_TOKENS.length;
}

/** Two-letter abbreviation for the avatar circle ("NVDAx" → "NV"). */
export function tickerInitials(ticker: string): string {
  const letters = ticker.replace(/[^A-Za-z0-9]/g, "");
  return (letters.slice(0, 2) || "·").toUpperCase();
}

/** More than this many constituents collapse into `+N` after the chips. */
export const MAX_VISIBLE_CHIPS = 3;

const FALLBACK_CHIP_CLASS =
  "flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[9px] font-semibold leading-none";

/**
 * One chip: the issuer logo (fixed 24px, lazy, async-decoded — no layout
 * shift), dropping to the ethereal letter avatar on load failure.
 */
function TickerChip({ ticker }: { ticker: string }) {
  const [failed, setFailed] = useState(false);
  const token = AVATAR_TOKENS[tickerAvatarIndex(ticker)];

  if (failed) {
    return (
      <span
        title={ticker}
        aria-hidden="true"
        className={cn(FALLBACK_CHIP_CLASS, token.text, token.bg, token.border)}
      >
        {tickerInitials(ticker)}
      </span>
    );
  }

  return (
    <span
      title={ticker}
      aria-hidden="true"
      className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-muted"
    >
      {/* Plain <img> on purpose: external origin, skip next/image optimization. */}
      <img
        src={logoUrl(ticker)}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

/**
 * Chip row for a basket's composition. Exactly three avatars maximum, then a
 * single muted `+N` counter — never a second row. The full list is exposed to
 * screen readers once via sr-only (chips themselves are decorative).
 */
export function CompositionChips({
  tickers,
  maxVisible = MAX_VISIBLE_CHIPS,
}: {
  tickers: string[];
  maxVisible?: number;
}) {
  if (tickers.length === 0) return null;
  const visible = tickers.slice(0, maxVisible);
  const overflow = tickers.length - visible.length;

  return (
    <span className="flex items-center gap-1">
      {visible.map((ticker, i) => (
        <TickerChip key={`${ticker}-${i}`} ticker={ticker} />
      ))}
      {overflow > 0 ? (
        <span
          aria-hidden="true"
          className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full border border-border bg-muted px-1 font-mono text-[9px] font-semibold leading-none text-muted-foreground"
        >
          +{overflow}
        </span>
      ) : null}
      <span className="sr-only">
        Composition: {tickers.join(", ")}
        {overflow > 0 ? `, plus ${overflow} more` : ""}
      </span>
    </span>
  );
}
