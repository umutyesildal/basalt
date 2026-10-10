> **Current live owner-devnet release, 2026-10-10:** Website and VPS backend now run source `6cacb49f2b1a1fecd7398174c189c9bb65cec895`. The genuine owner initialization and independently verified 19-transaction three/four-token lifecycle are complete. New basket creation uses only the approved owner namespace and treasury; legacy baskets retain their read/redemption routes. Start at [Create on devnet](https://basalt.markets/create/onchain). No additional owner setup signature is required. See the [final release, exact identities and public evidence](../docs/devnet-owner-live-activation-2026-10-10.md).

> **Current limits:** This is a project-issued mock-token devnet release with single-owner governance. Chrome verified the live Create factory check and the existing legacy withdrawal screen without sending a transaction; no fresh human creation transaction is claimed. At 17:37:59 UTC, finalized discovery covered all six registered programs with zero pending scans or missing coverage, but 111 history signatures, four quarantine rows and seven basket rebuilds remained; USD valuations were unavailable. Historical financial recovery was not automatically activated. Earlier dated pending/disabled/backend-`307053d` statements below are preserved checkpoints, superseded by this release.

> **Release checkout:** Continue implementation and releases from `/Users/umutyesildal/.codex/worktrees/basket-art-release/createyouretf`. Older dirty checkouts retain unrelated work and must not be reset or deployed. The [release record](../docs/devnet-owner-live-activation-2026-10-10.md#guarded-vps-cutover-and-continuation) documents the stopped-writer backup and guarded manual continuation after a missing directory stopped the initial cutover.

# Basalt — Build Context (pitch-deck input)

> **Current devnet wallet UI, 2026-10-03:** `/devnet` and `/create/onchain` now expose wallet-signed test-token claim, atomic basket creation, in-kind mint and redemption. The same four project-issued eight-decimal Token-2022 mocks, BSTESTA–D, back every new test basket; each basket gets its own share mint. `/create` offers **Try on devnet** and a shared preview offers **Create on devnet**. The funded, once-per-wallet faucet is `2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf`. Verified basket, supply, vault and wallet reads use direct devnet RPC, without a database or backend signer. [The wallet-flow record](../docs/devnet-ui-wallet-flow-2026-10-03.md) links the finalized claim and shipped UI-builder proof: **seven finalized transactions and 20 assertions**. Names and theses are browser-local, verified against the immutable onchain metadata hash. An owner extension-wallet signature was not performed; build and responsive checks are recorded separately. This supersedes earlier redirect-only and incomplete mock-UI statements. Official xStocks, mainnet and Managed V2 release boundaries remain unchanged. Source changes remain local and unpushed.

> Current scoped follow-up, 2026-10-03: V0 now has shared full-profile Token-2022 admission, current isolated SBF builds and byte-attested devnet upgrades. Complete 3/4-token runtime checks passed using explicitly project-issued eight-extension mocks. See [runtime evidence](../docs/xstocks-devnet-runtime-2026-10-03.md) and [policy decision](../docs/xstocks-token-policy-decision-2026-10-03.md). Current checks: 243 Rust, 807 backend passed with 18 DB skips, 16 harness and 14 build-wrapper cases. Compact quote-only Stocks/ETF cards passed the production build and responsive browser check; detail Bklit 7D/1M charts remain. Older verification/gap statements below are historical; real funded issuer-token integration, historic-account live smoke, governance and external/mainnet reviews remain separate.


> Prepared 2026-09-03 and verification status refreshed 2026-09-18. Companion to `idea-context.md`. Sources: AGENTS.md, plan.md §6/§8c, verified worker reports.

## Stack

- **Protocol:** Anchor 0.30.1 + SPL Token-2022. 3 programs: `whitelist` (Token-2022 ownership + decimals verification), `basket_factory` (2–20 constituents, weights sum 10,000 bps, fee caps 300/100/300 bps, atomic seed, genesis 1M shares via temp-authority handoff), `basket` (mint_in_kind 4n remaining-accounts contract with pause gate, redeem_in_kind 3n — permissionless, oracle-free, structurally tested; accrue_management_fee). All transfers `transfer_checked`, RAW only.
- **Backend:** Node 20 + TS strict + PostgreSQL + optional Redis. Anchor event decoder (Borsh), holdings sync with ScaledUiAmountConfig multiplier (f64 per spl-token 0.4.15), exact BigInt fixed-point NAV engine, basket_rankings matview, event-driven user_positions writer (idempotent position_events ledger), unsigned fee-crank tx builder (backend never signs). REST /api/v1 with source/asOf provenance; Jupiter zap quotes; honest 503/404 states.
- **Frontend:** Next.js 15, React 19, Tailwind 3.4, locally vendored Bklit-derived chart sources with a documented local Brush adapter, @solana/wallet-adapter (Phantom/Solflare), and the BASALT identity (hexagonal-column mark, disciplined electric-yellow accent, Chakra Petch display, Geist Mono labels). Production build emits 21 route entries; typecheck is clean.
- **Fee policy:** V0 is protocol-wide 90% creator / 10% treasury. The creator leg is floored and treasury receives the exact remainder, including split dust. The legacy factory split field/argument is pinned to 9,000 for ABI compatibility; management-fee checkpoints use then-current supply with exact remainder carry, so fee-share mints compound later intervals slightly.

## Verification

- 208 Rust tests (including management-fee remainder, crank-frequency, legacy-account compatibility, pro-rata, fee-cap, genesis, checked arithmetic, and redeem-gate invariants).
- 596 backend TS tests (event decode fixtures, BigInt NAV and fee math, positions ledger idempotency, API contracts, deployment-manifest v2, and loopback governance-rehearsal guardrails).
- Frontend: tsc 0 errors, next build green (21 generated route entries, no ignored errors), browser-verified dark/light + 390px.
- Historical pre-BAS-001 localnet E2E: 8/8 steps PASS, twice consecutive (validator → deploy → whitelist → basket → mint/redeem → accrue → health). The remainder change still needs an existing-account devnet smoke test.

## Program IDs (deploy keypairs verified on-curve)

- whitelist `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS`
- basket_factory `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF`
- basket `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k`

## Known gaps (honest)

- The BAS-001 basket-program upgrade and existing-account devnet smoke test are pending.
- The new remainder path is verified by host math and serialization tests, not yet by ProgramTest/LiteSVM or a post-upgrade live transaction.
- Token-2022 extension compatibility and actual-received balance accounting remain P0 work.
- Legal copy pending counsel (strategy-basket positioning).
- BAS-006 has a repository-local autonomous 2-of-3/48-hour target policy, manifest v2, and loopback-only authority-transfer tooling. The real multisig, full threshold/time-lock rehearsal, authority transfer, and fresh RPC evidence remain open.
- BAS-005 fee-split source and interval-compounding semantics are documented and derived by the frontend policy helper; this is not deployment, audit, hosted-CI, or mainnet evidence.

## DeFi build handoff — 2026-09-18

- `defi.protocol_type`: `vault`
- `defi.program_id`: `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k` (devnet basket program)
- `defi.security_review`: `self`; independent review remains required before mainnet
- `defi.oracle_integration`: reference NAV only; no oracle is permitted in redemption correctness
- `defi.emergency_pause`: mint-only through whitelist status; redeem is intentionally never pausable
- BAS-001 working-tree decision: exact checked management-fee numerator remainder, appended as five bytes inside the existing 888-byte Basket allocation; devnet program upgrade and smoke are pending

## DeFi build handoff, 2026-10-03

- `defi.protocol_type`: `vault`
- `defi.program_id`: `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k`, unchanged, current binary deployed on devnet at slot 506817619.
- `defi.security_review`: independent agent source/parser review and separately reviewed harness passed; external full audit remains required before mainnet.
- `defi.oracle_integration`: reference NAV only; create/in-kind/redeem correctness in this proof has no oracle or price dependency.
- `defi.emergency_pause`: protocol whitelist pause blocks new minting only; redemption has no policy/oracle/backend pause gate. Underlying issuer powers can still stop a Token-2022 transfer.
- Current management-fee remainder and raw pro-rata behavior passed current-program runtime tests in newly created baskets. Historic pre-upgrade basket state was preserved, not exercised or reset.
- Authority remains the existing single devnet key; multisig/timelock rollout and mainnet remain outside this task.

## Debug session, 2026-10-10

- `debug.last_debug_session`: 2026-10-10T12:07:16Z.
- `debug.current_issue`: owner initialization stops before broadcast after reported wallet signing; finalized singleton/admission accounts remain absent.
- `debug.evidence`: actual six-instruction unsigned devnet simulation passes; exact submit path reaches the wallet callback; serialized standard-wallet roundtrip regression passes.
- `debug.status`: cause pending improved sanitized live diagnostics. No automatic economic retry; no setup execution claimed. See `docs/devnet-owner-ui-debug-2026-10-10.md`.


## Owner setup debug observation, 2026-10-10

Live b075cbea25edcf3e4acbb4b03dc1e77abf535fb4 passed six CI jobs. Genuine owner signing returns before-broadcast constructor/message-integrity failure. Exact wire change versus cross-constructor return remains under investigation. Do not claim initialization, lifecycle or activation complete. Bounded lifecycle operator 2d814cd is committed, reviewed and offline-tested (32 tests); not executed.


## Owner wallet wire compatibility patch, 2026-10-10

A valid foreign installed web3 constructor reproduces the overly strict instanceof rejection offline. Replace constructor identity with bounded canonical legacy wire parsing, retaining exact message/signatures and all finalized state/budget/recovery guards. 68 setup tests and app typecheck pass; independent review has no blocker. Actual production constructor-only cause and initialization remain unverified until a fresh live owner signature.


## Owner wire release live, 2026-10-10

d137a895071917c4b9389ae8a4f7ef35125b76a5 / dpl_56PFB4tLJYW33Rq81yJQg9gjciF9 verified live with all six CI jobs, hosted build and Chrome program verification. Genuine initialization remains pending; no runtime/creation claim. VPS unchanged healthy, actual image sha256:8e7d0ab276307af13ad71d71da78aded59f82d3f249b93f31fd678d17c399f3a.


## Owner setup fee compatibility checkpoint, 2026-10-10

Live UI source `b5fecf67c10915b0e17e4db1059f3fdd6635a753` explicitly prepares setup compute limit 200,000 and zero priority price before review/quote/simulation/signing, matching documented Phantom augmentation conditions without accepting mutated messages. Persistent fixed public diagnostics survive reload. 83 focused tests, independent review, six CI jobs and hosted/Chrome program verification passed. Actual unsigned devnet simulation: 864 bytes, 98,956 CU, rent 7,167,880 and fee 5,000 lamports. Read-only exact submit path reaches signing with wallet and sender disabled. Actual owner initialization, finalized lifecycle proof, registry activation and backend/frontend activation release remain pending. Backend unchanged. Latest diagnostic cause for the repeated no-error stall is not proven.
