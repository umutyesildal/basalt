# Basalt — xStocks Strategy Baskets on Solana

> **Current devnet data repair, 2026-10-09:** The previous security/readiness website and backend release is already live. The newly tested `codex/devnet-data-repair` source separates canonical fact collection from financial application, bounds shared RPC reads, supports an optional verified holder provider and shows explicit position/price quality. This follow-up rollout and its hosted Vercel build proof remain pending; earlier rollout-pending statements below describe the previous checkpoint. No historical projection activation or chain change is claimed. See [current behavior, tests and remaining release gates](docs/devnet-data-repair-2026-10-09.md).

> **Backend/devnet security continuation, 2026-10-09:** `codex/backend-devnet-security` implements fail-closed auth/resource controls, canonical event identity, atomic position effects, restart-safe finalized history, authenticated holdings/complete valuations and dependency gates from the 4 October audit. The explicitly approved recovery source now verifies finalized holders, preserves immutable backups and publishes positions atomically; production activation remains an independent operator action. Old records are retained and unresolved values excluded. Live key retirement, governance and rollout remain open. See [implementation, tests, evidence and operator steps](docs/backend-devnet-security-2026-10-09.md).

> **GitHub and live release, 2026-10-03:** The owner authorized the full latest source checkpoint and updates to the existing Vercel frontend and VPS backend. The release includes the four-mock wallet workspace, production dependency remediation and persistent quote/history storage. Read [the release record](docs/github-live-release-2026-10-03.md) for exact source/deployment identities, backups, final live checks and remaining scoped limitations. Dated local-only notes below describe earlier checkpoints.

> **Current devnet wallet UI, 2026-10-03:** `/devnet` and `/create/onchain` now expose wallet-signed test-token claim, atomic basket creation, in-kind mint and redemption. The same four project-issued eight-decimal Token-2022 mocks, BSTESTA–D, back every new test basket; each basket gets its own share mint. `/create` offers **Try on devnet** and a shared preview offers **Create on devnet**. The funded, once-per-wallet faucet is `2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf`. Verified basket, supply, vault and wallet reads use direct devnet RPC, without a database or backend signer. [The wallet-flow record](docs/devnet-ui-wallet-flow-2026-10-03.md) links the finalized claim and shipped UI-builder proof: **seven finalized transactions and 20 assertions**. Names and theses are browser-local, verified against the immutable onchain metadata hash. An owner extension-wallet signature was not performed; build and responsive checks are recorded separately. This supersedes earlier redirect-only and incomplete mock-UI statements. Official xStocks, mainnet and Managed V2 release boundaries remain unchanged. Source changes remain local and unpushed.

> **Current compact catalog and V0 admission update, 2026-10-03:** `/stocks` and `/etfs` use compact quote-only cards, with no per-card charts, 7D figures or history requests; the asset detail keeps its real exact-mint Bklit 7D/1M chart. [Catalog evidence](docs/compact-asset-cards-2026-10-03.md). V0 source now validates Plain, DisplayOnly and the complete observed eight-extension issuer profile through one shared byte validator; inactive hooks, unpaused state, initialized public deposit accounts and fully validated TLVs are required. [Admission decision](docs/xstocks-token-policy-decision-2026-10-03.md), [independent review and harness](docs/xstocks-devnet-basket-proof-2026-10-03.md). This supersedes earlier blanket extension-rejection claims for current V0 source only. Redeem has no new policy gate; issuer pause, freeze, hook and delegate powers remain limitations. Managed V2 and public investing availability are unchanged. **All three current V0 binaries are byte-attested on devnet at finalized slot 506820772; fresh 3/4-asset full-profile mock proof passed (54 transactions, 28 assertions):** [completed runtime record](docs/xstocks-devnet-runtime-2026-10-03.md). These are project-issued mocks, not funded official xStocks; mainnet AAPLx/SPYx fixtures establish parsing compatibility separately. Source changes remain local and unpushed.

> **Earlier chart and contract follow-up, 2026-10-03; catalog and admission scope superseded above:** At that revision, Stocks/ETF cards and asset details used real exact-mint Solana history with historical issuer multipliers, 7D/1M windows and Bklit plots. Visible market/cache labels and the price-source wall are removed; internal NYSE spot-refresh gating remains. Read [the chart record](docs/xstocks-charts-2026-10-03.md) and [contract compatibility audit](docs/xstocks-contract-compatibility-2026-10-03.md). The pre-change source rejected official xStocks extensions; historical devnet mock success did not attest that source. The current admission decision and runtime record above govern the later change. Final validation: 779 backend tests (18 DB skips), 39 frontend checks, 214 Rust library tests and both builds. This work remains local.

> **Current Create and price-cache follow-up, 2026-10-03:** Create opens directly on asset selection; fresh drafts recommend 2% annual management fees and sharing gives one-time success feedback. Public token quotes retain last-good provenance in a persisted cache. Refresh cadence is five minutes for the catalog and one minute for viewed assets, **only during the owner-selected NYSE cash session**. Outside it, retain last-known quotes internally and pause spot polling; the current UI omits market/cache labels. Read [the decisions, coverage and validation](docs/create-price-cache-2026-10-03.md). This work remains local; the prior landing push is `7a16c18`.

> **Current data integration, 2026-10-03:** Official Solana xStocks discovery now covers 1,271 issuer assets, with 69 verified ETF classifications and nullable Jupiter V3 token quotes. Read [the implementation and validation record](docs/xstocks-integration-2026-10-03.md) for metadata/price provenance, scaled units, mint-bearing shared links and remaining release gates. Landing commit `7a16c18` is pushed; these xStocks changes remain local. Public read-only data does not enable investing or whitelist admission.

> **Latest landing revision, 2026-10-03, source and build verified:** Keep the calm stock-basket hero and four featured cards; use **Or create one that fits your needs.** Remove the home status and home-only methodology/source note, retaining card **Model price** labels. Gallery → six benefits → `#build` creator/fee visual → `#how-it-works` investor/manager journeys. The accepted landing revision was subsequently pushed as `7a16c18` to `origin/main`. Read [the landing scope](docs/landing-journeys-2026-10-03.md) and [3 October session](docs/session-updates-2026-10-03.md). The production build and recorded responsive/role checks passed; earlier records retain their dated scope.

> **Previous accepted restoration, 2026-10-02; composition superseded by the 3 October scope:** The calm centered hero is restored: **“Find a stock basket / you believe in.”** The **Different takes.** gallery follows immediately. **Good stock picks can come from anyone.**, conditional future management fees and the annual-cap/90/10 fee-share visual now sit in the lower `#build` section. This supersedes the fee-first hero below. All ten unique covers and the Create catalog, weight-removal, focus and grouped-input improvements remain. Read [the final hero restoration](docs/home-hero-restoration-2026-10-02.md) and [cover refresh](docs/basket-cover-refresh-2026-10-02.md) for the final passing build, responsive browser checks and durable screenshots. The earlier 38-test run was not rerun; public investing and fee revenue remain unavailable.

> **Previous fee-first interpretation, superseded for hero/layout, 2026-10-02:** At that revision, the opening said **“Create stock baskets. Earn management fees.”** and places the annual-rate cap and 90/10 fee-share visual beside the hero copy. The adjacent status states that investing and fees remain in development. The lower “Good stock picks” invitation stays compact. Public Create exposes all 41 catalog assets with an end-aware clickable fade, supports weight-row removal with exact positive 10,000-bps redistribution and a two-stock progression guard, and preserves focus and grouped amount editing. USD/count/percentage displays use shared comma grouping. Read [the current home/Create audit](docs/home-create-feedback-2026-10-02.md) for the five requests, precise fee meaning, final 38-test/build evidence and browser checks. That hero placement is superseded by the final owner correction above; the Create improvements and their dated verification remain valid.

> **2026-10-02 performance update:** Model prices, seven-day returns and a ten-basket leaderboard now connect the public discovery flow. The broader audit also fixes indexed return calculations and Create usability. Read [the current audit and evidence](docs/product-performance-audit-2026-10-02.md). This is local uncommitted work; investing availability is unchanged.

> **Previous visual-creation handoff, superseded by the owner-feedback audit, 2026-10-02:** The landing uses a calm hero and four named basket cards, followed by one visual creator invitation: stock picks become a basket others can back, with a compact future management-fee split and a direct create CTA. The repeated text steps and final CTA block are removed; xStocks and fee details remain in native disclosures. Native vertical scrolling replaces the earlier three full-screen demos. Feed pairs short viewpoints with visual basket cards; Managers pairs people with their baskets. Start with the [current design audit](docs/design-home-visual-creation-2026-10-02.md) and [session record](docs/session-updates-2026-10-02.md). Public Create shares basket ideas; investing remains in development. The visual follow-up passed production build, TypeScript and responsive browser checks; exact fee-chart geometry and screenshots are recorded in the audit. This is a working-tree UI update, not a new chain deployment.

> **2026-09-25 handoff:** Managed Basket V2 code is merged into canonical `main` (`3eeb7be`). `/managed` is a simulated public explainer; `/managed/lab` is a loopback localnet transaction prototype. V2 is not publicly deployed, and creator fees, live xStocks, and extension-wallet signing remain unverified or unimplemented. Start with `AGENTS.md` and `handoff.md`, then `docs/managed-basket-v2-prototype-status.md` and `docs/managed-basket-v2-wallet-lab.md`. Earlier test counts below are dated V0/concept snapshots.

> "Build your basket idea. Share your thesis." A wallet-free basket builder and discovery experience.
> V0 spec: `docs/basalt-v0-spec.md` (normative product constraints). Documentation map: `docs/README.md`. Current backlog: `docs/implementation-backlog.md`. Brand: `brand.md`.
> Current state: **The public first-run flow builds and shares a wallet-free basket idea, with an optional real devnet test.** `/devnet` and `/create/onchain` connect a wallet, claim the fixed BSTESTA–D mock pack, create a separately tokenized basket, mint additional shares and redeem through direct RPC. These are project-issued test assets with no market value; official xStocks investing and mainnet access remain unavailable. [The devnet wallet-flow record](docs/devnet-ui-wallet-flow-2026-10-03.md) distinguishes finalized UI-builder proof from browser and extension-wallet verification. The dated 2026-09-19 verification snapshot recorded 208 Rust + 596 backend tests and a 21-route build; the 2026-09-24 concept release built 23 routes and passed its app typecheck and concept integrity test. A 2026-09-19 RPC audit confirms that program upgrade and whitelist authorities remain one wallet; no multisig or time lock is active. Full snapshot: `docs/current-state-2026-09-18.md`; governance evidence: `docs/devnet-governance-audit-2026-09-19.md`.
> **Won: Superteam Germany "Road to Colosseum" Ideathon (2026-09-14)** — top-10 of 38 submissions, $3k USDG pool. Submission: `docs/ideathon-submission-2026-09.md`. Live demo: https://basalt-coral.vercel.app/explore. Current implementation order: `docs/implementation-backlog.md`.

## Try the devnet wallet flow

Run the frontend with `NEXT_PUBLIC_CLUSTER=devnet` and a devnet RPC, then open `/devnet` or `/create/onchain`. Connect Phantom or Solflare, add devnet SOL for fees and account rent, and choose **Get test tokens** once per wallet. Set four positive allocations totaling 100%, create your test basket, then mint or redeem its shares. Create uses the four fixed BSTESTA–D mints; it does not acquire the stock assets in a shared concept preview. Names and theses remain in the browser and are displayed only after the saved JSON matches the onchain hash.

The funded faucet and transaction workspace operate without the local indexer or PostgreSQL. A later read-only check can open the [finalized proof basket](https://explorer.solana.com/address/9PoTEPsCjew9NtYA9MLTjDapMsW1ZdW4dgokdGzmPimB?cluster=devnet). For the exact backing identities, tests, transaction evidence and remaining release boundaries, read [the wallet-flow record](docs/devnet-ui-wallet-flow-2026-10-03.md).

## Verification commands

```bash
cargo test                                  # 208 Rust tests
npm --prefix backend install                # once (backend has its own lockfile)
npm --prefix backend run build              # strict NodeNext, no suppressions
npm --prefix backend test -- --run          # 596 TS tests in the 2026-09-19 working tree
(cd app && npx tsc --noEmit --incremental false)   # 0 errors
npm --prefix app run build                  # passed on 2026-10-02; 25 static pages generated
(cd app && npx tsx --test tests/*.test.ts) # concept preview and sample integrity
```

## Devnet live (historical flow proof from 2026-09-04)

- Deployed at declared IDs: `whitelist` `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS`, `basket_factory` `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF`, `basket` `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k`. A finalized read-only RPC audit on 2026-09-19 reconfirmed all three accounts and their shared single-key upgrade authority; see `docs/devnet-governance-audit-2026-09-19.md`.
- Historical 2026-09-04 devnet evidence records 12 mock xStocks and one live basket (the then-deployed mocks used `ScaledUiAmountConfig` multiplier 1.0). That historical proof and the subsequent extension-free BAS-002 boundary predate the 2026-10-03 admission change. The new isolated setup reproduces all eight observed mint extensions with explicit project-issued devnet mocks; current deployment and runtime evidence are tracked separately in `docs/xstocks-devnet-runtime-2026-10-03.md`. The recorded basket lifecycle still reconciles exactly (38 confirmed transactions; see `docs/devnet-live-2026-09-04.md`).
- Transaction-size limit (resolved): `create_basket` / `mint_in_kind` / `redeem_in_kind` compile offline to v0 messages ≤ 1232 B for n = 2..10 constituents; n ≥ 4 routes through one address-lookup table. Proof: `npm run proof:txsize` (`scripts/checkTxSize.ts`).

Run the backend against devnet:

```bash
cp backend/.env.devnet.example backend/.env.devnet
cd backend && set -a && . ./.env.devnet && set +a
# Local-only opt-in: process-random auth secret, invalidated on restart.
SOCIAL_AUTH_ALLOW_DEV_SECRET=1 npx tsx src/index.ts
```

Full evidence pack — signature tables, address tables, reconciliation, reproduction steps: `docs/devnet-live-2026-09-04.md`.

## Stack

- **Solana programs (Anchor 0.30, real Token-2022 CPI):** `whitelist` (exact Token-2022 ownership + decimals + shared fail-closed Plain/DisplayOnly/IssuerControlled validation), `basket_factory` (atomic seed transfers with exact raw deltas, genesis 1M with temp-mint-authority handoff), `basket` (real `transfer_checked`/`burn`/`mint_to`; `redeem_in_kind` permissionless + oracle-free, structurally tested)
- **Backend:** Node 20 + TypeScript (strict) + PostgreSQL + optional Redis — real indexer (Anchor event decode), holdings sync with ScaledUiAmount multiplier, exact BigInt fixed-point NAV engine, REST API with `source`/`asOf` provenance on every row; backend never signs
- **Frontend:** Next.js 15 + Tailwind 3.4 + **bklit UI** (registry provenance verified; Brush = documented local adapter) + wallet-adapter (Phantom/Solflare, full state machine) — brand per `brand.md` (monochrome base + BASALT MARK, Chakra Petch display — 2026-09-12 identity update)
- **Token:** SPL Token-2022 — raw transfers on-chain, `scaled = raw × multiplier` for display/NAV

## Programs

| Program | ID (localnet/devnet) | State |
|---------|----------------------|-------|
| `whitelist` | `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS` | Current source verifies exact Token-2022 ownership, decimals and complete allowed extension profiles; deployment proof is tracked separately |
| `basket_factory` | `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF` | Real; full §3.2 validations, atomic seed, genesis mint, real `vault_bump` |
| `basket` | `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k` | Real; `mint_in_kind` (4n remaining-accounts contract, pause-gated), `redeem_in_kind` (3n, never gated), `accrue_management_fee` |

See `docs/basalt-v0-spec.md` §2-6 for account model, instruction args, mint/redeem math, fee math. Client instruction builders live in `app/lib/transactions.ts` + `app/lib/create-basket.ts` (mirrored from program source, discriminators cross-verified).

## Token-2022 Accounting

- On-chain: **raw** (`transfer_checked` with decimals; `// RAW ONLY` on every CPI site)
- Off-chain: `scaled = raw × multiplier` (the indexer is ScaledUiAmount-aware); the isolated new devnet mocks reproduce the observed issuer extension profile. Mainnet AAPLx/SPYx byte fixtures prove parsing compatibility, not live backing, whitelist admission or public investing. Amounts crossing module boundaries travel as decimal strings (BigInt-exact).

## Backend (real)

Indexer listens for `BasketCreated/Minted/Redeemed/FeeAccrued` (Borsh decoders), upserts `baskets`/`events`/`creator_stats`, syncs `vault_holdings` (raw + multiplier + scaled), NAV engine snapshots `nav_snapshots` + refreshes `basket_rankings`, fee crank emits **unsigned** `accrue_management_fee` transactions. REST `/api/v1` implements the spec §8-9 routes with honest empty/error states (`NOT_INDEXED`, `DB_UNAVAILABLE`, `QUOTE_UNAVAILABLE`) — no fabricated production-looking data. Zap quotes proxy Jupiter; provenance + sequential/non-atomic warning included.

## Frontend (current public experience and retained transaction surfaces)

Current route map, updated 2026-10-03:

- `/` Home, accepted revision: centered stock-basket hero and four featured cards, six benefit cards, `#build` creator/future-fee visual, then `#how-it-works` investor and manager journeys. The home status and landing methodology/source note are removed; individual Model price labels and bottom issuer/fee disclosures remain.
- `/stocks`: compact searchable official asset cards with real nullable token quotes. No inline chart or historical request. `/stock/[ticker]` keeps the real exact-mint Bklit 7D/1M chart.
- `/etfs`: the same compact catalog filtered to verified ETF classifications, with search, pagination and clickable asset details.
- `/explore` — always-available concept basket gallery above a separate indexed devnet basket section
- `/create` — wallet-free basket idea builder: pick assets from an empty selection, set the mix, choose an illustrative $10/$100/$1,000 amount, review the 2% recommended annual management fee, and create a shareable preview
- `/preview?d=...` — versioned, validated URL with only basket name, optional thesis, symbols, weights, example amount, and fees; no account or backend storage
- `/create/onchain`: redirects to `/create`; the earlier transaction wizard remains retained source, not an exposed route.
- `/basket/[pubkey]` + buy/redeem — transaction surfaces; `/portfolio`, `/creator/[pubkey]`, `/legal`

Design language: the **BASALT identity** — hexagonal-column mark, dark industrial canvas, disciplined electric-yellow accent, Chakra Petch display, and Geist Mono labels — with chart-only data colors. No site footer; `LEGAL_REVIEW_REQUIRED` remains in the create disclosure and `/legal` until counsel replaces placeholder copy. Charts use locally vendored Bklit-derived sources; Brush is a documented local adapter.

## Basket sharing and social

The basket gallery, feed, and manager discovery share one sample dataset. Repeated concept badges and the landing status were removed by owner decision; accurate action labels and scoped disclosures distinguish sharing from investment. Sample basket ideas and activity are illustrative, with no invented onchain trades, balances, or returns. Separate onchain sections use indexed devnet activity; wallet-authenticated following and social writes remain available there. Creator fee shares can accrue only for a separately deployed basket when protocol fees are generated (V0 split: 90% creator, 10% treasury). Concept previews and follows generate no fees. The underlying social backend also supports:

- **Thesis posts** — trade-linked reasoning attached to a basket; the on-chain outcome stays attached for free
- **Social profiles** — optional handle/avatar/bio over a wallet pubkey (`profiles`), follow/unfollow, per-wallet equity curve (`user_value_snapshots`, ~5m snapshotter)
- **Privacy** — trades are public by default (the chain is public anyway); `is_public=false` hides a wallet from feed + leaderboard
- **Auth** — wallet-signature only (SIWS-lite: `POST /auth/nonce` → sign → `/auth/verify` → bearer token); it gates **social writes only** — the backend remains read-only/non-custodial for everything else and still never signs transactions
- **No auto-copy** (deliberate) — copying is "Clone this basket" into the create wizard (regulatory + latency reasons); feed refreshes by 30s polling

## Security

See spec §11, `docs/current-state-2026-09-18.md`, and `docs/security-hardening-plan.md`. Key invariants: `redeem_in_kind` is never gated (no whitelist/oracle/pauser account in its context; structural test), no `admin_withdraw`, RAW-only transfers, fee caps + canonical protocol-wide 90/10 split (creator floor, treasury remainder), and genesis 1M inflation-attack protection. Run `cargo test` plus independent security review before mainnet.

## Legal Placeholders

UI chips were removed at the owner's request (2026-09-03); the review items live in the backlog and the wizard's legal-checkbox step + `/legal` page remain. Never describe Basalt as an ETF/fund; voice rules in `brand.md`. Counsel review required before mainnet.

## Local dev demo data

For local (non-devnet) development, `demo-seed` seeds the local Postgres so pages render with content: 4 whitelisted mock xStocks (TSLAx/AAPLx/NVDAx/SPYx from `docs/providers.md`) and two demo baskets (**Tech Duo** 50/50 AAPLx-TSLAx, **Index Plus** 60/25/15 SPYx-NVDAx-AAPLx) with 30d NAV history (`demo-seed` source marker). Dev-only — drop or re-seed freely. When the backend runs against devnet instead, pages serve on-chain-indexed data (see "Devnet live" above) and the seed is unnecessary.

## Current work

Use the current scope/evidence links above for this revision, `docs/current-state-2026-09-18.md` for its historical snapshot and `docs/implementation-backlog.md` for implementation order. BAS-002 now has reviewed source support for fully validated allowed profiles, including the complete observed issuer profile with inactive hooks. Exact raw seed/mint deltas remain required. Current-SBF devnet deployment/runtime evidence is tracked separately and mainnet mint admission is not implied. BAS-003 Zap-in delta accounting and BAS-004 checked arithmetic are complete in the working tree. BAS-006 now has a canonical 2-of-3 target in `docs/upgrade-governance-policy.md`; the fresh 2026-09-19 RPC evidence confirms the current single-key blocker, while the real multisig/time-lock activation and authority transfer remain open. Instruction-level coverage under BAS-016, deployed-ELF attestation, data-truth, and legal gates also remain open before an independent audit and any mainnet decision. `plan.md` is retained as the historical implementation-wave log.

## Scripts

- `scripts/e2e.sh` — deterministic localnet flow (validator → whitelist → basket → mint/redeem → fee crank)
- `scripts/rehearse-governance-localnet.sh` — loopback-only authority-transfer and rollback rehearsal; it is not evidence of a production multisig
- Devnet E2E — the same four scripts (`scripts/createWhitelist.ts` → `createBasket.ts` → `mintAndRedeem.ts` → `accrueFee.ts`) run against devnet via `BASALT_E2E_*` env vars; state + logs + evidence collector in `scripts/.e2e-devnet/` (reproduction commands in `docs/devnet-live-2026-09-04.md` §8)

---

Generated from the historically named `foliox_build_prompt.md` via solana.new superstack skills (`scaffold-project`, `build-defi-protocol`, `cso`, `brand-design`) + orchestrated implementation waves (2026-09-01).
