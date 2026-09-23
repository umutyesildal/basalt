import type { LeaderboardEntry, ThesisFeedItem, TradeFeedItem } from "@/lib/social-api";

/**
 * Compatibility types for the legacy synthetic profile renderer. That
 * renderer is no longer fed sample activity: concept people are resolved
 * from `lib/concept-samples` and link to wallet-free preview pages.
 */
export interface DemoCreatorPosition {
  basket: string;
  basketName: string;
  shares: number;
  usdValue: number;
}

export interface DemoCreatorStats {
  followers: number;
  following: number;
  trades: number;
  roiPct: number;
  valueUsd: number;
  positionCount: number;
  memberSince: string;
}

export interface DemoCreator {
  wallet: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  stats: DemoCreatorStats;
  positions: DemoCreatorPosition[];
  trades: TradeFeedItem[];
  theses: ThesisFeedItem[];
}

/** Legacy demo leaderboard payload intentionally disabled. */
export const DEMO_LEADERBOARD_USERS: LeaderboardEntry[] = [];

/** No synthetic wallet ids resolve to profile pages anymore. */
export function getDemoCreator(_wallet: string): DemoCreator | null {
  return null;
}
