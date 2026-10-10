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

// Decorative display identities for legacy devnet baskets with no published
// metadata. These aliases do not describe their assets or alter their hashes.
const DEVNET_IDENTITIES = [
  { address: "38VG85nUbemsfKzozHtnr3oaf4VKFdAk1ySPCt4LDM4S", name: "First Move", coverId: "fresh-start" },
  { address: "4tkoyCsktgfkNpN1ovAnvuLHLcfXiFcdAUQskQUBA65z", name: "Four Corners", coverId: "world-tour" },
  { address: "6CUXMFNehD7DU1Njbxu7cg8B5Fesmn64tJUDQ6EoqGMv", name: "Threefold", coverId: "orbit" },
  { address: "78jbGZHDiH1jSdctS9bxVkKQgNzuzt1nCX9DiimyYLir", name: "Mainframe", coverId: "deep-focus" },
  { address: "9PoTEPsCjew9NtYA9MLTjDapMsW1ZdW4dgokdGzmPimB", name: "Open Circuit", coverId: "robot-shift" },
  { address: "9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg", name: "Core Three", coverId: "cloud-nine" },
  { address: "CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo", name: "Wide Lens", coverId: "signal-noise" },
  { address: "E8mBqH3xp74z5HZ52nDyex14XyDk3aDLz6oMmy8FfodR", name: "New Chapter", coverId: "moon-shot" },
  { address: "HYq16UQLv8HnBnzZDgjEJWnYS1mrUs5rzzbycQEGduSW", name: "Triple Play", coverId: "side-quest" },
  { address: "YZuBJ6PmVZXvaGHmNC8g84j1H61zDWpZ1mkENjGcrd8", name: "Even Steven", coverId: "bull-case" },
] as const satisfies readonly { address: string; name: string; coverId: BasketCoverId }[];

function devnetIdentity(address: string) {
  const known = DEVNET_IDENTITIES.find((identity) => identity.address === address);
  if (known) return known;
  let hash = 2166136261;
  for (const character of address) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return DEVNET_IDENTITIES[(hash >>> 0) % DEVNET_IDENTITIES.length];
}

function compositionDescription(options: OnchainBasketDisplayOptions): string {
  const validCount = (count: unknown): count is number => typeof count === "number" && Number.isSafeInteger(count) && count >= 2 && count <= 20;
  const count = validCount(options.assetCount) ? options.assetCount
    : validCount(options.weightsBps?.length) ? options.weightsBps!.length
    : validCount(options.tickers?.length) ? options.tickers!.length : null;
  if (count === null) return "A basket from the community.";
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
  const label = `${words[count]} tokens`;
  const weights = options.weightsBps;
  if (weights?.length === count && weights.every((weight) => Number.isSafeInteger(weight) && weight > 0 && weight <= 10_000) && weights.reduce((sum, weight) => sum + weight, 0) === 10_000 && weights.every((weight) => weight === weights[0])) {
    return `${label}, evenly split.`;
  }
  return count <= 4 ? `${label}, one simple mix.` : `${label} in one basket.`;
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

/** Actual display metadata wins; optional devnet aliases remain presentation-only. */
export function onchainBasketDisplay(metadataJson: unknown, pubkey: string, options: OnchainBasketDisplayOptions = {}): OnchainBasketDisplay {
  const metadata = metadataRecord(metadataJson);
  const decorative = options.devnet === true ? devnetIdentity(pubkey) : null;
  return {
    name: displayText(metadata?.name, 64) ?? decorative?.name ?? `Basket ${truncateAddress(pubkey, 4, 4)}`,
    thesis: displayText(metadata?.description, 400) ?? displayText(metadata?.thesis, 400) ?? (decorative ? compositionDescription(options) : null),
    coverId: isBasketCoverId(metadata?.coverId) ? metadata.coverId : decorative?.coverId ?? null,
  };
}
