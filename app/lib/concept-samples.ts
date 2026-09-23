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
    bio: "Long-term themes, clear weights, and a thesis you can explain in one sentence.",
  },
  {
    id: "concept-creator-jordan",
    handle: "jordan.lee",
    displayName: "Jordan Lee",
    avatarUrl: conceptAvatar("jordan-lee"),
    bio: "Broad market ideas with room for a small, deliberate growth tilt.",
  },
  {
    id: "concept-creator-riley",
    handle: "riley.parks",
    displayName: "Riley Parks",
    avatarUrl: conceptAvatar("riley-parks"),
    bio: "I turn a point of view into a basket that is easy to inspect and share.",
  },
  {
    id: "concept-creator-alex",
    handle: "alex.morgan",
    displayName: "Alex Morgan",
    avatarUrl: conceptAvatar("alex-morgan"),
    bio: "Quality businesses first. Every allocation has a reason to be there.",
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
    "Mega-Cap Tech",
    "MCT",
    "A concentrated view of the platforms and chipmakers shaping modern technology.",
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
    "Index Core",
    "CORE",
    "A broad-market starting point with a measured tilt toward durable, large businesses.",
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
    "Motion",
    "MOVE",
    "A thesis on the companies building the next generation of mobility and automation.",
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
    "Quality Compounders",
    "QUAL",
    "Established businesses with strong brands, repeat customers, and room to keep investing.",
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
];

/** Static example copy. No transaction claims, performance figures or timestamps. */
export const CONCEPT_ACTIVITY: ConceptActivity[] = [
  {
    id: "concept-activity-maya-share",
    creatorId: "concept-creator-maya",
    basketId: "concept-basket-mega-cap-tech",
    kind: "shared",
    title: "A technology basket with the thesis up front",
    body: "Maya’s concept puts chipmakers and platform businesses in one easy-to-review mix.",
  },
  {
    id: "concept-activity-jordan-thesis",
    creatorId: "concept-creator-jordan",
    basketId: "concept-basket-index-core",
    kind: "thesis",
    title: "Start broad, then make the tilt visible",
    body: "Jordan keeps a broad index at the center and names each company behind the additional tilt.",
  },
  {
    id: "concept-activity-riley-share",
    creatorId: "concept-creator-riley",
    basketId: "concept-basket-motion",
    kind: "shared",
    title: "Mobility is bigger than one automaker",
    body: "Riley’s concept connects vehicle makers, software platforms, and the tools behind automation.",
  },
  {
    id: "concept-activity-alex-thesis",
    creatorId: "concept-creator-alex",
    basketId: "concept-basket-quality-compounders",
    kind: "thesis",
    title: "A quality lens built from familiar businesses",
    body: "Alex looks for brands and customer relationships that can support steady reinvestment.",
  },
  {
    id: "concept-activity-maya-thesis",
    creatorId: "concept-creator-maya",
    basketId: "concept-basket-mega-cap-tech",
    kind: "thesis",
    title: "Why include both chips and platforms?",
    body: "The idea pairs the infrastructure layer with the products and services people use every day.",
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
