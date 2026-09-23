"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SocialAvatar } from "@/components/social/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  CONCEPT_BASKETS,
  CONCEPT_CREATORS,
  getConceptBasketHref,
  getConceptCreator,
} from "@/lib/concept-samples";
import { formatRelativeTime, formatUsd, NOT_A_NUMBER_LABEL, truncateAddress } from "@/lib/format";
import {
  fetchBasketLeaderboard,
  fetchLeaderboard,
  type BasketLeaderboardEntry,
  type LeaderboardEntry,
  type LeaderboardWindow,
} from "@/lib/social-api";

type BoardView = "concept" | "live";
type ConceptTab = "people" | "baskets";
type LiveTab = "people" | "baskets";

export default function LeaderboardClient() {
  const [view, setView] = useState<BoardView>("concept");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionHeading
            as="h1"
            eyebrow={<span className="text-[0.7rem] font-medium leading-4 tracking-[0.22em]">CREATOR DISCOVERY</span>}
            title={<span className="text-3xl font-semibold tracking-tight">Creators &amp; ideas</span>}
          />
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Explore sample basket theses, then find onchain creators to follow in Devnet rankings.
          </p>
        </div>
        <nav aria-label="Leaderboard data" className="flex flex-wrap items-center gap-2">
          <Link
            href="/create"
            className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Build an idea
          </Link>
          <Button variant={view === "concept" ? "secondary" : "ghost"} size="sm" onClick={() => setView("concept")}>
            Concept examples
          </Button>
          <Button variant={view === "live" ? "secondary" : "ghost"} size="sm" onClick={() => setView("live")}>
            Devnet rankings
          </Button>
        </nav>
      </header>

      {view === "concept" ? <ConceptBoard /> : <LiveBoard />}
    </div>
  );
}

function ConceptBoard() {
  const [tab, setTab] = useState<ConceptTab>("baskets");
  return (
    <section className="space-y-4" aria-label="Concept examples">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Concept preview
        </p>
        <nav aria-label="Concept examples category" className="flex items-center gap-2">
          <Button variant={tab === "baskets" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("baskets")}>Baskets</Button>
          <Button variant={tab === "people" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("people")}>People</Button>
        </nav>
      </div>

      {tab === "baskets" ? (
        <ol className="space-y-3">
          {CONCEPT_BASKETS.map((basket) => {
            const creator = getConceptCreator(basket.creatorId);
            return (
              <li key={basket.id}>
                <Card className="transition-colors hover:border-border">
                  <CardContent className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                    <span aria-hidden="true" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-accent/40 font-mono text-[11px] font-semibold text-accent-foreground">{basket.symbol}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link href={getConceptBasketHref(basket.id)} className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">{basket.name}</Link>
                        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{basket.allocations.length} assets</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{basket.thesis}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Basket assets">
                        {basket.allocations.slice(0, 5).map((asset) => (
                          <span key={asset.symbol} className="rounded-md border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{asset.symbol}</span>
                        ))}
                        {basket.allocations.length > 5 ? <span className="px-1 py-0.5 font-mono text-[10px] text-muted-foreground">+{basket.allocations.length - 5}</span> : null}
                      </div>
                    </div>
                    {creator ? (
                      <Link href={`/creator/${creator.id}`} className="flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                        <SocialAvatar wallet={creator.id} handle={creator.handle} displayName={creator.displayName} avatarUrl={creator.avatarUrl} />
                        <span className="text-sm text-muted-foreground">{creator.displayName}</span>
                      </Link>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-2">
          {CONCEPT_CREATORS.map((creator) => (
            <li key={creator.id}>
              <Card className="h-full transition-colors hover:border-border">
                <CardContent className="p-5">
                  <Link href={`/creator/${creator.id}`} className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    <SocialAvatar wallet={creator.id} handle={creator.handle} displayName={creator.displayName} avatarUrl={creator.avatarUrl} size="md" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{creator.displayName}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">@{creator.handle}</span>
                    </span>
                  </Link>
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">{creator.bio}</p>
                  <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {CONCEPT_BASKETS.filter((basket) => basket.creatorId === creator.id).length} basket idea
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function LiveBoard() {
  const [tab, setTab] = useState<LiveTab>("baskets");
  const [window, setWindow] = useState<LeaderboardWindow>("all");
  const [users, setUsers] = useState<LeaderboardEntry[]>([]);
  const [baskets, setBaskets] = useState<BasketLeaderboardEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    const request = tab === "baskets"
      ? fetchBasketLeaderboard(window, controller.signal).then((payload) => setBaskets(payload.items))
      : fetchLeaderboard(window, controller.signal).then((payload) => setUsers(payload.items));
    void request.then(() => setStatus("ready")).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("error");
    });
    return () => controller.abort();
  }, [tab, window]);

  return (
    <section className="space-y-4" aria-label="Live onchain rankings">
      <p className="text-sm text-muted-foreground">Rankings use indexed devnet snapshots. Mock token values are not live market prices.</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Live ranking type" className="flex items-center gap-2">
          <Button variant={tab === "baskets" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("baskets")}>Baskets</Button>
          <Button variant={tab === "people" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("people")}>People</Button>
        </nav>
        <nav aria-label="Ranking period" className="flex items-center gap-1">
          {(["7d", "30d", "all"] as const).map((value) => (
            <Button key={value} variant={window === value ? "secondary" : "ghost"} size="sm" onClick={() => setWindow(value)}>{value === "all" ? "All time" : value}</Button>
          ))}
        </nav>
      </div>
      {status === "loading" ? <Card><CardContent className="p-5 text-sm text-muted-foreground">Loading live rankings…</CardContent></Card> : null}
      {status === "error" ? <Card><CardContent className="p-5 text-sm text-muted-foreground">Live rankings are unavailable right now.</CardContent></Card> : null}
      {status === "ready" && tab === "baskets" ? (
        baskets.length ? <ol className="space-y-2">{baskets.map((entry, index) => <LiveBasketRow key={entry.basket} entry={entry} rank={index + 1} />)}</ol> : <EmptyBoard />
      ) : null}
      {status === "ready" && tab === "people" ? (
        users.length ? <ol className="space-y-2">{users.map((entry, index) => <LivePersonRow key={entry.wallet} entry={entry} rank={index + 1} />)}</ol> : <EmptyBoard />
      ) : null}
    </section>
  );
}

function EmptyBoard() {
  return <Card><CardContent className="p-5 text-sm text-muted-foreground">No indexed rankings are available for this period yet.</CardContent></Card>;
}

function LiveBasketRow({ entry, rank }: { entry: BasketLeaderboardEntry; rank: number }) {
  const nav = Number(entry.nav);
  return (
    <li>
      <Card><CardContent className="flex flex-wrap items-center gap-3 p-4">
        <span className="w-7 font-mono text-xs text-muted-foreground">{String(rank).padStart(2, "0")}</span>
        <Link href={`/basket/${entry.basket}`} className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{entry.basketName?.trim() || truncateAddress(entry.basket, 4, 4)}</span>
          <span className="block font-mono text-[11px] text-muted-foreground">{entry.holders} {entry.holders === 1 ? "holder" : "holders"} · {formatRelativeTime(entry.asOf)}</span>
        </Link>
        <span className="text-right font-mono text-xs tabular-nums">{Number.isFinite(nav) ? formatUsd(nav) : NOT_A_NUMBER_LABEL}<span className="block text-[10px] uppercase text-muted-foreground">NAV / share</span></span>
        <span className="text-right font-mono text-xs tabular-nums">{entry.returnPct >= 0 ? "+" : ""}{entry.returnPct.toFixed(2)}%<span className="block text-[10px] uppercase text-muted-foreground">indexed return</span></span>
      </CardContent></Card>
    </li>
  );
}

function LivePersonRow({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  return (
    <li>
      <Card><CardContent className="flex flex-wrap items-center gap-3 p-4">
        <span className="w-7 font-mono text-xs text-muted-foreground">{String(rank).padStart(2, "0")}</span>
        <Link href={`/creator/${entry.wallet}`} className="flex min-w-0 flex-1 items-center gap-2.5">
          <SocialAvatar wallet={entry.wallet} handle={entry.handle} displayName={entry.displayName} avatarUrl={entry.avatarUrl} />
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{entry.displayName?.trim() || (entry.handle ? `@${entry.handle}` : truncateAddress(entry.wallet, 4, 4))}</span><span className="block font-mono text-[11px] text-muted-foreground">{entry.positionCount} {entry.positionCount === 1 ? "position" : "positions"}</span></span>
        </Link>
        <span className="text-right font-mono text-xs tabular-nums">{entry.valueUsd === null ? NOT_A_NUMBER_LABEL : formatUsd(entry.valueUsd, { maximumFractionDigits: 0 })}<span className="block text-[10px] uppercase text-muted-foreground">indexed value</span></span>
        <span className="text-right font-mono text-xs tabular-nums">{entry.roiPct === null ? NOT_A_NUMBER_LABEL : `${entry.roiPct >= 0 ? "+" : ""}${entry.roiPct.toFixed(2)}%`}<span className="block text-[10px] uppercase text-muted-foreground">indexed return</span></span>
      </CardContent></Card>
    </li>
  );
}
