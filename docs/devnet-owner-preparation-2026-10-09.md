# Devnet owner preparation — 2026-10-09

The owner authorized generating the missing identities and proposed `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea`. Four fresh software keypairs were created in private storage outside Git, with an owned 0700 directory and 0600 files. Only their public addresses are in [the shared policy](../backend/src/config/devnetOwnerPolicy.json). These are a temporary devnet bootstrap and three program identities, not independent human multisig signers. The owner/treasury role choice remains unanswered; no acceptance is inferred.

| Role | Public address |
|---|---|
| Proposed owner | `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea` |
| Temporary bootstrap | `8B2wktjNVETgnkoe92r2hTL9THw7umh4zF7iuidMt5H4` |
| Whitelist | `37UVmx2uysqkKibBcSP5EZMycUeKnWRmnXVpr967juKF` |
| Factory | `2xvJKG8DTmSZFu1zXpNVP3wvaCCCgGC2ufGGhYjzr4DH` |
| Basket | `8XPKfAYPaDSvUH95CeyjkgujTXAE5nFBJyFSqZvFvX7T` |

`owner-devnet` explicitly compiles these identities and corresponding cross-program trust roots. Factory features propagate to its dependencies. Default legacy builds, active namespace registration and creation selection retain their previous values. [Anchor.owner-devnet.toml](../Anchor.owner-devnet.toml) has no default wallet. The [public planner and narrow operator](devnet-owner-bootstrap.md) keep preparation separate from execution and production governance.

The new `/devnet/setup` screen permits only the genuine designated wallet to claim an authenticated pending whitelist transfer on devnet. It verifies the canonical loader/config accounts in one finalized bank and rechecks wallet, network, intent and current state before signing. No ready transfer or already-complete transfer produces a claim instruction. It does not perform loader handoffs or activate creation.

## Verified before publishing preparation

- Rust default workspace 249 tests and isolated owner feature 250 tests passed. CI now exercises both.
- Frontend 218 Node tests, 57 Vitest tests, concept preview, typecheck and production build passed, including 36 focused owner-claim cases.
- The operator 22 focused tests and independent review passed; the final security suite 69 tests passed with the actual disposable PostgreSQL restore test, zero skips.
- All three isolated feature-specific SBF builds passed with entrypoint-bearing ELFs. The scratch lockfile version3 has the same dependency graph as tracked version4; 226 source files matched the compiled copy. This is local build evidence, not deployed-byte proof.
- [Twelve real local-validator initialization and rollback cases](assets/devnet-owner-bootstrap-2026-10-09/local-validator-init.json) passed. The receipt discloses canonical genesis loader fixtures, the validator fixture quirk, and the dirty base-commit/file-hash scope. No actual bootstrap key was used in this rehearsal.

| Artifact | Bytes | SHA256 |
|---|---:|---|
| whitelist |343456| `381398e9a6f51f0555990b696d8a81f7a225f44f0ef3897a44a575a07ca16d01` |
| basket_factory |443576| `6edb669bd32afd6016f5eed3b9652144ee153ea874a871f1881fc1238779057c` |
| basket |434936| `2d77954816021814fc8eaa5a7173bd535d9dbf6dce619de3800e6f56c0c5e71a` |

## Actual funding and remaining execution

Finalized devnet reads found the new trio, canonical ProgramData PDAs and two singleton configs vacant. The owner address held 13937807292 lamports; the fresh bootstrap held zero. One official devnet airdrop request for 2 test SOL returned RPC error -32603 at 2026-10-09T16:52:06Z, with no transaction signature. No owner transfer was made.

Actual ELF-size rent quotes total 6.712117640 test SOL retained, with 8.457712320 test SOL peak temporary buffer/program rent when deploying factory, basket, then whitelist. The requested funding target is 9 **devnet test SOL**, covering the peak and fees; no mainnet or real-value SOL is requested. These balances/rent quotes describe their recorded observation and must be refreshed before execution.

New remote deployment, singleton initialization, token admission, owner claim, loader handoff and creation activation have not occurred. Actual execution requires the unanswered role/treasury selection and funding, then finalized byte/config evidence and genuine owner-wallet acceptance. The factory's initializer authority field is immutable and inactive: initializing with bootstrap records bootstrap there permanently; this does not assert that the proposed owner initialized it. Historical recovery is not activated. Existing balances and legacy permissionless redemption remain in scope for regression verification.
