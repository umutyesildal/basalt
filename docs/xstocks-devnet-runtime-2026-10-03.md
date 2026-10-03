# Current V0 xStocks-profile runtime proof, 2026-10-03

Status: complete for this scoped V0 compatibility increment. Current-source build, independent review, all three devnet upgrades, exact deployed-byte attestation and complete three/four-constituent runtime proof passed. All 54 proof-run transactions are finalized. Public Create and real funded issuer-token integration remain separate product work. This document records their verified outcome. It supersedes the earlier blanket extension-rejection boundary for the current V0 source and byte-attested devnet deployment; the earlier audit remains historical evidence.

## Scope and compatibility decision

The owner requested compact Stocks/ETF cards and current contract tests on devnet with three or four underlying tokens. [Compact cards](compact-asset-cards-2026-10-03.md) passed production build and desktop/mobile browser checks. Detail-page Bklit 7D/1M charts remain.

V0 admission now uses the [shared strict policy](xstocks-token-policy-decision-2026-10-03.md). It accepts plain mints, fully validated display-only extensions, or the exact observed eight-extension issuer profile with initialized default state, unpaused state and inactive hook. Whitelist admission, factory seed and basket deposits validate mint/account data. Every transfer still uses raw units and exact debit/credit reconciliation. IDs, instruction arguments, account layouts, immutable composition and fee formulas remain unchanged.

Redemption receives no new whitelist, oracle, backend, admission, price, market-hours or extension-policy gate. Issuer pause/freeze/active-hook restrictions may still prevent the underlying Token-2022 transfer. PermanentDelegate may change backing externally; shares always claim the actual raw holdings remaining. This is an explicit issuer trust assumption, not guaranteed redemption availability.

## Source review and host checks

- Independent parser/wiring review: no actionable defect, recorded in [harness and review](xstocks-devnet-basket-proof-2026-10-03.md). A second agent reviewed the harness itself.
- Rust workspace: 214 existing program tests plus 29 shared-policy integration tests passed, including real mainnet AAPLx/SPYx public account fixtures and 2,000 deterministic mutations.
- Backend full suite after fixture/verifier/transport additions: 807 passed, 18 database-dependent tests skipped. This includes 11 fixture tests, 11 deployment-verifier tests and six transport tests.
- Repaired basket harness: 16 focused tests passed, including the SDK expected-failure confirmation race. Scripts typecheck.
- Isolated SBF wrapper: 14 controlled cases passed and the actual three-program build passed.
- Existing management fee math and raw pro-rata paths are unchanged. Host checks are not a runtime or official-token custody proof.

## SBF builds and a corrected artifact trap

Modern official tooling was required for Cargo.lock v4. [Readiness evidence](devnet-contract-readiness-2026-10-03.md) records Agave 4.3.0, platform-tools v1.56 / Rust 1.89, source/archive hashes and devnet feature observations. These tools were installed under a temporary directory without changing the default toolchain.

A workspace-wide SBF build unified CPI/no-entrypoint features and overwrote standalone whitelist/basket outputs with 896-byte library artifacts. Solana's local ELF preflight rejected the attempted whitelist upgrade with `Entrypoint out of bounds`; no transaction was sent. The correction builds each program separately into its own output directory and validates the named ELF before copying it to the deployment directory. No loader or feature verification was bypassed.

| Artifact | Executable bytes | ELF entrypoint | Existing ProgramData capacity |
|---|---:|---|---:|
| whitelist | 244,624 | 0xbd18 | 261,816 |
| basket_factory | 319,128 | 0x11768 | 537,736 |
| basket | 357,248 | 0x1b7c8 | 593,416 |

The permanent [isolated build command](v0-sbf-build-2026-10-03.md) now replaces the root package script’s former host-build fallback. It validates both legacy EM_BPF=247 and modern EM_SBPF=263 ELF encodings; an initial overly narrow machine check was corrected using the actual compiler output. Fourteen controlled wrapper tests and a full actual three-program run passed. The final hashes stayed identical to the binaries uploaded through the CLI. [Actual build log](assets/xstocks-devnet-runtime-2026-10-03/sbf-isolated-build.log).

All three fit existing accounts. Only their existing public devnet IDs are upgraded, with the existing authority. Managed V2 is outside this change. Current working-tree source and binary hashes will be recorded by the read-only deployed-byte verifier after all upgrades complete.

## Devnet test boundary

Starting devnet balance: 3.117839360 SOL at the public readiness observation. No payer private key was printed or copied. Existing historical .e2e-devnet state is preserved. Fresh fixtures, generated test actors and temporary loader buffers use an ignored isolated `.cache/devnet-xstocks/issuer-profile-20261003-0035` directory with private keyfiles mode 0600.

The four new tokens are explicitly project-issued eight-decimal mocks, BSTESTA/B/C/D. They reproduce all eight observed mint extensions, including ConfidentialTransferMint configuration while retaining transparent raw token accounts. They are not official issuer devnet xStocks, and devnet SOL does not buy or create genuine mainnet-backed equities. Real AAPLx/SPYx account bytes are separately used as parser fixtures.

Planned runtime checks: 3/4-token atomic create, proportional in-kind mint, oracle-free pro-rata redeem, separate creator/investor/treasury share conservation, 90/10 entry/exit/management fee split, four-token ALT packet size, confirmed rejected transactions with full writable-account rollback, whitelist pause with successful redemption, issuer pause/active-hook/frozen-default rejection, and multiplier display change with unchanged raw custody. Mutated mock settings are restored.

## Runtime outcome

All three upgrades returned confirmed signatures. The initial RPC write attempt reached its retry limit; resuming the same buffer through the official CLI TPU route succeeded. No loader preflight or feature check was skipped.

| Program | Upgrade signature |
|---|---|
| Whitelist | `5WvW8oQQ7PMFhe7WCkWg6eurboY3BwB4PKg8SCmmQpu46xj7JyrZTXu1Kn1CRUN49eoAVUgKS56QtpJTfkRdkVdx` |
| Basket | `JLNPbGn2VZ79FrQELtm9qN3JKX4aGLBUq9jHUSHxB2cyCzxDDLXBvAF2d4KPzp8FRDi9z9hH11c5QPYww65hDn8` |
| Factory | `51hU9eLhgsotapE2KtDG4xmarq18nMuhvQjhoSxQUjovBi5cYC7oKEDuaA5S8ZcbtCaBFpejCchN9ERzbBv4TPcc` |

[Public fixture state](assets/xstocks-devnet-runtime-2026-10-03/fixture-state.json) records four successfully created, funded and admitted mock mints. Setup spent 0.027654240 SOL and left 3.085585120 SOL; the loader upgrade/write costs are separate.

[Finalized deployed-byte attestation](assets/devnet-contract-readiness-2026-10-03/deployed-byte-attestation.json) passed at slot 506820772. Current source file-set SHA-256 is `387ad99ba1baaee9b8e9a00c96570b3ce82bee4e65b1e3ec183485c34e70c62a`. Program deployment slots are whitelist 506817308, factory 506817882, basket 506817619. The verifier checks the exact executable prefix, zero-only spare capacity, loader/PDA ownership and unchanged upgrade/whitelist authorities; it does not certify an independent reproducible build.

The repaired run completed with **54 validated, finalized transactions: 38 successes and 16 expected rejections**. It recorded 28 proof assertions; both basket summaries passed. [Complete runtime report](assets/xstocks-devnet-runtime-2026-10-03/basket-proof.json), [full execution log](assets/xstocks-devnet-runtime-2026-10-03/basket-complete.log), [finalized ledger and restored settings](assets/xstocks-devnet-runtime-2026-10-03/finalized-proof.json). No mainnet compatibility certification, mainnet deployment, external audit or public Create transaction integration is claimed by this work.

## First runtime attempt and SDK confirmation recovery

The first run proved three-token atomic seed, proportional mint, raw share/asset reconciliation, management fee accrual and a successful redemption with the whitelist’s mint-only pause active. Confirmed deposit/create rejections preserved writable financial account bytes.

The deliberately issuer-paused redemption then landed with Token-2022 Custom(67), at slot 506819830, signature `J5DjvMq3N8dUg72yordZKRAM2E7BiHE4idcopeFynh7LLirHhxpH3uiUGzoMVm2RjyVKpFxXmCMPGiuY5mrQ5X2`. The SDK’s HTTP status race rejects with a plain `InstructionError` object instead of returning `value.err`; the harness treated that expected failed transaction as a generic tool error. The issuer pause was restored in `finally`. [Recovered onchain error/logs](assets/xstocks-devnet-runtime-2026-10-03/attempt-1-failure-recovery.json) show the actual underlying transfer restriction.

This is a test-harness confirmation fix, not a relaxation of contract checks. An observed failed signature is queried and verified at confirmed/finalized commitment without resending. Submitted signatures are persisted before waiting. Absent/processed/ambiguous statuses still stop execution. The partial first run is retained in [attempt-one report](assets/xstocks-devnet-runtime-2026-10-03/basket-proof-attempt-1.json) and [log](assets/xstocks-devnet-runtime-2026-10-03/basket-attempt-1.log). A subsequent complete run uses fresh basket nonces while preserving the same explicit mock identity and historical state.

## Completed runtime checks

| Underlyings | Basket | Create / mint / redeem wire bytes | Create compute units |
|---:|---|---:|---:|
| 3 | `HYq16UQLv8HnBnzZDgjEJWnYS1mrUs5rzzbycQEGduSW` | 577 / 452 / 426 | 235,129 |
| 4 | `YZuBJ6PmVZXvaGHmNC8g84j1H61zDWpZ1mkENjGcrd8` | 627 / 476 / 440 | 295,798 |

Both flows use one run-scoped address lookup table, with packet sizes below Solana’s 1,232-byte limit. They seed actual transparent raw token vaults, mint basket shares to a separate investor, stream management-fee shares, and redeem proportional raw assets. All creator/treasury fee legs conserve the total fee with the canonical 90/10 split and remainder dust. The three holder balances sum to the share mint supply at every checkpoint.

For each basket, eight expected failures were confirmed and their writable financial account bytes remained unchanged: whitelist-paused deposit, issuer-paused deposit/create/redeem, active-hook deposit/create, and frozen-default deposit/create. Redemption succeeded while the whitelist’s new-mint pause was active. Issuer-paused redemption failed at the underlying Token-2022 transfer, demonstrating the issuer restriction without adding a basket redemption gate.

Changing the final constituent’s display multiplier by 2x changed displayed units while preserving raw custody, share supply and fee checkpoints. A subsequent redemption matched the same raw pro-rata formula. All four mock mints were restored to their original display multipliers, unpaused/inactive-hook/Initialized configurations, and active whitelist state.

Finalized read-only snapshot: slot 506,823,575. Remaining payer balance: **2.955199120 SOL**. The entire task reduced the starting 3.117839360 SOL by 0.162640240 SOL, including setup, loader write fees, address-table/actor/account rent and both retained test attempts. Actor/vault/account rent remains in the test environment; it is not all network fees. No faucet or mainnet transaction was used.

## Reproduction and remaining boundary

- Build: [isolated V0 build command](v0-sbf-build-2026-10-03.md), never a workspace SBF build or host fallback.
- Setup: `node --import tsx scripts/setupXStockDevnet.ts --run-id <fresh-id> --payer <existing-devnet-keypair> --execute`. Default mode is offline/read-only.
- Runtime: `node --import tsx scripts/testXStockBaskets.ts --run-id <same-id> --payer <existing-devnet-keypair> --execute`. Positive confirmation ambiguity stops the run; expected failed confirmations are resolved by the same signature, never resent.
- Byte verification: `node --import tsx scripts/verifyXStocksDeployment.ts --output <local-json-path>`; no signer reads or transactions.

This closes the requested devnet 3/4-token V0 runtime proof. It does not certify active-hook support, confidential token accounts, fee-bearing tokens, future extension changes, real funded official-token custody or mainnet readiness. Official AAPLx/SPYx data is validated by separate parser fixtures; runtime tokens are explicitly project mocks. Multisig governance, external security/legal review and real issuer integration remain required future work. All source/docs changes remain local after the earlier landing push.


## UI availability follow-up, 2026-10-03

The owner confirmed that project-issued devnet mock tokens are acceptable for the user-facing test flow. The successful contract runtime proof does not yet make the current public UI an end-to-end devnet app. `/create` renders the concept sharing flow, and `/create/onchain` redirects to it. Existing in-kind buy and redeem components have wallet transaction builders, but depend on indexed basket/holdings/supply data and wallet token balances. Mock tokens cannot use the Jupiter USDC zap path. A read-only follow-up check found no reachable local API at `127.0.0.1:3001`, so indexed test baskets are not currently available through that service. Completing UI availability requires exposing the onchain create flow, serving the actual devnet basket data and making the test tokens available to the connected user wallet. No additional chain transaction, public wallet connection test or UI integration was performed in this follow-up.

## Superseding UI availability notice, 2026-10-03

The later authorized wallet-flow work completes the missing fixed-mock UI path described in the preceding follow-up. `/devnet` and `/create/onchain` now connect a wallet, claim the funded once-per-wallet BSTESTA–D pack, atomically create a basket with its own share mint, mint in kind and redeem pro rata. `/create` and shared previews expose explicit devnet links. Current basket, raw supply, vault and wallet data come directly from a genesis-pinned devnet RPC; the flow needs neither the local API/database nor a backend signer.

The faucet is deployed at `2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf`, with a finalized isolated-wallet claim. The shipped UI transaction builders passed seven finalized transactions and 20 assertions for basket `9PoTEPsCjew9NtYA9MLTjDapMsW1ZdW4dgokdGzmPimB` and share mint `9UPqD8gfePPEMpEy67pCitvwqr4V58jTcFzSkPB2P3A9`. [The wallet-flow record](devnet-ui-wallet-flow-2026-10-03.md) distinguishes this chain proof from browser checks and the still-unperformed owner extension-wallet signature. Names and theses remain hash-verified browser-local metadata. This notice supersedes only the prior redirect/incomplete mock-UI status; real official-token custody, mainnet and Managed V2 remain outside the scope. Earlier historical evidence is preserved, and this UI follow-up made no core ABI/math change or source push.
