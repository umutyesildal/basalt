import type { Metadata } from "next";

import { siteUrl } from "@/app/site";
import { conceptPreviewHref, decodeConceptBasket, encodeConceptBasket } from "@/lib/concept-share";
import ConceptPreviewClient from "./preview-client";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ d?: string | string[]; created?: string | string[] }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const encoded = typeof params.d === "string" ? params.d : null;
  const basket = decodeConceptBasket(encoded);
  const title = basket ? `${basket.name} · Basalt` : "Stock basket · Basalt";
  const description = basket?.thesis || "Explore this stock basket on Basalt.";
  const image = basket ? `/api/basket-image/social?d=${encodeConceptBasket(basket)}` : "/opengraph-image";
  return {
    metadataBase: new URL(siteUrl()),
    title: { absolute: title }, description,
    openGraph: { title, description, type: "website", siteName: "Basalt", ...(basket ? { url: conceptPreviewHref(basket) } : {}), images: [{ url: image, width: 1200, height: 630, alt: basket ? `${basket.name}, a stock basket on Basalt` : "Basalt stock baskets" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
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
