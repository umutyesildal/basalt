# Devnet owner completion, October 10, 2026

## Status

All three isolated owner-devnet programs are deployed and byte-attested. Genuine owner-wallet loader handoff is finalized and independently signature-verified. Owner-signed whitelist/factory initialization, four test-token admissions, lifecycle verification and creation activation remain pending. The owner setup screen is live at https://basalt.markets/devnet/setup. Existing legacy basket redemption remains available; the legacy factory was not reopened.

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

Treasury is pinned to the user's explicitly selected wallet `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea`. This recipient choice alone does not prove wallet control. Genuine loader acceptance was subsequently finalized as recorded below; initialization remains a separate owner action.

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

## Public package prepared

The clean committed operator checkout `5ed2db1fa6e7b2b77d5bb209e47835b6229c59cd` proved exact program/build equivalence to `cdc2e8b978470d12335d2186d7eaafdf52abc8a0` and exported the 494-byte transaction after two fresh finalized code/nonce reads at context 509530087. The public bootstrap-partially-signed package is shipped at `/devnet/owner-handoff.json`; the owner's signature is absent. The exact network fee quote was 10,000 lamports. Preparing/exporting this package sent no transaction and transferred no authority. [Preparation receipt](evidence/owner-handoff-preparation-2026-10-10.json).

Final frontend typecheck and production build passed. The actual exported package also passed the frontend parser with its genuine bootstrap signature. At preparation time the owner signature and chain execution were absent; the later finalized handoff is recorded below.

## Live release and genuine owner handoff

Source `823126105562247228ec4d90f082367b3e1270f0` passed all six GitHub CI jobs, including Node, Rust, dependency reachability, backend Node 20 container, dependency audit and secret scan. Vercel candidate `dpl_CfZ9bMCppy7dkYPydRKRDYZMvVUG` completed its hosted frozen install/production build, passed the Chrome review, and was promoted to `https://basalt.markets`. The Vercel API resolves the custom domain to that exact deployment with both metadata commit fields equal to the source. [Compact release evidence](evidence/owner-setup-live-release-2026-10-10.json).

The genuine owner accepted all three loader authorities in transaction [`2aHjrLcbZQ8oogQQmpCZKVetb5wX9v34c5aDyao7eeX7jVvLHZ681pJLUyixKKmcctnMvvguSYW67SLAFwjv4JAC`](https://explorer.solana.com/tx/2aHjrLcbZQ8oogQQmpCZKVetb5wX9v34c5aDyao7eeX7jVvLHZ681pJLUyixKKmcctnMvvguSYW67SLAFwjv4JAC?cluster=devnet), finalized at slot 509531529. The independently fetched legacy message exactly matches the reviewed durable-nonce handoff, and both actual bootstrap/owner Ed25519 signatures verify. A fresh finalized inspection at slot 509533148 authenticated all three deployed code hashes, slots, padding, pointers and owner authorities. [Finalized public evidence](evidence/owner-wallet-handoff-finalized-2026-10-10.json).

At that snapshot the whitelist and factory were still absent and the four admissions were absent. Chrome displays the remaining owner initialization actions and a wallet-connect control. The human was asked to connect the designated devnet owner and review/sign the remaining setup; no owner secret is available to the agent. Public basket creation is deliberately still disabled until genuine initialization and the dedicated bounded lifecycle proof pass. The backend was not changed by this setup-screen release.

## Live program initialization preflight

A read-only unsigned simulation of the actual six owner-setup instructions passed on finalized devnet context 509534003. The deployed programs successfully simulated whitelist initialization, factory initialization and all four exact mock admissions, using 98,656 compute units in an 812-byte transaction. Fresh quoted rent was 7,167,880 lamports and the network fee 5,000 lamports, total 0.007172880 devnet SOL. Signature verification was deliberately disabled for this unsigned preflight; no signature was created, no transaction was broadcast, and no state was persisted onchain. Genuine owner initialization remains pending. [Runtime simulation receipt](evidence/owner-setup-runtime-simulation-2026-10-10.json).


## Live diagnostic observation

Source `b075cbea25edcf3e4acbb4b03dc1e77abf535fb4` is live at https://basalt.markets in Vercel `dpl_9as2xcijMATprUxkJKg5BHfCJJbJ`. All six exact-source CI jobs passed. The actual owner signed again, and Chrome exposed the exact pre-broadcast guard: **The wallet changed the reviewed transaction. Nothing was broadcast.** This combined guard checks both local constructor identity and exact serialized message bytes, so this message alone does not establish that Phantom altered instructions. The next investigation separates cross-constructor wallet return objects from genuine wire-message changes. No changed instructions, compute budgets, fees or blockhash will be silently accepted. Creation is still disabled and the VPS backend is unchanged. See [release evidence](evidence/owner-diagnostics-live-release-2026-10-10.json).
