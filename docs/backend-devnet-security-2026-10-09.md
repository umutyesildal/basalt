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

## Verification

| Check | Result / evidence |
|---|---|
| Backend build / strict TypeScript | Passed; [build output](assets/backend-security-2026-10-09/backend-build.txt) |
| Full backend suite | **946 passed, 41 files, zero skips**, including 18 real PostgreSQL tests; [complete output](assets/backend-security-2026-10-09/backend-tests.txt) |
| New negative regressions | 22 auth/startup/nonce + 20 limiter + 21 JSON/HTTP integration tests |
| Real entrypoint rejection | Missing/placeholder production secrets exit before worker logs/listen |
| HTTP behavior | Declared/chunked oversize, UTF-8 byte boundary, authenticated social writes, wallet signatures/replay, spoofed forwarding headers, quote capacity/provider failures |
| Patch hygiene | `git diff --check` passed |

Both root and backend dependencies were installed deterministically from their existing lockfiles, with install scripts disabled. No dependency or lockfile changed. For separate installs, install root first: root `npm ci` can clean nested workspace dependencies. The full suite used a new disposable PostgreSQL cluster over a local Unix socket with no TCP listener; the test cluster was stopped after verification. JSON timeout/aborted-read cleanup is exercised with controlled streams/timers; actual HTTP tests cover the size, auth and quota paths. No live API load test, chain transaction or external wallet signature was performed.

The backend suite ran with its test-only auth configuration in `backend/vitest.config.ts`. Use `npm --prefix backend test`; direct Vitest invocations from the repository root must select that configuration explicitly. SQL tests use only `BASKET_RETURNS_TEST_DATABASE_URL`, never the application's `DATABASE_URL`. Rust and frontend checks were not rerun because this package does not modify those sources or shared math/fees. Caddy configuration was checked against its [official request-body documentation](https://caddyserver.com/docs/caddyfile/directives/request_body); a Caddy/container runtime was unavailable locally, so proxy startup validation remains a rollout check.

## Remaining audit work

Code/test completion below is separate from live remediation. This branch has not been deployed. No VPS/Vercel/program update, secret rotation, asset transfer, repository-history rewrite or authority transfer was performed.

| ID | State after this package | Next completion evidence |
|---|---|---|
| BAS-AUD-01: disclosed historical treasury/test keys | Open, operational P0 | Permanently retire all four disclosed keys; provision a clean treasury/factory and new baskets, verify finalized state. Existing immutable baskets retain permissionless redemption. Never add mutable treasury/admin withdrawal to repair them. |
| BAS-AUD-02: known auth fallback | Code/test complete; live rollout pending | Supply a generated secret through secure configuration, invalidate old tokens, rebuild/recreate backend and verify auth after rollout. |
| BAS-AUD-03: unbounded public resource consumption | Code/test complete for the controls above; live rollout pending | Validate Caddy config, roll out matching app/proxy limits and verify 413/429 and normal health under small controlled requests. Review trusted-proxy/distributed limits before changing topology. |
| BAS-AUD-04: single-key governance | Open, pre-mainnet gate | Independently operated 2-of-3 hardware-backed governance and 48-hour onchain delay; finalized proof for all three upgrades plus whitelist authority. Follow the existing ceremony runbook. |
| BAS-AUD-05: event identity collisions | Next code package | Carry actual attributed log index; use `(sig,log_index)` in event and position ledgers. Replay original logs to recover lost history; assigning index zero alone is insufficient. Cover repeated same-kind events and multiple baskets per transaction. |
| BAS-AUD-06: non-atomic position claims/effects | Next code package, paired with 05 | Dedicated Pool client: claim, position and fee effects commit atomically, with rollback and per-position concurrency protection. Failure-injection and parallel replay prove one complete effect. Do not interleave transactions on the shared Client. |
| BAS-AUD-07: history window gaps | After 05/06 | Durable finalized cursor per program, pagination/backfill through the checkpoint, restart/crash/retry proof, basket reconciliation and oldest-unprocessed metrics. |
| BAS-AUD-08: invented mint/vault facts on RPC failure | Separate data-integrity package | Preserve last verified facts as stale or skip the snapshot. Failed mint/vault reads must not publish decimals6/multiplier1/raw0 as fresh facts. Validate mint/owner/authority. |
| BAS-AUD-09: partial NAV treated as fresh | Pair with 08 | Require complete valid fresh exact-mint quotes and holdings; reject incomplete performance/ranking baselines and reconcile historical snapshots. |
| BAS-AUD-10: dependency advisories | Open, separate compatibility work | Runtime target/call-site reachability and remediation or dated exception per advisory; compatible deterministic installs and bounded-decode tests. No blind forced downgrade. |

Mainnet security, governance, independent review, reproducible-build, issuer and legal gates remain open. This initial backend package does not change immutable V0 terms, Token-2022 raw accounting, backend non-custody or backend-independent oracle-free redemption.
