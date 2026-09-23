import type { Metadata } from "next";

import ExploreClient from "./explore-client";

export const metadata: Metadata = {
  // absolute: the root layout appends "· Basalt" via its title template — a
  // plain string here would render "Baskets — Basalt · Basalt".
  title: { absolute: "Basalt | Baskets" },
  description:
    "Explore curated stock basket ideas, review their composition, and create a basket of your own.",
};

export default function BasketsPage() {
  return (
    <>
      <ExploreClient />
    </>
  );
}
