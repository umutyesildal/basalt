"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ModelPerformanceNote } from "@/components/basket/basket-performance";
import { BasketStoryCard } from "@/components/basket/basket-story-card";
import { SocialAvatar } from "@/components/social/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { CONCEPT_ACTIVITY, getConceptBasket, getConceptCreator } from "@/lib/concept-samples";
import { formatRelativeTime, formatUsd, truncateAddress } from "@/lib/format";
import { fetchFeed, type TradeFeedItem } from "@/lib/social-api";

export default function FeedClient() {
  const [showLive, setShowLive] = useState(false);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 py-4 sm:space-y-12 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">People and their picks.</h1>
          <p className="text-sm text-muted-foreground">Sample viewpoints</p>
        </div>
        <Link href="/create" className="inline-flex min-h-11 items-center rounded-md text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          Create a basket
        </Link>
      </header>

      <ConceptFeed />
      <ModelPerformanceNote />

      <details className="border-t border-border pt-4" onToggle={(event) => setShowLive(event.currentTarget.open)}>
        <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Devnet activity</summary>
        <div className="pt-5">{showLive ? <LiveActivity /> : null}</div>
      </details>
    </div>
  );
}

function ConceptFeed() {
  return (
    <section aria-label="Basket viewpoints">
      <ul className="divide-y divide-border">
        {CONCEPT_ACTIVITY.map((activity) => {
          const creator = getConceptCreator(activity.creatorId);
          const basket = getConceptBasket(activity.basketId);
          if (!creator || !basket) return null;
          return (
            <li key={activity.id} className="grid gap-6 py-8 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] sm:gap-10 sm:py-10">
              <article className="min-w-0 space-y-5">
                <Link href={`/creator/${creator.id}`} className="inline-flex min-h-11 max-w-full items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <SocialAvatar wallet={creator.id} handle={creator.handle} displayName={creator.displayName} avatarUrl={creator.avatarUrl} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{creator.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">@{creator.handle}</span>
                  </span>
                </Link>
                <p className="max-w-prose text-lg leading-8 text-foreground">{activity.body}</p>
              </article>
              <div className="min-w-0"><BasketStoryCard basket={basket} compact showOwner={false} /></div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LiveActivity() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<TradeFeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchFeed({ scope: "all", type: "trades", limit: 20, cursor: null }, controller.signal)
      .then((payload) => {
        setItems(payload.items.filter((item): item is TradeFeedItem => item.kind === "trade"));
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Could not load live activity.");
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  return (
    <section aria-label="Verified onchain activity" className="space-y-3">
      <p className="text-sm text-muted-foreground">Indexed devnet transactions. Mock token values are not live market prices.</p>
      {status === "loading" ? <Card><CardContent className="p-5 text-sm text-muted-foreground">Loading live activity…</CardContent></Card> : null}
      {status === "error" ? <Card><CardContent className="p-5 text-sm text-muted-foreground">{error ?? "Could not load live activity."}</CardContent></Card> : null}
      {status === "ready" && items.length === 0 ? <Card><CardContent className="p-5 text-sm text-muted-foreground">No indexed activity yet.</CardContent></Card> : null}
      {status === "ready" && items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((item, index) => <LiveActivityCard key={`${item.sig}-${index}`} item={item} />)}
        </ul>
      ) : null}
    </section>
  );
}

function LiveActivityCard({ item }: { item: TradeFeedItem }) {
  const actor = item.displayName?.trim() || (item.handle ? `@${item.handle}` : truncateAddress(item.wallet, 4, 4));
  return (
    <li>
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={`/creator/${item.wallet}`} className="flex min-w-0 items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <SocialAvatar wallet={item.wallet} handle={item.handle} displayName={item.displayName} avatarUrl={item.avatarUrl} />
              <span className="truncate text-sm font-medium">{actor}</span>
            </Link>
            <span className="font-mono text-[11px] text-muted-foreground">{formatRelativeTime(item.ts)}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {item.type === "Minted" ? "Added to" : "Exited"}{" "}
            <Link href={`/basket/${item.basket}`} className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4">
              {item.basketName ?? truncateAddress(item.basket, 6, 4)}
            </Link>
            {item.usdValue !== null ? <span> · {formatUsd(item.usdValue)}</span> : null}
          </p>
        </CardContent>
      </Card>
    </li>
  );
}
