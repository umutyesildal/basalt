import type { MetadataRoute } from "next";

import { siteUrl } from "./site";

/**
 * Sitemap — STATIC ROUTES ONLY. Basket detail URLs are pubkey-addressed
 * (/basket/<pubkey>) and the index grows permissionlessly; listing them would
 * mean coupling the build to the indexer, so they are deliberately excluded.
 * The same origin as robots.ts (app/app/site.ts) — keep the two in sync.
 */
const STATIC_ROUTES: { path: string; priority: number }[] = [
  { path: "", priority: 1 },
  { path: "explore", priority: 0.9 },
  { path: "market", priority: 0.7 },
  { path: "stocks", priority: 0.6 },
  { path: "etfs", priority: 0.6 },
  { path: "create", priority: 0.6 },
  { path: "feed", priority: 0.5 },
  { path: "leaderboard", priority: 0.5 },
  { path: "portfolio", priority: 0.3 },
  { path: "providers", priority: 0.3 },
  { path: "legal", priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = new Date();
  return STATIC_ROUTES.map(({ path, priority }) => ({
    url: path === "" ? `${base}/` : `${base}/${path}`,
    lastModified,
    priority,
  }));
}
