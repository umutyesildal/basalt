"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SocialAvatar } from "@/components/social/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { CONCEPT_ACTIVITY, getConceptBasket, getConceptBasketHref, getConceptCreator } from "@/lib/concept-samples";
import { formatRelativeTime, formatUsd, truncateAddress } from "@/lib/format";
import { fetchFeed, type TradeFeedItem } from "@/lib/social-api";

type FeedView = "concept" | "live";

export default function FeedClient() {
  const [view, setView] = useState<FeedView>("concept");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionHeading
            as="h1"
            eyebrow={<span className="text-[0.7rem] font-medium leading-4 tracking-[0.22em]">IDEAS IN MOTION</span>}
            title={<span className="text-3xl font-semibold tracking-tight">Feed</span>}
          />
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Explore basket ideas, share your own preview, and follow onchain creators.
          </p>
        </div>
        <nav aria-label="Feed view" className="flex flex-wrap items-center gap-2">
          <Link
            href="/create"
            className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Share an idea
          </Link>
          <Button variant={view === "concept" ? "secondary" : "ghost"} size="sm" onClick={() => setView("concept")}>
            Concept examples
          </Button>
          <Button variant={view === "live" ? "secondary" : "ghost"} size="sm" onClick={() => setView("live")}>
            Devnet activity
          </Button>
        </nav>
      </header>

      {view === "concept" ? <ConceptFeed /> : <LiveActivity />}
    </div>
  );
}

function ConceptFeed() {
  return (
    <section aria-label="Concept examples" className="space-y-3">
      <p className="inline-flex rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Concept preview
      </p>
      <ul className="space-y-3">
        {CONCEPT_ACTIVITY.map((activity) => {
          const creator = getConceptCreator(activity.creatorId);
          const basket = getConceptBasket(activity.basketId);
          if (!creator || !basket) return null;
          return (
            <li key={activity.id}>
              <Card className="transition-colors hover:border-border">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Link href={`/creator/${creator.id}`} className="flex min-w-0 items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                      <SocialAvatar wallet={creator.id} handle={creator.handle} displayName={creator.displayName} avatarUrl={creator.avatarUrl} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{creator.displayName}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">@{creator.handle}</span>
                      </span>
                    </Link>
                  </div>
                  <div className="mt-4">
                    <h2 className="text-base font-semibold tracking-tight">{activity.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{activity.body}</p>
                  </div>
                  <Link
                    href={getConceptBasketHref(basket.id)}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent font-mono text-[10px] font-semibold text-accent-foreground">{basket.symbol}</span>
                    <span>{basket.name}</span>
                    <span aria-hidden="true" className="ml-1 text-muted-foreground">↗</span>
                  </Link>
                </CardContent>
              </Card>
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
