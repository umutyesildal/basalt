"use client";

import { Analytics } from "@vercel/analytics/next";
import { sanitizeAnalyticsEvent } from "@/lib/analytics";

export function SiteAnalytics() {
  return <Analytics beforeSend={sanitizeAnalyticsEvent} />;
}
