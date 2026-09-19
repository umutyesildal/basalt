# Basalt — Build Context (pitch-deck input)

> Prepared 2026-09-03 and verification status refreshed 2026-09-18. Companion to `idea-context.md`. Sources: AGENTS.md, plan.md §6/§8c, verified worker reports.

## Stack

- **Protocol:** Anchor 0.30.1 + SPL Token-2022. 3 programs: `whitelist` (Token-2022 ownership + decimals verification), `basket_factory` (2–20 constituents, weights sum 10,000 bps, fee caps 300/100/300 bps, atomic seed, genesis 1M shares via temp-authority handoff), `basket` (mint_in_kind 4n remaining-accounts contract with pause gate, redeem_in_kind 3n — permissionless, oracle-free, structurally tested; accrue_management_fee). All transfers `transfer_checked`, RAW only.
- **Backend:** Node 20 + TS strict + PostgreSQL + optional Redis. Anchor event decoder (Borsh), holdings sync with ScaledUiAmountConfig multiplier (f64 per spl-token 0.4.15), exact BigInt fixed-point NAV engine, basket_rankings matview, event-driven user_positions writer (idempotent position_events ledger), unsigned fee-crank tx builder (backend never signs). REST /api/v1 with source/asOf provenance; Jupiter zap quotes; honest 503/404 states.
- **Frontend:** Next.js 15, React 19, Tailwind 3.4, locally vendored Bklit-derived chart sources with a documented local Brush adapter, @solana/wallet-adapter (Phantom/Solflare), and the BASALT identity (hexagonal-column mark, disciplined electric-yellow accent, Chakra Petch display, Geist Mono labels). Production build emits 21 route entries; typecheck is clean.
- **Fee policy:** V0 is protocol-wide 90% creator / 10% treasury. The creator leg is floored and treasury receives the exact remainder, including split dust. The legacy factory split field/argument is pinned to 9,000 for ABI compatibility; management-fee checkpoints use then-current supply with exact remainder carry, so fee-share mints compound later intervals slightly.

## Verification

- 183 Rust tests (including management-fee remainder, crank-frequency, legacy-account compatibility, pro-rata, fee-cap, genesis, and redeem-gate invariants).
- 550 backend TS tests (event decode fixtures, BigInt NAV and fee math, positions ledger idempotency, API contracts).
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
- BAS-005 fee-split source and interval-compounding semantics are documented and derived by the frontend policy helper; this is not deployment, audit, hosted-CI, or mainnet evidence.

## DeFi build handoff — 2026-09-18

- `defi.protocol_type`: `vault`
- `defi.program_id`: `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k` (devnet basket program)
- `defi.security_review`: `self`; independent review remains required before mainnet
- `defi.oracle_integration`: reference NAV only; no oracle is permitted in redemption correctness
- `defi.emergency_pause`: mint-only through whitelist status; redeem is intentionally never pausable
- BAS-001 working-tree decision: exact checked management-fee numerator remainder, appended as five bytes inside the existing 888-byte Basket allocation; devnet program upgrade and smoke are pending
