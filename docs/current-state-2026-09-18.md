# Basalt current state — 2026-09-18

> Snapshot of the current `main` repository state, the deployed web app, and read-only Solana devnet checks. BAS-002, BAS-003, and BAS-004 policy, code, and test evidence described below is repository-local; hosted CI and the documented upgrade/deployment gates remain authoritative for release status. Dynamic values may change after this date.

## Executive status

Basalt is a working Solana devnet beta, not a visual scaffold. Create, in-kind mint, redeem, indexing, and NAV flows use real code and real devnet transactions. The current constituent tokens are project-issued devnet mocks with no economic backing, and parts of the deployed home/social experience use a demo dataset. The product is not mainnet-ready.

The current BAS-002 boundary is intentionally fail-closed: new whitelist admission, factory seed, and basket mint accept only extension-free Token-2022 mints; seed and mint transfers verify exact raw source and destination deltas. Official mainnet xStocks remain unsupported until the dependency upgrade and hook-aware transfer path are audited. Instruction-level extension and adversarial-hook coverage remains open under BAS-016. These changes do not gate `redeem_in_kind`, which remains permissionless, oracle-free, backend-independent, and independent of the whitelist pause flag.

BAS-004 checked arithmetic is complete in the working tree. Economic narrowing and multiplication paths now fail with domain errors, bps inputs are bounded, and boundary/property coverage includes max-u64 and conservation invariants. Factory account-size and remaining-account arithmetic plus the whitelist mint counter were hardened as related peripheral paths. This does not close BAS-016 or any independent-audit/mainnet gate.

## Canonical source and deployment

- Canonical branch: `main`
- Audited commit: `9ddee47`
- Live app: `https://basalt-coral.vercel.app/`
- Solana cluster: `devnet`
- Basket program: `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k`
- Factory program: `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF`
- Whitelist program: `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS`

Do not confuse the initial scaffold on the local `master` branch with the deployed product. Development and agent work must target the canonical `main` worktree.

## Verified capabilities

| Area | Status | Evidence summary |
|---|---|---|
| Basket creation | Working | Factory creates real Token-2022 vaults/share mint and seeds atomically |
| In-kind mint | Working | Constituent `TransferChecked` CPIs and share `MintTo` verified on-chain |
| In-kind redeem | Working | Pro-rata transfers, share burn, and fee transfers verified on-chain |
| Permissionless redeem | Working | No oracle, backend, or whitelist-status dependency |
| Backend indexer | Working | Persists events, holdings, NAV, and positions; never signs |
| NAV/market data | Reference-only | Used for display; never gates settlement |
| Wallet UI | Working | Phantom/Solflare with simulate, sign, confirm, retry, and Explorer states |
| Zap | Implemented, disabled on mock devnet | Must fix received-balance accounting before enablement |
| Social/feed | Mixed live and demo | Some surfaces use `NEXT_PUBLIC_HOME_DEMO=1` |
| Mainnet backing | Not available | Current devnet mints are not official Backed xStocks |

## Live snapshot

On 2026-09-18, the deployed Explore API returned one indexed basket. The older 2026-09-14 smoke record reports three. Basket count is dynamic and must not be hard-coded as permanent product status.

Verified example:

- Basket: `9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg`
- Share mint: `7xo7uw13B4DnfwAMGQ9MC5qkX2zD2rUp94j4UBQ61eSE`
- Share standard: Token-2022, 6 decimals
- Mint and redeem logs showed constituent transfers, share mint/burn, and fee distribution with `err: null`.

This proves that the devnet protocol flow is real. It does not prove issuer backing for the mock constituent tokens.

## Test and build snapshot

| Check | Result | Notes |
|---|---|---|
| `cargo test --workspace` | 207 passed | 136 basket, 44 factory, 27 whitelist |
| Backend Vitest | 565 passed | 14 files |
| App TypeScript | Passed | `npx tsc --noEmit --incremental false` |
| App production build | Passed | 21 routes from a clean standalone app install |
| Clean `npm ci` | Passed | Root workspace, standalone app, and standalone backend verified independently |
| Frontend E2E | Missing | No Playwright/wallet regression suite |

Verified automated total for the repaired working tree: **772 = 207 Rust + 565 backend**. Older 599/620/421/442/549/733/749/764 counts are historical.

## Mainnet blockers

1. The working tree fixes management-fee crank grief with exact remainder carry, but the deployed devnet basket program still requires an upgrade and existing-account smoke test. BAS-004 arithmetic hardening is complete locally, but it still needs the normal release/upgrade evidence before being treated as deployed security status.
2. The interim Token-2022 policy is extension-free and fail-closed, with exact raw source/destination delta checks for seed and mint. Instruction-level extension, adversarial-hook, and full ProgramTest/LiteSVM coverage remain open under BAS-016; official mainnet xStocks are not admitted.
3. Zap-in now uses wallet/quote-bound raw `post - pre` snapshots with min-out validation and partial-leg recovery; Zap-out remains quote-only with no frontend execution path.
4. Upgrade authority is a single wallet; no multisig/timelock.
5. Mock and synthetic data are not labeled consistently across all surfaces.
6. Price integration still targets legacy Jupiter Price v6.
7. Dependency audit still reports transitive vulnerabilities requiring triage and controlled upgrades.
8. Frontend E2E and instruction-level Solana integration coverage are incomplete.
9. No published deployed-ELF-to-source attestation.
10. Legal and geo-compliance work is incomplete for real xStocks access.

See `implementation-backlog.md` and `mainnet-readiness-roadmap.md` for the ordered plan.

## Documentation drift

- README, AGENTS, CLAUDE, and CONTEXT previously reported conflicting test and basket counts.
- Jupiter Price v6 was described as current; migration is now tracked.
- Dated devnet evidence remains useful only for the recorded date.
- Completed/active labels in older plans are not release-status declarations.

## Refresh triggers

Create a new dated snapshot after any program upgrade, mock-to-official-xStocks transition, production deployment change, P0 security completion, test-baseline change, or mainnet pilot.
