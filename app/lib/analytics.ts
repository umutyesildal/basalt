import type { BeforeSendEvent } from "@vercel/analytics/next";

/** Keep page paths useful without sending basket payloads or wallet identifiers. */
export function sanitizeAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password) {
      return null;
    }

    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/^\/creator\/[^/]+(?=\/|$)/, "/creator/[pubkey]");
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}
