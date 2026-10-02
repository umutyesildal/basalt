import type { ConceptBasket } from "@/lib/concept-basket";
import { conceptPreviewHref } from "@/lib/concept-share";

export interface ConceptCreator {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
}

export interface ConceptBasketSample extends ConceptBasket {
  id: string;
  symbol: string;
  creatorId: string;
  allocations: { symbol: string; name: string; weightBps: number }[];
}

export interface ConceptActivity {
  id: string;
  creatorId: string;
  basketId: string;
  kind: "shared" | "thesis";
  title: string;
  body: string;
}

export const CONCEPT_CREATORS: ConceptCreator[] = [
  {
    id: "concept-creator-maya",
    handle: "maya.builds",
    displayName: "Maya Chen",
    avatarUrl: conceptAvatar("maya-builds"),
    bio: "I follow the platforms and chips behind everyday tech.",
  },
  {
    id: "concept-creator-jordan",
    handle: "jordan.lee",
    displayName: "Jordan Lee",
    avatarUrl: conceptAvatar("jordan-lee"),
    bio: "I start with the market, then add a few favorites.",
  },
  {
    id: "concept-creator-riley",
    handle: "riley.parks",
    displayName: "Riley Parks",
    avatarUrl: conceptAvatar("riley-parks"),
    bio: "Cars, chips and how we get around.",
  },
  {
    id: "concept-creator-alex",
    handle: "alex.morgan",
    displayName: "Alex Morgan",
    avatarUrl: conceptAvatar("alex-morgan"),
    bio: "I like the brands and services we use on repeat.",
  },
];

function conceptAvatar(seed: string): string {
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=1a1a1c`;
}

function sample(
  id: string,
  name: string,
  symbol: string,
  thesis: string,
  creatorId: string,
  allocations: ConceptBasketSample["allocations"],
): ConceptBasketSample {
  return {
    v: 1,
    id,
    name,
    symbol,
    thesis,
    creatorId,
    allocations,
    assets: allocations.map(({ symbol: assetSymbol, weightBps }) => ({
      symbol: assetSymbol,
      weightBps,
    })),
    amountUsd: 1_000,
    fees: { entryBps: 0, exitBps: 0, managementBps: 0 },
  };
}

/** Curated, illustrative baskets shared by Create, Explore, Feed and Leaderboard. */
export const CONCEPT_BASKETS: ConceptBasketSample[] = [
  sample(
    "concept-basket-mega-cap-tech",
    "Terminally Online",
    "ONLINE",
    "Platforms, chips and the world on your screen.",
    "concept-creator-maya",
    [
      { symbol: "NVDA", name: "NVIDIA", weightBps: 2200 },
      { symbol: "MSFT", name: "Microsoft", weightBps: 1800 },
      { symbol: "AAPL", name: "Apple", weightBps: 1600 },
      { symbol: "AMZN", name: "Amazon", weightBps: 1400 },
      { symbol: "GOOGL", name: "Alphabet", weightBps: 1200 },
      { symbol: "META", name: "Meta", weightBps: 1000 },
      { symbol: "AVGO", name: "Broadcom", weightBps: 800 },
    ],
  ),
  sample(
    "concept-basket-index-core",
    "Touch Grass",
    "GRASS",
    "An index at the core, with a few extra picks.",
    "concept-creator-jordan",
    [
      { symbol: "SPY", name: "S&P 500", weightBps: 4000 },
      { symbol: "MSFT", name: "Microsoft", weightBps: 1200 },
      { symbol: "AAPL", name: "Apple", weightBps: 1000 },
      { symbol: "JPM", name: "JPMorgan Chase", weightBps: 1000 },
      { symbol: "QQQ", name: "Nasdaq 100", weightBps: 1000 },
      { symbol: "NVDA", name: "NVIDIA", weightBps: 1000 },
      { symbol: "V", name: "Visa", weightBps: 800 },
    ],
  ),
  sample(
    "concept-basket-motion",
    "No Hands",
    "AUTO",
    "Cars, chips and the platforms that move them.",
    "concept-creator-riley",
    [
      { symbol: "TSLA", name: "Tesla", weightBps: 2200 },
      { symbol: "NVDA", name: "NVIDIA", weightBps: 1800 },
      { symbol: "UBER", name: "Uber", weightBps: 1600 },
      { symbol: "AMZN", name: "Amazon", weightBps: 1400 },
      { symbol: "GOOGL", name: "Alphabet", weightBps: 1200 },
      { symbol: "TSM", name: "Taiwan Semiconductor", weightBps: 1000 },
      { symbol: "AMD", name: "AMD", weightBps: 800 },
    ],
  ),
  sample(
    "concept-basket-quality-compounders",
    "Daily Ritual",
    "DAILY",
    "Brands and services people come back to.",
    "concept-creator-alex",
    [
      { symbol: "MSFT", name: "Microsoft", weightBps: 1800 },
      { symbol: "SPY", name: "S&P 500", weightBps: 1600 },
      { symbol: "V", name: "Visa", weightBps: 1400 },
      { symbol: "JPM", name: "JPMorgan Chase", weightBps: 1200 },
      { symbol: "AAPL", name: "Apple", weightBps: 1200 },
      { symbol: "KO", name: "Coca-Cola", weightBps: 1000 },
      { symbol: "MCD", name: "McDonald’s", weightBps: 1000 },
      { symbol: "ADBE", name: "Adobe", weightBps: 800 },
    ],
  ),
  sample(
    "concept-basket-chip-happens",
    "Chip Happens",
    "CHIPS",
    "Chipmakers behind everyday tech and AI.",
    "concept-creator-maya",
    [
      { symbol: "NVDA", name: "NVIDIA", weightBps: 3000 },
      { symbol: "AMD", name: "AMD", weightBps: 2500 },
      { symbol: "AVGO", name: "Broadcom", weightBps: 2000 },
      { symbol: "TSM", name: "Taiwan Semiconductor", weightBps: 2500 },
    ],
  ),
  sample(
    "concept-basket-after-hours",
    "After Hours",
    "LATE",
    "Streaming, scrolling and shopping after work.",
    "concept-creator-maya",
    [
      { symbol: "NFLX", name: "Netflix", weightBps: 3500 },
      { symbol: "META", name: "Meta", weightBps: 2500 },
      { symbol: "AMZN", name: "Amazon", weightBps: 2500 },
      { symbol: "GOOGL", name: "Alphabet", weightBps: 1500 },
    ],
  ),
  sample(
    "concept-basket-payday",
    "Payday",
    "PAYDAY",
    "Cards, banks and the crypto economy.",
    "concept-creator-jordan",
    [
      { symbol: "V", name: "Visa", weightBps: 4000 },
      { symbol: "JPM", name: "JPMorgan Chase", weightBps: 3500 },
      { symbol: "COIN", name: "Coinbase", weightBps: 2500 },
    ],
  ),
  sample(
    "concept-basket-offline-mode",
    "Offline Mode",
    "OFFLINE",
    "Food, drinks and everyday essentials.",
    "concept-creator-alex",
    [
      { symbol: "KO", name: "Coca-Cola", weightBps: 4000 },
      { symbol: "MCD", name: "McDonald’s", weightBps: 3500 },
      { symbol: "WMT", name: "Walmart", weightBps: 2500 },
    ],
  ),
  sample(
    "concept-basket-power-hungry",
    "Power Hungry",
    "POWER",
    "Chips and cloud tools behind the AI rush.",
    "concept-creator-maya",
    [
      { symbol: "NVDA", name: "NVIDIA", weightBps: 3000 },
      { symbol: "AVGO", name: "Broadcom", weightBps: 3000 },
      { symbol: "TSM", name: "Taiwan Semiconductor", weightBps: 2500 },
      { symbol: "ORCL", name: "Oracle", weightBps: 1500 },
    ],
  ),
  sample(
    "concept-basket-main-character",
    "Main Character",
    "MAIN",
    "Cars, chips, data and the crypto economy.",
    "concept-creator-riley",
    [
      { symbol: "TSLA", name: "Tesla", weightBps: 3000 },
      { symbol: "NVDA", name: "NVIDIA", weightBps: 2500 },
      { symbol: "PLTR", name: "Palantir", weightBps: 2500 },
      { symbol: "COIN", name: "Coinbase", weightBps: 2000 },
    ],
  ),
];

export const FEATURED_BASKETS = CONCEPT_BASKETS.slice(0, 4);

export const BASKET_STORY_COVERS: Record<string, string> = {
  "concept-basket-mega-cap-tech": "/images/baskets/terminally-online.png",
  "concept-basket-index-core": "/images/baskets/touch-grass.png",
  "concept-basket-motion": "/images/baskets/no-hands.png",
  "concept-basket-quality-compounders": "/images/baskets/daily-ritual.png",
  "concept-basket-chip-happens": "/images/baskets/chip-happens.png",
  "concept-basket-after-hours": "/images/baskets/after-hours.png",
  "concept-basket-payday": "/images/baskets/payday.png",
  "concept-basket-offline-mode": "/images/baskets/offline-mode.png",
  "concept-basket-power-hungry": "/images/baskets/power-hungry.png",
  "concept-basket-main-character": "/images/baskets/main-character.png",
};

/** Static example copy. No transaction claims, performance figures or timestamps. */
export const CONCEPT_ACTIVITY: ConceptActivity[] = [
  {
    id: "concept-activity-maya-share",
    creatorId: "concept-creator-maya",
    basketId: "concept-basket-mega-cap-tech",
    kind: "shared",
    title: "Terminally Online",
    body: "The platforms I use, plus the chips that keep them running.",
  },
  {
    id: "concept-activity-jordan-thesis",
    creatorId: "concept-creator-jordan",
    basketId: "concept-basket-index-core",
    kind: "thesis",
    title: "Touch Grass",
    body: "SPY is the core. A few tech and financial names fill out the mix.",
  },
  {
    id: "concept-activity-riley-share",
    creatorId: "concept-creator-riley",
    basketId: "concept-basket-motion",
    kind: "shared",
    title: "No Hands",
    body: "Tesla and Uber, plus the chips and platforms around them.",
  },
  {
    id: "concept-activity-alex-thesis",
    creatorId: "concept-creator-alex",
    basketId: "concept-basket-quality-compounders",
    kind: "thesis",
    title: "Daily Ritual",
    body: "Food, payments and work tools. Businesses with a place in everyday life.",
  },
  {
    id: "concept-activity-maya-thesis",
    creatorId: "concept-creator-maya",
    basketId: "concept-basket-mega-cap-tech",
    kind: "thesis",
    title: "Screens need silicon",
    body: "The apps get the attention. The chips do the work.",
  },
];

export function getConceptCreator(id: string): ConceptCreator | null {
  return CONCEPT_CREATORS.find((creator) => creator.id === id) ?? null;
}

export function getConceptBasket(id: string): ConceptBasketSample | null {
  return CONCEPT_BASKETS.find((basket) => basket.id === id) ?? null;
}

export function conceptBasketHref(basket: ConceptBasketSample): string {
  return conceptPreviewHref({
    v: 1,
    name: basket.name,
    thesis: basket.thesis,
    assets: basket.assets,
    amountUsd: basket.amountUsd,
    fees: basket.fees,
  });
}

export function getConceptBasketHref(id: string): string {
  const basket = getConceptBasket(id);
  return basket ? conceptBasketHref(basket) : "/explore";
}
