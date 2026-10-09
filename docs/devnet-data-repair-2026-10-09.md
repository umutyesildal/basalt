# Devnet data repair — 2026-10-09

> **Superseded release status:** The follow-up was subsequently deployed on 2026-10-09. Read the [live release record](devnet-live-release-2026-10-09.md) for exact source/image/Vercel identities, observed collection progress and the successful post-freeze SBF build. Pending statements below describe the pre-release checkpoint; historical financial recovery remains guarded.

The previous security/readiness application release (`ae6253765bfd8d7cdfcf219b0e98acff6b5ab855`, subsequently merged by PR #9) was deployed to the existing devnet website and VPS backend. Its incomplete projection status was disclosed; deployment did not establish complete historical balances or USD valuations. This follow-up on `codex/devnet-data-repair`, based on `3e2312304d147d407dab9f4dc136e1bf90021d4c`, is verified source awaiting its own rollout. Earlier documents saying the previous application rollout is still pending are historical. Key retirement, governance, historical recovery and mainnet approval remain separate open work.

## Runtime problem and bounded progress

The previous live backend remained available while its ordered position queue stopped at a basket requiring reviewed reconstruction. Repeating that head could not repair the projection. Separate finalized holder enumeration also failed because the configured public devnet RPC excludes Token-2022 from its account secondary index, with additional HTTP 429 responses. No alternate provider credential was configured. These are different conditions: a healthy process does not prove complete indexed balances, complete history or valid token prices.

The indexer now separates collecting canonical transaction facts from applying financial effects:

- Discovery still durably enqueues finalized signatures and verifies finalized block order, transaction signature/slot identity, trusted program emissions and complete original logs.
- A known unresolved projection head stops ordered financial application without fetching that same transaction on every poll. Its queue row remains pending.
- A separate collector visits at most five pending, uncollected signatures per poll, including later signatures after a quarantined predecessor. It may authenticate immutable basket parents and persist canonical event rows. Event rows and the queue's `canonical_collected_at`/`canonical_event_count` marker commit together, including genuinely empty event sets.
- Collection never writes position claims/balances or creator fee aggregates, marks a signature processed, clears quarantine or activates a staged rebuild. Existing replay-only maintenance semantics remain unchanged.
- Truncated logs, unavailable original transactions/order or authentication failures still block completeness. Later authentic facts do not fill a missing earlier event or authorize historical cost basis.

`/api/v1/health` exposes `db.history.pendingEvidence`, `collectedPendingEffects`, `projectionBlockedSignatures`, pending and quarantine counts, plus `subsystems.indexer.collection`. A declining `pendingEvidence` count can demonstrate collection progress while `pendingSignatures` remains unchanged. Neither counter is proof of financial publication. `/api/v1/ready` keeps service readiness and `projectionReady` separate; collected pending rows still prevent projection readiness.

The current financial recovery contract remains the [approved staged recovery](ledger-recovery-2026-10-09.md). Candidate inspection/export/explicit activation still binds the exact database identity, source, backup, staged run/history and reviewed holder/claim digests. This change adds no automatic activation, new snapshot baseline, invented original log offsets or live projection replacement. Follow the current [operator runbook](../deploy/DEPLOY.md), which supersedes older unrestricted replay command examples.

## RPC scheduling and holder provider

[requestBudget.ts](../backend/src/rpc/requestBudget.ts) supplies the shared read-only Connection factory used by the indexer, holdings/NAV and fee-crank reads. Connections using the exact same endpoint share scheduling. The transport accepts only its explicit read method list, disables the SDK's additional 429 retry layer, bounds request/response bodies and rejects mismatched JSON-RPC response identities. Provider errors are sanitized; URLs, credentials and raw upstream error text are not runtime evidence.

| Setting | Default | Allowed range |
|---|---:|---:|
| `RPC_MAX_CONCURRENCY` | 2 in flight per endpoint | 1–4 |
| `RPC_MAX_QUEUE` | 32 waiting per endpoint | 1–64 |
| `RPC_MIN_INTERVAL_MS` | 250 | 100–2,000 |
| `RPC_QUEUE_TIMEOUT_MS` | 2,000 | 500–5,000 |
| `RPC_REQUEST_TIMEOUT_MS` | 8,000 | 1,000–10,000 |
| `POSITIONS_RPC_UNSUPPORTED_COOLDOWN_MS` | 900,000 | 60,000–86,400,000 |

The transport bounds requests at 64 KiB and streamed responses at 8 MiB, and retains an in-flight slot until an opaque request actually settles even if its caller times out. HTTP 429 and matching JSON-RPC `error.code=429` both establish a shared endpoint cooldown; the existing bounded backoff remains the retry layer. An unrelated error whose raw text happens to mention 429 is sanitized and does not trigger retry.

Optional private `POSITIONS_RPC_URL` must support finalized Token-2022 `getProgramAccounts` with context. Startup first verifies the full devnet genesis hash, `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; wrong/unavailable identity fails closed before workers. One selected endpoint supplies the whole authenticated basket/holder/mint snapshot. The existing same-slot holder/supply, account ownership, immutable metadata, supply equality and publication lock checks remain required. There is no enhanced parsed-account fallback or mixed-provider snapshot.

Permanent account-index exclusion starts a cooldown. Later snapshot attempts skip that provider before reading basket accounts; another available provider may be selected for an entirely new snapshot. A successful probe after cooldown restores capability. Without an alternate endpoint, capability remains honestly unavailable; this source does not create credentials or promise that public RPC supports enumeration.

Position synchronization also performs a cheap read-only preflight: pending/quarantined canonical history, unfinished scans or missing finalized coverage skip all holder scans; an unresolved basket rebuild skips that basket. Transactional checks still revalidate after locks, so this optimization does not authorize publication from stale preflight results. Health exposes sanitized `rpcRequests`, `positionsRpc` and `positionsSync` evidence through subsystem status.

## Explicit position and price quality

Basket list/detail responses now provide `dataQuality`: a public status, fixed human-readable reasons, current valuation eligibility, missing price mints and recovery/pending/quarantine counts. Current valuation failure remains separate from immutable last-good snapshots. Failed or incomplete current inputs cannot make an older value fresh, authorize returns or establish a new wallet valuation.

The frontend parses that evidence conservatively. Missing/malformed quality, unresolved recovery/history and mock price sources suppress indexed USD price/return presentation and show a short explanation. Test tokens have no USD market price. The devnet workspace distinguishes indexed data availability from direct wallet/RPC access; API liveness alone never means balances are ready. Model/concept previews remain reference illustrations rather than verified onchain valuations. No mock/catalog quote is promoted to an eligible exact-mint Jupiter NAV input.

Direct, permissionless oracle-free redemption is unchanged. This work changes no Solana program source, program IDs, onchain raw accounting, authorities, signer requirements or asset balances. Existing creation security guards remain in force.

## Dependency and frontend build preparation

Three narrowly patched upstream Rust parent manifests move the host logger to `env_logger=0.10.2` and SDK/frozen-ABI mmap dependencies to `memmap2=0.9.11`. Original Rust source/feature/cfg bytes are preserved and offline archive/source/license/VCS provenance is checked. RustSec findings fall from 16 to 13; the remaining scoped exceptions retain their original **2026-10-23 00:00 UTC** expiry and mainnet approval remains false. Host checks, tests and regressions passed. A new SBF build is still pending, and no deployed binary was rebuilt, upgraded or re-attested by these host results. See the [dependency record](dependency-security-2026-10-09.md) and [bounded remediation evidence](security-evidence-2026-10-09/rust-parent-remediation.json).

The Vercel install source now locates the canonical repository-root workspace from either root/app working directory, checks its frozen lock and local bounded bigint codec input, and invokes pinned npm 11.6.2 `npm ci` with default peer resolution. [app/vercel.json](../app/vercel.json) selects that installer. The frontend still builds from the repository-root workspace, including its backend fee-helper dependency. This is source/build preparation; a successful new hosted Vercel build and exact deployment/alias verification remain pending.

## Verification and release boundary

| Verification | Result |
|---|---|
| Full backend suite | 1,352/1,352 passed, including explicitly configured disposable PostgreSQL regressions |
| Security script suite | 49/49 passed |
| Backend strict build and installed dependency smoke | Passed |
| Node 20 history/RPC/provider regressions | 48/48 passed, including disposable PostgreSQL |
| Focused RPC/provider/position/backoff follow-up | 97/97 passed; actual local HTTP SDK regressions cover 429 retry/cooldown and response identity |
| Frontend Node tests | 141/141 passed |
| Frontend Vitest | 54/54 passed |
| Frontend typecheck, concept integrity and production build | Passed; 26 static pages |
| Rust workspace host tests | 247 passed |
| Rust host regression fixtures | 4 passed |
| Rust security/provenance tests | 19 passed, including 10 provenance regressions |
| Rust format/check/clippy and scoped audit gate | Passed; 13 findings remain accepted within unchanged scope/expiry |

The full backend and security logs are retained locally at `/private/tmp/basalt-devnet-data-repair-backend-full.log` and `/private/tmp/basalt-devnet-data-repair-security.log`. Rust checks and hashes are retained in the linked tracked evidence. These results establish source behavior, not a new deployment or wallet transaction proof. Database tests use unique disposable schemas and explicit test URLs; HTTP/provider regressions use controlled local servers or fixtures.

Before publication, retain the exact source/image identity and rollback material, apply the contained devnet rollout procedure, and verify the actual hosted frontend build and public backend status. Record collector progress separately from still-pending financial effects, provider capability and valuation coverage. If original logs are permanently truncated, retain quarantine and the documented unresolved projection; a more capable endpoint cannot recreate logs the runtime never emitted. No live recovery activation, chain transaction, authority change or mainnet release is claimed here.

**New release live evidence:** pending. The release owner will append the exact source/deployment identities and fresh observations after the actual rollout.
