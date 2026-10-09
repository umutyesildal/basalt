import { CANONICAL_SITE_URL, publicSiteOrigin } from "@/lib/site-origin";

/** Canonical origin for metadata, crawl URLs and public sharing. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return configured ? publicSiteOrigin(configured) : CANONICAL_SITE_URL;
}
