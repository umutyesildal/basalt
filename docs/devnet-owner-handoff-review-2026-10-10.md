# Owner devnet handoff and setup review

Date: 2026-10-10. Scope: read-only implementation, wire, state, artifact and recovery review. No source edits, key reads, wallet operations or transactions were performed by this reviewer.

## Result

No remaining blocking finding in the frozen implementation. The owner-first setup is compatible with the currently reviewed program source. Actual owner signing and finalized execution remain separate runtime verification steps.

Reviewed files in the canonical release worktree:

- `scripts/devnet-owner-handoff.ts`
- `backend/tests/devnet-owner-handoff.test.ts`
- `app/lib/devnet-owner-setup.ts`
- `app/lib/devnet-owner-setup.test.ts`
- `app/components/devnet/devnet-owner-setup.tsx`
- `app/lib/devnet-owner-artifacts.json`
- `programs/whitelist/src/lib.rs`
- `programs/basket_factory/src/lib.rs`
- `docs/evidence/owner-deployed-programs-public-proof-2026-10-10.json`

## Verified bindings

The public package contains exactly the fixed nine-field schema. The browser independently reconstructs the compiled legacy message: bootstrap fee payer, durable nonce advance first, followed by checked upgrade-authority transfers for whitelist, factory and basket. Each transfer uses enum 7, canonical writable ProgramData, bootstrap signer and designated owner signer. The genuine bootstrap signature must remain unchanged; the exact missing owner signature is supplied by the wallet. Added instructions, accounts, changed message bytes, wrong signers and invalid signatures are rejected.

Finalized reads authenticate all three program accounts, canonical loader PDAs, exact deployed slots, SHA256 of the declared ELF bytes and zero trailing padding. The browser repeats code and state checks before signing and before its single broadcast. The public package source commit is informational; artifact authentication comes from source-pinned reviewed hashes.

The CLI requires clean committed source, exact source-bound public deployment proof and source equivalence across programs, shared crates, vendored Rust, the Rust verification workspace member, manifests, lockfile, toolchain/config files and build script. A later UI-only commit is permitted, while owner/bootstrap/program identity drift is rejected. Existing initialized, rent-exempt bootstrap-owned durable nonce and exact actual finalized fee quote are checked before loading the isolated bootstrap signer. The CLI has no chain-write path.

Owner-first `init_config` and `init_factory` authenticate the canonical ProgramData upgrade authority. They therefore require the real loader handoff to land first. The setup then initializes both singleton configs and admits only the four fixed mock Token-2022 mints. Treasury, 90/10 fee split, caps, account discriminators, lengths, bumps, admission source strings and counts are checked. Existing proposed whitelist ownership can be claimed; incompatible existing ownership fails closed.

## Review findings resolved

1. Added frontend ELF hash, length, zero-padding and deployed-slot authentication on every relevant read.
2. Expanded CLI source equivalence to shared crates and vendored/workspace Rust inputs.
3. Bound the submitted actions and rent/network-fee upper bounds to the owner's displayed review.
4. Added normal-blockhash lifetime receipts captured before wallet interaction, finalized expiry recovery and a second status read to catch a finalization racing an initial missing status.
5. Recognized canonical prefunded, System-owned, nonexecutable, zero-data setup PDAs as vacant, matching Anchor 0.30.1 initialization semantics; foreign-owned, executable and nonempty accounts remain rejected.
6. Corrected expiry recovery's commitment mismatch: signature-status context is processed, so it must not become a finalized account-read minimum slot. Recovery uses the pre-broadcast finalized receipt slot.

Receipts persist synchronously before broadcast. Ambiguous transport outcomes retain the same public signature, prevent automatic resending and require reconciliation. A failed persistence operation prevents broadcasting. Fresh owner review is required after expiry; no automatic re-signing occurs. Wallet, connection, acceptance and active-page intent are checked around asynchronous operations. The public handoff loader is fixed same-origin, no-store, redirect-rejecting, 8 KiB bounded and feeds the same strict package validator.

## Size and validation evidence

- Exact four-instruction checked handoff: 494 serialized bytes.
- Exact six-instruction owner-first initialization/admission transaction: 812 serialized bytes.
- Both are below Solana's 1,232-byte packet limit.
- Setup caps rent plus network fee at 0.02 SOL, network fee at 100,000 lamports and preserves a 1,000,000-lamport reserve. Prefunded accounts retain a conservative full-rent upper bound.
- Handoff CLI agent reports 33 focused tests passing and targeted TypeScript checking passing.
- Owner setup agent reports 41 real-crypto focused tests passing. Coverage includes message substitution, cryptographic signatures, nonce replay/state/authority, code/slot/padding changes, wallet intent changes, cost/action review binding, immutable treasury/split expectations, prefunded targets, lifetime metadata mutation, ambiguous send, expiry race and processed/finalized context separation.
- Reviewer ran `git diff --check` successfully and independently inspected frozen code and regression assertions.
- Both unsigned and fully signed simulations are required before actual broadcasting. Static review and synthetic tests do not replace the genuine owner's finalized wallet execution.

## Reviewed deployed artifact pins

Build-source reference: `cdc2e8b978470d12335d2186d7eaafdf52abc8a0`.

| Program | ELF bytes | SHA256 | Deployed slot |
| --- | ---: | --- | ---: |
| whitelist | 343456 | `381398e9a6f51f0555990b696d8a81f7a225f44f0ef3897a44a575a07ca16d01` | 509261837 |
| basket_factory | 441944 | `10cba51806f5c1c5c3f0bd3b189911d219393a7a9668a49aa245f889d9fdbe91` | 509526877 |
| basket | 433504 | `b005928bda9cafa7ba3609af1a9774fb2e241055e708aef7d8d08672b4169154` | 509527303 |

The previously deployed whitelist is intentionally retained. Its private public receipt was source-bound to `ef31b239a6887715f6a2fee59fed4d079035ee76`, whose tracked program/build inputs match the current build-source commit. Two fresh builds reproduce the new trio byte-for-byte, but the earlier whitelist binary differs and earlier full compiler/environment provenance was unavailable. This review does not infer a source change or claim that the old whitelist was independently rebuilt to the same bytes.

## Primary compatibility evidence

- Pinned loader checked-authority instruction: https://raw.githubusercontent.com/solana-labs/solana/v1.18.26/sdk/program/src/bpf_loader_upgradeable.rs
- Pinned durable nonce fee lookup: https://raw.githubusercontent.com/solana-labs/solana/v1.18.26/runtime/src/bank.rs
- `getFeeForMessage`: https://solana.com/docs/rpc/http/getfeeformessage
- Pinned signature-status RPC explicitly selects the processed bank (lines 1313–1323): https://raw.githubusercontent.com/solana-labs/solana/v1.18.26/rpc/src/rpc.rs
- Anchor 0.30.1 `generate_create_account` handles prefunded PDA targets with rent top-up, allocate and assign; verified in the locally cached primary crate source at `anchor-syn-0.30.1/src/codegen/accounts/constraints.rs`.


## Final live follow-through, 2026-10-10

The genuine owner initialization is finalized and the owner/treasury is `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea`. The 90/10 split, 300/100/300-bps entry/exit/management caps and all four exact active mock admissions were authenticated. Earlier pending authority/setup checkpoints are historical. Single-owner devnet authority is not a multisig or mainnet governance approval.

Website and VPS backend are live from `6cacb49f2b1a1fecd7398174c189c9bb65cec895`. [Create on devnet](https://basalt.markets/create/onchain) is the normal user entry point. [Final release, owner setup, completed lifecycle and hosted evidence](devnet-owner-live-activation-2026-10-10.md) supersede earlier pending/disabled checkpoints in this record without deleting their history. The live release uses project-issued mocks; historical financial projection remains guarded, USD values remain unavailable, and no mainnet or fresh human UI creation transaction is claimed.
