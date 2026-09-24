# Managed Basket V2 localnet proof — 2026-09-24

The instruction-level proof in `scripts/managed-v2-proof.ts` and `scripts/managed-v2-localnet.sh` completed on one Solana 1.18 local validator with two newly minted, extension-free mock Token-2022 assets. The run used the **test-only** `localnet-fast-notice` feature with a 200-slot notice. The normal program still requires at least 216,000 slots; its separate default build and test assert that policy. Neither artifact was deployed to devnet or mainnet.

| Evidence | Result |
| --- | --- |
| Test SBF SHA-256 | `4a03bf3aa106a497dcf1cc7097632430365d8f03d41336d4a80af3dec59d78f8` |
| Normal SBF SHA-256 | `fa5d827aedaaae83daccf9c12d080c5a9b1a7ec08e57fd989017e42b09e78f9f` |
| Basket / allocation version | `5AGqyPKtLHSVW65fqkyNeegQc5tPu962x1555ZNu8PhF` / `1` |
| Identity mint | Separate supply-one, zero-decimal Token-2022 mint; further minting revoked at creation |
| Before → after fill vault raw balances | `[52,500,000, 52,500,000]` → `[51,500,000, 53,300,000]` |
| Exact pair trade | Counterparty received `1,000,000` raw input and paid `800,000` raw output; below-min output was rejected |
| Share supply across fill | `1,050,000` raw before and after; no shares minted or burned by the rebalance |
| Holder exits | Notice-period exit paid `[2,500,000, 2,500,000]` raw. Post-fill exit paid `[2,452,380, 2,538,095]` raw by pro-rata floor. Final share supply was `1,000,000` raw. |
| Rejected actions | Unauthorized manager proposal, non-guardian price approval, early fill, and output below the guardian minimum. |

The manager's new `30% / 70%` target is versioned intent; it is **not** a claim that raw or economic vault holdings equal those percentages. The vault balances above are the actual amounts used for redemption.

Local transaction signatures: create `AVus3d493wghNmH1WisEWBZKnww5oqVMwadLjbLr1h2REMAvsqekZd1J3wdNFVyTHSgYro5w5NmfGjBpK8pgNtV`; delayed fill `5E1d3DuXT9SUCt3hA4UikMuWzEDXzgH3M7azNNXmLUMAC2PAdqKkA1137mD7u28osNR2q83RZTjt2jR2vPQuL6o`; final redeem `5ycZE6ksbaNSkM4FrJvJ54d57XYHxHaE98Zpsyyh2Ztob9BCKta8aGpHxZM4YhEN7qmiyUmAyecJ9oVWqD6eQSeM`. These are localnet signatures, not public explorer transactions. Full result JSON with all seven successful signatures and raw balances is in `/private/tmp/basalt-managed-v2-proof.54Yj2CwW/run/result.json` on this machine; generated test keypairs are stored separately in the same private temporary directory and are not committed.

The installed validator could not reliably restore this state when restarted with `--warp-slot`, so the successful fast-notice proof kept one validator process running and waited until the execution slot. This proof covers one honest two-asset mock scenario plus the listed negative cases. It does not replace a complete adversarial instruction suite, external audit, asset allowlist, production pricing policy, or live-asset compatibility review.
