import type { Metadata } from "next";

import LeaderboardClient from "./leaderboard-client";

export const metadata: Metadata = {
  // absolute: the root layout appends "· Basalt" via its title template — a
  // plain string here would render "Leaderboard — Basalt · Basalt".
  title: { absolute: "Basalt | Leaderboard" },
  description:
    "Public Basalt traders ranked by estimated portfolio return over 7 days, 30 days and all time.",
};

export default function LeaderboardPage() {
  return <LeaderboardClient />;
}
