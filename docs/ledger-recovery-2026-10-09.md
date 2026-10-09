# Approved position-ledger recovery — 2026-10-09

Branch: `codex/backend-devnet-security`. Baseline: `56fd56c`, following `4d188cb`.

## Authorization and scope

The user explicitly approved the prepared source proposal and disposable tests: “Onaylıyorum lütfen devam”. This resolves the earlier automatic approval-review rejection of the broad financial-ledger source rewrite. The [original review](assets/backend-security-2026-10-09/proposed-ledger-recovery-review.md) and [starting patch](assets/backend-security-2026-10-09/proposed-ledger-recovery.patch) are retained as historical artifacts; the reviewed final source includes additional failure, ordering and tamper controls.

Implementation and verification use the isolated managed worktree, in-memory RPC fixtures and unique disposable PostgreSQL schemas. No application `DATABASE_URL`, live database replay/publication, transaction, signer, deployment or authority change is part of this work. Production activation remains an independent operator action against an exact reviewed run and history hash. V0 programs, program IDs, raw transfer math and permissionless oracle-free redemption are unchanged.

## Finalized snapshot and reconciliation

`fetchFinalizedPositionSnapshot` authenticates the canonical basket owner/discriminator, factory/basket/share-mint/vault PDAs and immutable V0 facts. All three configured program IDs must be distinct canonical public keys, including explicit basket and factory roles. The share mint must be the plain initialized Token-2022 mint created by V0: six decimals, canonical mint authority and no freeze authority. Holder accounts must be owned by Token-2022, initialized, non-executable, structurally valid and bound to the exact share mint. Duplicate token-account addresses are rejected; multiple accounts belonging to one owner are aggregated with exact raw integers.

Holders and mint supply must have exactly the same finalized RPC context, no earlier than the basket observation. Holder totals must equal supply, including the valid zero-supply case. A context advance retries the complete observation at most three times. RPC reads and rate-limit waits share a ten-second deadline. Parsed provider token APIs without authenticated account bytes and finalized context are rejected.

Reconciliation reads the snapshot before taking database locks. A bounded caller hook can catch canonical history up through its slot; the listener uses durable discovery directly, avoiding recursive state synchronization. Publication then takes the global discovery lock, sorted program locks and the basket lock on one pooled transaction. It rechecks completed scans, processed queues, persisted discovery coverage, immutable basket metadata, latest canonical and already-applied event slots, and the previous snapshot barrier. Incomplete, quarantined, newer, unknown-slot or regressing evidence preserves prior positions. Overlapping attempts cannot overwrite a newer failed/busy attempt with an older transient successful discovery watermark.

A successful transaction publishes exact holder balances and the snapshot barrier together. Missing prior holders become zero-balance rows rather than being erased by reconciliation. Basket/leaderboard holder counts and wallet live-position queries exclude those retained zero rows. Changed balances lose unproven historical cost basis; adding a later priced mint cannot turn previously unknown holdings into a known full cost, and an unpriced mint invalidates a previously known full basis; reconciliation does not infer fills from current NAV. A failure for one basket is contained and leaves its previous committed projection intact.

## Explicit activation and preserved evidence

The maintenance CLI remains replay-and-stage only. It shares the authenticated snapshot helper, then proves discovery through that snapshot within the command's total poll budget. Staging records the exact canonical history hash, event count, program set, finalized slot/supply, holders and canonical event claims without replacing active positions.

`activateStagedPositionRebuild` is an explicit source API with no bootstrap, worker, HTTP or CLI activation caller. It requires the exact run ID/history hash/program set and an unresolved same-basket projection guard. It verifies canonical history and share-supply conservation, fresh finalized holders, immutable basket facts, staged holders/claims, prior claim consistency and a nonregressing barrier. Snapshot acquisition and optional bounded catch-up precede the locks; all relevant evidence is rechecked under the same publication locks.

Before publication, every prior position and claim is copied into per-run backups, including original timestamps, cost provenance and known claim slots. Database triggers reject backup UPDATE, DELETE and TRUNCATE, and reject INSERT after activation. Staged run evidence is immutable; the only permitted update records its one activation transition. Old negative legacy claims remain retained.

Backups, exact holder positions, canonical claims, snapshot barrier, activated receipt and same-basket guard transition commit in one transaction. Faults roll all of them back. Repeating an already committed exact activation validates its matching guard, run/hash/program set and nonregressing barrier, returns the existing receipt and performs no replacement or fresh RPC work. A superseded or conflicting receipt fails closed.

## Event and API behavior

Every normal event claim stores its finalized runtime slot. Migration retains old claims with unknown slots and marks their baskets as requiring recovery. A known missing/insufficient indexed balance also persists a same-basket recovery marker outside the rolled-back event transaction; if an older recovery was active, the new gap reopens the guard without deleting that historical receipt. Replay-only maintenance can then drain canonical history and stage an explicit recovery for a fresh creator genesis or transferred holding, as well as for legacy ledgers. After reconciliation, an event at or before the snapshot barrier is claimed without repeating balance, fee or cost effects; an event after the barrier applies once. Missing/invalid slots after a barrier fail before a claim can commit. Direct event updates serialize on the same basket lock, so a newer applied event cannot be overwritten by an older snapshot, even before its canonical event row is persisted.

Legacy evidence resolves only when its `activated_run_id` points to a committed activated run for the same basket. Wallet valuation predicates and health reporting share this condition. A staged run or an activated run belonging to another basket never clears the guard. Independent history/fact/NAV quality checks remain required after recovery. Normal event cost basis remains a reference estimate from a NAV observation, not authenticated transaction-time fill evidence; this change does not reconstruct historical purchase prices.

## Verification

| Check | Result / evidence |
|---|---|
| Backend strict build | Passed; [output](assets/ledger-recovery-2026-10-09/backend-build.txt) |
| Full backend suite | **1,248 passed, 50 files, zero skips**, including **196 actual PostgreSQL tests**; [output](assets/ledger-recovery-2026-10-09/backend-tests.txt) |
| Frontend suites | **133 Node + 50 Vitest passed**; [Node](assets/ledger-recovery-2026-10-09/app-node-tests.txt), [Vitest](assets/ledger-recovery-2026-10-09/app-vitest.txt) |
| Frontend typecheck / production build | Passed; [typecheck](assets/ledger-recovery-2026-10-09/app-typecheck.txt), [build](assets/ledger-recovery-2026-10-09/app-build.txt) |
| Rust workspace | **243 passed**; [output](assets/ledger-recovery-2026-10-09/rust-tests.txt) |
| Security scripts / installed dependency compatibility | **9 passed**, compatibility passed; [scripts](assets/ledger-recovery-2026-10-09/security-scripts.txt), [compatibility](assets/ledger-recovery-2026-10-09/dependency-smoke.txt) |
| Historical/index secret checks | **6,271 objects**, four retired historical keys acknowledged, **zero new findings**; [report](assets/ledger-recovery-2026-10-09/secret-history.json) |

Final test counts, source hashes and evidence are recorded in [verification-summary.json](assets/ledger-recovery-2026-10-09/verification-summary.json). The original [56fd56c verification](assets/backend-security-2026-10-09/verification-summary.json) remains an immutable dated baseline.

The real PostgreSQL suites cover transaction rollback, same-basket concurrency, later/covered events, changed/stale/tampered recovery evidence, unresolved guards, changed immutable facts, supply/holder equality, immutable backups and exact retries. RPC context drift, missing/malformed/wrong-owner accounts, unsupported provider results and deadlines use explicit in-memory fixtures. SQL tests use only explicitly named test database variables; this run sets `BASKET_RETURNS_TEST_DATABASE_URL` and unsets application `DATABASE_URL`/`RPC_URL`. PostgreSQL advisory locks are database-wide, so Vitest runs test files serially when a test database URL is configured; explicit concurrent transactions inside each regression still run concurrently. This avoids unrelated schemas contending for production lock names. The disposable cluster is stopped after final verification. No live RPC recovery or production activation was performed.

## Remaining operator work

Follow the [candidate migration and rollout order](backend-devnet-security-2026-10-09.md). Retain a backup, stop live writers, replay archival logs into an isolated candidate, review the exact staged run/hash and immutable facts, and separately authorize any live publication. Historical costs remain unknown where no authenticated fill evidence exists. Providers that cannot supply equal holder/mint contexts may exhaust the strict retry budget; this deliberately preserves prior data.

Key retirement, the real hardware-signer multisig/time-lock ceremony, current compromised treasury replacement, deployment/runtime checks and mainnet/legal/external-audit gates remain open as recorded in the [security remediation](backend-devnet-security-2026-10-09.md). Recovery source completion does not close these live operational findings.
