import Link from "next/link";
import { CARD_LINK_CLASS } from "../cards/card-frame";
import { formatAsOf, formatUsd } from "../../lib/format";
import { portfolioShareAmount, type PortfolioPosition } from "../../lib/portfolio-data";

/** Identity enrichment cannot supply balance, price or return evidence. */
export function PortfolioPositionCard({ position, headline, composition }: {
  position: PortfolioPosition;
  headline: string;
  composition?: string | null;
}) {
  const evidence = position.balanceEvidence;
  const value = position.estimatedValue;
  return (
    <Link href={`/basket/${position.basket}`} title={`Open basket ${position.basket}`} className={CARD_LINK_CLASS}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block break-words text-sm font-medium tracking-tight text-foreground" title={position.basket}>
            {headline}
          </span>
          {composition && <span className="mt-1 block break-words font-mono text-xs text-muted-foreground">
            {composition}
          </span>}
        </div>
        <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {evidence ? "finalized" : "indexed"}
        </span>
      </div>

      <span className="mt-4 break-words font-mono text-2xl tabular-nums text-foreground">
        {value !== null ? formatUsd(value) : portfolioShareAmount(position.share_balance)}
      </span>
      <span className="mt-0.5 text-xs text-muted-foreground">
        {value !== null ? "value (reference)" : "shares held · USD value unavailable"}
      </span>

      <div className="mt-auto pt-4">
        <div className="flex items-start justify-between gap-2 border-t border-border/60 pt-3">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Raw shares</span>
            <span className="break-all font-mono text-xs tabular-nums">{position.share_balance}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              {evidence ? "Finalized slot" : "Indexed as of"}
            </span>
            <span className="font-mono text-xs tabular-nums">
              {evidence ? evidence.slot.toLocaleString("en-US") : position.asOf ? formatAsOf(position.asOf) : "Unknown"}
            </span>
          </span>
        </div>
        {evidence && <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Observed {formatAsOf(evidence.observedAt)}. History incomplete; cost basis unknown.
        </p>}
      </div>
    </Link>
  );
}
