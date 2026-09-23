import type { Metadata } from "next";

import LeaderboardClient from "./leaderboard-client";

export const metadata: Metadata = {
  // absolute: the root layout appends "· Basalt" via its title template — a
  // plain string here would render "Leaderboard — Basalt · Basalt".
  title: { absolute: "Basalt | Leaderboard" },
  description:
    "Explore illustrative Basalt basket ideas and creators, with indexed onchain rankings kept separate.",
};

export default function LeaderboardPage() {
  return <LeaderboardClient />;
}
