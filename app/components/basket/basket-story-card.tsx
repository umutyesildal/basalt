"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";

import { BasketMetrics } from "@/components/basket/basket-performance";
import { Card } from "@/components/ui/card";
import { SocialAvatar } from "@/components/social/avatar";
import { BASKET_STORY_COVERS, conceptBasketHref, getConceptCreator, type ConceptBasketSample } from "@/lib/concept-samples";
import { logoUrl } from "@/lib/logos";
import { cn } from "@/lib/utils";

/** Editorial artwork, not a holdings or performance visualization. */
export function BasketCover({ basket, className }: { basket: ConceptBasketSample; className?: string }) {
  return (
    <div className={cn("basket-story-cover", className)} aria-hidden="true">
      <Image src={BASKET_STORY_COVERS[basket.id]} alt="" width={1254} height={1254} sizes="(max-width: 639px) 80vw, (max-width: 1023px) 50vw, 320px" quality={80} />
    </div>
  );
}

export function BasketAssetMarks({ basket }: { basket: ConceptBasketSample }) {
  return (
    <span className="basket-story-assets" aria-label={basket.allocations.map((asset) => asset.name).join(", ")}>
      {basket.allocations.slice(0, 4).map((asset) => <AssetMark key={asset.symbol} symbol={asset.symbol} />)}
      {basket.allocations.length > 4 && <span className="basket-story-count" aria-hidden="true">+{basket.allocations.length - 4}</span>}
    </span>
  );
}

function AssetMark({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="basket-story-asset" aria-hidden="true">{failed ? symbol.slice(0, 2) : <img src={logoUrl(symbol)} alt="" width={24} height={24} loading="lazy" onError={() => setFailed(true)} />}</span>;
}

export function BasketStoryCard({ basket, compact = false, showOwner = true }: { basket: ConceptBasketSample; compact?: boolean; showOwner?: boolean }) {
  const creator = getConceptCreator(basket.creatorId);
  return (
    <Card className={cn("basket-story-card", compact && "basket-story-card-compact")}>
      <Link href={conceptBasketHref(basket)} className="basket-story-link" aria-label={`View ${basket.name}`}>
        <BasketCover basket={basket} />
        <div className="basket-story-content">
          <div className="basket-story-title-row"><h3 className="font-display">{basket.name}</h3><ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></div>
          <p className="basket-story-thesis">{basket.thesis}</p>
          <div className="basket-story-meta"><BasketAssetMarks basket={basket} /><span className="font-mono">{basket.allocations.length} assets</span></div>
          <BasketMetrics basketId={basket.id} compact={compact} />
        </div>
      </Link>
      {showOwner && creator && <Link href={`/creator/${creator.id}`} className="basket-story-owner"><SocialAvatar wallet={creator.id} displayName={creator.displayName} avatarUrl={creator.avatarUrl} className="!size-6" /><span>by {creator.displayName}</span></Link>}
    </Card>
  );
}
