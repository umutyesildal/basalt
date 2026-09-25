"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronRight, Layers3 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { CreatePreviewDonut } from "@/components/create/create-preview-donut";
import { WeightBar } from "@/components/basket/weight-bar";
import { SectionReveal } from "@/components/home/section-reveal";
import { SocialAvatar } from "@/components/social/avatar";
import { conceptCopyHref } from "@/lib/concept-share";
import { conceptBasketHref, CONCEPT_ACTIVITY, CONCEPT_BASKETS, CONCEPT_CREATORS, getConceptBasket, getConceptCreator } from "@/lib/concept-samples";
import { getConceptAsset } from "@/lib/concept-assets";

const STORIES = CONCEPT_CREATORS.slice(0, 3).flatMap((creator) => {
  const basket = CONCEPT_BASKETS.find((sample) => sample.creatorId === creator.id);
  return basket ? [{ creator, basket }] : [];
});

const HOME_SYMBOL_COLORS: Readonly<Record<string, string>> = {
  NVDA: "#77B900",
  MSFT: "#05A6F0",
  AAPL: "#E5E7EB",
  AMZN: "#FF6200",
  GOOGL: "#1ABD4D",
  META: "#0081FB",
  AVGO: "#CC092F",
  SPY: "#6676FF",
  JPM: "#A36848",
  QQQ: "#8D86D9",
  V: "#4564D8",
  TSLA: "#E82127",
  UBER: "#4B535B",
  TSM: "#F58C96",
  AMD: "#939CA6",
  KO: "#BC343C",
  MCD: "#FFCC00",
  ADBE: "#FF8070",
};

/** Homepage brand-inspired chart tints, not an exact official brand palette. */
function homeSymbolColor(symbol: string): string {
  return HOME_SYMBOL_COLORS[symbol.toUpperCase()] ?? "#7D8794";
}

/** Choose readable text for the homepage WeightBar blocks. */
function homeLabelColor(color: string): string {
  const [red, green, blue] = color.match(/[A-Fa-f0-9]{2}/g)!.map((channel) => parseInt(channel, 16) / 255);
  const linear = [red, green, blue].map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.179 ? "#000000" : "#FFFFFF";
}

// Storyboard: creator → mix → your preview. The people, chart and actions
// stay visible from frame one; only the two connector strokes reveal in order.
const TIMING_MS = {
  creatorToMix: 260,
  mixToPreview: 700,
  connectorReveal: 360,
} as const;

export function HomeExperience() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [stage, setStage] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const prefersReducedMotion = useReducedMotion();
  const story = STORIES[selectedIndex] ?? STORIES[0];

  useEffect(() => {
    if (!story) return;
    if (prefersReducedMotion) {
      setStage(2);
      return;
    }

    setStage(0);
    const mixTimer = window.setTimeout(() => setStage(1), TIMING_MS.creatorToMix);
    const previewTimer = window.setTimeout(() => setStage(2), TIMING_MS.mixToPreview);
    return () => {
      window.clearTimeout(mixTimer);
      window.clearTimeout(previewTimer);
    };
  }, [selectedIndex, replayKey, prefersReducedMotion, story]);

  if (!story) return null;
  const { creator, basket } = story;
  const slices = basket.allocations.map((asset) => ({
    key: asset.symbol,
    label: asset.symbol,
    value: asset.weightBps,
    color: homeSymbolColor(asset.symbol),
  }));

  function chooseStory(index: number) {
    setStage(0);
    setSelectedIndex(index);
    setReplayKey((current) => current + 1);
  }

  return (
    <div className="space-y-5 pb-6 md:space-y-7">
      <section className="relative isolate overflow-hidden rounded-[1.5rem] border border-border/80 bg-card">
        <div className="px-4 py-5 sm:px-7 sm:py-7 lg:px-9 lg:py-8">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.17em] text-muted-foreground">Strategy baskets, made social</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-primary-text">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
              Concept preview
            </span>
          </div>

          <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(19rem,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-8">
            <div>
              <h1 className="font-display text-[2rem] font-semibold leading-[1.02] tracking-tight sm:text-4xl lg:text-[2.7rem]">
                Build a basket.
                <br />
                <span className="text-primary-text">Discover creators.</span>
              </h1>
              <p className="mt-2 max-w-md text-sm leading-5 text-muted-foreground">
                Choose stocks, set your mix, or start with a creator’s idea.
              </p>
              <div className="mt-4 flex gap-2.5">
                <Link
                  href="/create"
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-center text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:text-sm"
                >
                  Build a basket <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
                <Link
                  href="/leaderboard?tab=people"
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-primary/60 bg-background/35 px-3 text-center text-xs font-semibold text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:text-sm"
                >
                  Discover creators <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-border/80 bg-background/45 p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Choose a point of view</span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{String(selectedIndex + 1).padStart(2, "0")} / 03</span>
              </div>
              <div role="group" aria-label="Choose a sample creator" className="mt-2 grid grid-cols-3 gap-1.5">
                {STORIES.map(({ creator: option }, index) => {
                  const selected = selectedIndex === index;
                  return (
                    <button
                      type="button"
                      key={option.id}
                      aria-pressed={selected}
                      onClick={() => chooseStory(index)}
                      className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${selected ? "border-primary/70 bg-primary/10 text-foreground" : "border-border bg-card/55 text-muted-foreground hover:border-border/90 hover:text-foreground"}`}
                    >
                      {selected ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary-text" /> : null}
                      <span className="truncate">{option.displayName.split(" ")[0]}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-col items-center gap-0.5">
                <Link
                  href={`/creator/${creator.id}`}
                  className="group flex min-h-[4.25rem] w-full items-center gap-3 rounded-xl border border-border/80 bg-card/70 px-3 py-2.5 transition-colors hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <SocialAvatar wallet={creator.id} handle={creator.handle} displayName={creator.displayName} avatarUrl={creator.avatarUrl} size="md" className="!size-11 border border-border" />
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm font-semibold text-foreground">{creator.displayName}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">@{creator.handle}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary-text" />
                </Link>

                <FlowConnector stage={stage} revealAt={1} reduced={prefersReducedMotion} />

                <div className="w-full py-1 text-center">
                  <div className="mb-1 flex items-center justify-center gap-2">
                    <span className="max-w-[13rem] truncate font-display text-base font-semibold sm:text-lg">{basket.name}</span>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">100%</span>
                  </div>
                  <div
                    role="img"
                    aria-label={`Illustrative allocation: ${basket.allocations.map((asset) => `${asset.symbol} ${asset.weightBps / 100}%`).join(", ")}`}
                    className="relative mx-auto size-[10.5rem] sm:size-[11.5rem] md:size-[13.5rem]"
                  >
                    <CreatePreviewDonut slices={slices} size={216} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[0.778] sm:scale-[0.852] md:scale-100" />
                    {basket.allocations.map((asset, index) => {
                      const priorWeight = basket.allocations.slice(0, index).reduce((sum, item) => sum + item.weightBps, 0);
                      const midpoint = priorWeight + asset.weightBps / 2;
                      const angle = -Math.PI + (2 * Math.PI * midpoint) / 10_000;
                      return <AssetPin key={`${basket.id}:${asset.symbol}`} symbol={asset.symbol} angle={angle} stage={stage} reduced={prefersReducedMotion} />;
                    })}
                  </div>
                  <div className="mt-1 flex items-center justify-center gap-x-2.5 gap-y-1 font-mono text-[9px] tabular-nums text-muted-foreground sm:text-[10px]">
                    {basket.allocations.slice(0, 3).map((asset) => (
                      <span key={asset.symbol}>{asset.symbol} {asset.weightBps / 100}%</span>
                    ))}
                    <span>+{basket.allocations.length - 3}</span>
                  </div>
                </div>

                <FlowConnector stage={stage} revealAt={2} reduced={prefersReducedMotion} />

                <div className="flex min-h-[4.25rem] w-full items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/[0.045] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Layers3 aria-hidden="true" className="size-4 shrink-0 text-primary-text" />
                      <span className="truncate text-sm font-semibold">Your preview</span>
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">Editable · {basket.allocations.length} assets</p>
                  </div>
                  <Link
                    href={conceptCopyHref(basket)}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    Use this mix <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </div>
              </div>
              <p className="sr-only" aria-live="polite">Showing {creator.displayName}’s {basket.name} basket.</p>
            </div>
          </div>
        </div>
      </section>

      <DiscoverySection />
      <ManagedPreview />
      <ClosingActions />
    </div>
  );
}

function AssetPin({ symbol, angle, stage, reduced }: { symbol: string; angle: number; stage: number; reduced: boolean | null }) {
  const asset = getConceptAsset(symbol);
  const [failed, setFailed] = useState(false);
  const radius = 41.2;
  const x = 50 + Math.cos(angle) * radius;
  const y = 50 + Math.sin(angle) * radius;
  const revealed = stage >= 1;
  return (
    <motion.span
      aria-hidden="true"
      className="absolute z-10 flex size-5 items-center justify-center overflow-hidden rounded-full border border-border bg-card shadow-[0_2px_10px_hsl(var(--background)/0.7)] md:size-6"
      initial={false}
      animate={{ left: revealed ? `${x}%` : "50%", top: revealed ? `${y}%` : "50%", x: "-50%", y: "-50%", opacity: revealed ? 1 : 0, scale: revealed ? 1 : 0.6 }}
      transition={{ duration: reduced ? 0 : TIMING_MS.connectorReveal / 1000, ease: "easeOut" }}
    >
      {asset?.logoUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- logos use the shared remote asset catalogue
        <img src={asset.logoUrl} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span className="font-mono text-[8px] font-semibold text-foreground">{symbol.slice(0, 3)}</span>
      )}
    </motion.span>
  );
}

function FlowConnector({ stage, revealAt, reduced }: { stage: number; revealAt: number; reduced: boolean | null }) {
  const active = stage >= revealAt;
  return (
    <div aria-hidden="true" className="relative flex h-6 items-center justify-center">
      <span className="absolute top-0 h-full w-px rounded-full bg-border" />
      <motion.span
        className="absolute top-0 h-full w-px origin-top rounded-full bg-primary"
        initial={false}
        animate={{ scaleY: active ? 1 : 0 }}
        transition={{ duration: reduced ? 0 : TIMING_MS.connectorReveal / 1000, ease: "easeOut" }}
      />
      <ArrowDown className="absolute bottom-[-1px] size-3.5 bg-card text-primary-text" />
    </div>
  );
}

function DiscoverySection() {
  const activityRows = CONCEPT_ACTIVITY.slice(0, 2).flatMap((activity) => {
    const creator = getConceptCreator(activity.creatorId);
    const basket = getConceptBasket(activity.basketId);
    return creator && basket ? [{ activity, creator, basket }] : [];
  });
  const basketRows = [
    getConceptBasket("concept-basket-index-core"),
    getConceptBasket("concept-basket-quality-compounders"),
  ].filter((basket) => basket !== null);

  return (
    <section aria-labelledby="ideas-title" className="space-y-4">
      <SectionReveal>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary-text">01 / Explore</p>
            <h2 id="ideas-title" className="mt-1 font-display text-2xl font-semibold sm:text-3xl">Ideas worth exploring.</h2>
          </div>
          <span className="rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Sample ideas</span>
        </div>
      </SectionReveal>

      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        <SectionReveal className="h-full min-w-0">
          <div className="h-full min-w-0 rounded-2xl border border-border/80 bg-card/70 p-3 sm:p-4">
            <Link href="/feed" className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 font-display text-lg font-semibold transition-colors hover:text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              Creator ideas <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </Link>
            <div className="mt-2 space-y-2">
              {activityRows.map(({ activity, creator, basket }, index) => (
                <SectionReveal key={activity.id} delay={index * 60}>
                  <article className="rounded-xl border border-border/70 bg-background/35 p-3">
                    <div className="flex items-center gap-2.5">
                      <Link href={`/creator/${creator.id}`} aria-label={`View ${creator.displayName}'s profile`} className="flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <SocialAvatar wallet={creator.id} handle={creator.handle} displayName={creator.displayName} avatarUrl={creator.avatarUrl} size="md" className="!size-10 border border-border" />
                      </Link>
                      <div className="min-w-0">
                        <Link href={`/creator/${creator.id}`} className="flex min-h-11 items-center gap-1 truncate text-xs font-semibold text-foreground hover:text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{creator.displayName} <span className="font-normal text-muted-foreground">@{creator.handle}</span></Link>
                        <h3 className="mt-0.5 line-clamp-2 whitespace-normal text-sm leading-5 text-muted-foreground">{activity.title}</h3>
                      </div>
                    </div>
                    <Link href={conceptBasketHref(basket)} className="mt-2 inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/60 px-3 text-xs font-medium hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <span className="truncate">{basket.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">Open mix <ArrowRight aria-hidden="true" className="size-3.5" /></span>
                    </Link>
                  </article>
                </SectionReveal>
              ))}
            </div>
          </div>
        </SectionReveal>

        <SectionReveal className="h-full min-w-0" delay={80}>
          <div className="h-full min-w-0 rounded-2xl border border-border/80 bg-card/70 p-3 sm:p-4">
            <Link href="/explore" className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 font-display text-lg font-semibold transition-colors hover:text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              Basket mixes <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </Link>
            <div className="mt-2 space-y-2">
              {basketRows.map((basket, index) => {
                const creator = getConceptCreator(basket.creatorId);
                return (
                  <SectionReveal key={basket.id} delay={index * 60}>
                    <article className="rounded-xl border border-border/70 bg-background/35 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate font-display text-base font-semibold">{basket.name}</h3>
                          {creator ? <Link href={`/creator/${creator.id}`} className="mt-0.5 inline-flex min-h-11 items-center truncate text-xs text-muted-foreground hover:text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">by {creator.displayName}</Link> : null}
                        </div>
                        <Link href={conceptBasketHref(basket)} aria-label={`Preview ${basket.name}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:border-primary/45 hover:text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          <ArrowUpRight aria-hidden="true" className="size-4" />
                        </Link>
                      </div>
                      <WeightBar constituents={basket.allocations.map((asset) => {
                        const color = homeSymbolColor(asset.symbol);
                        return { symbol: asset.symbol, weight: asset.weightBps / 100, color, labelColor: homeLabelColor(color) };
                      })} className="mt-2" />
                      <p className="mt-1.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{basket.allocations.length} assets · 100% mix</p>
                    </article>
                  </SectionReveal>
                );
              })}
            </div>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}

function ManagedPreview() {
  const creator = CONCEPT_CREATORS[0];
  if (!creator) return null;

  return (
    <SectionReveal>
      <section aria-labelledby="managed-preview-title" className="grid overflow-hidden rounded-3xl border border-border/80 bg-card lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <div className="flex flex-col items-start p-5 sm:p-7 lg:p-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Managed · Prototype</p>
          <h2 id="managed-preview-title" className="mt-3 font-display text-3xl font-semibold leading-[1.04] tracking-tight sm:text-4xl">
            Their strategy.
            <br />
            <span className="text-primary-text">Your share.</span>
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-5 text-muted-foreground">Preview a creator-led strategy, one share at a time.</p>
          <Link
            href="/managed"
            className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Explore managed preview <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
          <details className="group mt-5 w-full border-t border-border/70 pt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
              <span>How the prototype works</span>
              <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-90" />
            </summary>
            <p className="pb-1 text-xs leading-5 text-muted-foreground">
              Simulated public example; the V2 program has run on localnet only and prototype fees are 0%. A fixed asset pair bounds creator proposals, with separate guardian approval and public notice. Redemption reflects current vault balances. Market, contract and manager risks remain.
            </p>
          </details>
        </div>

        <ManagedStoryScene creator={creator} />
      </section>
    </SectionReveal>
  );
}

function ManagedStoryScene({ creator }: { creator: (typeof CONCEPT_CREATORS)[number] }) {
  const [ownedShares, setOwnedShares] = useState<10 | 25>(10);
  const totalShares = 100;
  const assetA = 200;
  const assetB = 100;
  const ownershipPercent = (ownedShares / totalShares) * 100;
  const claimA = assetA * ownedShares / totalShares;
  const claimB = assetB * ownedShares / totalShares;

  return (
    <div role="group" aria-label="Illustrative example of proportional basket ownership" className="relative isolate min-h-[19rem] overflow-hidden border-t border-border/70 bg-background/45 p-3 sm:min-h-[20rem] sm:p-4 lg:min-h-[20rem] lg:border-l lg:border-t-0">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <SocialAvatar wallet={creator.id} handle={creator.handle} displayName={creator.displayName} avatarUrl={creator.avatarUrl} size="md" className="!size-10 border border-border" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{creator.displayName}</span>
            <span className="block text-xs text-muted-foreground">Example creator</span>
          </span>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Illustrative example</span>
      </div>

      <div className="mt-3 grid min-h-[13rem] grid-cols-2 gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-col rounded-2xl border border-border/80 bg-card/75 p-2.5 sm:p-3">
          <div className="flex min-h-9 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary-text"><Layers3 aria-hidden="true" className="size-4" /></span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold">Shared basket</span>
              <span className="block truncate text-[10px] text-muted-foreground">Current vault assets</span>
            </span>
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/55 px-2.5">
              <span className="font-mono text-xs font-semibold">Asset A</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{assetA}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/55 px-2.5">
              <span className="font-mono text-xs font-semibold">Asset B</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{assetB}</span>
            </div>
          </div>
          <p className="mt-auto pt-2 font-mono text-[10px] text-muted-foreground">{totalShares} total shares</p>
        </div>

        <div className="flex min-w-0 flex-col rounded-2xl border border-primary/35 bg-primary/[0.045] p-2.5 sm:p-3">
          <div className="flex min-h-9 items-center justify-between gap-1.5">
            <span className="text-xs font-semibold">Your share</span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{ownedShares} / {totalShares}</span>
          </div>
          <div role="img" aria-label={`${ownedShares} of ${totalShares} basket shares highlighted`} className="mt-2 grid grid-cols-10 gap-1 self-start rounded-lg border border-border/70 bg-background/60 p-2">
            {Array.from({ length: totalShares }, (_, index) => (
              <span key={index} className={`size-1.5 rounded-[2px] sm:size-2 ${index < ownedShares ? "bg-primary" : "bg-muted-foreground/25"}`} />
            ))}
          </div>
          <div role="group" aria-label="Choose shares in the illustrative example" className="mt-2 grid grid-cols-2 gap-1.5">
            {([10, 25] as const).map((shares) => (
              <button
                key={shares}
                type="button"
                aria-pressed={ownedShares === shares}
                onClick={() => setOwnedShares(shares)}
                className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-1 text-[11px] font-medium tabular-nums transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${ownedShares === shares ? "border-primary/65 bg-primary/10 text-foreground" : "border-border/80 bg-background/50 text-muted-foreground hover:text-foreground"}`}
              >
                {shares} shares
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{ownershipPercent}% of current assets</p>
          <div aria-live="polite" className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[11px] font-semibold tabular-nums text-foreground">
            <span>{claimA} A</span>
            <span>{claimB} B</span>
            <span className="sr-only">Your portion: {claimA} units of Asset A and {claimB} units of Asset B.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ClosingActions() {
  return (
    <SectionReveal>
      <section aria-labelledby="closing-actions-title" className="border-t border-border/70 pt-6 sm:pt-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          <h2 id="closing-actions-title" className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Make your next move.</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:w-[min(100%,30rem)]">
            <Link href="/create" className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-center text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:gap-2 sm:px-4 sm:text-sm">
              Build a basket <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
            <Link href="/leaderboard?tab=people" className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg border border-primary/50 px-2.5 text-center text-xs font-semibold text-foreground transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:gap-2 sm:px-4 sm:text-sm">
              Discover creators <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          </div>
        </div>
        <div className="mt-4 flex min-h-12 items-center justify-center gap-3 border-t border-border/60 pt-2 text-xs text-muted-foreground sm:gap-5 sm:text-sm">
          <Link href="/explore" className="inline-flex min-h-11 items-center px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Browse baskets</Link>
          <span aria-hidden="true" className="h-4 w-px bg-border" />
          <Link href="/feed" className="inline-flex min-h-11 items-center px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Open the feed</Link>
        </div>
      </section>
    </SectionReveal>
  );
}
