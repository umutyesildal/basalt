import { getBasketCover, isBasketCoverId, type BasketCover, type BasketCoverId } from "@/lib/basket-covers";
import { onchainBasketDisplay } from "@/lib/onchain-basket-display";

/** Display-only resolution leaves old metadata bytes and their onchain commitment untouched. */
export function devnetBasketCover(metadata: unknown, address: string): BasketCover {
  const display = onchainBasketDisplay(metadata, address, { devnet: true });
  return getBasketCover(display.coverId ?? undefined);
}

/** New basket metadata must commit a selected local artwork ID before hashing. */
export function devnetBasketMetadata(draft: {
  name: string;
  thesis: string;
  coverId: BasketCoverId;
  constituents: readonly { ticker: string; mint: string; weightBps: number }[];
  managementBps: number;
}): string {
  if (!isBasketCoverId(draft.coverId)) throw new Error("Choose a basket image before creating your basket.");
  return JSON.stringify({ name: draft.name.trim(), description: draft.thesis.trim(), coverId: draft.coverId, version: "basalt-devnet-v0", network: "devnet", constituents: draft.constituents, feesBps: { entry: 0, exit: 0, management: draft.managementBps } });
}
