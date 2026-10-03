# GitHub and live release, 2026-10-03

Status: release preparation in progress. The owner explicitly requested pushing the latest project to GitHub, verifying it, and updating both the existing Vercel frontend and VPS backend. Final commit, deployment identities and live checks are appended after publication.

## Existing targets

- Repository: `https://github.com/umutyesildal/basalt`, branch `main`.
- Website: `https://basalt-coral.vercel.app`, existing Vercel project `basalt`.
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
