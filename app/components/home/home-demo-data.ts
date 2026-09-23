import type {
  BasketLeaderboardEntry,
  ThesisFeedItem,
  TradeFeedItem,
} from "@/lib/social-api";
import { CONCEPT_CREATORS } from "@/lib/concept-samples";

/**
 * The old home demo overlay represented sample ideas as recent onchain trades,
 * attached them to devnet baskets and supplied made-up NAV/AUM figures. Keep
 * the compatibility exports empty so that overlay can never imply activity
 * or performance that did not happen. Concept surfaces consume the shared
 * wallet-free catalog in `lib/concept-samples` instead.
 */
export const DEMO_TRADES: TradeFeedItem[] = [];
export const DEMO_THESES: ThesisFeedItem[] = [];
export const DEMO_BASKETS: BasketLeaderboardEntry[] = [];

export interface DemoTrader {
  wallet: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
}

/** Shared concept personas for surfaces that only need profile identity. */
export const DEMO_TRADERS: DemoTrader[] = CONCEPT_CREATORS.map((creator) => ({
  wallet: creator.id,
  handle: creator.handle,
  displayName: creator.displayName,
  avatarUrl: creator.avatarUrl,
  bio: creator.bio,
}));

export function demoAvatar(handle: string): string {
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(handle)}&backgroundColor=1a1a1c`;
}
