import type { Metadata } from "next";

import LeaderboardClient from "./leaderboard-client";

export const metadata: Metadata = {
  // absolute: the root layout appends "· Basalt" via its title template — a
  // plain string here would render "Leaderboard — Basalt · Basalt".
  title: { absolute: "Basalt | Leaderboard" },
  description:
    "Ten sample stock baskets, ranked by seven-day model return.",
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
