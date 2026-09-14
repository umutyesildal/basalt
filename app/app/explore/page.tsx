import type { Metadata } from "next";

import ExploreClient from "./explore-client";

export const metadata: Metadata = {
  // absolute: the root layout appends "· Basalt" via its title template — a
  // plain string here would render "Baskets — Basalt · Basalt".
  title: { absolute: "Basalt | Baskets" },
  description:
    "Community-made strategy baskets: who created each one, AUM, share price, holders, and performance vs the SPY benchmark.",
};

export default function BasketsPage() {
  return (
    <>
      <ExploreClient />
    </>
  );
}
