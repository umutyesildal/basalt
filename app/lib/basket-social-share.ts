import type { ConceptBasket } from "@/lib/concept-basket";
import { conceptPreviewHref, encodeConceptBasket } from "@/lib/concept-share";
import { publicSiteOrigin } from "@/lib/site-origin";
import { apiFetch } from "@/lib/api-client";
import type { BasketPerformanceResponse } from "@/lib/basket-performance";
import { getBasketSharePerformance } from "@/lib/basket-share-performance";
import { formatPercent } from "@/lib/format";

const SOCIAL_FOOTER = "Check out more at @basalt_sol";
const textWeight = (text: string) => Array.from(text).reduce((total, char) => total + (char.codePointAt(0)! <= 0x7f ? 1 : 2), 0);
const cleanText = (text: string) => text.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();

function truncateSocialText(text: string, budget: number): string {
  if (textWeight(text) <= budget) return text;
  const segments = typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ segment }) => segment)
    : Array.from(text);
  let result = "", weight = 0;
  for (const segment of segments) {
    const cost = textWeight(segment);
    if (weight + cost > budget - 2) break; // Reserve the ellipsis without splitting emoji.
    result += segment; weight += cost;
  }
  return `${result.trimEnd()}…`;
}

/** Only exact-mix, verified weekly model evidence can produce a performance sentence. */
export function basketSocialText(basket: ConceptBasket, performanceData?: BasketPerformanceResponse | null, shareUrl?: string): string {
  const performance = getBasketSharePerformance(basket, performanceData);
  const name = cleanText(basket.name);
  let title = `${name} stock basket`;
  if (performance) {
    const change = performance.return7dPct;
    title += change > 0 ? ` has gained ${formatPercent(change)} this week!`
      : change < 0 ? ` is down ${formatPercent(Math.abs(change))} this week.` : " is flat this week.";
  }
  const thesis = cleanText(basket.thesis);
  // X counts a URL as 23 units. Keep the link and footer intact, and also reserve
  // that space when native sharing supplies its URL separately.
  const budget = 280 - 23 - 4 - textWeight(SOCIAL_FOOTER);
  const main = truncateSocialText(thesis ? `${title}\n\n${thesis}` : title, budget);
  const link = shareUrl ? `${thesis ? " " : "\n\n"}${shareUrl}` : "";
  return `${main}${link}\n\n${SOCIAL_FOOTER}`;
}

export function basketPublicLink(basket: ConceptBasket, origin: string): string {
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Invalid site origin");
  return new URL(conceptPreviewHref(basket), publicSiteOrigin(base.origin)).href;
}

export const BASKET_SHARE_ID_RE = /^[A-Za-z0-9_-]{20}$/;
const shareIds = new Map<string, Promise<string>>();

/** Persist only when someone chooses to share. Repeated clicks share one request. */
export async function ensureBasketPublicLink(basket: ConceptBasket, origin: string): Promise<string> {
  const fallback = new URL(basketPublicLink(basket, origin)); // Validate the site before writing.
  const encoded = encodeConceptBasket(basket);
  let pending = shareIds.get(encoded);
  if (!pending) {
    pending = (async () => {
      const response = await apiFetch("/api/v1/basket-shares", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encoded }), credentials: "omit", redirect: "error",
        cache: "no-store", signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Couldn't create a short link. Try again.");
      const value = await response.json();
      if (typeof value?.data?.id !== "string" || !BASKET_SHARE_ID_RE.test(value.data.id)) throw new Error("Invalid basket link response");
      return value.data.id as string;
    })();
    shareIds.set(encoded, pending);
    if (shareIds.size > 64) shareIds.delete(shareIds.keys().next().value!);
    void pending.catch(() => { if (shareIds.get(encoded) === pending) shareIds.delete(encoded); });
  }
  return new URL(`/b/${await pending}`, fallback.origin).href;
}

export function basketXIntent(basket: ConceptBasket, origin: string, shortLink?: string, performanceData?: BasketPerformanceResponse | null): string {
  const fallback = new URL(basketPublicLink(basket, origin));
  if (shortLink) {
    const supplied = new URL(shortLink);
    if (supplied.origin !== fallback.origin || supplied.username || supplied.password || supplied.search || supplied.hash ||
      !/^\/b\/[A-Za-z0-9_-]{20}$/.test(supplied.pathname)) throw new Error("Invalid basket share link");
  }
  const params = new URLSearchParams({ text: basketSocialText(basket, performanceData, shortLink || fallback.href) });
  return `https://twitter.com/intent/tweet?${params}`;
}
