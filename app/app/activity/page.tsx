import type { Metadata } from "next";

import ActivityClient from "./activity-client";

export const metadata: Metadata = {
  // absolute: the root layout appends "· Basalt" via its title template — a
  // plain string here would render "Protocol activity — Basalt · Basalt"
  // (same reason /leaderboard declares an absolute title).
  title: { absolute: "Protocol activity — Basalt" },
  description: "Everything, in public.",
};

export default function ActivityPage() {
  return <ActivityClient />;
}
