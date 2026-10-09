import type { ConceptBasket } from "@/lib/concept-basket";
import { conceptPreviewHref, encodeConceptBasket } from "@/lib/concept-share";
import { publicSiteOrigin } from "@/lib/site-origin";
import { apiFetch } from "@/lib/api-client";

/** Only editable post text and a basket link are passed to X, never a media upload. */
export function basketSocialText(basket: Pick<ConceptBasket, "name" | "thesis">): string {
  const title = `My stock basket: ${basket.name.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim()}`;
  const thesis = basket.thesis.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  const text = thesis ? `${title}\n\n${thesis}` : title;
  const segments = typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ segment }) => segment)
    : Array.from(text);
  // Leave room for the shortened link and avoid splitting an emoji cluster.
  let result = "", weight = 0;
  for (const segment of segments) {
    // Conservative X budget: ASCII costs one, other code points cost two.
    // Emoji clusters stay intact even when this overestimates their weight.
    const cost = Array.from(segment).reduce((total, char) => total + (char.codePointAt(0)! <= 0x7f ? 1 : 2), 0);
    if (weight + cost > 228) return `${result.trimEnd()}…`;
    result += segment; weight += cost;
  }
  return result;
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

export function basketXIntent(basket: ConceptBasket, origin: string, shortLink?: string): string {
  const fallback = new URL(basketPublicLink(basket, origin));
  if (shortLink) {
    const supplied = new URL(shortLink);
    if (supplied.origin !== fallback.origin || supplied.username || supplied.password || supplied.search || supplied.hash ||
      !/^\/b\/[A-Za-z0-9_-]{20}$/.test(supplied.pathname)) throw new Error("Invalid basket share link");
  }
  const params = new URLSearchParams({ text: basketSocialText(basket), url: shortLink || fallback.href });
  return `https://twitter.com/intent/tweet?${params}`;
}
