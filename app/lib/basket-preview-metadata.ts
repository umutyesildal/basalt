import type { Metadata } from "next";
import { siteUrl } from "@/app/site";
import type { ConceptBasket } from "@/lib/concept-basket";
import { conceptPreviewHref, encodeConceptBasket } from "@/lib/concept-share";

export function basketPreviewMetadata(basket: ConceptBasket | null, href?: string): Metadata {
  const title = basket ? `${basket.name} · Basalt` : "Stock basket · Basalt";
  const description = basket?.thesis || "Explore this stock basket on Basalt.";
  const image = basket ? `/api/basket-image/social?d=${encodeConceptBasket(basket)}` : "/opengraph-image";
  return {
    metadataBase: new URL(siteUrl()), title: { absolute: title }, description,
    ...(href ? { alternates: { canonical: href } } : {}),
    openGraph: { title, description, type: "website", siteName: "Basalt", ...(basket ? { url: href || conceptPreviewHref(basket) } : {}), images: [{ url: image, width: 1200, height: 630, alt: basket ? `${basket.name}, a stock basket on Basalt` : "Basalt stock baskets" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
