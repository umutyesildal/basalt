import Link from "next/link";

import { WeightBar, type WeightBarConstituent } from "@/components/basket/weight-bar";
import { CompositionChips } from "@/components/cards/composition-chips";
import {
  BenchmarkDelta,
  CARD_LINK_CLASS,
  MICRO_LABEL_CLASS,
  StatCell,
} from "@/components/cards/card-frame";
import { ChangeValue } from "@/components/stocks/change-value";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Shared basket card — the /explore grid anatomy (Cesto-derived, monochrome
 * chrome; docs/ui-plan.md §1): name-first headline, one-line context (the
 * presentation-layer category label), composition shown EITHER as the Stax
 * weight strip (docs/stax-analiz/05 §5.3/§5.8 — when the caller passes
 * `weights`, the strip replaces the avatar chips and a single mono micro
 * count line dedupes the two representations) OR as the avatar-chips row
 * with `+N` overflow when no weights are available (never fabricate equal
 * weights). Below: mono share price with the unlabeled 24h change riding
 * beside it (owner feedback round 2 — no "24h" caption, the number only;
 * hidden when the price is missing), AUM, and a bottom zone carrying the
 * 30d cell plus the optional gray vs-SPY comparison, closed by the trust
 * provenance line (NAV estimate, with an explicit devnet/mock qualifier when
 * applicable). Cells exist only when the indexer actually carries the
 * figure. The whole card is one link; nothing interactive lives inside.
 */
export interface BasketCardCompare {
  label: string;
  value: number | null;
  window: "24h" | "30d";
}

export interface BasketCardProps {
  href: string;
  /** Basket name when indexed, else the composition string / pubkey fragment. */
  headline: string;
  /** Pubkey for the hover/assistive title. */
  pubkey?: string;
  /** Category label (MicroLabel style) — omitted when classification has no label. */
  context?: string | null;
  /** Constituent tickers in list order — drives the avatar chips. */
  tickers?: string[];
  /**
   * Weighted composition (percent weights) — when present it replaces the
   * avatar chips with the Stax weight strip. Optional and additive: callers
   * without weight data keep the chips path untouched.
   */
  weights?: WeightBarConstituent[];
  /** Share price; null renders an em dash plus the explicit "not indexed" chip. */
  price: number | null;
  /** Basket AUM; always shown for baskets (em dash when not indexed). */
  aum: number | null;
  /** True when the visible indexer data describes devnet/localnet mock tokens. */
  devnetPreview?: boolean;
  return24h?: number | null;
  return30d?: number | null;
  /** vs-SPY comparison — only passed by the page when benchmark data exists. */
  compare?: BasketCardCompare | null;
}

export function BasketCard({
  href,
  headline,
  pubkey,
  context,
  tickers = [],
  weights,
  price,
  aum,
  devnetPreview = false,
  return24h = null,
  return30d = null,
  compare = null,
}: BasketCardProps) {
  const unavailable = price === null;
  // Composition dedupe: the weight strip and the avatar chips say the same
  // thing, so only one renders. Weights win (they carry the proportions);
  // without them the chips stay exactly as before — no equal-weight
  // fabrication for baskets whose weights the feed does not carry.
  const shownWeights =
    Array.isArray(weights) && weights.length > 0 ? weights : null;
  // Footer stat cells: 30d only — the 24h change lives beside the price now
  // (owner feedback round 2). A cell exists only when the figure exists.
  const stats = return30d !== null ? [{ key: "30d", value: return30d }] : [];
  const hasFooter = stats.length > 0 || compare !== null;

  return (
    <Link
      href={href}
      title={pubkey ? `Open basket ${pubkey}` : `Open ${headline}`}
      className={CARD_LINK_CLASS}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span
            className="block break-words text-sm font-medium tracking-tight text-foreground"
            title={pubkey}
          >
            {headline}
          </span>
          {context ? (
            <span className={cn("mt-1 block", MICRO_LABEL_CLASS)}>{context}</span>
          ) : null}
        </div>
        {unavailable ? (
          <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            not indexed
          </span>
        ) : null}
      </div>

      {shownWeights ? (
        // Stax weight strip + one deduping micro line: the constituent count
        // rides on the right (docs/stax-analiz/05 §5.3) so the strip never
        // doubles up with a chip row saying the same thing.
        <div className="mt-3">
          <WeightBar constituents={shownWeights} />
          <span className={cn("mt-1.5 block text-right", MICRO_LABEL_CLASS)}>
            {shownWeights.length} constituents
          </span>
        </div>
      ) : tickers.length > 0 ? (
        <div className="mt-3">
          <CompositionChips tickers={tickers} />
        </div>
      ) : null}

      {/* Price line: big mono price with the unlabeled 24h change beside it,
          baseline-aligned (owner feedback round 2). When the basket is not
          indexed the change is hidden too — no figure, no delta. */}
      <span className="mt-4 flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-2xl tabular-nums",
            unavailable ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {price !== null ? formatUsd(price) : "—"}
        </span>
        {!unavailable && return24h !== null ? (
          <ChangeValue changePct={return24h} className="text-sm" />
        ) : null}
      </span>
      <span className="mt-0.5 text-xs text-muted-foreground">
        AUM {aum !== null ? formatUsd(aum, { maximumFractionDigits: 0 }) : "—"}
      </span>

      {/* Bottom zone: the 30d/vs-SPY footer (when any figure exists) and a
          concise NAV provenance line. Do not imply mock-token valuations are
          live xStocks NAV. */}
      {hasFooter || !unavailable ? (
        <div className="mt-auto pt-4">
          {hasFooter ? (
            <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
              {stats.length > 0 ? (
                <span className="flex gap-4">
                  {stats.map((cell) => (
                    <StatCell key={cell.key} label={cell.key} changePct={cell.value} />
                  ))}
                </span>
              ) : null}
              {compare ? (
                <span className="flex flex-col items-end gap-0.5">
                  <span className={MICRO_LABEL_CLASS}>{compare.label}</span>
                  <BenchmarkDelta value={compare.value} window={compare.window} />
                </span>
              ) : null}
            </div>
          ) : null}
          {!unavailable ? (
            <span
              className={cn(
                "mt-2 block text-[0.6rem] leading-3 text-muted-foreground/60",
                MICRO_LABEL_CLASS,
              )}
            >
              {devnetPreview ? "Devnet · mock tokens · reference NAV" : "NAV estimate"}
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
