# Devnet onboarding audit, 2026-10-10

Read-only application source and public finalized RPC review of the canonical release checkout. Only these documentation and public-evidence copies were written. No signer/key access, transaction submission, authority changes, deployment, application source edits or flag changes occurred in this audit. Public RPC observations are separate from source/deployed-byte attestation.

## Result

New basket creation is intentionally unavailable in the supported app. This is an actual deployment/treasury gate, not just difficult wording. Existing baskets remain readable and redeemable. The safest short path is to finish the already prepared **separate owner-devnet/mock namespace**, prove it, then enable only that namespace. Do not reopen the retired legacy factory, invent an official xStocks devnet mapping, or weaken redemption/account checks.

## Important new chain observation

The October 9 preparation documents are no longer a complete current inventory. At finalized slot **509517232**, observed **2026-10-10T10:54:53.483Z**:

- New whitelist `37UVmx2uysqkKibBcSP5EZMycUeKnWRmnXVpr967juKF` exists and is executable, owned by the canonical upgradeable loader.
- Its canonical ProgramData `BVU9c7KKhPbxEBt2CQpdttAXJPVQnb2LXCKYhJTUbBWj` exists, 376269 bytes, with upgrade authority `8B2wktjNVETgnkoe92r2hTL9THw7umh4zF7iuidMt5H4` (temporary bootstrap).
- New factory `2xvJKG8DTmSZFu1zXpNVP3wvaCCCgGC2ufGGhYjzr4DH` and basket `8XPKfAYPaDSvUH95CeyjkgujTXAE5nFBJyFSqZvFvX7T` do not exist. Their ProgramData and both new singleton configs are absent.
- Bootstrap balance: **0.085145120 devnet SOL**. Proposed owner `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea`: **13.931998332 devnet SOL**.
- This establishes a **partial deployment**, not a ready or byte-verified namespace. Locate the actual deployment receipt/source/ELF and verify the existing whitelist before resuming. Do not rerun an all-vacant deployment assumption. The existing all-vacant verifier stopped at its 128KiB response bound because ProgramData is now present; a bounded 89-byte account-header read established the partial state without reading executable content.

Public evidence: [devnet-owner-current-2026-10-10.json](evidence/devnet-owner-current-2026-10-10.json). No responsible actor, authorization, source hash or artifact identity is inferred from these public headers.

At finalized slot **509517056**, the legacy factory still embeds retired treasury `AAb2TXLQCPFvnUoJFSBe9PFs28w5kvAukH4Gaiia3eiJ`, basket count 10. Its three upgrade authorities and whitelist authority remain `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE`, with no pending whitelist transfer. Evidence: [devnet-current-state-2026-10-10.json](evidence/devnet-current-state-2026-10-10.json).

The owner explicitly selected their own devnet wallet `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea` as the new immutable treasury recipient during this follow-up. This documents the treasury choice only. The public policy still records `treasury:null` and owner-role acceptance pending; no policy edit, wallet-control proof, owner-role acceptance signature or namespace activation is inferred.

## Actual gates

| Gate | Evidence | Implication |
|---|---|---|
| No active creation namespace | `backend/src/config/programNamespaces.ts:46` through 66: only legacy registered, legacy creation disabled; `CREATION_NAMESPACE_ID=null` | No environment switch or cosmetic UI change can legitimately enable creation. |
| Prepared new namespace excluded | Same file:58: `DEVNET_OWNER_NAMESPACE` prepared separately, `enabled:false` | Registration/activation requires reviewed source plus actual completed deployment evidence. |
| Owner prerequisites unresolved in source | `backend/src/config/devnetOwnerPolicy.json:7`: treasury null; ownerRoleAcceptance pending; deploymentExecuted false | Owner selected their own wallet as treasury in this conversation; the source policy is unchanged. Neither that selection nor its balance proves owner-role acceptance or wallet control. |
| Retired immutable legacy treasury | `app/lib/create-basket-security.ts:12`, finalized inventory above | Never remove retired-key protection, add treasury setter, upgrade/reset legacy to hide the problem or migrate assets silently. |
| Checks before paid setup/signing | `app/components/devnet/create-availability.ts:15`, workspace:296, `app/lib/transactions.ts:691` and892 | Preserve fail-closed availability before draft/ALT setup and recheck at actual build. |
| Narrow operator is setup only | `scripts/devnet-owner-bootstrap.ts:309` through 320; `docs/devnet-owner-bootstrap.md:36` | Existing operator does not deploy, sign for owner, hand off loaders or activate creation. |
| New owner setup page only claims whitelist | `app/components/devnet/devnet-owner-setup.tsx:75`, owner claim library:82 | It cannot fix missing programs/config, fund bootstrap, transfer loader control or enable Create. |

## Minimal safe operational path

1. Reconcile the newly observed partial whitelist deployment with receipts and exact reviewed source/ELF. Refresh actual rent/fee estimates; the October 9 target of 9 devnet SOL was for an entirely vacant deployment and is historical.
2. Record the explicitly selected owner-wallet treasury in a separately reviewed policy/manifest update, and resolve the remaining owner role acceptance. A declaration/reference is not a signature. Use genuine owner wallet review/signatures for owner-only steps. Do not request or export the owner's private key.
3. Finish the exact owner-devnet trio with consistently compiled cross-program IDs/IDL/SBF. Preserve loader-bound initializer guards. Verify canonical finalized Program/ProgramData relationships and deployed bytes for every program.
4. Initialize the new whitelist/factory with accepted treasury, canonical 90/10 split and fee caps. Admit the existing four verified faucet mocks to the **new** whitelist. Existing legacy admission cannot substitute for clean-namespace admission. If immutable FactoryConfig.authority must be the owner, hand off that loader authority before the owner initializes; bootstrap initialization permanently records bootstrap there, although the field has no active setter.
5. Complete checked loader handoff and owner-signed whitelist claim, then finalized readback. Preparation docs explicitly distinguish single-owner devnet control from production multisig/timelock governance.
6. Prove clean create → in-kind mint → oracle-free pro-rata redeem with a new wallet; prove legacy basket redemption still works; verify token/raw/share/fee conservation and failure rollback. No historical recovery activation is required to simplify mock creation.
7. Only after those proofs, register the exact second trio in the closed namespace registry, set its reviewed treasury and creation.enabled, select its ID, deploy app/backend coherently. Preserve the legacy factory mapping and per-basket namespace routing. Do not use API/env supplied trust roots.

References: `docs/devnet-namespace-routing.md:23`, `docs/devnet-owner-bootstrap.md:30`, `docs/devnet-owner-preparation-2026-10-09.md:31`, `scripts/devnet-owner-bootstrap.ts:100`.

## Normal UX improvements, independent of authority/chain changes

- **Direct Create route issue, fixed in this UI update:** `/create/onchain` previously opened trade unless `?name=` existed. DevnetWorkspace now accepts `initialMode`, the Create route passes `create`, and `/devnet` remains trade-default. This changes the initial UI tab only; creation availability remains fail-closed.
- **Draft stocks are not onchain backing:** `app/lib/devnet-links.ts:3` through 11 carries only name, thesis, fee and cover. Onchain workspace at lines 300–304 always commits the same four BSTEST mocks with fresh equal default weights (:107). This is intentional identity separation, but the UI should make one concise transition clear. Do not silently claim the selected mainnet issuer stocks were deployed.
- **Healthy test-token distribution already exists:** At slot 509517471, all four pinned faucet vaults authenticate to the expected mint/authority, are unfrozen, each contains 9,500,000,000,000 raw base units, and supports **95 more once-per-wallet claims**. Program executable. Evidence: [devnet-faucet-current-2026-10-10.json](evidence/devnet-faucet-current-2026-10-10.json). The current faucet can be reused after new-namespace admission; no token-price service or backend custody is needed.
- **5m-lamport prerequisite is insufficient for a first claim:** `devnet-workspace.tsx:229` and 392 use 0.005 devnet SOL as the generic balance gate. Fresh public finalized rent reads at 2026-10-10T10:56:41Z returned 1,559,560 lamports for 179 bytes and 655,320 for 1 byte. Four 179-byte ATAs plus 1-byte claim marker require **6,893,560 lamports before network fees**. Estimate missing account rent and fees from actual mint/account state instead of treating 0.005 as enough. Creation adds its own accounts/ALT rent.
- **Keep one primary workflow:** Connect wallet → Get test tokens when needed → name/cover/mix → Create basket. The existing pipeline already handles preparation, simulation, signing, confirmation and ambiguous submission recovery (`devnet-workspace.tsx:362`). Four-constituent creation genuinely needs an ALT (`transactions.ts:586`); first-time setup can require an extra wallet approval, so do not promise one signature or silently repeat economic actions.
- **No need for a dollar amount for mocks:** Current seed input is total unscaled tokens, management fee defaults to 2%, entry/exit fees are 0%, and exact positive weights total 100%. Keep raw accounting and scaled display separate, including differing 1/1.25/2/10 multipliers. Arbitrary USD/weekly returns cannot be inferred from real-stock prices for these mocks.
- **Public exact metadata is a separate sharing gap:** Names/theses/covers are hashed into immutable metadata but saved only in the creating browser/session (`app/lib/devnet-baskets.ts:340` through 380, `devnet-cover.ts:19`). Other viewers receive decorative fallbacks when indexed metadata is absent. Before seamless public creation/share, add bounded publication of the **exact UTF-8 bytes** and validate SHA-256 against the authenticated basket's immutable metadata hash; serve only matched metadata. Never replace/rehash older immutable records or infer user-selected cover from a decorative fallback.

## Official xStocks boundary

This source proves project-issued mock compatibility with the issuer extension profile, not official funded devnet xStocks custody. `docs/xstocks-devnet-runtime-2026-10-03.md:42` explicitly describes BSTESTA–D as project mocks, and the new contained owner policy admits mocks only (`docs/devnet-owner-bootstrap.md:11`, operator:112). Public `/stocks` catalog and quote discovery are mainnet issuer discovery, not devnet whitelist/faucet evidence. The product draft's mainnet mint addresses must never be treated as devnet mint identities. Fresh official-source research and four-address devnet verification are recorded in [xStocks devnet availability](xstocks-devnet-availability-2026-10-10.md). It is not necessary to wait for issuer sandbox access to complete the separate mock-only path.

## UI source integrity and verification

Read-only review of the current StockMixCard extraction, preview/onchain integration, devnet theme helper, direct Create initialMode and BaseUI Link-rendered buttons found **no new source blocker**. The same Bklit allocation card renders both surfaces; chart display requires positive safe-integer weights summing 10,000; onchain integration passes no illustrative `amountUsd`; underlying mint IDs and transaction data are untouched. Exact four BSTEST mint themes are devnet-only, visibly marked as test tokens, and issuer logos/colors are decoration. Mainnet asset resolution uses exact supplied mint and unknown mints get neutral art; no ticker-based financial data is introduced. Existing namespace, retired-treasury, immutable-metadata and redemption checks have no diff. The primary agent reports the complete application suites passed: **333 Node tests and 57 Vitest tests**, plus TypeScript checking. This audit did not perform browser-wallet signing, public basket creation or hosted deployment. Publication and exact-source CI evidence must be recorded separately.

## Evidence scope

The [official-token API/RPC observation](evidence/xstocks-devnet-rpc-2026-10-10.json) joins the three linked project RPC records above. All four files contain public addresses, account state or asset metadata only. None establishes owner consent, a valid current source-to-ELF deployment attestation or authorization to execute another transaction. Observation times and finalized slots are retained; these are dated snapshots.

## Operational preparation status

A narrow read-only search found no owner-namespace deployment receipt or ELF artifact in the canonical checkout's build/cache directories, the original checkout's build/cache directories or the task's temporary artifact directory. The existing public local-validator record binds dirty working-tree source based on commit `599648a2744acb79957c58eebaa911943097c954`; it is not a committed remote deployment receipt. The existing `verifyXStocksDeployment.ts` CLI pins legacy IDs and the legacy authority, so it must not be presented as owner-namespace attestation. Further public byte comparison and exact deployment provenance inspection remain a separate read-only follow-up; no new deployment should assume the whitelist address is vacant.
