import type { ConceptBasket } from "@/lib/concept-basket";
import { conceptPreviewHref } from "@/lib/concept-share";
import { publicSiteOrigin } from "@/lib/site-origin";

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

export function basketXIntent(basket: ConceptBasket, origin: string): string {
  const params = new URLSearchParams({ text: basketSocialText(basket), url: basketPublicLink(basket, origin) });
  return `https://twitter.com/intent/tweet?${params}`;
}
