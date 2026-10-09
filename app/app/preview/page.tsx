import type { Metadata } from "next";

import { basketPreviewMetadata } from "@/lib/basket-preview-metadata";
import { decodeConceptBasket } from "@/lib/concept-share";
import ConceptPreviewClient from "./preview-client";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ d?: string | string[]; created?: string | string[] }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const encoded = typeof params.d === "string" ? params.d : null;
  const basket = decodeConceptBasket(encoded);
  return basketPreviewMetadata(basket);
}

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string | string[]; created?: string | string[] }>;
}) {
  const params = await searchParams;
  const encoded = typeof params.d === "string" ? params.d : null;
  const basket = decodeConceptBasket(encoded);

  return <ConceptPreviewClient basket={basket} created={params.created === "1"} />;
}
