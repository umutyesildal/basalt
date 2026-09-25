import type { Metadata } from "next";

import LeaderboardClient from "./leaderboard-client";

export const metadata: Metadata = {
  // absolute: the root layout appends "· Basalt" via its title template — a
  // plain string here would render "Leaderboard — Basalt · Basalt".
  title: { absolute: "Basalt | Creators & ideas" },
  description:
    "Discover sample basket ideas and the people behind them, with indexed Devnet rankings kept separate.",
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialTab = params.tab === "people" ? "people" : "baskets";
  return <LeaderboardClient initialTab={initialTab} />;
}
