import type { Metadata } from "next";

import FeedClient from "./feed-client";

export const metadata: Metadata = {
  // absolute: the root layout appends "· Basalt" via its title template — a
  // plain string here would render "Feed — Basalt · Basalt".
  title: { absolute: "Basalt | Feed" },
  description:
    "Stock picks and the stories behind them.",
};

export default function FeedPage() {
  return <FeedClient />;
}
