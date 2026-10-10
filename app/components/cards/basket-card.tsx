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
import { formatUsd, truncateAddress } from "@/lib/format";
import { logoUrl } from "@/lib/logos";

export interface BasketCardCompare {
  label: string;
  value: number | null;
  window: "24h" | "30d";
}

export interface BasketCardProps {
  quality: BasketDataQuality;
  href: string;
  headline: string;
  pubkey?: string;
  context?: string | null;
  tickers?: string[];
  weights?: WeightBarConstituent[];
  coverId?: BasketCoverId | null;
  thesis?: string | null;
  assetCount?: number | null;
  creator?: string | null;
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

function AssetMark({ ticker, devnet }: { ticker: string; devnet: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`basket-story-asset ${devnet ? "!border-border !bg-muted !text-[0.625rem] text-muted-foreground" : ""}`} aria-hidden="true" title={ticker}>
      {devnet || failed ? ticker.slice(0, 2) : (
        <img
          src={logoUrl(ticker)}
          alt=""
          width={24}
          height={24}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </span>
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
  coverId,
  thesis,
  assetCount,
  creator,
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
  const count = Number.isSafeInteger(assetCount) && (assetCount as number) > 0
    ? assetCount as number : tickers.length || weights?.length || null;
  const description = thesis?.trim() || tickers.join(" · ") || context?.trim() || null;
  const reason = basketDataMessage(quality) ?? "Price and return data are not available yet.";
  const hasMetrics = price !== null || aum !== null || return7d !== null || return30d !== null || compare !== null;

  return (
    <Card className="basket-story-card">
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
          <div className="basket-story-meta">
            <span className="basket-story-assets" aria-label={tickers.length ? `Holdings: ${tickers.join(", ")}` : undefined}>
              {tickers.slice(0, 4).map((ticker, index) => (
                <AssetMark key={`${ticker}-${index}-${devnetPreview}`} ticker={ticker} devnet={devnetPreview} />
              ))}
              {tickers.length > 4 && <span className="basket-story-count" aria-hidden="true">+{tickers.length - 4}</span>}
            </span>
            {count !== null && <span className="font-mono">{count} {count === 1 ? "asset" : "assets"}</span>}
          </div>
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
        <Link href={`/creator/${encodeURIComponent(creator)}`} className="basket-story-owner" title={creator}>
          <SocialAvatar wallet={creator} className="!size-6" />
          <span>by {truncateAddress(creator, 4, 4)}</span>
        </Link>
      )}
    </Card>
  );
}
