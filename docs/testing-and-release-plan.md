# Testing and release plan

## Current baseline

Snapshot from 2026-09-19:

- Rust workspace: 208 tests passed (136 basket, 45 basket_factory, 27 whitelist).
- Backend: 596 Vitest tests passed across 18 files.
- Frontend TypeScript: passed.
- Frontend test suite: missing.
- Root, standalone app, and standalone backend clean installs pass after the 2026-09-18 lock repair.
- Most Rust tests are host unit/source-structure tests. Devnet/localnet proves real CPI behavior, but ProgramTest/LiteSVM coverage is insufficient.
- BAS-004 adds checked-arithmetic boundary/property coverage for max-u64 inputs, invalid bps, narrowing failures, redemption bounds, and fee conservation; this does not replace the missing instruction-level suite.

Test count alone is not a quality metric. Release gates focus on behavior, invariants, and reproducible evidence.

## TST-001 — Reproducible installation

Decision: keep the root npm workspace lock for unified local development and CI, while retaining `app/package-lock.json` and `backend/package-lock.json` for independent Vercel/container deployment contexts. All three locks must be generated from the same manifests and verified independently.

1. Keep root/backend/app package ownership explicit.
2. Align package names and versions with lockfiles.
3. Align Next, React, and `@types` versions.
4. Run clean installs in temporary directories.
5. Repeat in CI without an existing dependency cache.

**Acceptance:** A fresh clone installs, builds, and tests without manual lock repair.

## TST-002 — Rust instruction-level tests

Add ProgramTest, LiteSVM, or an equivalent harness for:

- atomic seeded basket creation,
- real Token-2022 CPI mint,
- permissionless/oracle-free redeem,
- paused mint fails while redeem succeeds,
- ATA substitution and wrong owner/mint,
- management-fee crank-grief regression,
- supported and unsupported Token-2022 extensions,
- 2, 10, and 20 constituents with compute/size measurements,
- ALT-backed v0 transactions,
- arithmetic boundaries.

## TST-003 — Frontend component and E2E tests

Minimum Playwright matrix:

1. Home, Explore, and basket read-only live states.
2. Visible demo labels on every demo surface.
3. Wallet-free create navigation and Deploy wallet gate.
4. Wallet rejection, wrong network, simulation failure, expired blockhash, and retry.
5. In-kind mint review through confirmation.
6. Redeem through confirmation, including backend-unavailable direct-RPC behavior.
7. Zap pre/post balance delta excluding existing balances.
8. Partial Zap-leg recovery.
9. Mobile 360/390/768 and keyboard-only smoke.
10. No localhost in production metadata/canonical URLs.

Use wallet test doubles for UI-state tests, plus at least one localnet/nightly flow with a real validator and funded test keypair.

## TST-004 — Backend contract and resilience

- Mandatory API provenance fields.
- `(sig,event_index)` replay/idempotency.
- RPC 429, timeout, reorg, and duplicate signature.
- No fabricated values when providers are stale or unavailable.
- Redis-to-memory fallback.
- Database migration upgrade rehearsal.
- Separate liveness and readiness.
- Indexer catch-up and lag alerts.

## TST-005 — Economic property tests

- Redemption never pays more than a constituent vault holds.
- Full redemption leaves only defined flooring dust.
- Mint/redeem round trips cannot create value outside fees and flooring.
- For fixed supply, management-fee numerator value is independent of how elapsed time is partitioned across cranks; supply-changing compounding is tested and disclosed separately.
- Every entry, exit, and management-fee path uses the protocol-wide split `creator=floor(fee*9000/10000)`, `treasury=fee-creator`; the conservation invariant assigns all split dust to treasury. The legacy factory split field/argument is pinned to 9,000 rather than treated as a V0 override.
- Checked economic arithmetic must return domain errors rather than wrap or narrow; max-u64 and deterministic property cases remain part of the Rust release gate.
- Multiplier changes never alter raw ownership.
- Creator plus treasury equals total fee.
- Deposit accounting equals actual received raw delta.

## Current CI pipeline

~~~bash
cargo fmt --all -- --check
cargo check --workspace --all-targets
cargo test --workspace
cargo clippy --workspace --all-targets
npm ci
npm --prefix backend run build
npm --prefix backend test -- --run
npm --prefix app run typecheck
npm --prefix app run build
git diff --check
~~~

The checked-in GitHub Actions workflow also runs production dependency thresholds and a secret scan. The first hosted run is still required to validate repository permissions, action execution, and merge protection.

Target additions are `npm --prefix app run test`, `npm --prefix app run test:e2e`, SQL migration tests, generated IDL/client drift checks, deployment-manifest/ELF hashing, bundle-size budgets, and accessibility checks. These commands must be added only when their scripts and harnesses exist.

## Environments

| Environment | Assets | Demo | Purpose |
|---|---|---|---|
| Local | Deterministic fixtures | Optional | Fast development and E2E |
| Devnet | Explicit mock tokens | Separate flag | Public beta and transaction proof |
| Mainnet pilot | Approved official xStocks | Off | Limited users and exposure |
| Mainnet public | Approved official xStocks | Off | General access |

Each environment gets its own configuration and deployment manifest.

## Release evidence package

Every release records:

- git commit/tag and CI run,
- test summary and dependency-lock hash,
- frontend/backend image hashes,
- program ELF hashes and deployed IDs,
- database migration version,
- environment flags,
- known limitations,
- rollback and communication runbook.

For an upgradeable Solana release, the evidence package also records the
ProgramData address and fresh RPC-derived upgrade authority for each program,
the governance vault and threshold, configured time lock, announcement URL,
authority-transfer transaction, and the result of the rehearsal defined in
`docs/upgrade-governance-policy.md`. An operator-supplied manifest value is not
RPC attestation. The loopback rehearsal proves authority-transfer mechanics
only; it does not prove a real multisig threshold or production time lock.

## Release blockers

- Any open P0 security issue.
- Unlabeled mock or simulated data.
- Failed clean install/build.
- Redeem gains an oracle/backend/whitelist gate.
- Deployed programs cannot be tied to source.
- Missing frontend E2E for primary money flows.
- Incomplete mainnet asset allowlist or legal/geo decision.
- Upgrade authority remains one hot wallet.
- Governance threshold, time lock, or authority state is asserted without fresh on-chain evidence.
