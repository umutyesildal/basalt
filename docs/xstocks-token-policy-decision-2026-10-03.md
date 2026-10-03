# xStocks token admission decision, 2026-10-03

Status: implemented and independently reviewed for current V0. All three current SBF binaries are byte-attested on devnet; complete three/four-constituent runtime proof passed with the explicit full-profile mocks. [Completed runtime evidence](xstocks-devnet-runtime-2026-10-03.md). The earlier [compatibility audit](xstocks-contract-compatibility-2026-10-03.md) remains pre-change evidence, and real funded issuer-token integration/mainnet certification remains separate.

## Chosen boundary

Keep Anchor 0.30.1 and existing Token-2022 raw `transfer_checked` CPI. Add one shared `basalt-token-policy` crate for complete byte validation. A modern official interface dependency is preferred only if it compiles with the existing dependency graph and SBF toolchain; the disposable 1.0.0 probe already demonstrated a `zeroize` dependency conflict. The selected implementation is a dependency-free strict wire validator after both interface probes failed against the current dependency graph. Exact published interface 1.0.0 and metadata 0.7.0 source hashes are pinned in `crates/token-policy/tests/fixtures/upstream-layouts.json`; runtime account validation does not add a second Solana SDK.

Mint validation is used at whitelist admission, atomic seed/create and new in-kind deposits. Token-account extension validation is used on seed/deposit source and vault accounts. **Redeem receives no new whitelist, mint-admission, oracle, price, backend, pause or extension-policy gate.** Its existing identity checks and raw pro-rata accounting remain.

Three accepted profiles:

| Profile | Accepted mint data |
|---|---|
| Plain | Exact initialized 82-byte Token-2022 base mint, no padding or extensions. Existing behavior retained. |
| DisplayOnly | A nonempty subset of MetadataPointer (18), TokenMetadata (19), ScaledUiAmount (25), DefaultAccountState (6). Every present payload is fully parsed. Default state must be Initialized; metadata identity must match this mint; both multipliers must be finite and strictly positive. |
| IssuerControlled | Exactly the eight observed issuer extension types: MetadataPointer (18), PermanentDelegate (12), DefaultAccountState (6), ScaledUiAmount (25), Pausable (26), ConfidentialTransferMint (4), TransferHook (14), TokenMetadata (19). Default state Initialized, paused=false and hook program=None are required. |

The profile is a transfer/accounting compatibility classification, **not proof that an asset was issued by Backed**. Token-2022 program ownership and an authority-controlled, authenticated mint-specific whitelist remain mandatory. A mock can reproduce an extension layout; its name, symbol or layout never makes it a real xStock. Issuer catalog discovery never automatically admits a mint.

All unknown types, other known extensions, partial privileged profiles, duplicate TLVs, invalid account-kind tags, malformed/truncated payloads, invalid boolean bytes and nonzero data hidden after a TLV terminator are rejected. Genuine zero-filled allocation padding after valid entries is allowed. The parser must fully inspect every admitted entry rather than trusting `get_extension_types()` alone. Decimal cap remains 12 and must match actual mint state.

## Issuer powers are explicit trust assumptions

Accepting the observed profile changes the old empty-extension policy deliberately. It does not remove these issuer powers:

- PermanentDelegate can transfer or burn tokens in holder/vault accounts without the vault owner's signature. A basket share owns a pro-rata claim on the **actual raw assets remaining**, not an unconditional fixed quantity or issuer-independent custody guarantee.
- A Pausable authority can stop underlying mint/transfer/burn operations. A freeze authority can freeze token accounts. The basket program cannot override these restrictions.
- A mutable TransferHook authority may activate a hook later. This increment rejects any active hook on admission/deposit and supplies no arbitrary hook CPI. New deposits then fail closed. An underlying token transfer during redemption may also fail until the issuer restores compatible transfer behavior.
- A multiplier authority may schedule changes to displayed units. Both stored multipliers must be valid, but **raw balances, share ratios and transfer arguments never multiply by either value**.

Consequently “permissionless, oracle-free redeem” means the basket's own instruction requires no administrator/backend/oracle approval. It does not promise that an issuer-controlled underlying token always permits a transfer. Product and technical disclosures must retain this distinction. No admin withdrawal, basket rebalance, emergency seizure or new redemption pause is added.

ConfidentialTransferMint is only configuration. Its presence does not turn ordinary `TokenAccount.amount` into a hidden balance. This implementation continues to use public raw balances and rejects **ConfidentialTransferAccount** and all other confidential account extensions on seed/deposit accounts.

## Token accounts

Accept initialized base Token-2022 accounts, plus only the standard account extensions needed for this profile: ImmutableOwner (7), TransferHookAccount (15, transferring=false), and PausableAccount (27). Reject frozen/uninitialized accounts, malformed or duplicate entries, transfer fees, CPI guards, memo requirements, confidential accounts and unknown account extensions for new deposits.

ImmutableOwner belongs to token accounts, not mints. It prevents changing the ordinary account owner; it does not revoke a mint-level PermanentDelegate. Token-account owner/mint/ATA identity and Token-2022 program ownership are checked separately by the caller. Re-read and compare exact debit/credit raw deltas after CPI, as current create/mint already do.

## Shared API

```rust
pub fn validate_mint(data: &[u8], mint_key: &[u8; 32])
    -> Result<MintPolicyInfo, PolicyError>;
pub fn validate_token_account(data: &[u8])
    -> Result<TokenAccountInfo, PolicyError>;
```

Public result fields use primitive Rust values and local enums, not types from a different Solana SDK. Mint info exposes decimals and profile/risk flags; account info exposes mint bytes, owner bytes and raw amount. Callers map local structural/state/unsupported error categories into existing program errors. No program IDs, account layouts or instruction arguments change merely to add this validator.

## Required proof

1. Parse fresh real mainnet AAPLx/SPYx mint bytes into IssuerControlled; fixture provenance includes slot, mint, owner and hash. Wrong supplied mint key must fail metadata identity checks.
2. Preserve exact base mocks and display-only scaled mocks; reject every unknown/fee/active-hook/paused/frozen/confidential-account path, malformed TLV, duplicate entry and invalid payload.
3. Validate all eight privileged fields, metadata pointer/self mint, metadata UTF-8/length structure, canonical booleans and both multiplier encodings, including NaN/infinity/negative/zero cases.
4. Current SBF create/mint/redeem against a modern Token-2022 runtime with exactly 3 and 4 distinct extension-profile mocks, raw transfer/delta assertions and the larger-basket ALT path. A verified devnet runtime run satisfies this instruction-level requirement; a separate local-validator run is not mandatory. Devnet mocks remain mocks.
5. Negative instruction cases must leave vault/share state unchanged. Whitelist pause blocks deposits, never creates a new redeem gate. Token issuer pause/delegate/hook limitations are tested/documented rather than hidden.
6. Reproducible current SBF, byte hashes and deployment source record before an authorized devnet upgrade. Host tests alone are insufficient.

## Primary references

- [Published interface 1.0.0](https://docs.rs/spl-token-2022-interface/1.0.0/spl_token_2022_interface/), [interface 3.1.2](https://docs.rs/spl-token-2022-interface/3.1.2/spl_token_2022_interface/)
- [Token-2022 extension implementation](https://github.com/solana-program/token-2022/tree/main/interface/src/extension)
- [Issuer developer guide](https://docs.xstocks.fi/developers), [issuer multipliers](https://docs.xstocks.fi/developers/multipliers)
- [PermanentDelegate](https://solana.com/docs/tokens/extensions/permanent-delegate), [Pausable](https://solana.com/docs/tokens/extensions/pausable), [TransferHook](https://solana.com/docs/tokens/extensions/transfer-hook), [ImmutableOwner](https://solana.com/docs/tokens/extensions/immutable-owner)

## Parser implementation validation

The shared crate is implemented with zero external dependencies. `cargo test -p basalt-token-policy` passes **29 tests**, including the captured official issuer accounts and 2,000 deterministic account mutations. These integration tests must run explicitly; `cargo test --workspace --lib` does not select them. [Focused test log](assets/xstocks-token-policy-2026-10-03/policy-tests.log), [crate and exact upstream source provenance](../crates/token-policy/README.md). The pending runtime/deployment proof is separate and is recorded by the root implementation task.
