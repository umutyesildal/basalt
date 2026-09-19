# Basalt implementation backlog

> Canonical operational work queue. Mark an item complete only when code, tests, documentation, and evidence are finished.

Statuses: `[ ]` open, `[~]` in progress, `[x]` complete, `[!]` blocked.

## Priority model

- **P0:** Blocks mainnet or real-value access.
- **P1:** Required for public-devnet trust, conversion, or release reliability.
- **P2:** Improves retention, observability, and quality.
- **P3:** Controlled product expansion.

## P0 — Security and economic correctness

### BAS-001 — Fix management-fee crank grief

- [x] Record the zero-fee checkpoint decision.
- [x] Implement exact numerator remainder carry.
- [x] Add many-small-versus-one-combined accrual invariants.
- [x] Document state migration and deployment impact.

**Owner area:** on-chain
**Acceptance:** Crank frequency cannot suppress management fees.

Completion evidence (working tree, 2026-09-18):
- Formula: `numerator = supply * bps * elapsed + previous_remainder`; mint `numerator / denominator` and persist `numerator % denominator`.
- One thousand one-second accruals equal one combined 1,000-second accrual for fixed supply; the former grief case now collects 9 shares instead of 0.
- Minute-by-minute annual accrual at genesis supply cannot fall below the 30,000-share single-crank baseline.
- The remainder is an append-only five-byte little-endian field. It fits inside the seven zero-filled bytes already present in every 888-byte V0 Basket account: the legacy serialized length is 881 bytes including the 8-byte discriminator, the upgraded length is 886 bytes including it, and the account remains 888 bytes.
- Existing field offsets, instruction accounts, event schema, program IDs, and client builders do not change. Existing accounts decode the old zero padding as remainder 0; no realloc or rent migration is required.
- Fractional fees already lost to pre-upgrade zero-fee checkpoints cannot be reconstructed; upgraded legacy accounts begin with remainder 0. This is a bounded historical-fee loss, not a holder debt or realloc requirement.
- Deployment impact: upgrade only the `basket` program, then run existing-account accrue/mint/redeem smoke tests on devnet before treating the deployed issue as closed.
- Backend fee estimates share the exact BigInt helper with remainder defaulted to zero. For identical supply and elapsed inputs, the unknown remainder can make the estimate at most one raw share low; stale DB supply or timestamps can cause a larger difference.

### BAS-002 — Token-2022 extension policy

- [x] Record official xStocks extension fixtures.
- [x] Implement a strict extension-free whitelist allowlist/denylist boundary.
- [x] Account for actual received balance delta in seed/mint.
- [x] Fail closed on unsupported extensions.
- [ ] Add extension integration tests.

**Owner area:** on-chain + client
**Acceptance:** Transfer semantics cannot break vault/share accounting.

Documentation evidence (2026-09-18):
- `docs/fixtures/token2022-mainnet-xstocks-2026-09-18.json` records the observed mainnet-beta Token-2022 owner, decimals, extension order, authorities, account lengths, account-data hashes, and scaled multipliers for TSLAx, AAPLx, and NVDAx at slot `448202873`.
- `docs/bas-002-token2022-extension-policy.md` records the deny-by-default policy, V0 incompatibilities, received-balance-delta design, and the invariant that redeem remains permissionless, oracle-free, backend-independent, and not gated by the whitelist pause flag.
- The current V0 boundary is intentionally narrow: whitelist admission, factory seed, and basket mint accept only extension-free Token-2022 mints; seed/mint transfers require exact raw source and destination deltas. Official xStocks remain unsupported until the dependency and hook-aware transfer work is complete.
- Host-level policy and delta tests are green. Instruction-level extension, adversarial-hook, and full ProgramTest/LiteSVM coverage remain open under BAS-016.

### BAS-003 — Zap pre/post balance delta

- [x] Snapshot pre-swap raw ATA balances.
- [x] Calculate post-confirmation deltas.
- [x] Check quote/min-out/tolerance.
- [x] Add partial-leg recovery.
- [x] Add existing-balance regression tests.

**Owner area:** frontend
**Acceptance:** Only tokens received by the Zap are deposited.

Implementation evidence (2026-09-19):
- `app/lib/zap-balance-delta.ts` provides ordered raw-balance snapshots, exact `post - pre` accounting, Jupiter minimum-output selection, and retry classification without converting economic amounts through `Number`.
- `app/components/basket/zap-in-form.tsx` binds one immutable snapshot to the wallet and quote fingerprint, validates each confirmed leg against minimum output, freezes only received deltas for `mint_in_kind`, skips settled legs, and retains signed transaction bytes across ambiguous RPC sends.
- The quote API exposes `minimumOutAmount`; the UI shows quoted, minimum, and actual raw output separately.
- `backend/tests/zap-balance-delta.test.ts` covers pre-existing balances, zero/negative deltas, mint/order mismatch, BigInt boundaries, min-out, and partial-leg recovery.
- Zap-out remains quote-only and is not presented as an end-to-end frontend flow.

### BAS-004 — Checked arithmetic

- [x] Replace unchecked `u128 -> u64` conversions.
- [x] Check `diff * 100` and bps expressions.
- [x] Add boundary and fuzz tests.

**Owner area:** on-chain
**Acceptance:** No unchecked overflow or narrowing in economic paths.

Implementation evidence (repository-local, 2026-09-19):
- Basket economic helpers now use checked `u128` multiplication/division and fallible `u64::try_from` conversions for gross shares, entry/exit fees, management fees, fee splits, and pro-rata redemption amounts.
- Bps inputs are rejected above the 10,000 bps denominator; tolerance comparisons use checked widened arithmetic instead of overflowing `diff * 100`. Redemption also rejects zero supply and burns above total supply.
- Boundary and deterministic property tests cover `u64::MAX`, narrowing failures, invalid bps, zero-supply redemption, fee-split conservation, max-value redemption, and repeated randomized arithmetic cases.
- Peripheral hardening replaces unchecked account-size conversions in the factory and the whitelist mint counter now fails atomically at `u32::MAX`; remaining-account length multiplication is checked in both programs.
- The BAS-004 completion run was 207 Rust tests: basket 136, basket_factory 44, whitelist 27. BAS-005 subsequently raised the current baseline to 208. BAS-016 still owns instruction-level ProgramTest/LiteSVM, extension, and adversarial-hook coverage; this completion does not make mainnet ready.

### BAS-005 — Single fee-split source

- [x] Decide fixed 90/10 versus configurable.
- [x] Decide and disclose simple versus interval-compounded management-fee semantics.
- [x] Align program, factory, state, spec, and client.
- [x] Add split invariants to every fee path.

**Owner area:** protocol + spec
**Acceptance:** Factory configuration and actual distribution cannot diverge.

Completion evidence (repository-local, 2026-09-19; deployment-independent):
- V0 policy is fixed protocol-wide at 9,000 / 1,000 bps (90% creator / 10% treasury). The creator leg is `floor(fee * 9000 / 10000)` and the treasury leg is `fee - creator`, so every fee path conserves the full fee and all split dust goes to treasury.
- `programs/basket/src/lib.rs` uses the canonical creator split for entry, exit, and management-fee distribution. `programs/basket_factory/src/lib.rs` retains `creator_fee_split_bps` and the `init_factory` argument only for legacy ABI/account-layout compatibility and rejects non-canonical values; it does not provide a V0 override.
- The frontend policy module at `app/lib/protocol-policy.ts` derives exact split helpers and labels used by active fee, transaction-review, documentation, and legal surfaces. The normative explanation is in `docs/basalt-v0-spec.md` §6.2-6.3.
- Management fee accrual carries the exact numerator remainder at each checkpoint and evaluates the interval against then-current supply. Fee shares join supply, so later intervals compound slightly; the nominal annualized rate is not a fixed charge against initial supply. Fixed-supply partition equivalence remains a separate invariant.
- Local repository evidence covers split conservation/dust and management-fee remainder/compounding behavior. This closes the documentation and policy decision only; BAS-016 instruction-level coverage, audit, hosted CI, upgrade, existing-account devnet smoke, legal review, governance, and mainnet gates remain open.
- Current local verification is 208 Rust tests (136 basket, 45 basket_factory, 27 whitelist) plus 596 backend tests across 18 files; frontend typecheck and production build pass.

### BAS-006 — Multisig and timelock `[~]`

- [x] Decide signer roles and threshold policy.
- [x] Rehearse loader authority transfer/rejection/rollback on private localnet.
- [ ] Rehearse the real 2-of-3 delayed authority-transfer ceremony.
- [x] Define timelock and announcement policy.
- [x] Disclose current governance status in UI and the deployment-manifest contract.

**Owner area:** governance/ops
**Acceptance:** One hot wallet cannot upgrade programs.

Partial completion evidence (repository-local, 2026-09-19):
- `docs/upgrade-governance-policy.md` fixes the production target at an autonomous, hardware-wallet-backed 2-of-3 vault with independent Protocol Maintainer, Security and Incident Lead, and Operations and Release Lead roles. It defines one 48-hour on-chain delay for normal and emergency upgrades, plus announcement and incident evidence; there is no unilateral bypass.
- All three BPF upgrade authorities and the separate `WhitelistConfig.authority` target the governance vault. Basket parameters remain immutable and redemption remains permissionless, oracle-free, backend-independent, whitelist-independent, and unpausable.
- Manifest v2 can represent unknown, single-key, multisig, and immutable authority models, verification source, threshold, signer count, time lock, rehearsal, and per-program authority evidence without converting operator declarations into RPC proof.
- A finalized read-only devnet RPC audit on 2026-09-19 confirms that all three BPF upgrade authorities and `WhitelistConfig.authority` remain the same single wallet, with no pending whitelist successor. The app, agent guide, agent markdown route, and release documentation disclose this current single-key boundary. The audit does not prove source-to-ELF identity, multisig threshold, or a time lock.
- The local rehearsal tooling is intentionally loopback-only and uses disposable authority keys. All three artifacts passed transfer, former-authority rejection, ProgramData/executable stability, and rollback on 2026-09-19; see `docs/local-governance-rehearsal-2026-09-19.md`. This proves loader mechanics, not a Squads threshold or production time lock.

**Still open:** Create the actual autonomous multisig, approve the exact signer and vault public keys, run and publish the full 2-of-3 delayed rehearsal, transfer all three program authorities and the whitelist authority, then publish post-transfer RPC proof. Until that evidence exists, the acceptance criterion is not met and BAS-006 remains partial.

### BAS-007 — Reproducible program attestation

- [ ] Pin deterministic toolchain.
- [x] Generate optional ELF and image SHA-256 hashes.
- [x] Add deployment-manifest schema, template, and generator.
- [ ] Verify on-chain program data.

**Owner area:** protocol/CI/ops
**Acceptance:** Users can tie deployed programs to a source commit.

### BAS-008 — Independent audit

- [ ] Freeze threat model and scope.
- [ ] Select auditor.
- [ ] Remediate findings.
- [ ] Publish retest summary.

**Dependency:** BAS-001/002/004/005
**Acceptance:** No open P0/P1 audit finding.

## P0 — Data, backing, and compliance

### BAS-009 — Devnet/mock truth layer

- [ ] Add global devnet/mock banner.
- [ ] Use Reference NAV terminology.
- [ ] Add backing badges to basket, trade, portfolio, and OG output.
- [ ] Label every demo marquee ticker.
- [ ] Add screenshot/contract tests.

**Acceptance:** Mock/demo data cannot appear as real backing or AUM.

### BAS-010 — Remove misleading synthetic prices

- [ ] Identify random-jitter endpoints.
- [ ] Remove or isolate them as `simulated`.
- [ ] Show unavailable state without real OHLCV.

**Acceptance:** No generated series is attributed to a real provider.

### BAS-011 — Migrate Jupiter price integration

- [ ] Implement current endpoint and auth contract.
- [ ] Update response parser.
- [ ] Add rate-limit/cache/retry behavior.
- [ ] Add provider contract tests.

**Acceptance:** Legacy `price.jup.ag/v6` is absent from production paths.

### BAS-012 — Official xStocks integration

- [ ] Sync official asset and mint metadata.
- [ ] Track current/pending multiplier and activation.
- [ ] Handle corporate actions.
- [ ] Display issuer/proof metadata.
- [ ] Preserve redeem while applying mint-only safety controls.

**Dependency:** BAS-002
**Acceptance:** Mainnet allowlist contains only verified, compatible official mints.

### BAS-013 — Legal and geo-compliance

- [ ] Counsel review.
- [ ] Restricted-jurisdiction policy.
- [ ] Onboarding/access implementation.
- [ ] Approved issuer/risk/fee copy.
- [ ] Redeem non-gating regression.

**Acceptance:** Written go-live decision; redemption is never blocked by location.

## P1 — Build, test, and release

### BAS-014 — Repair lockfiles and workspace model

- [x] Decide root/backend/app ownership: root workspace lock for CI/local use; child locks for independent deployments.
- [x] Align package names and versions.
- [x] Pass clean `npm ci` for root, app, and backend.
- [x] Record lock hashes in completion evidence.

**Acceptance:** A fresh clone builds without manual dependency repair.

Completion evidence (2026-09-18):
- Root workspace clean install: 804 packages added; exit 0.
- Standalone app clean install: 596 packages added; exit 0.
- Standalone backend clean install: 188 packages; exit 0.
- Clean app production build: 21 routes; exit 0.
- Clean app TypeScript gate: `npm --prefix app run typecheck`; exit 0.
- Clean backend build and test after BAS-001: 13 files / 550 tests; exit 0.
- Lock entries: root 914, app 627, backend 266.
- Lock SHA-256: root `fa724321cc78a8eccec1b02dffe7602d906de8d2499d70c09667c25926d34669`, app `3daf1146736675741c30af67bc28bc05c725dde0fa0203f9eccaf165a0e87528`, backend `f11306c5f1663d8acca9d8cff2e9bcf8fb5509577a1a66e28c83046b38a8711f`.
- Production audit gates pass at their documented thresholds. Remaining reviewed transitive findings are recorded in `dependency-audit-2026-09-18.md`; no unreviewed `--force` upgrade was used.

### BAS-015 — One CI gate

- [x] Define Rust format/check/test gates.
- [x] Define backend build/test gates.
- [x] Define frontend typecheck/build gates.
- [x] Define dependency and secret scans; the first hosted run passed both gates.
- [x] Pin third-party GitHub Actions to reviewed commit SHAs.
- [x] Artifact/deployment manifest shape and deterministic local generator.

**Dependency:** BAS-014
**Acceptance:** Required checks gate every merge.

Local workflow evidence (2026-09-18):
- Rust after BAS-001: format, workspace check, 183 tests, and Clippy all exit 0. Clippy emits existing Anchor cfg/style warnings but no errors.
- Node after BAS-001: clean root install, backend build, 550 tests, app typecheck, and 21-route production build all exit 0.
- Dependency gates: root and backend block critical production advisories; app blocks high production advisories. All three configured commands exit 0.
- Hosted run `35394708139` passed Rust, dependency-audit, and secret-scan jobs. Its Node job exposed an ignored-file dependency in `devnet-catalog.test.ts`; the test now reads the tracked, secret-free `.env.devnet.example`.
- Hosted rerun `35395553351` is fully green: Rust workspace, Node workspace, dependency audit, and secret scan all passed on commit `9ddee47`.
- Manifest evidence: `deploy/deployment-manifest.schema.json`, `deploy/deployment-manifest.template.json`, `scripts/generate-deployment-manifest.mjs`, and `docs/deployment-attestation.md`. RPC verification of authorities, slots, and deployed program bytes remains pending.

### BAS-016 — Solana instruction-level suite

- [ ] ProgramTest/LiteSVM harness.
- [ ] CPI, ATA, extension, and adversarial flows.
- [ ] 20-constituent compute/size.
- [ ] Fee-grief regression.

**Acceptance:** Real instruction/account tests complement host math tests.

### BAS-017 — Frontend Playwright suite

- [ ] Read-only pages.
- [ ] Create/mint/redeem.
- [ ] Wallet errors and retries.
- [ ] Zap delta/recovery.
- [ ] Mobile, keyboard, and metadata.

**Acceptance:** Primary user funnels are automated release gates.

### BAS-018 — Release evidence and rollback

- [ ] Release template.
- [ ] Image, ELF, and lock hashes.
- [ ] Database migration version.
- [ ] Known limitations.
- [ ] Rollback and communication runbook.

**Acceptance:** Every release is identifiable, verifiable, and recoverable.

## P1 — Backend integrity and operations

### BAS-019 — Multi-event transaction schema

- [ ] Add `event_index` migration.
- [ ] Enforce `(sig,event_index)` uniqueness.
- [ ] Update decoder and replay.
- [ ] Add multi-event regression tests.

**Acceptance:** No event is lost when one signature emits several events.

### BAS-020 — Separate liveness and readiness

- [ ] Keep `/health` for liveness.
- [ ] Add `/ready` for DB/RPC/indexer/NAV freshness.
- [ ] Expose commit, cluster, program IDs, and demo mode.
- [ ] Define 503 and alert policy.

**Acceptance:** A degraded process never reports ready.

### BAS-021 — Decide queue architecture

- [ ] Decide whether BullMQ is used.
- [ ] If yes, implement jobs, retries, idempotency, and metrics.
- [ ] If no, remove the dependency and documentation.

**Acceptance:** Runtime behavior and stack documentation agree.

### BAS-022 — Indexer resilience

- [ ] RPC backoff and 429 handling.
- [ ] Reorg/finality strategy.
- [ ] Catch-up checkpoint.
- [ ] Lag/freshness metrics and alerts.
- [ ] Full rebuild rehearsal.

**Acceptance:** Restart or RPC failure does not lose events or positions.

## P1 — Onboarding and transaction UX

### BAS-023 — Wallet-late create wizard

- [ ] Allow pre-review steps without a wallet.
- [ ] Persist a versioned draft.
- [ ] Revalidate network and balances at Deploy.

**Acceptance:** Users can reach review before connecting.

### BAS-024 — Human/raw amount system

- [ ] Shared exact parser/formatter.
- [ ] Human amount primary; raw amount advanced.
- [ ] Max, rounding, and balance preview.

**Acceptance:** Users enter normal token amounts while transactions use exact raw units.

### BAS-025 — Devnet onboarding

- [ ] Network and faucet help.
- [ ] Mock constituent acquisition.
- [ ] Guided first basket/mint path.
- [ ] Confirmation to Explorer/Portfolio.

**Acceptance:** A new user completes a devnet transaction without external instructions.

### BAS-026 — Production metadata

- [ ] Environment-derived canonical URL.
- [ ] Remove localhost from OG/Twitter.
- [ ] Add devnet/mock OG badge.
- [ ] Test sitemap and robots.

**Acceptance:** Production metadata contains no localhost or false backing claim.

### BAS-027 — Terminology cleanup

- [ ] Decide the header `ETFs` label.
- [ ] Scan prohibited wording.
- [ ] Finalize issuer, fee, and risk copy.

**Acceptance:** UI consistently uses approved strategy-basket language.

## P2 — Charts, accessibility, and social

### BAS-028 — Real chart pipeline

- [ ] Real OHLCV provider contract.
- [ ] Candlestick and volume rendering.
- [ ] Working brush/x-domain.
- [ ] Source/as-of and unavailable state.

**Dependency:** BAS-010/011/012
**Acceptance:** No placeholder brush or fabricated candles.

### BAS-029 — Accessibility and mobile pass

- [ ] 44 px targets.
- [ ] Reduced-motion support.
- [ ] Chart summaries and names.
- [ ] Keyboard-only transaction flows.
- [ ] Touch-action audit.

**Acceptance:** Automated scans and manual keyboard/mobile smoke pass.

### BAS-030 — Verified social feed

- [ ] Separate demo and live data.
- [ ] Link verified thesis and trade.
- [ ] Creator track record.
- [ ] Shareable deep links and watchlist.

**Dependency:** BAS-019/020 and the data-integrity policy
**Acceptance:** Every live feed claim carries chain/database provenance.

## P3 — Controlled growth

### BAS-031 — Mainnet pilot controls

- [ ] Supported-mint allowlist.
- [ ] Creator/basket onboarding limits.
- [ ] Product-level exposure and rate guardrails.
- [ ] Zap beta decision.
- [ ] 24/7 alerts and incident contact.

**Acceptance:** Limited blast radius with redeem always open.

### BAS-032 — Bug bounty and periodic review

- [ ] Scope, rules, and rewards.
- [ ] Responsible-disclosure channel.
- [ ] Quarterly dependency/governance review.
- [ ] Post-audit protocol monitoring.

## Recommended execution order

1. BAS-014 → BAS-015: establish reproducible build and CI truth.
2. BAS-001/003/004/005 in parallel; research official fixtures for BAS-002. BAS-004 is complete locally; its checked arithmetic remains covered by the normal Rust gates.
3. BAS-016 locks all P0 protocol fixes at instruction level.
4. BAS-009/010/011/019/020 repair data and trust layers.
5. BAS-012/013/006/007/008 complete mainnet gates.
6. BAS-023–029 improve conversion and quality.
7. BAS-031 pilot, then BAS-030/032 and public growth.

## Completion evidence template

~~~markdown
Completion evidence (YYYY-MM-DD):
- Commit/PR:
- Tests:
- Deployment/environment:
- Screenshots or transaction signatures:
- Remaining limitations:
~~~
