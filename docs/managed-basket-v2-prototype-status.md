# Managed Basket V2 prototype status

Managed Basket V2 is a separate, opt-in experiment on `codex/managed-baskets-v2`. Immutable V0 accounts, instructions, and the wallet-free Create preview are unchanged. This branch is not a public deployment.

## What this slice contains

- `programs/managed_basket/` creates a two-asset Token-2022 vault, one fungible share mint, and one supply-one identity token. A second holder can mint shares in kind, and a holder can burn shares for the current raw vault assets.
- The creator, acting as manager, proposes a new target mix within the fixed pair. A distinct guardian approves a minimum output. After the public notice, any counterparty may fill the complete pair trade atomically. A successful fill changes vault balances and allocation version; it does not mint or burn existing shares.
- `backend/src/managed/` projects confirmed events and marks holdings current only after a matching confirmed or finalized account snapshot. It is read-only and holds no signing key.
- `/managed` is an English, wallet-free explanation using visibly simulated data. It has no signing, RPC reads, or trade controls.

The identity token is not an economic share or management key. Token-2022 provides two separate mints here; it does not fractionalize one NFT. On-chain target weights record strategy intent. Without a trusted price model, the program cannot prove that the vault's market-value weights match those targets after a fill. The holder claim and redemption amounts come from actual raw vault balances.

## Intentional prototype boundaries

- Fees are fixed at 0%. Creator fee revenue, a 90/10 split, and fee accrual are not implemented in this slice.
- The identity token has no Token-2022 metadata name, image, or URI yet, so wallet presentation is incomplete.
- There is no manager or guardian rotation instruction. Losing either key affects future management, though it does not gate holder redemption.
- The program accepts an extension-free Token-2022 pair without freeze authority; it does not enforce a project-issued mock allowlist or verify asset provenance. Do not deploy it on a public network until admission policy is implemented and reviewed.
- Guardian approval is a trusted minimum-output policy, not an independent oracle, auction, or best-execution guarantee. No arbitrary DEX CPI is used.
- The notice uses a minimum of 216,000 slots, nominally about 24 hours at 400 ms per slot. It is not a wall-clock guarantee.
- Existing issuer transfer controls can prevent transfer in a future asset universe. Official xStocks and their Token-2022 extension behavior are outside this prototype.
- The UI and backend projection are not connected to a deployed Managed V2 program. No live basket or completed trade is represented by the example page.

## Required evidence before a public pilot

The first localnet transaction proof has passed: two holders, a separate identity mint, manager proposal, guardian approval, notice-period redeem, bounded atomic fill, unchanged share supply across fill, and post-fill pro-rata redeem. See `managed-basket-v2-localnet-proof.md` for artifact hashes, signatures, and actual raw balance deltas. It used a **separate test-only fast-notice SBF** because the installed validator could not preserve state across a 216,000-slot warp. The normal SBF retains the 216,000-slot minimum and was separately exercised through notice-period redemption.

Remaining gates:

1. Expand instruction-level adversarial coverage for substituted accounts, replay, expiry boundaries, rollback, dust, and token admission. The completed smoke covers unauthorized signers, early fill and an insufficient output, but not the full threat matrix.
2. Reconcile all projected versions and holdings with confirmed chain accounts; expose a read-only API only after this is reliable.
3. Complete asset allowlisting, role rotation, identity metadata, fee math, and wallet transaction UI before presenting it as a usable managed-basket product.

The normative design and threat matrix remain in `managed-basket-v2-plan.md`, `managed-basket-v2-product-flow.md`, and `managed-basket-v2-threat-model.md`.
