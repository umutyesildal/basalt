# Basalt implementation backlog

> **4 October audit continuation, 2026-10-09:** `codex/backend-devnet-security` now implements auth/resource bounds, canonical log identity, atomic position effects, durable finalized history, fail-closed facts/NAV and dependency gates. Historical projection activation/reconciliation source awaits separate explicit approval; live key retirement, governance and rollout remain open. The [dated remediation record](backend-devnet-security-2026-10-09.md) separates implemented source, test evidence, staging and operational gates; BAS-019/022 remain active until their full acceptance is verified.

> **Current devnet wallet UI, 2026-10-03:** `/devnet` and `/create/onchain` now expose wallet-signed test-token claim, atomic basket creation, in-kind mint and redemption. The same four project-issued eight-decimal Token-2022 mocks, BSTESTA–D, back every new test basket; each basket gets its own share mint. `/create` offers **Try on devnet** and a shared preview offers **Create on devnet**. The funded, once-per-wallet faucet is `2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf`. Verified basket, supply, vault and wallet reads use direct devnet RPC, without a database or backend signer. [The wallet-flow record](devnet-ui-wallet-flow-2026-10-03.md) links the finalized claim and shipped UI-builder proof: **seven finalized transactions and 20 assertions**. Names and theses are browser-local, verified against the immutable onchain metadata hash. An owner extension-wallet signature was not performed; build and responsive checks are recorded separately. This supersedes earlier redirect-only and incomplete mock-UI statements. Official xStocks, mainnet and Managed V2 release boundaries remain unchanged. Source changes remain local and unpushed.

> **UI update, 2026-10-02:** The discovery landing, Feed/Managers refresh, copy cleanup, and Colosseum research are recorded in [session updates](session-updates-2026-10-02.md). `/create/onchain` redirects to `/create`; prior transaction-wizard acceptance notes describe retained implementation, not current route availability. This pass does not close protocol, provenance, legal, or deployment gates.

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

### BAS-002 — Token-2022 extension policy `[~]`

2026-10-03 source update: the [dated admission decision](xstocks-token-policy-decision-2026-10-03.md) replaces blanket extension rejection for immutable V0. Shared validation accepts Plain/DisplayOnly and the full observed issuer profile with inactive hooks, unpaused state, complete validated TLVs and supported public token accounts. Real AAPLx/SPYx fixtures, 29 shared-policy tests and [independent review](xstocks-devnet-basket-proof-2026-10-03.md) are complete. Redeem is unchanged; issuer powers remain an explicit limitation. All three current V0 binaries are upgraded and byte-attested on devnet at finalized slot 506820772. The [completed runtime report](xstocks-devnet-runtime-2026-10-03.md) records the fresh three/four-asset full-profile mock flow: 54 transactions, 16 expected rejections and 28 assertions. This closes that scoped devnet proof, not funded official issuer transfers or mainnet admission. Managed V2 policy is unchanged.

- [x] Record official xStocks extension fixtures.
- [x] Implement the original strict extension-free boundary, then replace it with the reviewed complete-profile validator on 2026-10-03.
- [x] Account for actual received balance delta in seed/mint.
- [x] Fail closed on unsupported extensions.
- [x] Prepare isolated eight-extension mock setup and 3/4-asset accounting/rollback harness; final confirmation regressions bring focused harness coverage to 16 passing tests.
- [x] Complete and record current-SBF extension runtime proof and deployed-byte verification for all three V0 programs.
- [ ] Verify funded official issuer transfers and mainnet mint-specific admission under the release gates.

**Owner area:** on-chain + client
**Acceptance:** Transfer semantics cannot break vault/share accounting.

Documentation evidence (2026-09-18):
- `docs/fixtures/token2022-mainnet-xstocks-2026-09-18.json` records the observed mainnet-beta Token-2022 owner, decimals, extension order, authorities, account lengths, account-data hashes, and scaled multipliers for TSLAx, AAPLx, and NVDAx at slot `448202873`.
- `docs/bas-002-token2022-extension-policy.md` records the deny-by-default policy, V0 incompatibilities, received-balance-delta design, and the invariant that redeem remains permissionless, oracle-free, backend-independent, and not gated by the whitelist pause flag.
- Historical September boundary: whitelist admission, factory seed and basket mint accepted only extension-free Token-2022 mints. This blanket rejection is superseded by the 2026-10-03 update above. Exact raw source/destination delta requirements remain.
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
- `docs/governance-ceremony-runbook.md` defines the exact authorization record, vault/config-address separation, read-only preflight, full delayed rehearsal, direct bootstrap transfers, two-step whitelist claim, abort conditions, post-state verification, and publication package. It authorizes no chain mutation without the exact approved public keys and addresses.
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

2026-10-03 scoped progress: the new `/devnet` workspace labels the fixed BSTESTA–D mocks and devnet network, omits invented USD valuations and distinguishes each basket share mint. The broader whole-product and OG truth-layer checklist remains open. [Wallet-flow evidence](devnet-ui-wallet-flow-2026-10-03.md).


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

2026-10-03 progress: the public official catalog, verified ETF classifications, nullable scaled token quotes and historical multiplier normalization are implemented ([data integration](xstocks-integration-2026-10-03.md)). Reviewed V0 source now supports the observed inactive-hook issuer profile. This is not a mainnet whitelist, live backing or public investment release; verified mint admission, corporate-action coverage and deployment evidence remain separate gates.

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

2026-10-03 scoped completion: `scripts/testXStockBaskets.ts` passed current-SBF devnet three/four-asset tests using four distinct full-profile mocks, ALT, exact raw/share/90-10 fee reconciliation and confirmed-failure rollback for whitelist pause, issuer pause, active hooks and frozen default state. Default mode is read-only; `--execute` is explicit and devnet-genesis-pinned. [Harness review](xstocks-devnet-basket-proof-2026-10-03.md), [completed runtime proof](xstocks-devnet-runtime-2026-10-03.md). The run recorded 38 successful transactions, 16 expected onchain rejections and 28 assertions with settings restored. This does not close the larger ProgramTest/LiteSVM or 20-constituent suite.

- [ ] ProgramTest/LiteSVM harness.
- [ ] CPI, ATA, extension, and adversarial flows.
- [ ] 20-constituent compute/size.
- [ ] Fee-grief regression.

**Acceptance:** Real instruction/account tests complement host math tests.

### BAS-017 — Frontend Playwright suite

2026-10-03 scoped evidence: direct-RPC data, amount and signing tests passed, and the shipped UI builders produced seven finalized devnet transactions with 20 accounting assertions. Disconnected browser checks are separate evidence; neither the CLI proof nor these focused tests constitute an automated extension-wallet Playwright release gate. [Wallet-flow record](devnet-ui-wallet-flow-2026-10-03.md).


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

- [x] Carry deterministic attributed `log_index` from the actual transaction log and migrate both ledgers (local source and real PostgreSQL migration tests, 2026-10-09).
- [x] Enforce `(sig,log_index)` uniqueness in events and position effects, including repeated kinds/multiple baskets.
- [ ] Replay original transaction logs and reconcile lost history; defaulting old rows to index zero does not recover dropped events.
- [x] Make claim plus all position/fee effects atomic on a dedicated Pool client, with rollback and concurrency tests (BAS-AUD-06; local source, historical recovery remains gated).
- [x] Add multi-event regression tests, including real PostgreSQL rollback, concurrent claims and finalized transaction ordering.

**2026-10-09 source evidence:** Finalized per-program cursor/queue replay retains original runtime offsets and global `(slot, transaction index)` order, retries missing reads, and blocks later effects after an unresolved predecessor. Legacy rows retain negative quarantine offsets; maintenance can stage a separate recovery without publishing it. Full archival replay, explicit safe recovery-source approval and operator activation remain open. See [the recovery/rollout record](backend-devnet-security-2026-10-09.md).

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

2026-10-03 scoped progress: wallet-free Create/preview remain available, with an explicit test link to `/devnet` and `/create/onchain`. The fixed-mock workspace validates connection, devnet identity, legal acknowledgment, exact seeds and balances before simulation/signing. This supplies the new workspace network guard; versioned concept-draft persistence remains separate.


- [x] Allow the four-task Choose → Set up → Start → Review flow and final basket summary without a wallet (2026-09-23 UX pass).
- [ ] Persist a versioned draft.
- [x] Check wallet connection and creator token balances at Deploy; transaction simulation remains before signing (2026-09-22 UX pass).

**Acceptance:** Users can reach review before connecting.

Remaining: versioned draft persistence and an explicit wrong-network check remain open; this UX pass does not claim the full onboarding item is complete.

2026-09-23 owner decision: default fees are zero, the USD target is optional and blank by default, the seed step makes per-token deposits explicit, and transaction byte estimates are absent from the user flow. Required legal acknowledgments are in Review; the program validation remains unchanged.

### BAS-024 — Human/raw amount system

2026-10-03 scoped progress: the devnet workspace has exact eight-decimal token parsing, six-decimal shares, positive bps allocation checks, proportional deposits and Half/Max. Transfers stay raw; actual scaled multipliers are used for display. Five amount tests and the direct-RPC large-integer checks passed. The broader shared amount-system checklist remains open.


- [ ] Shared exact parser/formatter.
- [ ] Human amount primary; raw amount advanced.
- [ ] Max, rounding, and balance preview.

**Acceptance:** Users enter normal token amounts while transactions use exact raw units.

2026-09-22 UX pass: create weights/fees now display percentages, while transaction arguments remain exact integer bps. Seed inputs already use human token units with exact raw parsing; a shared cross-flow amount system and Max behavior remain open.

### BAS-025 — Devnet onboarding

2026-10-03 scoped implementation: `/devnet` and `/create/onchain` include network/SOL help, a deployed funded once-per-wallet BSTESTA–D claim, atomic basket creation, mint/redeem review and transaction Explorer links. The faucet claim and shipped UI builders finalized with exact raw/share accounting. A real owner extension-wallet first-run completion remains unverified, so this broader acceptance item is not marked complete. [Wallet-flow record](devnet-ui-wallet-flow-2026-10-03.md).


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

2026-10-02 progress: landing and the main sharing/discovery surfaces use shorter English without em dashes, remove repeated preview/concept notices, and explain xStocks and future fees directly. Navigation uses Managers while internal creator identifiers remain. Final issuer/risk copy and a whole-product prohibited-wording review remain open.

- [ ] Decide the header `ETFs` label.
- [ ] Scan prohibited wording.
- [ ] Finalize issuer, fee, and risk copy.

**Acceptance:** UI consistently uses approved strategy-basket language.

### BAS-034 — Direct-RPC redeem fallback

2026-10-03 scoped implementation: `/devnet` reads verified current Basket/share/vault/wallet accounts directly from devnet RPC, accepts whitelist pause as data and submits in-kind redemption without a database, indexer or price feed. Large raw precision, whitelist-paused reads and finalized redemption through the shipped builder are covered. This closes the fixed BSTESTA–D workspace path only; general `/basket/[pubkey]/redeem` fallback and the broader outage/stale-indexer acceptance checklist below remain open. [Data and transaction evidence](devnet-ui-wallet-flow-2026-10-03.md).


- [ ] Read basket supply, constituent vault balances, and user share balance from RPC when indexed basket data are unavailable or stale.
- [ ] Build and preview `redeem_in_kind` from verified on-chain accounts without a price feed, backend, or whitelist status check.
- [ ] Test indexer outage, stale snapshots, paused mints, raw Token-2022 precision, and a fresh redeem after direct-RPC fallback.

**Acceptance:** The app can submit an in-kind redemption through RPC during an indexer outage, with an honest raw-token preview. Until then, the redeem page must say that its current preview needs indexed supply and vault balances even though the on-chain instruction is permissionless and oracle-free.

## P2 — Charts, accessibility, and social

### BAS-028 — Real chart pipeline

2026-10-03 scoped delivery: exact-mint Solana daily history, historical multiplier normalization, complete-window 7D/1M returns and detail Bklit charts are implemented. The subsequent owner decision removes charts and history requests from the compact Stocks/ETF catalog. [History evidence](xstocks-charts-2026-10-03.md), [compact-card verification](compact-asset-cards-2026-10-03.md). Broader candlestick/volume/brush work below remains unclaimed.

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

### BAS-033 — Publish retrievable basket metadata

- [ ] Publish creator name/thesis JSON to content-addressed storage before deployment.
- [ ] Verify the published content against the immutable on-chain metadata hash.
- [ ] Have the indexer resolve and cache verified metadata; show address fallback and source state when unavailable.
- [ ] Test a fresh creator, a second browser, and an indexer restart; avoid implying that a hash alone stores display text.

**Acceptance:** A created basket's name and thesis are visible to another user and independently verifiable from its on-chain hash. Until this is complete, create Review discloses that public metadata publishing is unavailable.

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
6. BAS-023–029, BAS-033, and BAS-034 improve conversion, metadata truth, redeem availability, and quality.
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


## UI re-audit follow-up, 2026-10-02

See [the discovery audit](design-home-discovery-2026-10-02.md). Performance is intentionally absent from illustrative discovery cards. Existing total-NAV change calculations in `backend/src/api/server.ts` and `backend/src/api/social.ts` can be distorted by deposits/redemptions; the devnet UI labels total NAV as “NAV / share”. `priceCompare.ts` synthesizes xStock chart candles with random jitter. These findings remain open. Before adding returns to discovery, use a cash-flow-neutral verified share-price record or an explicitly labeled underlying-price reference with complete constituent coverage, common dates and source/as-of metadata. Do not reuse the synthetic xStock curve.


## Public discovery audit update, 2026-10-02

Completed locally: real-close sample-model prices/7D, ten-basket weekly leaderboard, share-price-based indexed returns, complete/fresh baselines, snapshot/units corrections, raw-share trade values, consistent SPY window selection, null-safe UI, mobile Create actions, invalid-copy recovery and keyboard step focus. Evidence: [product audit](product-performance-audit-2026-10-02.md), [indexed return/schema notes](indexed-basket-return-integrity.md).

Still open: production quote-provider contract/monitoring, persisted price evidence, full accessibility testing, lightweight sample-profile bundle, and the existing investing/xStocks/governance release gates. This update does not close those protocol or deployment items.
