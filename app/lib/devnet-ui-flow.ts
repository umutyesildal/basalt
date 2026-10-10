import { DEVNET_MOCK_TOKENS } from "./devnet-faucet";
import { onchainBasketDisplay } from "./onchain-basket-display";
import type { BasketDetail } from "../components/basket/basket-api";

const fixedMints = new Set<string>(DEVNET_MOCK_TOKENS.map(token => token.mint.toBase58()));

/** UI selection only. The workspace authenticates the account and namespace again through RPC. */
export function supportsDevnetWorkspace(detail: Pick<BasketDetail, "constituents">, cluster: string): boolean {
  const mints = detail.constituents;
  return cluster === "devnet" && mints.length >= 2 && mints.length <= fixedMints.size && new Set(mints).size === mints.length && mints.every(mint => fixedMints.has(mint));
}

/** The current create form exposes all four test tokens and zero entry/exit fees. Never silently change a clone. */
export function devnetCloneDraft(detail: Pick<BasketDetail, "pubkey" | "metadata_json" | "constituents" | "weights_bps" | "entry_fee_bps" | "exit_fee_bps" | "management_fee_bps">) {
  if (!supportsDevnetWorkspace(detail, "devnet") || detail.constituents.length !== fixedMints.size || detail.weights_bps.length !== detail.constituents.length ||
      detail.weights_bps.some(weight => !Number.isInteger(weight) || weight <= 0) || detail.weights_bps.reduce((sum, weight) => sum + weight, 0) !== 10_000 ||
      detail.entry_fee_bps !== 0 || detail.exit_fee_bps !== 0 || !Number.isInteger(detail.management_fee_bps) || detail.management_fee_bps < 0 || detail.management_fee_bps > 300) {
    throw new Error("This basket's mix or fees cannot be copied into the four-token create form. Start a new basket instead.");
  }
  const display = onchainBasketDisplay(detail.metadata_json, detail.pubkey, { devnet: true, assetCount: detail.constituents.length, weightsBps: detail.weights_bps });
  const byMint = new Map(detail.constituents.map((mint, index) => [mint, detail.weights_bps[index]]));
  return {
    name: display.name.slice(0, 64), thesis: (display.thesis ?? "").slice(0, 400), coverId: display.coverId ?? undefined,
    weights: DEVNET_MOCK_TOKENS.map(token => String(byMint.get(token.mint.toBase58())! / 100)),
    management: String(detail.management_fee_bps / 100),
  };
}
