# xStocks contract compatibility review, 2026-10-03

> Pre-change audit retained for its capture time. The later shared admission policy and current SBF devnet upgrades supersede this document’s rejection/deployment conclusions for current V0. See [the compatibility decision](xstocks-token-policy-decision-2026-10-03.md) and [current runtime record](xstocks-devnet-runtime-2026-10-03.md). Managed V2 scope remains unchanged.

**Pre-change verdict at capture: V0 supported baskets with 2–20 constituents, including 3 or 4, but that source did not support official xStocks. Then-existing devnet success used project-issued mocks and an older deployment.** Managed V2 is a separate two-asset localnet prototype. Public asset discovery and token-price integration do not change any of these contract boundaries.

This is a focused compatibility and release-readiness review using the `review-and-iterate` workflow, not an independent full security audit. No program, gate, deployment, authority, or account was changed. No transaction, airdrop, or signature was submitted. Telemetry remained off under the owner's instruction.

- Source HEAD: `7a16c18e5809ae3b955dc334b4af016afae9eb56`; inspected program sources have no working-tree diff.
- Fresh RPC observation: `2026-10-02T23:39:24.159Z`, October 3 in Europe/Berlin; finalized devnet slot `506801833`, mainnet slot `452760484`.
- [HTML review](assets/xstocks-contract-compatibility-2026-10-03/review.html), [public RPC evidence](assets/xstocks-contract-compatibility-2026-10-03/rpc-evidence.json), [test log](assets/xstocks-contract-compatibility-2026-10-03/rust-library-tests.log), [source/evidence hashes](assets/xstocks-contract-compatibility-2026-10-03/evidence-manifest.json).

## Direct answers

| Question | Answer | Strength of evidence |
|---|---|---|
| Can V0 combine three different assets? | Yes, within its admitted Token-2022 asset set. | Current source plus finalized historical 3-token mock create, mint and redeem. |
| Can V0 combine four different assets? | The data model and per-asset CPI path support it. A versioned transaction with an address lookup table is required by the current create builder. | Source verified. No exact 4-token successful E2E record was found in the inspected evidence. Later 6-token mock create/mint/redeem succeeded using the larger-basket path. |
| Does today's source accept real xStocks? | No. Whitelist, factory and mint-side validation reject all mint extensions. | Exact source checks, issuer docs and four fresh official mainnet mint observations. |
| Can we use official mainnet mint addresses on devnet? | The four checked addresses are not usable devnet mints. | AAPLx, NVDAx and SPYx absent; TSLAx is a zero-data System account on devnet. |
| Are the old devnet assets official xStocks? | No. They are different project-issued mock mints with six decimals. | Existing state and fresh devnet mint reads. |
| Are current source checks deployed on devnet? | The deployments predate the hardening commits. There is no current source-to-deployed-ELF attestation. | Fresh ProgramData deployment slots and block times, Git history and existing governance record. |
| Does Managed V2 support 3–4 tokens or official xStocks? | No. It is a fixed pair and rejects extensions. | Source and localnet proof documentation; its program ID is absent on devnet. |

## 1. V0 really has a multi-asset transfer path

[Factory source](../programs/basket_factory/src/lib.rs#L25) sets the range to 2–20. `create_basket` validates lengths, count, duplicates, weight total, fees, metadata and nonzero seed amounts before mutation (lines 65–105). It requires four remaining accounts per constituent: whitelist PDA, mint, creator token account and vault token account.

For every constituent it verifies the whitelist account owner/PDA/status, the actual mint and decimals, the canonical creator/vault ATAs, token-account owner, token mint and balances (lines 145–219). It initializes the basket/share mint/vaults atomically, calls `transfer_checked` with raw seed amounts and verifies actual source and destination deltas (lines 354–375). These are implemented CPIs, not the historical scaffold's caller-trusted whitelist stub.

[Basket source](../programs/basket/src/lib.rs#L377) uses a variable-length 4n account layout for mint and 3n for redeem. Mint validates supported extensions and account identities, transfers raw amounts, and verifies received/debited deltas (lines 486–527). Redeem computes floor pro-rata amounts from real vault balances and executes signed raw transfers (lines 722–750). Checked arithmetic, fixed fee policy and fee-accrual changes are in the current source.

The target weights are immutable configuration. V0 does not actively rebalance after creation. Combining several assets is supported; automatically following a manager's later portfolio changes is a different feature and is not implied by the current V0 contract.

### Four tokens need the larger transaction path

The preserved `scripts/.e2e-devnet/logs/createBasket-N4.log` records a four-token create attempt rejected locally at **1,270 bytes**, above Solana's **1,232-byte** packet limit. This was a transaction construction limit, not a four-token ban in the program.

The [current builder](../app/lib/transactions.ts#L642) uses v0 messages, requires lookup table addresses for 4+ constituents, verifies table coverage/propagation and checks serialized size. Current scripts use the same approach. Historical state records a successful six-token simulation at **642 bytes / 364,766 compute units**, and finalized six-token create/mint/redeem signatures are still queryable. Six-token buy proof records a **437-byte / 210,674-CU** mint and **381-byte / 221,130-CU** redeem after lookup-table compilation.

This proves that a larger mock basket has actually run on the old deployment. It does not substitute for an exact four-token test on a freshly built current program. The maximum of 20 is an account/model bound, not measured proof that every 20-token transaction fits all runtime limits.

### Historical transactions rechecked on devnet

All six signatures below returned `confirmationStatus=finalized` and `err=null` during this review. Existing basket accounts were also read and decode to three or six constituents with the expected basket-program owner.

| Flow | Constituents | Finalized slot | Transaction |
|---|---:|---:|---|
| Create | 3 | 493,114,770 | [5bds3tN1…](https://explorer.solana.com/tx/5bds3tN1ZwSUPAGxGif7EWAbpzRMni4DjbiRf6Q3H7iwmMRUzbNSpKfxAUSpGYEv7qXUv8F38LUASRX9dd1jojne?cluster=devnet) |
| Create | 6 | 493,176,364 | [2NCetoms…](https://explorer.solana.com/tx/2NCetomsTGQdJMBESG2YaaNmzvaF6XeR6KwRZvmhLus81MqmszGHRj3v5gN2LSYFN74mEme453sqqhajiD3CQAD7?cluster=devnet) |
| Mint | 3 | 493,184,004 | [5gc6qYru…](https://explorer.solana.com/tx/5gc6qYrudyvkRFcvKN98ui1mxGVdQs2J4pK3pAQi2VjYuTUJ2b4WiNUtTQdorsTxmwamWZgiftdSyHnrd4uQS7t3?cluster=devnet) |
| Redeem | 3 | 493,184,009 | [5MRGfrWT…](https://explorer.solana.com/tx/5MRGfrWTZrxbvkfVLodK7kfQPthEbKSkAnHgxBXfK7S5VnWNiwzHsAuoPDTejFuXvMerPb6N119GQZVHdWKa4Qjz?cluster=devnet) |
| Mint | 6 | 493,239,464 | [5P5ge92v…](https://explorer.solana.com/tx/5P5ge92vEL7LYNmtRET4NZqMSbtMqMpau9tFQJGTsGfBmLfeq59eQfbhSFkmUuqRihiSV5EvAaiEAyDSRa1RERSp?cluster=devnet) |
| Redeem | 6 | 493,239,537 | [5qNfyDyQ…](https://explorer.solana.com/tx/5qNfyDyQn1sG6NrAcpvojDXRA5wkTjQtNqYrupu22mfqz3okuXMrGFVywXDiRdKjBHiiVsbxMDgPvCLoJSYibT79?cluster=devnet) |

## 2. Official mint identity and extensions are the blockers

The [issuer developer docs](https://docs.xstocks.fi/developers) identify Solana xStocks as Token-2022 assets with Scaled UI Amount. The [public asset API](https://docs.xstocks.fi/apis/openapi/assets/list_public_assets) is a metadata discovery source. Neither a ticker match nor an API listing grants on-chain whitelist admission.

I found no published official Solana devnet mint list or faucet in the reviewed issuer developer, asset API, multiplier and xChange documentation or targeted official-domain searches. This does not prove that an issuer-operated private sandbox does not exist. Until the issuer provides and authenticates such addresses, project mocks must remain labelled as mocks. The xChange guide's Solana example uses mainnet-beta; a Solana SOL faucet does not supply backed xStocks.

| Token | Official mainnet mint | Fresh devnet result at the same address |
|---|---|---|
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | Account absent |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | Account absent |
| SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | Account absent |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | System-owned, zero data, not a token mint |

All four official mainnet accounts were initialized Token-2022 mints with **8 decimals** and the extension IDs `18, 12, 6, 25, 26, 4, 14, 19`. They were not paused and their active transfer-hook program was null at observation. A null current hook does not remove its mutable authority or guarantee future behavior. The earlier [BAS-002 issuer fixture](bas-002-token2022-extension-policy.md) records the authorities; the new RPC artifact records current account hashes and extension states.

| Extension | Current consequence / future design requirement |
|---|---|
| MetadataPointer / TokenMetadata | Rejected today. A future parser must validate the complete profile; names are not token identity. |
| ScaledUiAmountConfig | Rejected today. Raw amounts remain the transaction/accounting unit; scheduled effective multipliers affect display/NAV only. |
| DefaultAccountState | Rejected today. Admission must inspect the actual state rather than only the extension ID. |
| PermanentDelegate | Rejected today. The mint-level delegate can transfer or burn from holder accounts, including vault accounts. |
| PausableConfig | Rejected today. An issuer pause can prevent token transfers independently of the basket's own permissionless redemption entrypoint. |
| ConfidentialTransferMint | Rejected today. Presence must be assessed precisely; it does not alone prove that these observed vault balances are confidential. |
| TransferHook | Rejected today. An active hook needs validated extra accounts in every affected transfer path. |

The authority and transfer implications follow the primary [permanent delegate](https://solana.com/docs/tokens/extensions/permanent-delegate), [pausable mint](https://solana.com/docs/tokens/extensions/pausable) and [transfer hook](https://solana.com/docs/tokens/extensions/transfer-hook) specifications. Raw/scaled treatment follows the [issuer multiplier guide](https://docs.xstocks.fi/developers/multipliers).

`ImmutableOwner` is a token-account extension, not a mint extension in the table above. Token-2022 ATAs initialize it automatically. It prevents changing the token-account owner, but does not revoke a mint-level permanent delegate. A future account-extension policy must preserve valid canonical ATAs rather than applying the empty mint-extension rule indiscriminately to token accounts. [Solana Immutable Owner specification](https://solana.com/docs/tokens/extensions/immutable-owner).

### Exact current rejection points

- [Whitelist `decode_mint_decimals`](../programs/whitelist/src/lib.rs#L131), lines 131–160, requires no extension types and the exact 82-byte base mint allocation. Unknown/malformed TLVs fail closed. The pinned `spl-token-2022` 3.0.5 dependency does not model the complete modern issuer profile.
- [Factory decoder](../programs/basket_factory/src/lib.rs#L629) delegates to that validator, so an old whitelist record cannot make a new basket bypass the extension policy.
- [Basket mint validator](../programs/basket/src/lib.rs#L1002), lines 1002–1018, rechecks the policy on new deposits to old baskets.
- Eight decimals are within the current cap of 12. **Decimals are not the incompatibility.**
- Redeem intentionally does not add this admission-policy check. The current source contains no new whitelist, oracle or backend gate on exits. Token-program transfer restrictions can still make an underlying asset untransferable; the basket cannot override issuer authority.

The four inspected **project devnet mocks** are also different from today's accepted asset profile: their mints are 226 bytes, six decimals, and contain ScaledUiAmountConfig alone. Current source would reject their admission/new deposits. The updated [mock setup script](../scripts/createWhitelist.ts#L1) creates extension-free mocks and refuses to reuse incompatible saved mints. Existing state must be preserved; a fresh test state directory is the appropriate future test path.

## 3. Devnet does not attest the current source

Fresh ProgramData reads match the deployment slots in the [September 19 governance audit](devnet-governance-audit-2026-09-19.md). `getBlockTime` resolved them to September 4:

| Program | Program ID | Last deploy slot | UTC deployment block time |
|---|---|---:|---|
| Whitelist | `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS` | 493,110,585 | 2026-09-04 16:40:48 |
| Factory | `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF` | 493,110,824 | 2026-09-04 16:41:27 |
| Basket | `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k` | 493,111,012 | 2026-09-04 16:41:58 |

Git records extension hardening at `fa14515` on September 18, checked arithmetic at `c15b124` and the fee-split policy at `d99672d` on September 19. These changes postdate the deployed slots. The old mock success therefore cannot validate current hardening or current official-token compatibility.

The evidence records SHA-256 hashes of each entire ProgramData account and of its payload after the 45-byte upgradeable-loader metadata header. The latter is called `deployedElfSha256` in the JSON and includes allocated payload bytes. It is **not** a reproducible-build attestation or proof of a particular historical Git commit. There is no current local `target/deploy/*.so` to compare and the checked-in deployment manifest is a template. The [attestation contract](deployment-attestation.md) already distinguishes these facts.

All three upgrade authorities remain `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE`. Whitelist configuration authority is the same key and `pendingAuthority` is null. The approved [2-of-3 governance and timelock policy](upgrade-governance-policy.md) remains unfulfilled by these live accounts. This is a confirmed existing release blocker, not a newly executed exploit.

## 4. Managed V2 and the public UI are separate

[Managed V2 create/mint signatures](../programs/managed_basket/src/lib.rs#L38) use two-element arrays. Its [mint validator](../programs/managed_basket/src/token.rs#L22) accepts only extension-free Token-2022 mints without freeze authority. It has no three/four-asset instruction path and no official-xStocks admission. Its ID `CZ3eG8JutryawXTcA1h97PMrhAGuWzsrYSgssMH43cKL` was absent on devnet. See the [localnet prototype status](managed-basket-v2-prototype-status.md) for its distinct guardian/trade flow and missing fees.

Public `/create` currently builds and shares basket ideas. [`/create/onchain`](../app/app/create/onchain/page.tsx#L1) redirects there. The newly integrated issuer catalog and prices are read-only data. None of them deploys a basket, whitelists an official token or implements live investment/following of a manager.

## 5. Review findings and concrete follow-up

| ID | Priority | Finding | Required result |
|---|---|---|---|
| XC-01 | High compatibility blocker | The current accepted extension set is empty and rejects official xStocks. | A separately reviewed issuer-specific asset policy, complete parser and transfer integration, or continued exclusion. Do not remove the gate to make a demo pass. |
| XC-02 | High release correctness | Devnet evidence is from a deployment preceding the current source; no byte-to-source attestation exists. | Reproducible current SBF artifacts, manifest/hash verification and controlled current-revision tests before any separately authorized upgrade. |
| XC-03 | Critical security release gate | One key still upgrades all three programs and controls the whitelist. | Verified target governance vault, approved timelock and read-back proof for all four authorities after an authorized migration. |
| XC-04 | Medium verification gap | No exact current-revision 4-token instruction E2E or complete adversarial extension/CPI coverage. | Add 3/4-token current-SBF create/mint/redeem proof plus token-policy rejection/rollback cases. Preserve old evidence. |

Concrete implementation/test sketches below are proposed work, **not changes applied by this audit**. Names beginning `verify_`/`exercise_` describe test-harness requirements rather than existing functions.

```rust
// XC-01: preserve today's admission boundary until a replacement is reviewed.
require!(extension_types.is_empty(), WhitelistError::MintExtensionNotAllowed);
// A future profile must enumerate every parsed extension and reject unknowns.
// Do not replace this with `contains(ScaledUiAmountConfig)` or a ticker check.
```

Before extending admission, upgrade compatible Anchor/SPL dependencies with reproducible SBF builds; parse complete modern mint and token-account extension sets; document the acceptance of issuer delegate/pause/freeze powers; resolve and validate hook extra accounts on every create/mint/redeem transfer; retain exact raw debit/credit checks. Test authority changes, paused/frozen states, malformed/unknown extensions, hooks, balance deltas and atomic rollback. A display multiplier implementation alone cannot resolve these issuer trust assumptions. Do not promise unconditional transferability of an issuer-controlled token.

```ts
// XC-02 / XC-03: assertions in a future read-only deployment acceptance job.
assert.equal(rebuiltArtifactHash, manifest.artifactHash);
assert.equal(verifiedDeployedArtifactHash, rebuiltArtifactHash);
assert.equal(manifest.sourceCommit, expectedReviewedCommit);
for (const authority of observedProgramAndWhitelistAuthorities) {
  assert.equal(authority, independentlyVerifiedGovernanceVault);
}
assert.equal(verifiedThreshold, 2);
assert.equal(verifiedSignerCount, 3);
assert.ok(verifiedTimelockSeconds >= 48 * 60 * 60);
```

```ts
// XC-04: future local validator/current-SBF tests, with isolated mock state.
for (const constituentCount of [3, 4]) {
  const result = await exercise_create_mint_redeem({
    constituentCount, extensionFreeMints: true, decimals: [6, 8],
    useLookupTable: constituentCount >= 4,
  });
  assert.ok(result.wireBytes <= 1_232);
  assert.deepEqual(result.actualVaultDeltas, result.expectedRawDeltas);
  assert.equal(result.redeemRequiresOracleOrWhitelist, false);
}
// Also reject the real issuer extension fixtures and the older scaled mocks
// under the CURRENT policy; test failed transfers roll back shares and vaults.
```

Only after those decisions and tests should there be a separate plan for an authorized devnet upgrade/smoke. If an issuer devnet environment becomes available, verify each supplied mint against that cluster rather than reusing mainnet addresses. A local simulation using copied mainnet account state is useful compatibility evidence, but is not a real funded issuer devnet integration.

## 6. Validation and limits

Executed `cargo test --workspace --lib` against current sources: **214 passed, 0 failed** (basket 136, factory 45, whitelist 27, Managed V2 6). Existing Anchor cfg warnings are recorded in the complete log. These are host library tests; they do not execute a fresh deployed SBF/CPI flow or prove an issuer asset is transferable through the basket.

Read-only RPC calls checked program ownership/executable flags, ProgramData, deployment block times, whitelist authority, four official mint addresses on both clusters, four devnet mock mints, existing three/six-asset baskets and six historical signature statuses. No key files were read. Public evidence and its [read-only probe](assets/xstocks-contract-compatibility-2026-10-03/rpc-probe.cjs) are preserved; the probe expects the repository's existing state/catalog paths and the block-time follow-up is included in the result JSON.

Focused source inspection covered signer/authority constraints, owner/PDA/ATA/mint checks, initialization, checked arithmetic, raw transfer and delta checks, oracle-free redemption, mint admission and upgrade governance. It did not include a full dependency audit, new SBF build, new validator E2E, fuzz campaign, mainnet transaction, external audit or legal review.

| Review score | Grade | Reason |
|---|---|---|
| Current source quality in reviewed paths | B | Explicit account validation, raw accounting, checked arithmetic and fail-closed admission; complete modern issuer integration still missing. |
| Security release readiness | C | Protective current admission policy, but single-key deployed governance, unattested older binaries and open instruction-level adversarial coverage. This is not a full security rating. |
| Official xStocks compatibility | Not supported | The complete observed issuer profile is rejected today. |
| Ready for mainnet | No | Existing contract, governance, evidence and legal release gates remain. |

Review handoff fields: `review.security_score=C`, `review.quality_score=B`, `review.ready_for_mainnet=false`; findings `XC-01` through `XC-04`. This task changed only this report and its evidence/HTML artifacts. Root owns the session/agent entrypoint handoff; `.superstack/build-context.md` was not rewritten by the scoped subagent.
