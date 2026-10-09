# Backend and devnet security remediation — 2026-10-09

Branch: `codex/backend-devnet-security`, based on `main@387ff5c3088315ab7471d3d3c304d51eb2ef52db`.

## Recovered context

The previous work was the **2026-10-04 read-only backend/devnet audit**: four high and six medium findings, with no product fixes or live changes. Its original report remains in the old project directory at `.superstack/security-reports/createyouretf-2026-10-04.md`. That audit examined the current Basalt `main` source, not the detached initial-commit FolioX scaffold in that directory. The new branch uses a separate managed worktree; existing main, contract-hardening and scaffold work is preserved.

The [Markdown review inventory](assets/backend-security-2026-10-09/markdown-review.md) records all 83 project-owned Markdown files at the base commit, with line counts and hashes. Security/current-release records were reviewed closely and historical product/design documents by their decisions, status, scope, superseding notices and acceptance gates. Vendored skills, dependencies and generated video projects were excluded. The older audit/report and build-context from the scaffold directory were reviewed separately.

The 3 October release and devnet records take precedence over earlier “local/unpushed”, deployment-pending and `/create/onchain` redirect notices. Managed V2 remains a separate localnet prototype. Older dated evidence is preserved rather than rewritten as a new result.

## First package: BAS-AUD-02 and BAS-AUD-03

- Auth configuration resolves before any worker or HTTP listener starts. Missing, short, whitespace-only and known-placeholder secrets fail startup without logging the configured value. Operators should supply 32 random bytes, for example as the 64 hex characters produced by `openssl rand -hex 32`.
- Local development can explicitly set `SOCIAL_AUTH_ALLOW_DEV_SECRET=1` with no configured secret. This creates a process-random secret; restarting invalidates its tokens. Production rejects this fallback. An explicitly configured weak secret is rejected in every mode.
- The resolved secret is injected into the API once. Wallet signatures, single-use challenges and the social-write-only bearer scope remain unchanged. Previously published fallback-secret tokens fail verification under the new secret.
- JSON readers count bytes before UTF-8 decoding, cap bodies at **65,536 bytes**, check declared and streamed sizes, reject arrays/non-objects, and terminate unfinished reads after **10 seconds**. Oversize returns **413**, timeout **408**. Rejected/aborted reads discard buffered chunks and listeners. Error responses close the connection instead of draining an unlimited body. Authenticated profile, post and comment routes preserve these errors.
- The nonce store caps pending entries at **10,000 globally** and **three per wallet**, without evicting existing valid challenges. Consumed and expired entries release capacity. Expiry cleanup removes an ordered prefix once rather than repeatedly scanning fresh entries.
- Auth and quote attempts have per-socket-peer budgets; validated auth wallets have independent budgets. The shared identity table caps at **10,000 buckets**, and each cleanup inspects at most **16** expired entries. Saturation returns **429** with `Retry-After`.
- Quote work allows **four concurrent quote jobs**, with no waiting queue, and at most **120 actual upstream leg fetches per minute**. Cache hits do not consume the upstream budget. Jobs release capacity in `finally`, including provider failures. Existing quote-leg HTTP deadlines remain 10 seconds. With V0's maximum 20 constituents, four jobs may have up to 80 concurrent provider legs; four is a job limit, not a provider-fetch limit.
- Caddy's configured request-body limit matches the application limit. Environment examples leave the secret blank and the deployment runbook explains fail-closed startup and token rotation.

| Attempt budget | Per socket peer / minute | Per validated wallet / minute |
|---|---:|---:|
| Nonce issuance | 30 | 5 |
| Signature verification | 60 | 10 |
| Zap quote | 30 | — |

**Proxy boundary:** the API uses the socket peer and deliberately ignores client-supplied `Forwarded`/`X-Forwarded-For`. In the current Caddy topology all proxied users share the peer budget; wallet quotas remain independent. Per-client proxy identities require a separately reviewed trusted-proxy arrangement. Limits are process-local for the current single-instance backend; multiple replicas need shared enforcement. These controls do not claim complete perimeter DoS protection.

## First-commit verification (4d188cb)

| Check | Result / evidence |
|---|---|
| Backend build / strict TypeScript | Passed; [build output](assets/backend-security-2026-10-09/first-commit-backend-build.txt) |
| Full backend suite | **946 passed, 41 files, zero skips**, including 18 real PostgreSQL tests; [complete output](assets/backend-security-2026-10-09/first-commit-backend-tests.txt) |
| New negative regressions | 22 auth/startup/nonce + 20 limiter + 21 JSON/HTTP integration tests |
| Real entrypoint rejection | Missing/placeholder production secrets exit before worker logs/listen |
| HTTP behavior | Declared/chunked oversize, UTF-8 byte boundary, authenticated social writes, wallet signatures/replay, spoofed forwarding headers, quote capacity/provider failures |
| Patch hygiene | `git diff --check` passed |

Both root and backend dependencies were installed deterministically from their existing lockfiles, with install scripts disabled. No dependency or lockfile changed. For separate installs, install root first: root `npm ci` can clean nested workspace dependencies. The full suite used a new disposable PostgreSQL cluster over a local Unix socket with no TCP listener; the test cluster was stopped after verification. JSON timeout/aborted-read cleanup is exercised with controlled streams/timers; actual HTTP tests cover the size, auth and quota paths. No live API load test, chain transaction or external wallet signature was performed.

The backend suite ran with its test-only auth configuration in `backend/vitest.config.ts`. Use `npm --prefix backend test`; direct Vitest invocations from the repository root must select that configuration explicitly. SQL tests use only `BASKET_RETURNS_TEST_DATABASE_URL`, never the application's `DATABASE_URL`. Rust and frontend checks were not rerun because this package does not modify those sources or shared math/fees. Caddy configuration was checked against its [official request-body documentation](https://caddyserver.com/docs/caddyfile/directives/request_body); a Caddy/container runtime was unavailable locally, so proxy startup validation remains a rollout check.

## Full audit continuation

All ten findings now have concrete remediation work in this branch. Source controls, the explicitly approved ledger recovery implementation and live operational remediation have distinct states below; this does not close the full audit. The immutable onchain programs, program IDs, raw transfer accounting and backend-independent permissionless redemption are unchanged.

| Finding | Local implementation | Remaining operational evidence |
|---|---|---|
| BAS-AUD-01 — exposed historical keys | Permanent public retirement inventory; history/index secret checks; loaders, senders, faucet and CLI/browser new-basket factory guards reject all four keys. Browser creation checks the fresh authenticated finalized factory before any ALT setup or signing. | Live factory still embeds the exposed treasury. Provision owner-approved clean treasury and new program/factory namespace; preserve old holder redemption. No history rewrite or asset migration performed. |
| BAS-AUD-02 — predictable auth | Startup rejects missing, weak and placeholder secrets; explicit ephemeral development mode only. | Configure strong production secret, invalidate old sessions, deploy and verify. |
| BAS-AUD-03 — unbounded requests | Body/deadline, wallet/peer nonce/auth, signature predecode length, quote concurrency/actual upstream-fetch budgets and bounded fallback cache; matching proxy body cap. | Proxy startup/controlled live requests after rollout; distributed/proxy identity rules before multiple replicas. |
| BAS-AUD-04 — unilateral authority | Strict unsigned public ceremony record and finalized read-only Squads/current-authority preflight; exact roles/2-of-3/48h/autonomous config. | Real hardware signer public keys and exact owner/signer approvals are absent. No governance accounts or authority changes created. |
| BAS-AUD-05 — colliding events | Actual runtime log offsets; `(sig,log_index)` both ledgers; legacy offsets quarantined; original-log replay and nondestructive staged recovery. | Run archival replay against a backup/candidate DB. Missing or permanently truncated logs block completeness; never invent a log offset. |
| BAS-AUD-06 — partial position effects | Dedicated pooled transaction claims and all position/fee effects; authenticated finalized reconciliation, replay barriers, immutable backups and explicit atomic activation with rollback/fault/concurrency tests. | Source/disposable tests explicitly approved and implemented; archival candidate replay and exact live operator publication remain open. No production projection changed. |
| BAS-AUD-07 — lost downtime history | Durable finalized per-program scans and global signature queue; original block transaction order, cross-process poll serialization, bounded pagination/checkpoints, retry/quarantine, authenticated account discovery and pending-history metrics. Discovery requires all three distinct valid program roles and minContextSlot; parsed slot/signature/time/known payload must agree. Persisted finalized coverage cannot advance after a busy, failed or resumed-only scan. | Operator replay and provider archival completeness verification; deployment pending. |
| BAS-AUD-08 — invented facts | Authenticate Token-2022 mint/vault ownership, mint/authority and state; failed observations preserve prior values/timestamps and invalidate freshness. | Re-sync candidate/live data after rollout; failed facts cannot authorize a valuation. |
| BAS-AUD-09 — partial NAV | All exact-mint fresh quotes, authenticated complete holdings and RPC supply required. Historical rows default unverified; preserve last complete snapshot, persist current failure separately. NAV/return/quote/wallet consumers filter quality; creator rows expose current quality and actual observation time; period baselines and all-position completeness validated. Quote cache revalidates current NAV/holdings and binds redemption keys to current raw balances/supply/fees; cached buy estimates use exact USDC units/current eligible NAV or null. | Old unverified snapshots remain retained and excluded. Exact-mint Jupiter quotes may be unavailable for devnet mocks; reference Yahoo/mock prices do not become eligible token NAV. |
| BAS-AUD-10 — dependencies | Root/backend/app production npm audits zero, native-free bounded integer codec, compatible pinned patches and high CI gates. Rust advisories have exact-lock/package/target exceptions expiring 23 October. | Rust findings and development-tool advisories remain disclosed; major SDK migration/mainnet review is separate. |

### Current finalized devnet evidence

The read-only [2026-10-09 state observation](assets/backend-security-2026-10-09/current-devnet-state.json) at finalized slot **509145967** confirms all three upgrade authorities and the whitelist authority remain `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE`; no pending whitelist transfer exists. FactoryConfig `CfxquMe4MAPksEEsVyw8XmcxYH5W7qftRWNySgHjLi6e` still embeds retired treasury `AAb2TXLQCPFvnUoJFSBe9PFs28w5kvAukH4Gaiia3eiJ`. These operational findings are **open**, not remediated by local guards.

### Migration and rollout order

1. Preserve a database backup and stop normal indexer, NAV and wallet snapshot writers. Apply the new schema to an isolated candidate database first. Legacy event/position markers and old NAV values remain retained; legacy projections are explicitly marked `rebuild-required`.
2. Build the backend, then use `node backend/dist/maintenance/replay-indexer.js --max-polls=100` with explicit candidate `DATABASE_URL`, archival `RPC_URL` and all three program IDs. It fetches finalized original logs without signers and only advances a history checkpoint after the page is durably enqueued. Rerun on budget exhaustion to resume. Resolve all pending/quarantined transactions before claiming complete history.
3. Add `--stage-basket=<address>` to prepare separate position runs/rows/claims from authenticated finalized mint/holder reads and reconciled canonical event supply. The staging command does **not** activate or overwrite existing positions. A changed/incomplete history, missing creation, supply mismatch or incomplete holder scan fails closed. Post-snapshot catch-up must successfully prove every program through the holder snapshot slot; stale persisted completion after a busy/failed poll is insufficient, even when missing events have zero net supply change. Initial replay and this catch-up share one max-polls budget. Historical fill cost remains unknown.
4. Review [the approved recovery implementation and fault tests](ledger-recovery-2026-10-09.md). Explicit user approval resolved the earlier source-review scope rejection. The [original proposal](assets/backend-security-2026-10-09/proposed-ledger-recovery-review.md) and [starting patch](assets/backend-security-2026-10-09/proposed-ledger-recovery.patch) remain historical artifacts. Activation requires the exact staged run/history hash, canonical program set, unchanged history, fresh authenticated holders and matching immutable basket facts. The activation API has no automatic caller; production publication remains an independent exact operator action.
5. Supply the generated production auth secret securely and roll out backend/proxy together. Confirm normal health, 413/429 bounds, backlog/oldest pending/quarantine metrics, quality flags, historical exclusion and wallet projections before public indexing resumes. Validate Caddy using its actual runtime during rollout.
6. Complete [key retirement and governance preparation](retired-key-remediation-2026-10-09.md) with the real human-operated identities. The immutable compromised factory namespace cannot be repaired with a mutable treasury setter or an administrative withdrawal. Mainnet, issuer/legal review and independent audit gates remain open.

### Dependency and test evidence

See [dependency remediation and scoped Rust reachability](dependency-security-2026-10-09.md), [public key retirement and ceremony preparation](retired-key-remediation-2026-10-09.md), and the evidence directory. The earlier 946-test result above belongs to the first commit only. The 56fd56c baseline results are preserved below and exclude recovery source. Verification of the subsequently approved implementation is recorded separately in [the recovery report](ledger-recovery-2026-10-09.md).


### Consolidated baseline verification (56fd56c)

| Check | Result / evidence |
|---|---|
| Backend strict build | Passed; [output](assets/backend-security-2026-10-09/backend-build.txt) |
| Entire backend suite | **1,097 passed, 47 files, no skips**, including **86 actual PostgreSQL tests** (41 valuation/returns/creator, 25 atomic positions/staging, 20 finalized history); [output](assets/backend-security-2026-10-09/backend-tests.txt) |
| Frontend suites | **133 Node tests + 50 Vitest tests**, no skips; [Node output](assets/backend-security-2026-10-09/app-node-tests.txt), [Vitest output](assets/backend-security-2026-10-09/app-vitest.txt) |
| Frontend strict typecheck and production build | Passed; [typecheck](assets/backend-security-2026-10-09/app-typecheck.txt), [build](assets/backend-security-2026-10-09/app-build.txt) |
| Rust workspace | **243 passed** (basket136, factory45, whitelist27, shared token policy29, managed core6); [output](assets/backend-security-2026-10-09/rust-tests.txt) |
| Security scripts / actual dependency codecs | **9 passed**, installed Solana/Jayson compatibility passed; [tests](assets/backend-security-2026-10-09/security-scripts.txt), [compatibility](assets/backend-security-2026-10-09/dependency-smoke.txt) |
| Root/app/backend production npm audits | **Zero advisories**; [exact reports and hashes](security-evidence-2026-10-09/evidence-summary.json) |
| RustSec gate | Zero blockers under **16 exact expiring exceptions**, not a clean dependency graph; [reachability and expiry](dependency-security-2026-10-09.md) |
| Historical/index secret checks | Full reachable history plus staged index checked; four retired historical blobs acknowledged, no new findings; [report](security-evidence-2026-10-09/secret-history.json) |
| Recovery proposal / patch hygiene at baseline | Starting proposal passed `git apply --check` without applying it; staged `git diff --check` passed. Subsequently approved implementation is recorded separately. |

The baseline source and evidence hashes are recorded in [verification-summary.json](assets/backend-security-2026-10-09/verification-summary.json). Verification used clean root workspace installation plus separately validated standalone locks. Local Node was24.11.1; CI/deploy selects Node20. Actual PostgreSQL tests ran against unique disposable schemas in a Unix-socket-only cluster, never the application DATABASE_URL. Frontend tests use both their existing Node and Vitest runners. RPC and transaction-order fault tests use explicit fixtures; current devnet authorities/treasury were observed read-only separately. Caddy/runtime rollout and owner browser-wallet signing were not performed.

**Approved recovery source:** the user approved implementation and disposable tests on 2026-10-09. The reconciler now authenticates finalized basket/mint/holder facts, catches history up and rechecks it under locks before publication. Legacy projections still require explicit activation of a reviewed run; immutable backups, claims and the replay barrier commit together. Creator genesis recovery comes from authenticated holders rather than an invented historical credit. APIs exclude unresolved projections. See [the source and verification record](ledger-recovery-2026-10-09.md). Public creation against the retired treasury remains rejected; direct-RPC redemption remains available.

No VPS/Vercel/program update, live auth rotation, transaction signing, asset transfer, history rewrite, authority transfer or production database replay occurred in this branch.
