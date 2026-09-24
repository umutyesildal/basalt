import {
  CONCEPT_BASKET_LIMITS,
  validateConceptBasket,
  type ConceptBasket,
} from "@/lib/concept-basket";

function toBase64Url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Compact, self-contained links need no account, database, or running backend. */
export function encodeConceptBasket(basket: ConceptBasket): string {
  const validation = validateConceptBasket(basket);
  if (!validation.ok) throw new Error(validation.errors[0] ?? "This basket cannot be shared.");
  const { name, thesis, assets, amountUsd, fees } = validation.value;
  const compact: unknown[] = [2, name, amountUsd, assets.flatMap(({ symbol, weightBps }) => [symbol, weightBps])];
  if (thesis || fees.entryBps || fees.exitBps || fees.managementBps) compact.push(thesis);
  if (fees.entryBps || fees.exitBps || fees.managementBps) compact.push([fees.entryBps, fees.exitBps, fees.managementBps]);
  const encoded = `2.${toBase64Url(compact)}`;
  if (encoded.length > CONCEPT_BASKET_LIMITS.maxEncodedLength) {
    throw new Error("This basket is too large to share.");
  }
  return encoded;
}

/** Return a validated preview or null for malformed, oversized, or unsupported links. */
export function decodeConceptBasket(encoded: string | null | undefined): ConceptBasket | null {
  if (!encoded || encoded.length > CONCEPT_BASKET_LIMITS.maxEncodedLength || !/^(?:2\.)?[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }
  try {
    const base64 = encoded.replace(/^2\./, "").replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.length > 3_072) return null;
    const payload: unknown = JSON.parse(decoded);
    let basket: unknown = payload;
    if (encoded.startsWith("2.")) {
      if (!Array.isArray(payload) || payload.length < 4 || payload.length > 6 || payload[0] !== 2 || !Array.isArray(payload[3]) || payload[3].length % 2 !== 0) return null;
      if (payload.length >= 5 && typeof payload[4] !== "string") return null;
      if (payload.length === 6 && (!Array.isArray(payload[5]) || payload[5].length !== 3)) return null;
      const flat = payload[3];
      basket = {
        v: 1,
        name: payload[1],
        amountUsd: payload[2],
        assets: Array.from({ length: flat.length / 2 }, (_, index) => ({ symbol: flat[index * 2], weightBps: flat[index * 2 + 1] })),
        thesis: payload[4] ?? "",
        fees: payload.length === 6
          ? { entryBps: payload[5][0], exitBps: payload[5][1], managementBps: payload[5][2] }
          : { entryBps: 0, exitBps: 0, managementBps: 0 },
      };
    }
    const validation = validateConceptBasket(basket);
    return validation.ok ? validation.value : null;
  } catch {
    return null;
  }
}

export function conceptPreviewHref(basket: ConceptBasket): string {
  return `/preview?d=${encodeConceptBasket(basket)}`;
}

export function conceptCopyHref(basket: ConceptBasket): string {
  return `/create?copy=${encodeConceptBasket(basket)}`;
}
