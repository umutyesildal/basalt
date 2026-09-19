# Mainnet readiness roadmap

> This is a dependency order, not a calendar promise. A phase is not complete until its exit gate passes.

## R0 — One source of truth and reproducible builds

**Goal:** Every contributor works from the same source, dependencies, and status model.

Deliverables:

- Documentation map and verified current-state snapshot.
- Canonical `main` worktree decision.
- Root/backend/app lockfile repair.
- Fresh-clone install, build, and test.
- Deployment manifest with commit, cluster, program IDs, and demo mode.
- Synchronized README/AGENTS/CONTEXT/CLAUDE status headers.

Exit gate: CI is green from a clean install and artifacts are tied to a commit.

## R1 — Economic correctness and on-chain security

**Goal:** Call ordering, token extensions, and client balances cannot alter economic results.

Deliverables:

- SEC-001 fee-grief fix.
- SEC-002 Token-2022 extension policy and received-delta accounting.
- SEC-003 Zap pre/post balance delta.
- Checked arithmetic and casts.
- One source for fee split: repository-local V0 policy is fixed at 90% creator / 10% treasury with creator-floor/treasury-remainder conservation; hosted/deployment and audit gates remain separate.
- ProgramTest/LiteSVM adversarial suite.
- 20-constituent compute and transaction-size evidence.

Exit gate: all economic invariants and the internal security review pass.

## R2 — Data integrity and official providers

**Goal:** Users can identify the source and backing level of every value.

Deliverables:

- Global devnet/mock banner and complete demo labeling.
- AUM renamed to Reference NAV where appropriate.
- Removal or explicit simulation labeling of jittered data.
- Current Jupiter price integration.
- Official xStocks metadata, multiplier, and corporate-action pipeline.
- Liveness/readiness, freshness, and deployment provenance.
- `(sig,event_index)` event migration.

Exit gate: provenance contract tests pass and no mock/simulated data is unlabeled.

## R3 — Onboarding and transaction experience

**Goal:** A non-expert user can safely complete a first transaction.

Deliverables:

- Wallet required only at Deploy/transaction time.
- Human-readable amounts plus exact raw preview.
- Faucet and mock-token onboarding.
- Fee, priority fee, and instruction review.
- Zap recovery UX.
- Real OHLCV/brush or an honest unavailable state.
- Accessibility/mobile improvements.
- Production metadata and OG repair.

Exit gate: Playwright passes from wallet-free discovery to a confirmed devnet transaction.

## R4 — Governance, audit, and operations

**Goal:** Mainnet operation does not depend on one person or one service.

Deliverables:

- Multisig and timelocked upgrade authority.
- Incident response and communication runbook.
- Database backup/restore and indexer rebuild rehearsal.
- RPC/indexer/NAV/provider monitoring.
- Independent audit and remediation.
- Legal review, xStocks terms, and geo-compliance.
- Mainnet deployment rehearsal and reproducible attestation.

Exit gate: no open P0/P1 audit finding, governance is active, and counsel has issued a written go/no-go.

## R5 — Controlled mainnet pilot

**Goal:** Validate production with a small blast radius.

Suggested limits:

- Small approved official-xStocks allowlist.
- Limited creator and basket set.
- Product/operations-level exposure and rate limits.
- Zap disabled initially or restricted to beta.
- 24/7 alerts and incident contact.
- Redeem always permissionless.

Go/no-go:

- No unexplained vault/share-supply/NAV reconciliation gap.
- Public program IDs and ELF attestation.
- Provider and multiplier freshness meets SLA.
- No demo/mock flag in production.
- Users see issuer, risk, and fees before transacting.

## R6 — Public mainnet and growth

After a stable pilot, expand the official asset allowlist, verified creator history, live social feed, watchlists/alerts, thesis distribution, performance work, bug bounty, and periodic audits.

Leverage, lending, derivatives, active rebalancing, and redeem gates are not part of this roadmap.
