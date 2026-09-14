import type { Metadata } from "next";

import FeedClient from "./feed-client";

export const metadata: Metadata = {
  // absolute: the root layout appends "· Basalt" via its title template — a
  // plain string here would render "Feed — Basalt · Basalt".
  title: { absolute: "Basalt | Feed" },
  description:
    "Trades and theses from public Basalt strategy baskets — what the community is minting, redeeming and writing.",
};

export default function FeedPage() {
  return <FeedClient />;
}
