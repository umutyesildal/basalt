import type { Metadata } from "next";

import { decodeConceptBasket } from "@/lib/concept-share";
import ConceptPreviewClient from "./preview-client";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ d?: string | string[] }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const encoded = typeof params.d === "string" ? params.d : null;
  const basket = decodeConceptBasket(encoded);
  return {
    title: { absolute: basket ? `${basket.name} preview · Basalt` : "Basket preview · Basalt" },
    description: basket
      ? `Review and share ${basket.name}, a concept basket of stocks and ETFs.`
      : "Review and share a concept basket of stocks and ETFs.",
  };
}

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string | string[] }>;
}) {
  const params = await searchParams;
  const encoded = typeof params.d === "string" ? params.d : null;
  const basket = decodeConceptBasket(encoded);

  return <ConceptPreviewClient basket={basket} />;
}
