# GitHub and live release, 2026-10-03

Status: publication and final live checks complete. The latest product source is pushed to GitHub; the existing VPS backend and Vercel website are updated. The exact released source, deployment identities and live evidence are recorded below.

## Existing targets

- Repository: `https://github.com/umutyesildal/basalt`, branch `main`.
- Website: `https://basalt.markets`, existing Vercel project `basalt`.
- API: `https://basalt.178.104.34.252.sslip.io`.
- VPS deployment: `/opt/basalt/backend` and `/opt/basalt/deploy`, existing Docker Compose backend/Postgres/Caddy services.
- Wallet network: Solana devnet. Website deployment does not deploy programs to mainnet.

GitHub is not connected to automatic Vercel deployment, so a source push is followed by an explicit release. Vercel now builds from repository root with project `rootDirectory: app` and `sourceFilesOutsideRootDirectory: true`; this includes the canonical backend fee helper imported by the frontend. Production `NEXT_PUBLIC_SITE_URL` is set to the public site. Existing API origin and verified devnet RPC configuration are preserved. The root `.vercelignore` omits private environments, keys, caches, build output and unrelated generated media from the upload.

## Release scope

The checkpoint includes official xStocks discovery and real token quotes/history, cash-session-aware quote refresh, compact stock/ETF cards, Create UX improvements, the reviewed V0 issuer-extension admission work, and the wallet-signed four-mock devnet workspace with its funded once-per-wallet faucet. Relevant source, tests, deployment settings, documentation and public runtime evidence are published together. Private keys, environment files, generated video outputs and unrelated pitch/media artifacts remain excluded.

The VPS is updated from the exact released source, preserving remote private environments and the PostgreSQL/Caddy volumes. Database/source/Compose backups and the previous backend image are retained on the server under `/opt/basalt/release-backups/20261003-xstocks-wallet-ui`; private database contents never enter Git. The existing image is retained as `deploy-backend:before-20261003`. Only the backend is rebuilt/recreated. [Cache migration](backend-cache-deployment-2026-10-03.md) adds a persistent quote/history volume and preserves genuine public price snapshots before the restart, including while the NYSE cash session is closed.

## Pre-release verification

- Rust workspace: 214 library tests passed. Rust formatting and Clippy gates passed; formatting changes are semantic-neutral and do not represent a new devnet program deployment.
- Backend: 807 tests passed, 18 database-dependent tests skipped in this local run; the TypeScript build passed.
- Frontend before release-specific dependency remediation: 40 Node tests and 20 Vitest tests passed.
- Direct-RPC/faucet Node tests: 18 passed; standalone faucet: 9 Rust tests passed.
- The previously recorded shipped UI-builder proof has seven finalized devnet transactions and 20 assertions. [Wallet-flow record](devnet-ui-wallet-flow-2026-10-03.md).
- Publication audit found no credential or keypair in selected source/evidence; all 58 local keypair files are ignored.

The first frontend test invocation incorrectly sent Node-test files to Vitest without the app aliases. The correct Node runner with the app TypeScript configuration passed all 40 tests; this was a runner setup issue, not a suppressed product failure.

The initial production dependency audit exposed existing unpatched native conversion and CLI-only dependency chains. Remediation and final gate results are recorded below before deployment. No advisory gate is disabled or weakened.

The VPS preflight returned healthy backend and PostgreSQL services, five indexed baskets and matching current devnet program IDs. The owner wallet extension signing step remains unperformed by the agent; shipped-builder runtime proof and browser rendering checks are recorded separately.

## Dependency remediation and token helper

The app no longer imports the native SPL conversion dependency at runtime. A small Token-2022 helper covers only the actual devnet and local-lab account layouts and wire instructions, using exact Buffer bigint reads. It validates owner, executable state, mint padding, account type, COptions and TLV bounds. Scaled UI activation timestamps use signed i64, matching the Rust ABI; positive/negative activation boundaries are tested. No fee formula, V0 instruction or program was changed by this frontend remediation.

Validation passed 28 focused Node tests (16 direct-RPC/activation tests, nine helper tests, three faucet tests), 288 comparisons against the official SDK, independent reads of three actual devnet baskets and app TypeScript checking. The claim transaction remains 771 bytes before compute-budget instructions.

The shadcn installer is a development dependency. Compatible lockfile patches update the affected transitive packages without changing the wallet or Token-2022 protocol major versions. All three clean lockfile installs passed. Existing production audit gates pass unchanged: app has zero high/critical and six moderate findings; workspace/backend have zero critical findings. The backend retains three propagated high findings from the upstream native `bigint-buffer` dependency, for which no official patched release exists; its SPL numeric inputs use bounded u64/u128 layouts. This finding is documented, not claimed fixed or suppressed. This remains a devnet/demo release rather than mainnet security certification.

Public technical logs are audited for credentials and normalized only for trailing whitespace and terminal carriage returns before publication; the recorded test results and binary/runtime JSON proofs are preserved.

## Published source and deployment identities

- Initial product source: [`e0e1edce2978ae8a717ef0b87d8683bddc296b19`](https://github.com/umutyesildal/basalt/commit/e0e1edce2978ae8a717ef0b87d8683bddc296b19). GitHub `main` matched this exact commit immediately after the push. The checksum correction does not change application code; the backend runtime correction below supersedes this initial backend source.
- Frontend deployment: `dpl_FNSeEzmNUyoK5DesY3jfcwnXmJAj`, built Ready with production settings and promoted to [the existing website](https://basalt.markets). Immutable build: `https://basalt-6fgnr8tir-yesildaladams-projects.vercel.app`.
- Initial VPS backend image: `sha256:9cadab9b63962240deda043935ae3d3c703a615d4b5de0c489c75455c861bd0f`. Source marker: `/opt/basalt/release-source-sha`. Backend recreated on 2026-10-03 at 11:03 UTC; its Docker healthcheck reports healthy.
- PostgreSQL and Caddy stayed running from their existing September 17 starts. Post-release row counts were 5 baskets, 40 whitelist entries, 17 holdings, 22,530 NAV snapshots and 39 events. NAV snapshots continue accumulating; the data was not reset.
- Backend cache is mounted read/write at `/app/.cache` from `deploy_backend_cache`. The two copied public snapshots retained their original SHA-256 digests and timestamps: 176 quote entries and 13 histories. Remote private environment files and database dumps remain on the server.

The exact commit was independently extracted with `git archive`. Fresh install, backend build, 807 backend tests, app typecheck and production app build passed. The 18 skipped tests require a test database; this run does not claim they executed. All 38 frontend traces and 87 JavaScript chunks were checked: no native `bigint-buffer` runtime reference. [Clean-build summary](assets/github-live-release-2026-10-03/clean-build.json).

## Live verification

The public API passed **35 read-only checks** on 2026-10-03 at 11:06 UTC: healthy database and running workers, 1,271 distinct issuer mints, 69 classified ETFs, exact AAPLx/SPYx/NVDAx identities, usable Jupiter quotes, real GeckoTerminal 7-day/30-day history and working CORS. Cached price, source and refresh timestamps exactly matched the verified seed and stayed unchanged across closed-session requests. The spot worker remained idle outside the chosen NYSE cash session. Historical reads remain available. A missing completed NVDA day produces a null return rather than a fabricated close. [API results and provenance](assets/github-live-release-2026-10-03/api-smoke.json).

The promoted public frontend was checked in the browser:

- The accepted calm hero, stock-basket wording and lower-page journeys are present. [Landing screenshot](assets/github-live-release-2026-10-03/live-home.png).
- Create opens directly on stock/ETF selection, displays the 1,271-asset catalog and defaults to 2% annual management fees. Its devnet entry is present. [Create screenshot](assets/github-live-release-2026-10-03/live-create.png).
- Compact stock cards show real token quotes without a per-card chart or market/cache text. [Stocks screenshot](assets/github-live-release-2026-10-03/live-stocks.png). The ETF page shows 69 ETFs.
- Apple detail renders the real 7D chart with eight daily closes and switches to 1M with 31 closes. [7D](assets/github-live-release-2026-10-03/live-aapl-7d.png), [1M](assets/github-live-release-2026-10-03/live-aapl-1m.png).
- The devnet workspace hydrates, exposes wallet connection/claim/create/mint/redeem controls, and reads the verified public basket directly from devnet: supply 1.7 shares, displayed vault balances 42.5 / 53.125 / 85 / 425. Disconnected economic controls stay disabled. [Devnet screenshot](assets/github-live-release-2026-10-03/live-devnet.png).
- The production local-lab fixture POST returns 404. Robots and sitemap use the public domain, not localhost.

No owner-wallet extension signature was performed during publication. The finalized shipped-builder proof remains the transaction evidence; the live checks above cover deployment, rendering, direct public RPC reads and API behavior.

## GitHub secret-scan correction

The released commit passed GitHub Rust, Node/build/test and dependency-audit jobs. The first secret-scan job reported one `generic-api-key` finding: the public SHA-256 for `programs/managed_basket/src/token.rs` in the historical evidence manifest. Independent hashing of both the named current source and the exact released commit matched the recorded value.

`.gitleaksignore` exempts only the immutable commit/path/rule/line fingerprint. No directory, rule or mutable-path exclusion is added. Official Gitleaks 8.24.3 reproduced one finding before that exact exception and zero afterward. A 757-file tracked-source scan found only the same known checksum; replacing the manifest value at the same path and line with a synthetic API-key-shaped value still triggered detection. [Commit scan](assets/github-live-release-2026-10-03/secret-scan-commit.json), [control scan](assets/github-live-release-2026-10-03/secret-scan-control.json). This is a documented checksum false positive, not a credential leak or disabled security gate.

The exact checksum correction was pushed as `3490a9e5405f54b8a9403fa036931fd3a2e8c866`. All four GitHub CI jobs passed: Rust, Node workspace, dependency audit and secret scan. [Successful CI](https://github.com/umutyesildal/basalt/actions/runs/37119074098). Application deployments remain tied to the product source above.

## Indexer reliability follow-up

The post-release operations check found real holdings and NAV updates: all 17 holdings rows refreshed after startup and eight new NAV snapshots appeared. Public devnet RPC rate limiting delays the sequential polling cadence. Historical event failures also exposed a missing recovery path: ten successful September 5–6 transactions for an existing devnet basket refer to a parent basket whose creation predates the newest 50 program signatures. The existing event foreign key rejects those orphan rows. This does not affect the new wallet UI basket or direct-RPC redemption.

The follow-up recovers only validated current-chain basket state before the foreign-key insert, using the actual onchain creation timestamp and immutable fields. It keeps the FK, avoids synthetic creation events and uses bounded RPC retries. The tested source and deployed recovery evidence are recorded below.

### Tested and published runtime correction

The indexer correction is pushed as [`8e49be05a2fe0bbe8534dcef43b849926e835f50`](https://github.com/umutyesildal/basalt/commit/8e49be05a2fe0bbe8534dcef43b849926e835f50). It changes only backend indexing/retry code and its tests. All GitHub CI jobs passed again: [runtime-fix CI](https://github.com/umutyesildal/basalt/actions/runs/37120353445). The Vercel frontend remains the verified `e0e1edc` application build because these backend modules are not frontend runtime imports.

- Missing basket parents are hydrated from their current Basket and canonical FactoryConfig accounts. Validation checks owner, discriminator, allocation, canonical PDAs/bumps, constituents, weights, fees, metadata and actual signed Clock timestamps. Nonces are exact decimal strings with an explicit PostgreSQL BIGINT boundary.
- The actual historical basket `CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo` passed this decoder: six constituents, nonce 1 and creation time `2026-09-04T19:42:25Z`. Recovery does not invent a creation event or increment a creator counter. [Public account proof](assets/github-live-release-2026-10-03/indexer-account-proof.json), [diagnosis](assets/github-live-release-2026-10-03/indexer-diagnosis.json).
- Runtime logs are attributed to configured program invocations. Event buffers commit only when the entire invocation ancestry succeeds; failed/caught CPI, foreign emitters and malformed/truncated frames cannot fabricate indexed activity. Trusted events from a shared transaction are processed together, so an earlier whitelist-address sweep does not hide factory/basket events.
- Transient missing transaction/account/RPC/DB reads remain retryable rather than being dropped after five polls. The retry ledger is bounded; capacity exhaustion is reported explicitly. Default web3 429 retries are disabled only where the shared bounded backoff already governs reads. Indexer reads are spaced 400 ms apart.

The final backend build passed; **865 tests passed, 18 database integration tests were skipped**. The 58 additional checks cover strict account validation, invocation/rollback attribution and recovery/retry/foreign-key behavior. Independent review passed and an actual public RPC fixture validated the compiled decoder. [Validation summary](assets/github-live-release-2026-10-03/indexer-validation.json), [build](assets/github-live-release-2026-10-03/indexer-build.txt), [tests](assets/github-live-release-2026-10-03/indexer-tests.txt).

The VPS image was rebuilt from an exact Git archive of this commit and replaced only the backend on 2026-10-03 at 11:41:49 UTC. Current image: `sha256:437a201ffb9e9bfa5b87737917e2467e97ae638f3e24703398c6b63e247240ce`. The source marker matches this commit. The earlier application image is retained as `deploy-backend:before-indexer-recovery-20261003`, with its source backup under `/opt/basalt/release-backups/20261003-indexer-recovery`. The original pre-release backup also remains. Health returned 200 with schema/DB/workers enabled immediately after the switch. Final recovery and fresh-log checks passed as recorded below.

### Final live result

The corrected backend passed **15 runtime checks and 35 public API checks**. The exact source/image match, Docker health is healthy with zero restarts, rollback material remains, and PostgreSQL now contains six baskets and 23 refreshed holdings. The missing historical basket retains its actual September 4 creation timestamp and all six constituents. All ten historical event rows and 20 position-ledger entries recovered; the recovered basket produced seven new NAV snapshots and the global worker produced 16 since the switch. New-container logs have no foreign-key failure, five-attempt drop, SDK retry spam, fatal error or state-sync failure. A few bounded public-RPC 429 notices remain; the retained retry completed recovery. [Runtime proof](assets/github-live-release-2026-10-03/postdeploy-runtime.json), [repeated API proof](assets/github-live-release-2026-10-03/postdeploy-api.json).

All 176 quote entries remain byte-for-byte identical to the original public seed, retaining every source timestamp while the NYSE spot-refresh session is closed. The persistent history volume holds 13 genuine same-mint normalized histories. Historical request handling legitimately refreshed provider retrieval times, and NVDA's same verified pool supplied its next completed UTC daily close. An initial combined checksum assertion incorrectly required history bytes to stay frozen as well; the final check distinguishes exact frozen quote retention from valid requested history refresh. Both the initial diagnostic and semantic comparison are retained, rather than presenting the first assertion as passed. [Initial diagnostic](assets/github-live-release-2026-10-03/initial-cache-diagnostic.json), [history comparison](assets/github-live-release-2026-10-03/history-cache-comparison.json).

Private sanitized server logs and database backups stay outside Git. Public runtime/API evidence was scanned for credentials before publication. [Public artifact manifest](assets/github-live-release-2026-10-03/postdeploy-artifact-manifest.json). The final documentation checkpoint does not require another application deployment; the website and backend source identities above remain exact.
