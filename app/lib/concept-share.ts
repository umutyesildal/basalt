import {
  CONCEPT_BASKET_LIMITS,
  validateConceptBasket,
  type ConceptBasket,
} from "@/lib/concept-basket";

/** Encode a bounded, versioned basket definition as URL-safe UTF-8 base64. */
export function encodeConceptBasket(basket: ConceptBasket): string {
  const validation = validateConceptBasket(basket);
  if (!validation.ok) throw new Error(validation.errors[0] ?? "This basket cannot be shared.");

  const bytes = new TextEncoder().encode(JSON.stringify(validation.value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (encoded.length > CONCEPT_BASKET_LIMITS.maxEncodedLength) {
    throw new Error("This basket is too large to share.");
  }
  return encoded;
}

/** Return a validated preview or null for malformed, oversized, or unsupported links. */
export function decodeConceptBasket(encoded: string | null | undefined): ConceptBasket | null {
  if (!encoded || encoded.length > CONCEPT_BASKET_LIMITS.maxEncodedLength || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.length > 3_072) return null;
    const validation = validateConceptBasket(JSON.parse(decoded));
    return validation.ok ? validation.value : null;
  } catch {
    return null;
  }
}

export function conceptPreviewHref(basket: ConceptBasket): string {
  return `/preview?d=${encodeConceptBasket(basket)}`;
}
