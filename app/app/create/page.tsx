import type { Metadata } from "next";

import ConceptCreate from "@/components/create/concept-create";

export const metadata: Metadata = {
  title: "Create a Basket — Basalt",
  description: "Build and share a concept basket of stocks and ETFs in minutes.",
};

export default function CreatePage() {
  return <ConceptCreate />;
}
