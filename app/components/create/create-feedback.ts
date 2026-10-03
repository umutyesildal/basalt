import type { ConceptBasket } from "@/lib/concept-basket";

export const RECOMMENDED_MANAGEMENT_BPS = 200;

/** Defaults apply only to a new idea. A copied basket retains every selected fee and asset. */
export function initialCreateDraft(initialBasket: ConceptBasket | null): ConceptBasket {
  if (initialBasket) return { ...initialBasket, assets: initialBasket.assets.map((asset) => ({ ...asset })), fees: { ...initialBasket.fees } };
  return { v: 1, name: "My stock basket", thesis: "", assets: [], amountUsd: 1_000, fees: { entryBps: 0, exitBps: 0, managementBps: RECOMMENDED_MANAGEMENT_BPS } };
}

type CreationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const CREATION_KEY = "basalt:created-preview";
let pendingHref: string | null = null;

/** Arm a one-time success message only from the completed Share basket action. */
export function rememberCreatedPreview(href: string, storage?: CreationStorage | null): void {
  pendingHref = href;
  try { storage?.setItem(CREATION_KEY, href); } catch { /* In-memory fallback for storage-restricted browsers. */ }
}

/** Refreshes and ordinary shared links do not replay a creation celebration. */
export function consumeCreatedPreview(href: string, storage?: CreationStorage | null): boolean {
  let stored: string | null = null;
  try { stored = storage?.getItem(CREATION_KEY) ?? null; } catch { /* Fall back to this tab's pending action. */ }
  if (pendingHref !== href && stored !== href) return false;
  pendingHref = null;
  try { storage?.removeItem(CREATION_KEY); } catch { /* The URL flag is also removed by the preview. */ }
  return true;
}
