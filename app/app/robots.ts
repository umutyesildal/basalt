import type { MetadataRoute } from "next";

import { siteUrl } from "./site";

/**
 * robots.txt — one group, resolved by longest-path-match:
 *
 *   path                     rule      why
 *   /api/                    disallow  REST surface is for the app, not crawlers
 *   /api/agent/              allow     agent basket endpoint is PUBLIC by design
 *                                      (see public/llms.txt "Agent surfaces")
 *   /llms.txt                allow     machine-readable site brief
 *   /basalt-agent-guide.md   allow     agent how-to, referenced from /llms.txt
 *   /                        allow     every static page (home, explore, market,
 *                                      portfolio, create, feed, leaderboard,
 *                                      stocks, etfs, providers, legal)
 *
 * Basket detail pages (/basket/<pubkey>) fall under "/" — they are public
 * pages, but not listed in the sitemap (see sitemap.ts).
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/llms.txt", "/basalt-agent-guide.md", "/api/agent/"],
        disallow: ["/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
