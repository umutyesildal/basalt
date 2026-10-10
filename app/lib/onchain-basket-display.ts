import { isBasketCoverId, type BasketCoverId } from "./basket-covers";
import { truncateAddress } from "./format";

export interface OnchainBasketDisplay {
  name: string;
  thesis: string | null;
  coverId: BasketCoverId | null;
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    // Avoid parsing unbounded display metadata from a malformed feed.
    if (value.length > 16_384) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function displayText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? Array.from(text).slice(0, limit).join("").trimEnd() : null;
}

/** Display-only metadata; missing artwork remains an explicit placeholder choice. */
export function onchainBasketDisplay(metadataJson: unknown, pubkey: string): OnchainBasketDisplay {
  const metadata = metadataRecord(metadataJson);
  return {
    name: displayText(metadata?.name, 64) ?? `Basket ${truncateAddress(pubkey, 4, 4)}`,
    thesis: displayText(metadata?.description, 400) ?? displayText(metadata?.thesis, 400),
    coverId: isBasketCoverId(metadata?.coverId) ? metadata.coverId : null,
  };
}
