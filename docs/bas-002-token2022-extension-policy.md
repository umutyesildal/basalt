# BAS-002 — Token-2022 extension policy and official xStocks fixtures

Status: fixture and policy decision record only. The program/client changes described here are not implemented by this document.

## Scope

BAS-002 closes the evidence gap around Token-2022 mints used as basket constituents. A Token-2022 mint is not equivalent to a legacy SPL mint just because it exposes the same basic `mint` and `token account` fields. Extensions can change who can transfer or burn, whether transfers are paused, how balances are displayed, and whether a transfer requires additional accounts.

The current V0 policy fails closed and admits only extension-free Token-2022 mints. In particular, the current implementation is not compatible with a mint that has an active transfer hook, confidential-transfer state, a permanent delegate, or a paused mint. This is a compatibility statement, not a claim that the issuer is malicious or that the asset cannot be used elsewhere.

## Point-in-time observation

The fixture [`docs/fixtures/token2022-mainnet-xstocks-2026-09-18.json`](fixtures/token2022-mainnet-xstocks-2026-09-18.json) records three Solana mainnet-beta Token-2022 mints observed at slot `448202873` on 2026-09-18:

| Symbol | Solana mint | Data length | Account-data SHA-256 | Observed multiplier |
|---|---|---:|---|---:|
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | 678 bytes | `74bde2c8afcf154a27832ba07caba20caa261286246f404a2ffd7f604ecfca84` | 1 |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | 678 bytes | `d8f8370a463e93af87638c2968903819bd2c68647cd3485f1e63cb3942836b7b` | 1.0026642075893797 |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | 679 bytes | `8d518878dfbe607807cada615dfa0834eda8288569b571f63f5a40cba41724f6` | 1.0009180758490996 |

All three observations reported:

- owner `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
- decimals `8`
- extensions in this order: `18 MetadataPointer`, `12 PermanentDelegate`, `6 DefaultAccountState(state=Initialized=1)`, `25 ScaledUiAmountConfig`, `26 PausableConfig(paused=false at observation)`, `4 ConfidentialTransferMint`, `14 TransferHook(programId=None/default; hook authority mutable)`, `19 TokenMetadata`
- scaled-ui authority `S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS`
- permanent-delegate, metadata, and transfer-hook authority `5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq`
- pause authority `JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs`

These values are evidence captured at one slot, not immutable product metadata. Supply, extension configuration, multiplier, pause state, authorities, and account bytes can change. The hashes are useful for reproducing this observation, but they do not prove that the mint remains unchanged later. A deployment must re-read and verify the mint on every allowlist admission and record a new fixture when the observed state changes.

The three fixtures are intentionally not an approval to use these mints in V0. The observed extension set includes features the current Anchor/SPL transfer contract does not handle. Official xStocks metadata and API endpoints are useful discovery sources, but the on-chain account remains authoritative for program admission.

## Current V0 admission policy and future expansion

The current whitelist uses a strict allowlist whose accepted extension set is empty, with deny-by-default behavior. The following rules document the current boundary and the checks required before expanding it:

1. Require the Token-2022 program owner exactly. Reject legacy SPL Token mints and any other owner.
2. Parse the mint and every enabled extension before creating or updating a whitelist record. Reject unknown extension IDs.
3. Require decimals to match the product limit and record the on-chain value. Do not infer decimals from ticker metadata.
4. Keep `MetadataPointer`, `TokenMetadata`, `DefaultAccountState(Initialized)`, and `ScaledUiAmountConfig` out of the V0 accepted set until their fields are validated and the client/indexer can read them. These are future-review candidates, not currently supported extensions.
5. Reject `PermanentDelegate` in V0. The issuer-level delegate can affect holder balances outside the basket program's signer set, so a vault/share accounting proof cannot treat the vault balance as solely controlled by normal owner transfers.
6. Reject `PausableConfig` in V0 unless the program explicitly models the mint's pause state. A paused issuer mint can stop a transfer while `redeem_in_kind` is required to remain permissionless, oracle-free, and independent of the whitelist pause flag. The product's own pause remains mint-only; this rule does not add a redeem pause.
7. Reject `ConfidentialTransferMint` in V0. Confidential balances cannot be reconciled with the current raw `u64` balance and pro-rata accounting path.
8. Reject `TransferHook` in V0 unless the transfer instruction supplies and validates the hook's required accounts and the hook-aware received-delta tests pass. A default/null program ID observed today is not a permanent guarantee: the hook authority is mutable.
9. Accept `ScaledUiAmountConfig` only as a display/NAV input. Program transfers and redemption math remain raw. The multiplier must be read from the mint and stored with every off-chain holding snapshot; a changed multiplier is a corporate-action/data event, not a change to raw vault ownership.
10. Require a positive, known account state and reject `DefaultAccountState` values other than `Initialized` for V0.

The policy should be enforced on-chain at whitelist admission, mirrored in the client for clear errors, and re-checked by the indexer as a monitoring alarm. Client checks are not a substitute for program checks.

## Received-delta design for seed and mint

The caller-supplied `amounts` and `vault_balances` vectors are not proof that the vault received those amounts. Once a compatible mint is admitted, the implementation should make each transfer auditable:

1. Before each constituent transfer, read the source and destination token-account raw amounts.
2. Execute `transfer_checked` with the mint's on-chain decimals and raw amount.
3. Reload both token accounts and calculate `source_delta` and `destination_delta` with checked arithmetic.
4. Require the destination delta to equal the intended amount and the source delta to equal the same amount. If a future fee, hook, delegate, or other extension makes either delta differ, abort the instruction rather than crediting shares against an amount the vault did not receive.
5. For `create_basket` seed transfers, perform this check for every constituent in the same atomic instruction. Initialize the basket only if all deltas match.
6. For `mint_in_kind`, require the verified destination deltas to equal the requested raw amounts before calculating gross shares. The current implementation also validates the supplied vault-balance snapshot against the on-chain vault account immediately before transfer; the existing weight-tolerance rule remains in force.
7. Preserve the existing invariant that `redeem_in_kind` has no oracle, backend, whitelist-pause, or issuer-pause account. The V0 admission policy rejects assets whose transfer semantics would make that invariant unprovable; it does not gate redemption at runtime.

For a future hook-aware version, the transfer instruction must pass the hook's required extra accounts, verify the hook program ID against a protocol policy, and test both the source and destination deltas. “Program ID is null in today's snapshot” is insufficient because the authority is mutable.

## Extension compatibility matrix

| Extension | V0 status | Reason / required work |
|---|---|---|
| `MetadataPointer` (18) | Conditional | Validate pointer and issuer metadata; do not treat metadata as transfer authority. |
| `PermanentDelegate` (12) | Reject | External delegate can burn/transfer; vault balance assumptions need a different trust model. |
| `DefaultAccountState` (6) | Future conditional | Only `Initialized` may be considered after extension-aware validation; no extensions are admitted by current V0. |
| `ScaledUiAmountConfig` (25) | Future conditional | Raw on-chain accounting; read multiplier for display/NAV and monitor authority changes before admission. |
| `PausableConfig` (26) | Reject in V0 | Issuer pause semantics are not modeled; never turn this into a redeem gate. |
| `ConfidentialTransferMint` (4) | Reject in V0 | Current accounting requires observable raw balances. |
| `TransferHook` (14) | Reject in V0 | Current CPI does not pass hook accounts or prove received deltas. |
| `TokenMetadata` (19) | Conditional | Parse safely; ticker/name are not identity and do not authorize a mint. |
| Any unknown/future extension | Reject | Fail closed until reviewed and covered by instruction-level tests. |

## Required tests before enabling any observed mint

- fixture parser rejects a wrong owner, wrong decimals, unknown extension, duplicate extension, and changed account hash;
- `PermanentDelegate`, paused `PausableConfig`, `ConfidentialTransferMint`, and `TransferHook` fixtures are rejected at whitelist admission;
- `DefaultAccountState(Frozen)` is rejected and `Initialized` is accepted;
- multiplier changes update display/NAV only and never change raw transfer or redeem amounts;
- seed transfers abort when the destination delta differs from the requested raw amount;
- mint transfers abort when a source or destination delta differs;
- zero, overflow, and stale-account reload paths fail closed;
- redeem remains callable with no oracle, backend, whitelist pause, or issuer-pause account in the instruction context;
- a future hook-aware implementation passes extra-account validation and adversarial hook tests before its denylist entry is removed.

## Primary references

- [Solana Token Extensions](https://solana.com/docs/tokens/extensions)
- [Solana Permanent Delegate extension](https://solana.com/docs/tokens/extensions/permanent-delegate)
- [Token-2022 source repository](https://github.com/solana-program/token-2022)
- [Token-2022 `ScaledUiAmountConfig` implementation](https://github.com/solana-program/token-2022/blob/main/interface/src/extension/scaled_ui_amount/mod.rs)
- [xStocks developer documentation](https://docs.xstocks.fi/developers)
- [xStocks public asset API](https://api.xstocks.fi/api/v2/public/assets)
- [Backed API documentation](https://api.backed.fi/api-docs/)
- [Official xStocks token-list repository](https://github.com/backed-fi/cowswap-xstocks-tokenlist)
- [Official issuer product catalogue](https://assets.backed.fi/products)

`LEGAL_REVIEW_REQUIRED`: xStocks are issuer-specific structured/tokenized instruments, not direct equity ownership. This technical note is not investment, legal, or tax advice.
