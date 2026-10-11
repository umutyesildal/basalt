import { isBasketCoverId, type BasketCoverId } from "./basket-covers";
import { truncateAddress } from "./format";

export interface OnchainBasketDisplay {
  name: string;
  thesis: string | null;
  coverId: BasketCoverId | null;
}

export interface OnchainBasketDisplayOptions {
  devnet?: boolean;
  assetCount?: number | null;
  tickers?: readonly string[];
  weightsBps?: readonly number[];
}

// Stable placeholder covers for legacy devnet baskets without published art.
const DEVNET_COVERS = [
  { address: "38VG85nUbemsfKzozHtnr3oaf4VKFdAk1ySPCt4LDM4S", coverId: "fresh-start" },
  { address: "4tkoyCsktgfkNpN1ovAnvuLHLcfXiFcdAUQskQUBA65z", coverId: "world-tour" },
  { address: "6CUXMFNehD7DU1Njbxu7cg8B5Fesmn64tJUDQ6EoqGMv", coverId: "orbit" },
  { address: "78jbGZHDiH1jSdctS9bxVkKQgNzuzt1nCX9DiimyYLir", coverId: "deep-focus" },
  { address: "9PoTEPsCjew9NtYA9MLTjDapMsW1ZdW4dgokdGzmPimB", coverId: "robot-shift" },
  { address: "9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg", coverId: "cloud-nine" },
  { address: "CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo", coverId: "signal-noise" },
  { address: "E8mBqH3xp74z5HZ52nDyex14XyDk3aDLz6oMmy8FfodR", coverId: "moon-shot" },
  { address: "HYq16UQLv8HnBnzZDgjEJWnYS1mrUs5rzzbycQEGduSW", coverId: "side-quest" },
  { address: "YZuBJ6PmVZXvaGHmNC8g84j1H61zDWpZ1mkENjGcrd8", coverId: "bull-case" },
] as const satisfies readonly { address: string; coverId: BasketCoverId }[];

function devnetIdentity(address: string) {
  const known = DEVNET_COVERS.find((identity) => identity.address === address);
  if (known) return known;
  let hash = 2166136261;
  for (const character of address) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return DEVNET_COVERS[(hash >>> 0) % DEVNET_COVERS.length];
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

/** Only creator metadata supplies names/theses; fallback art is a placeholder. */
export function onchainBasketDisplay(metadataJson: unknown, pubkey: string, options: OnchainBasketDisplayOptions = {}): OnchainBasketDisplay {
  const metadata = metadataRecord(metadataJson);
  const decorative = options.devnet === true ? devnetIdentity(pubkey) : null;
  return {
    name: displayText(metadata?.name, 64) ?? `Basket ${truncateAddress(pubkey, 4, 4)}`,
    thesis: displayText(metadata?.description, 400) ?? displayText(metadata?.thesis, 400) ?? null,
    coverId: isBasketCoverId(metadata?.coverId) ? metadata.coverId : decorative?.coverId ?? null,
  };
}
