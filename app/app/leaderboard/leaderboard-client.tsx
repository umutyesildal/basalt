"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BasketCover, BasketStoryCard } from "@/components/basket/basket-story-card";
import { ModelPerformanceNote, ReturnValue, modelPrice, modelReturn } from "@/components/basket/basket-performance";
import { useBasketPerformance } from "@/lib/use-basket-performance";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SocialAvatar } from "@/components/social/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CONCEPT_BASKETS, CONCEPT_CREATORS, conceptBasketHref, getConceptCreator } from "@/lib/concept-samples";
import { formatNumber, formatRelativeTime, formatUsd, NOT_A_NUMBER_LABEL, truncateAddress } from "@/lib/format";
import {
  fetchBasketLeaderboard,
  fetchLeaderboard,
  type BasketLeaderboardEntry,
  type LeaderboardEntry,
  type LeaderboardWindow,
} from "@/lib/social-api";

type ConceptTab = "people" | "baskets";
type LiveTab = "people" | "baskets";

export default function LeaderboardClient({
  initialTab = "baskets",
}: {
  initialTab?: ConceptTab;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [showLive, setShowLive] = useState(false);
  const [conceptTab, setConceptTab] = useState<ConceptTab>(initialTab);

  useEffect(() => {
    setConceptTab(initialTab);
  }, [initialTab]);

  const selectConceptTab = (tab: ConceptTab) => {
    setConceptTab(tab);
    router.replace(pathname + "?tab=" + tab, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 py-4 sm:space-y-12 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{conceptTab === "baskets" ? "This week’s top 10." : "People behind the baskets."}</h1>
          <p className="text-sm text-muted-foreground">{conceptTab === "baskets" ? "Ten sample baskets, ranked by 7D return." : "Sample profiles, each with a point of view."}</p>
        </div>
        <Link href="/create" className="inline-flex min-h-11 items-center rounded-md text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          Create a basket
        </Link>
      </header>

      <ConceptBoard tab={conceptTab} onTabChange={selectConceptTab} />

      <details className="border-t border-border pt-4" onToggle={(event) => setShowLive(event.currentTarget.open)}>
        <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Devnet rankings</summary>
        <div className="pt-5">{showLive ? <LiveBoard /> : null}</div>
      </details>
    </div>
  );
}

function ConceptBoard({ tab, onTabChange }: { tab: ConceptTab; onTabChange: (tab: ConceptTab) => void }) {
  return (
    <section className="space-y-6" aria-label="People and baskets">
      <nav aria-label="Browse people or baskets" className="flex items-center gap-2">
        <Button variant={tab === "baskets" ? "secondary" : "ghost"} size="sm" className="min-h-11" aria-pressed={tab === "baskets"} onClick={() => onTabChange("baskets")}>Top baskets</Button>
        <Button variant={tab === "people" ? "secondary" : "ghost"} size="sm" className="min-h-11" aria-pressed={tab === "people"} onClick={() => onTabChange("people")}>People</Button>
      </nav>

      {tab === "baskets" ? (
        <ModelLeaderboard />
      ) : (
        <ul className="grid gap-8 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-10">
          {CONCEPT_CREATORS.map((creator) => {
            const baskets = CONCEPT_BASKETS.filter((basket) => basket.creatorId === creator.id);
            if (baskets.length === 0) return null;
            return (
              <li key={creator.id} className="min-w-0 space-y-4">
                <Link href={`/creator/${creator.id}`} className="inline-flex min-h-11 max-w-full items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <SocialAvatar wallet={creator.id} handle={creator.handle} displayName={creator.displayName} avatarUrl={creator.avatarUrl} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-base font-medium">{creator.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">@{creator.handle}</span>
                  </span>
                </Link>
                <div className="space-y-4">
                  {baskets.map((basket) => <BasketStoryCard key={basket.id} basket={basket} compact showOwner={false} />)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ModelPerformanceNote />
    </section>
  );
}

function ModelLeaderboard() {
  const { data, status, retry } = useBasketPerformance();
  const rows = (data?.items ?? [])
    .filter((item) => item.status === "ready" && typeof item.return7dPct === "number" && Number.isFinite(item.return7dPct) && typeof item.modelPrice === "number" && Number.isFinite(item.modelPrice))
    .flatMap((item) => { const basket = CONCEPT_BASKETS.find((candidate) => candidate.id === item.basketId); return basket ? [{ item, basket }] : []; })
    .sort((a, b) => b.item.return7dPct! - a.item.return7dPct! || a.basket.name.localeCompare(b.basket.name))
    .slice(0, 10);
  if (status === "loading") return <Card aria-busy="true"><CardContent className="p-6 text-sm text-muted-foreground">Calculating this week’s returns…</CardContent></Card>;
  if (!rows.length) return <Card><CardContent className="space-y-3 p-6"><p className="text-sm text-muted-foreground">The leaderboard is waiting for complete market data. Try again shortly.</p><Button variant="outline" onClick={retry}>Reload leaderboard</Button></CardContent></Card>;
  return (
    <div className="space-y-3">
      {rows.length < 10 && <p className="text-xs text-muted-foreground">{rows.length} of 10 baskets have complete data. The rest will appear when prices return.</p>}
      <Table className="table-fixed" aria-label="Sample baskets ranked by seven-day model return">
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead scope="col" className="w-[58%] pl-0 text-xs text-muted-foreground">Basket</TableHead><TableHead scope="col" className="w-[21%] text-right text-[11px] text-muted-foreground">Model price</TableHead><TableHead scope="col" className="w-[21%] pr-0 text-right text-[11px] text-muted-foreground" aria-sort="descending">7D return ↓</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map(({ item, basket }, index) => {
          const creator = getConceptCreator(basket.creatorId);
          return <TableRow key={basket.id} className="model-ranking-row">
            <TableCell className="whitespace-normal py-4 pl-0 sm:py-5"><div className="flex min-w-0 items-center gap-2 sm:gap-4"><span className="model-rank w-5 shrink-0 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><BasketCover basket={basket} className="model-ranking-cover" /><div className="min-w-0"><Link href={conceptBasketHref(basket)} className="block rounded-sm font-display text-sm font-semibold leading-5 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:text-base">{basket.name}</Link>{creator && <Link href={`/creator/${creator.id}`} className="mt-1 block truncate rounded-sm text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{creator.displayName}</Link>}</div></div></TableCell>
            <TableCell className="text-right font-mono text-xs tabular-nums sm:text-sm">{modelPrice(item.modelPrice)}</TableCell>
            <TableCell className="pr-0 text-right text-xs sm:text-sm"><ReturnValue value={item.return7dPct} /></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </div>
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
          <Button variant={tab === "people" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("people")}>Managers</Button>
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
          <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">{formatNumber(entry.holders)} {entry.holders === 1 ? "holder" : "holders"} · {formatRelativeTime(entry.asOf)}</span>
        </Link>
        <span className="text-right font-mono text-xs tabular-nums">{Number.isFinite(nav) ? formatUsd(nav) : NOT_A_NUMBER_LABEL}<span className="block text-[10px] uppercase text-muted-foreground">Total value</span></span>
        <span className="text-right font-mono text-xs tabular-nums">{modelReturn(entry.returnPct)}<span className="block text-[10px] uppercase text-muted-foreground">indexed return</span></span>
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
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{entry.displayName?.trim() || (entry.handle ? `@${entry.handle}` : truncateAddress(entry.wallet, 4, 4))}</span><span className="block font-mono text-[11px] tabular-nums text-muted-foreground">{formatNumber(entry.positionCount)} {entry.positionCount === 1 ? "position" : "positions"}</span></span>
        </Link>
        <span className="text-right font-mono text-xs tabular-nums">{entry.valueUsd === null ? NOT_A_NUMBER_LABEL : formatUsd(entry.valueUsd, { maximumFractionDigits: 0 })}<span className="block text-[10px] uppercase text-muted-foreground">indexed value</span></span>
        <span className="text-right font-mono text-xs tabular-nums">{modelReturn(entry.roiPct)}<span className="block text-[10px] uppercase text-muted-foreground">indexed return</span></span>
      </CardContent></Card>
    </li>
  );
}
