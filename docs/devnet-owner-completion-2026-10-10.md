# Devnet owner completion, October 10, 2026

## Status

All three isolated owner-devnet programs are deployed and byte-attested. Genuine owner-wallet handoff/setup, lifecycle verification and creation activation are still pending. Existing legacy basket redemption remains available; the legacy factory was not reopened.

## Funding and deployments

The requested amount was 7 devnet SOL. The bootstrap's finalized balance became 10.085145120 SOL at slot 509524365 after 10 test SOL arrived. The remaining deployments consumed approximately 4.455069760 SOL including retained rent and fees, leaving 5.630075360 SOL at slot 509527425. No additional funding is needed.

| Role | Program | Deployed slot | ELF bytes |
|---|---|---:|---:|
| Whitelist, retained | `37UVmx2uysqkKibBcSP5EZMycUeKnWRmnXVpr967juKF` | 509261837 | 343,456 |
| Factory, new | `2xvJKG8DTmSZFu1zXpNVP3wvaCCCgGC2ufGGhYjzr4DH` | 509526877 | 441,944 |
| Basket, new | `8XPKfAYPaDSvUH95CeyjkgujTXAE5nFBJyFSqZvFvX7T` | 509527303 | 433,504 |

[Strict deployment proof](evidence/owner-deployed-programs-public-proof-2026-10-10.json), [factory verification](evidence/owner-verified-basket_factory-2026-10-10.json), [basket verification](evidence/owner-verified-basket-2026-10-10.json). Canonical devnet genesis, loader ownership, Program→ProgramData PDA pointers, bootstrap authority, exact executable SHA256, deployment slots and all-zero remaining allocation were checked together at finalized slot 509527425.

The initial factory upload through the shared RPC hit its request limit and ended with max retries before deployment. Its existing buffer was authenticated against the exact authority/size and already written bytes. The same program and buffer were resumed through the CLI's normal TPU path, then verified. No replacement program identity was created; the final deployment reclaimed the buffer. Basket deployed through the normal TPU path.

## Source provenance

Factory and basket were built offline from exact committed source `cdc2e8b978470d12335d2186d7eaafdf52abc8a0` with `owner-devnet`. Two independent fresh build directories produced identical ELF hashes. The scratch lock format was adapted from version 4 to version 3 for cached target rustc 1.75 without changing the dependency graph or tracked lock. [Public build receipt](evidence/owner-sbf-build-2026-10-10.json).

The existing whitelist's earlier exact ELF remained in place. Its program/build input tree and all eight previously listed source/lock hashes match the committed build source. Its earlier deployment receipt and finalized executable hash remain recorded. The current toolchain's rebuilt whitelist differs for an unresolved build-environment reason; no source change was inferred and no unnecessary whitelist upgrade occurred. The source-to-ELF provenance is explicitly different from a claim that all three binaries came from the current rebuild.

## Owner-first completion

Treasury is pinned to the user's explicitly selected wallet `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea`. This recipient choice alone does not prove wallet control. Owner acceptance remains pending.

1. Prepare a bounded, dedicated durable nonce and a bootstrap-partially-signed public package.
2. Have the designated owner review/sign the exact checked transfer of all three loaders through `/devnet/setup`.
3. After finalized owner loader authority, the owner signs canonical whitelist/factory initialization and four fixed verified mock admissions.
4. Verify genuine owner signatures and finalized code/config/treasury/admissions.
5. Prove create, mint, oracle-free redeem and legacy redemption. Only then activate the new namespace in app/backend.

No owner secret, application/backend custody key, legacy upgrade, immutable treasury rewrite, official xStocks sandbox claim, multisig proof or mainnet approval is part of this completion.

## Durable nonce preparation

A dedicated 80-byte nonce was created and finalized at slot 509528012, with bootstrap authority. Rent was 1,056,640 lamports and the network fee 10,000 lamports, below the 2,000,000-lamport total cap. Private nonce/bootstrap keys remain outside Git; only public nonce state and transaction details are exported. The signer and prepared signature receipt were fsynced before a single broadcast; the finalized receipt was atomically replaced and read back. No automatic replay or replacement nonce was used. [Nonce creation receipt](evidence/owner-nonce-creation-2026-10-10.json).

This nonce preparation does not transfer any program authority or prove owner acceptance.

## Wallet UI and local verification

`/devnet/setup` now supports the checked loader handoff and actual owner-first setup. The preferred button loads the fixed public same-origin package; manual file import remains available. Bootstrap partial signatures are public preparation material and cannot execute without the designated owner's genuine signature. The operator requires clean committed source and exact program/build source equivalence before preparing that package.

The browser independently checks exact pinned deployed ELF hashes/lengths/slots, zero padding, loader pointers and authority; then the nonce, wire instructions, signer privileges and signatures. It rejects changed wallet/message/actions/fees, tracks ambiguous outcomes by saved signature, and never automatically resends. [Independent read-only implementation review](devnet-owner-handoff-review-2026-10-10.md).

The local Chrome screen authenticated real finalized devnet state and showed “The reviewed programs are ready for owner acceptance.” No wallet was connected or owner transaction signed during that inspection. Focused tests: 41 owner UI real-crypto/state cases, 33 handoff operator cases, and source-policy tests. The full local app suite passed 369 Node plus 57 Vitest cases and concept integrity before the last focused recovery refinements; the final 41-case suite and typecheck cover those refinements. Backend passed 1,280 cases (292 environment-dependent cases skipped); security suite passed 68 with one environment-dependent skip. Genuine finalized owner execution remains required.
