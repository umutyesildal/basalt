# Basalt documentation map

- [Live devnet release, 2026-10-09](devnet-live-release-2026-10-09.md): exact backend/Vercel identities, retained backup/candidate limitations, live evidence-collection progress, guarded financial projections and post-freeze SBF build proof.

- [Devnet data repair, 2026-10-09](devnet-data-repair-2026-10-09.md): bounded canonical evidence collection, shared RPC limits/verified optional holder provider, explicit price/position quality, host Rust remediation and frozen Vercel install source. Source preparation checkpoint; the live release record above supersedes its pending rollout/hosted-proof status.

- [Backend/devnet security remediation, 2026-10-09](backend-devnet-security-2026-10-09.md): all ten findings mapped to implemented controls, real database tests, devnet proof and approved recovery implementation; use the latest data-repair record above for current rollout status.

- [Approved ledger recovery implementation](ledger-recovery-2026-10-09.md): authenticated finalized snapshots, replay barriers, immutable backups and isolated PostgreSQL fault tests; no live activation.

Current wallet UX: [one-action devnet flow](devnet-single-pipeline-2026-10-03.md), including partial account-setup recovery and verification.

- [GitHub and live release, 2026-10-03](github-live-release-2026-10-03.md): source checkpoint, Vercel/VPS rollout, persistent public price history and live verification.

> **Current devnet wallet UI, 2026-10-03:** `/devnet` and `/create/onchain` now expose wallet-signed test-token claim, atomic basket creation, in-kind mint and redemption. The same four project-issued eight-decimal Token-2022 mocks, BSTESTA–D, back every new test basket; each basket gets its own share mint. `/create` offers **Try on devnet** and a shared preview offers **Create on devnet**. The funded, once-per-wallet faucet is `2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf`. Verified basket, supply, vault and wallet reads use direct devnet RPC, without a database or backend signer. [The wallet-flow record](devnet-ui-wallet-flow-2026-10-03.md) links the finalized claim and shipped UI-builder proof: **seven finalized transactions and 20 assertions**. Names and theses are browser-local, verified against the immutable onchain metadata hash. An owner extension-wallet signature was not performed; build and responsive checks are recorded separately. This supersedes earlier redirect-only and incomplete mock-UI statements. Official xStocks, mainnet and Managed V2 release boundaries remain unchanged. Source changes remain local and unpushed.

> **Current compact catalog and V0 admission update, 2026-10-03:** `/stocks` and `/etfs` use compact quote-only cards, with no per-card charts, 7D figures or history requests; the asset detail keeps its real exact-mint Bklit 7D/1M chart. [Catalog evidence](compact-asset-cards-2026-10-03.md). V0 source now validates Plain, DisplayOnly and the complete observed eight-extension issuer profile through one shared byte validator; inactive hooks, unpaused state, initialized public deposit accounts and fully validated TLVs are required. [Admission decision](xstocks-token-policy-decision-2026-10-03.md), [independent review and harness](xstocks-devnet-basket-proof-2026-10-03.md). This supersedes earlier blanket extension-rejection claims for current V0 source only. Redeem has no new policy gate; issuer pause, freeze, hook and delegate powers remain limitations. Managed V2 and public investing availability are unchanged. **All three current V0 binaries are byte-attested on devnet at finalized slot 506820772; fresh 3/4-asset full-profile mock proof passed (54 transactions, 28 assertions):** [completed runtime record](xstocks-devnet-runtime-2026-10-03.md). These are project-issued mocks, not funded official xStocks; mainnet AAPLx/SPYx fixtures establish parsing compatibility separately. Source changes remain local and unpushed.

> **Earlier chart and contract follow-up, 2026-10-03; catalog and admission scope superseded above:** At that revision, Stocks/ETF cards and asset details used real exact-mint Solana history with historical issuer multipliers, 7D/1M windows and Bklit plots. Visible market/cache labels and the price-source wall are removed; internal NYSE spot-refresh gating remains. Read [the chart record](xstocks-charts-2026-10-03.md) and [contract compatibility audit](xstocks-contract-compatibility-2026-10-03.md). The pre-change source rejected official xStocks extensions; historical devnet mock success did not attest that source. The current admission decision and runtime record above govern the later change. Final validation: 779 backend tests (18 DB skips), 39 frontend checks, 214 Rust library tests and both builds. This work remains local.

> **Current Create and price-cache follow-up, 2026-10-03:** Create opens directly on asset selection; fresh drafts recommend 2% annual management fees and sharing gives one-time success feedback. Public token quotes retain last-good provenance in a persisted cache. Refresh cadence is five minutes for the catalog and one minute for viewed assets, **only during the owner-selected NYSE cash session**. Outside it, retain last-known quotes internally and pause spot polling; the current UI omits market/cache labels. Read [the decisions, coverage and validation](create-price-cache-2026-10-03.md). This work remains local; the prior landing push is `7a16c18`.

- [Devnet wallet flow](devnet-ui-wallet-flow-2026-10-03.md): current `/devnet` and `/create/onchain`, fixed BSTESTA–D faucet and separately minted basket shares; finalized UI-builder proof, direct-RPC accounting and scoped browser/signing evidence.
- [Current xStocks integration](xstocks-integration-2026-10-03.md): official 1,271-asset Solana catalog, 69 verified ETF classifications, Jupiter V3 token prices, mint-bearing share links and scoped validation. Current local data work follows pushed landing commit `7a16c18`. [Research and official sources](xstocks-live-data-research-2026-10-03.md).

- [Current landing journeys](landing-journeys-2026-10-03.md): revised hero description, six benefit cards, creator section and investor/manager steps. The production build and recorded responsive/role checks passed; landing revision `7a16c18` is saved remotely. [3 October session](session-updates-2026-10-03.md).

- [Previous accepted hero restoration](home-hero-restoration-2026-10-02.md): calm centered stock-basket heading, gallery immediately below, lower `#build` future-fee visual, final production build and actual responsive screenshots.

- [Current basket-cover refresh](basket-cover-refresh-2026-10-02.md): six additional original collages, ten unique mapped covers, preserved four featured assets and recognized-preview identity. File/source checks, final production build and responsive image loading checks passed.

- [Earlier home/Create owner-feedback audit](home-create-feedback-2026-10-02.md): fee-first hero superseded by the final correction; catalog, exact removal/focus and grouped display/input improvements remain. Its 38-test/build evidence belongs to that freeze.

- [Current performance and product audit](product-performance-audit-2026-10-02.md): model prices, real-close weekly returns, ten-basket leaderboard, broader flow fixes and validation.

Previous landing follow-up, superseded for the opening/layout by the current audit: [Visual creation and future management fees](design-home-visual-creation-2026-10-02.md). The earlier discovery audit retains gallery/artwork evidence.

This directory contains Basalt's product, protocol, security, and operations documentation. The files serve different purposes; when they conflict, use the precedence below.

## Source precedence

1. `docs/basalt-v0-spec.md`, including its dated 2026-10-03 immutable-V0 admission erratum, defines normative protocol and product constraints. Managed V2 retains its separate policy.
2. Current evidence by scope: `current-state-2026-09-18.md` for the dated V0 deployment snapshot; `managed-basket-v2-prototype-status.md` for implemented V2; `landing-journeys-2026-10-03.md` and `session-updates-2026-10-03.md` for the accepted landing scope and recorded verification; `home-hero-restoration-2026-10-02.md` for the prior accepted opening/layout, `basket-cover-refresh-2026-10-02.md` for artwork, and `session-updates-2026-10-02.md` for the revision history; `home-create-feedback-2026-10-02.md` remains evidence for retained Create controls; earlier design/performance files remain evidence for their dated scope. A UI update does not refresh chain evidence.
3. `docs/implementation-backlog.md` — canonical operational work queue.
4. Topic plans — security, data integrity, product/UX, and testing/release.
5. Dated smoke/evidence files — evidence for their capture date, not current-state declarations.
6. `plan.md`, older UI plans, and hackathon submissions — historical context.

Basket counts, test counts, API versions, and deployment claims in older files are not automatically current. Check the current-state snapshot, then verify the running system and CI.

## Current document set

- [Compact asset cards](compact-asset-cards-2026-10-03.md): production UI verification, no catalog history requests and retained detail chart.
- [V0 issuer-profile admission decision](xstocks-token-policy-decision-2026-10-03.md): exact accepted extension profiles and issuer trust boundary.
- [Independent source review and basket proof harness](xstocks-devnet-basket-proof-2026-10-03.md): raw accounting, fee conservation, rollback checks and read-only default.
- [Completed devnet runtime evidence](xstocks-devnet-runtime-2026-10-03.md): three byte-attested upgraded programs and fresh three/four-asset full-profile mock proof. Real official funded transfers and mainnet release remain unverified.

| Document | Purpose |
|---|---|
| [basket-cover-refresh-2026-10-02.md](basket-cover-refresh-2026-10-02.md) | Ten distinct covers, exact prompt record, preserved originals and scoped verification |
| [landing-journeys-2026-10-03.md](landing-journeys-2026-10-03.md) | New landing benefits/role journeys, checkpoint boundary and recorded verification |
| [session-updates-2026-10-03.md](session-updates-2026-10-03.md) | Successful checkpoint and subsequent accepted landing revision |
| [home-hero-restoration-2026-10-02.md](home-hero-restoration-2026-10-02.md) | Previously accepted calm hero, gallery-first order and dated verification |
| [home-create-feedback-2026-10-02.md](home-create-feedback-2026-10-02.md) | Earlier fee-first hero superseded; retained Create catalog/removal/input behavior and dated 38-test evidence |
| [session-updates-2026-10-02.md](session-updates-2026-10-02.md) | Complete UI/copy update record, Copilot setup, file map, verification, and preserved work |
| [design-home-discovery-2026-10-02.md](design-home-discovery-2026-10-02.md) | Earlier discovery design, reference audit, performance findings and screenshots |
| [basket-cover-prompts-2026-10-02.md](basket-cover-prompts-2026-10-02.md) | Exact built-in image generation prompts for all ten original covers; the first four are preserved |
| [design-home-chapters-2026-10-02.md](design-home-chapters-2026-10-02.md) | Superseded chapter design and historical verification |
| [colosseum-comparison-2026-10-02.md](colosseum-comparison-2026-10-02.md) | Dated competitor research, primary sources, product comparison, and recommendations |
| [../handoff.md](../handoff.md) | Canonical checkout, current entry points, and working-tree preservation |
| [../brand.md](../brand.md) | Current brand, concise copy, and landing narrative |
| `managed-basket-v2-prototype-status.md` | Implemented localnet V2 scope and remaining gaps |
| `current-state-2026-09-18.md` | Historical V0 capabilities, deployment evidence, tests, and blockers |
| `architecture-current.md` | Implemented architecture, money flows, trust boundaries, and invariants |
| `implementation-backlog.md` | P0–P3 tasks, dependencies, and acceptance criteria |
| `mainnet-readiness-roadmap.md` | Ordered gates from devnet beta to controlled mainnet |
| `security-hardening-plan.md` | On-chain, Token-2022, Zap, and governance hardening |
| `data-integrity-and-demo-policy.md` | Live/demo/mock/simulated data rules and provenance |
| `product-ux-improvement-plan.md` | Onboarding, create, trading, charts, and accessibility |
| `testing-and-release-plan.md` | CI, test layers, release evidence, and rollback |
| `dependency-audit-2026-09-18.md` | Dated npm audit evidence, remediation, and accepted upstream risk |
| `deployment-attestation.md` | Deployment manifest generation, artifact hashes, and verification limits |
| `upgrade-governance-policy.md` | Target multisig/timelock policy, current authority disclosure, and completion evidence |
| `governance-ceremony-runbook.md` | Exact authorization, rehearsal, migration, abort, and evidence procedure |
| `devnet-governance-audit-2026-09-19.md` | Finalized RPC evidence for current program and whitelist authorities |
| `local-governance-rehearsal-2026-09-19.md` | Disposable localnet authority transfer, rejection, and rollback evidence |
| `bas-002-token2022-extension-policy.md` | Token-2022 admission policy, received-delta design, and extension compatibility |
| `fixtures/token2022-mainnet-xstocks-2026-09-18.json` | Point-in-time mainnet-beta Token-2022 evidence for TSLAx, AAPLx, and NVDAx |

## Update discipline

- Close a backlog item only after code, tests, documentation, and evidence are complete.
- Record an explicit spec erratum or decision before changing a protocol constraint.
- Treat test totals as dated snapshots generated from CI, never as permanent facts.
- Verify devnet/mainnet claims through a deployment manifest.
- Never present mock or simulated data as live backing, real AUM, or on-chain proof.

- [Indexed return integrity](indexed-basket-return-integrity.md): raw-share units, complete historical windows, derived-view upgrade and actual PostgreSQL verification.
