"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";
import { ArrowUpRight } from "lucide-react";

import type { WeightBarConstituent } from "@/components/basket/weight-bar";
import { BenchmarkDelta } from "@/components/cards/card-frame";
import { SocialAvatar } from "@/components/social/avatar";
import { ChangeValue } from "@/components/stocks/change-value";
import { Card } from "@/components/ui/card";
import { getBasketCover, isBasketCoverId, type BasketCoverId } from "@/lib/basket-covers";
import { basketDataMessage, type BasketDataQuality } from "@/lib/basket-data-quality";
import { formatPercent, formatUsd } from "@/lib/format";
import { onchainTokenDisplay } from "@/lib/onchain-token-display";

export interface BasketCardCompare {
  label: string;
  value: number | null;
  window: "24h" | "30d";
}

export interface BasketCardHolding {
  symbol: string;
  /** Actual target percentage. Null means the feed has no verified weight. */
  weight: number | null;
  mint?: string;
}

export interface BasketCardProps {
  quality: BasketDataQuality;
  href: string;
  headline: string;
  pubkey?: string;
  context?: string | null;
  tickers?: string[];
  weights?: WeightBarConstituent[];
  holdings?: BasketCardHolding[];
  coverId?: BasketCoverId | null;
  thesis?: string | null;
  assetCount?: number | null;
  creator?: string | null;
  creatorName?: string | null;
  creatorAvatarUrl?: string | null;
  price: number | null;
  aum: number | null;
  devnetPreview?: boolean;
  return24h?: number | null;
  return7d?: number | null;
  return30d?: number | null;
  compare?: BasketCardCompare | null;
}

const PLACEHOLDER_SRC = "/images/baskets/onchain-placeholder.svg";
const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Local art is always underneath the cover, including while it loads or fails. */
function OnchainCover({ coverId }: { coverId: BasketCoverId | null | undefined }) {
  const cover = isBasketCoverId(coverId) ? getBasketCover(coverId) : null;
  return (
    <div
      className="basket-story-cover relative bg-cover bg-center"
      style={{ backgroundImage: `url("${PLACEHOLDER_SRC}")`, backgroundSize: "cover", backgroundPosition: "center" }}
      aria-hidden="true"
    >
      {cover && <CoverImage key={cover.src} src={cover.src} />}
    </div>
  );
}

function CoverImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 320px"
      quality={80}
      onError={() => setFailed(true)}
    />
  );
}

function HoldingTile({ holding, devnet }: { holding: BasketCardHolding; devnet: boolean }) {
  const display = onchainTokenDisplay(holding.symbol, holding.mint, devnet);
  const [failed, setFailed] = useState(false);
  const title = [display.sourceLabel, holding.mint].filter(Boolean).join(" · ");
  return (
    <li className="onchain-holding" title={title}>
      <span className="onchain-holding-art" style={{ backgroundColor: display.color }} aria-hidden="true">
        {failed ? (
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 6 10 6-10 6-10-6 10-6Z" stroke="currentColor" strokeWidth="1.5" /><path d="m6 17 10 6 10-6M6 22l10 6 10-6" stroke="currentColor" strokeWidth="1.5" /></svg>
        ) : (
          <img src={display.src} alt="" width={32} height={32} loading="lazy" decoding="async" onError={() => setFailed(true)} />
        )}
      </span>
      <span className="onchain-holding-copy">
        <span className="onchain-holding-label">{display.label}</span>
        {holding.weight !== null && <span className="onchain-holding-weight">{formatPercent(holding.weight, { fractionDigits: Number.isInteger(holding.weight) ? 0 : 2 })}</span>}
      </span>
    </li>
  );
}

/** Same cover-first gallery anatomy as stock baskets, with indexed values only. */
export function BasketCard({
  href,
  headline,
  pubkey,
  context,
  tickers = [],
  weights,
  holdings: suppliedHoldings,
  coverId,
  thesis,
  assetCount,
  creator,
  creatorName,
  creatorAvatarUrl,
  quality,
  price: suppliedPrice,
  aum: suppliedAum,
  devnetPreview = false,
  return24h: suppliedReturn24h = null,
  return7d: suppliedReturn7d = null,
  return30d: suppliedReturn30d = null,
  compare: suppliedCompare = null,
}: BasketCardProps) {
  const availabilityId = useId();
  const eligible = quality.valuation.eligible;
  const price = eligible && finite(suppliedPrice) && suppliedPrice >= 0 ? suppliedPrice : null;
  const aum = eligible && finite(suppliedAum) && suppliedAum >= 0 ? suppliedAum : null;
  const return24h = eligible && finite(suppliedReturn24h) ? suppliedReturn24h : null;
  const return7d = eligible && finite(suppliedReturn7d) ? suppliedReturn7d : null;
  const return30d = eligible && finite(suppliedReturn30d) ? suppliedReturn30d : null;
  const compare = eligible && suppliedCompare && finite(suppliedCompare.value) ? suppliedCompare : null;
  const holdings = (suppliedHoldings?.length ? suppliedHoldings : weights?.length ? weights : tickers.map(symbol => ({ symbol, weight: null })))
    .filter(holding => typeof holding.symbol === "string" && holding.symbol.trim())
    .map(holding => ({
      symbol: holding.symbol,
      weight: finite(holding.weight) && holding.weight >= 0 && holding.weight <= 100 ? holding.weight : null,
      mint: "mint" in holding && typeof holding.mint === "string" ? holding.mint : undefined,
    }))
    .sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
  const count = Number.isSafeInteger(assetCount) && (assetCount as number) > 0
    ? assetCount as number : holdings.length || null;
  const description = thesis?.trim() || context?.trim() || null;
  const reason = basketDataMessage(quality) ?? "Price and return data are not available yet.";
  const hasMetrics = price !== null || aum !== null || return7d !== null || return30d !== null || compare !== null;

  return (
    <Card className="basket-story-card onchain-basket-card">
      <Link
        href={href}
        className="basket-story-link"
        aria-label={`View ${headline}`}
        aria-describedby={!hasMetrics ? availabilityId : undefined}
        title={!hasMetrics ? reason : pubkey ? `Open basket ${pubkey}` : undefined}
      >
        <OnchainCover coverId={coverId} />
        <div className="basket-story-content">
          <div className="basket-story-title-row">
            <h3 className="font-display line-clamp-2 break-words" title={headline}>{headline}</h3>
            <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="basket-story-thesis min-h-[2.6rem] line-clamp-2 break-words" aria-hidden={!description || undefined}>{description}</p>
          {holdings.length > 0 && (
            <div className="onchain-composition">
              <div className="onchain-composition-heading"><span>Holdings</span>{count !== null && <span>{count > 4 ? `${Math.min(holdings.length, 4)} of ${count} tokens` : `${count} ${count === 1 ? "token" : "tokens"}`}</span>}</div>
              <ul className="onchain-holdings" aria-label="Basket holdings">
                {holdings.slice(0, 4).map((holding, index) => <HoldingTile key={`${holding.mint ?? holding.symbol}-${index}-${devnetPreview}`} holding={holding} devnet={devnetPreview} />)}
              </ul>
            </div>
          )}
          {hasMetrics ? (
            <div className="mt-auto">
              <dl className="basket-model-metrics flex-wrap">
                {price !== null && <div><dt>Share price</dt><dd className="flex items-baseline gap-2">{formatUsd(price)}{return24h !== null && <ChangeValue changePct={return24h} className="text-xs" />}</dd></div>}
                {return7d !== null && <div><dt>7D</dt><dd><ChangeValue changePct={return7d} /></dd></div>}
                {return30d !== null && <div><dt>30D</dt><dd><ChangeValue changePct={return30d} /></dd></div>}
                {aum !== null && <div><dt>Basket value</dt><dd>{formatUsd(aum, { maximumFractionDigits: 0 })}</dd></div>}
                {compare && <div><dt>{compare.label}</dt><dd><BenchmarkDelta value={compare.value} window={compare.window} /></dd></div>}
              </dl>
              <span className="mt-2 block text-[0.6rem] leading-4 text-muted-foreground">
                {devnetPreview ? "Devnet · mock tokens · reference NAV" : "NAV estimate"}
              </span>
            </div>
          ) : devnetPreview ? (
            <p id={availabilityId} className="sr-only" title={reason}>{reason}</p>
          ) : (
            <p id={availabilityId} className="mt-[1.1rem] border-t border-border/65 pt-4 text-xs leading-5 text-muted-foreground" title={reason} aria-label={reason}>
              {quality.status === "pending" ? "Checking basket data." : "Prices not available yet."}
            </p>
          )}
        </div>
      </Link>
      {creator && (
        <Link href={`/creator/${encodeURIComponent(creator)}`} className="basket-story-owner onchain-basket-owner" title={creator}>
          <SocialAvatar wallet={creator} displayName={creatorName} avatarUrl={creatorAvatarUrl} className="!size-7" />
          <span className="truncate">{creatorName?.trim() || "Basket manager"}</span>
          <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
        </Link>
      )}
    </Card>
  );
}
