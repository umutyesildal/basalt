/**
 * Canonical site origin for the crawl surface (robots.ts, sitemap.ts) — and
 * the intended source for layout.tsx `metadataBase` once that file's ownership
 * allows the swap. Single source so the two crawl files can never drift.
 *
 * Resolution order:
 *   1. `NEXT_PUBLIC_SITE_URL` (deploy-time env, no trailing slash needed)
 *   2. `http://localhost:3000` — the same fallback `metadataBase` uses today.
 *
 * No third source on purpose: a guessed domain in a sitemap is worse than an
 * explicit localhost.
 */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const origin =
    raw && raw.length > 0
      ? /^https?:\/\//i.test(raw)
        ? raw
        : `https://${raw}`
      : "http://localhost:3000";
  return origin.replace(/\/+$/, "");
}
