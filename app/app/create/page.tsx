import type { Metadata } from "next";

import ConceptCreate from "@/components/create/concept-create";
import { decodeConceptBasket } from "@/lib/concept-share";

export const metadata: Metadata = {
  title: "Create a Basket — Basalt",
  description: "Build and share a concept basket of stocks and ETFs in minutes.",
};

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ copy?: string | string[] }> }) {
  const params = await searchParams;
  const encoded = typeof params.copy === "string" ? params.copy : null;
  return <ConceptCreate key={encoded ?? "new"} initialBasket={decodeConceptBasket(encoded)} />;
}
