# Basalt Implementation Plan

## 2026-09-22 — Product, UX, and launch video correction plan

### 2026-09-23 owner decision on creating a basket

The original work sequence below identified real defects but treated the six-step wizard as fixed. The product flow is now four user tasks: **Choose** (name, thesis, eligible assets), **Set up** (allocation and optional fees), **Start** (the tokens deposited into the vault), and **Review** (immutable terms, risks, required legal acknowledgments, then wallet connection and signing). The final review is reachable while disconnected. Default fees are zero; there is no prefilled $1,000 deposit. A reference-USD helper may calculate token amounts only after the user chooses a target value, and each token amount remains editable. Current devnet uses mock mints and reference prices, never a live equity purchase.

The 2026-09-23 content-density review keeps this four-task structure and removes repeated copy: the active step has one heading; optional fees and the USD calculator open on demand; zero-fee examples do not repeat zero; legal acknowledgments remain required but their full explanations are expandable. Review shows the actual one basket share minted at genesis (1,000,000 base units with six decimals), not a million display shares. Devnet/mock status and the metadata publication gap remain visible. The app must distinguish oracle-free on-chain redemption from any indexed data that its current preview still needs.

Keep packet size, address lookup tables, bps, raw token amounts, and account addresses out of the main decision flow. If a larger basket requires extra wallet setup, explain that consequence at deployment without byte counts. Preserve exact 10,000-bps allocation, program fee caps, atomic per-token seed, immutable metadata hash, required legal checks, and all existing on-chain validation. The name/thesis JSON is currently hashed locally but not published to retrievable storage; tell creators that public display may fall back to an address and track metadata publishing as an open product limitation. Render the launch video only after the four-task UI and docs are verified.

**Decision:** Improve the real Basalt product experience and its source documents first, then regenerate the launch video from the updated `main` app. The previous FolioX video was made from the stale `master` scaffold and is not evidence of the current Basalt product. This section is the next UX work package; the older material below remains historical. `docs/implementation-backlog.md` remains the operational queue and `docs/basalt-v0-spec.md` remains the protocol constraint.

### Goal and scope

Make the first basket journey understandable without protocol vocabulary: choose a basket idea, allocate 100%, see the actual amount and fees, review, then deploy. Make basket detail answer what the basket contains, what it costs, and what action the user can take. Present redemption as receiving underlying assets for burned shares, with the real exit fee disclosed plainly. Use the Basalt name, mark, and electric yellow consistently. Preserve the on-chain rules and honest devnet/mock disclosures.

### Observed in current `main` at `8d4a5f9`

- Basalt naming and the yellow token already exist (`brand.md`, `docs/design-basalt-v1.md`, `app/app/globals.css`). This is a targeted consistency and hierarchy pass, not a rebrand from scratch. Older brand sections still contain superseded white/Geist and branch-specific language; reconcile them with the current Basalt identity when the docs are edited.
- The six-step create wizard works, has templates, sliders, a live preview, and wallet transactions. Yet `app/components/create/weights-editor.tsx` shows `10,000 bps`, raw bps inputs, “Normalize to 10,000,” and “MarketCap-ish”; `app/components/create/fees-editor.tsx` leads with bps. The create route blocks `Next` until a wallet connects, even before review (`app/app/create/create-client.tsx`), which is already tracked as BAS-023.
- Basket detail has About/History/Risk/Thesis tabs and a trade rail. The About tab adds a technical holdings table with raw/scaled units, addresses, and fee arithmetic to the initial decision view (`app/components/basket/basket-page-about.tsx`). The trade rail puts a permissionless/oracle-free implementation sentence in prominent product copy.
- The redeem route shows a real exit fee; “oracle-free” is a property of the protocol, not an extra “oracle fee.” No literal “Redeem oracle fee” label was found in current `main`. The video wording and current UI copy need separate review.

### Work sequence

1. **Source truth and content map.** Start from the `main` worktree and reconcile `brand.md`, `docs/design-basalt-v1.md`, `docs/product-ux-improvement-plan.md`, and `docs/implementation-backlog.md` with the approved UX. Use Basalt consistently in new user-facing copy. Keep historical FolioX filenames and dated evidence explicitly historical. Preserve `LEGAL_REVIEW_REQUIRED` and the documented legal vocabulary.
2. **Create flow.** Prototype a simpler selection-to-review journey on desktop and mobile. Show weights and their sum as percentages (`100%`); keep exact integer bps only in state, metadata, and transaction construction. Convert at the UI boundary, define rounding so displayed allocations and committed bps match, and retain the 10,000-bps program validation. Replace “Normalize to 10,000” with a plain `Balance to 100%` action; remove or properly explain “MarketCap-ish.” Display fee inputs as `1%`, `0.5%`, `2%/year` with caps in percentages. Let users reach review before wallet connection (BAS-023). Make seed amounts human-readable and verify raw conversion and balances at deploy (BAS-024). Keep templates, clone behavior, active whitelist, 2–20 assets, fee caps, immutable metadata, and legal acknowledgments.
3. **Basket detail.** Put basket name/thesis, understandable allocation, price/performance with source and timestamp, fees, risk, and buy/redeem actions in a clear reading order. Collapse raw amounts, mint addresses, drift arithmetic, management-fee formulas, and operator controls into clearly labeled advanced details. Keep all underlying data accessible and truthful; avoid implying mock devnet assets are issuer-backed xStocks.
4. **Redeem and fee language.** Explain in ordinary terms: the user gives up basket shares and receives proportional underlying tokens, less the disclosed exit fee in shares. Show an exact preview, token quantities, and transaction consequences before signing. Keep “permissionless/oracle-free” in advanced protocol information. Never label an oracle fee where none exists; never introduce an oracle gate. Review buy and redeem copy together so entry, exit, and annual fees are distinct.
5. **Brand and visual pass.** Apply the existing Basalt mark, dark canvas, Chakra Petch/Geist Mono hierarchy, and `#FCEE0A` to primary actions, focus, and key states in create/detail/redeem. Check contrast, mobile touch targets, and loading/error/empty states. Keep chart colors for data and do not manufacture NAV, holdings, or performance.
6. **Verification, then video.** Walk a new user through selection, allocations, review, wallet connection, deploy, basket detail, buy, and redeem on desktop and mobile. Test exact percent↔bps conversion, fee display, wallet-late validation, and existing transaction boundaries; run relevant app typecheck/build and tests for touched behavior. Only after the real app and docs agree, rerun `brag` against the canonical Basalt `main` app. Inspect rendered frames and copy: Basalt name, yellow accent, percentage allocations, concise detail, honest devnet/demo labels, and no invented oracle fee.

### Acceptance gates

- A first-time user can explain the create flow and the difference between entry, exit, and annual fees without seeing bps; the UI shows allocations totaling `100%` while the submitted transaction still totals 10,000 bps exactly.
- Review is reachable without a wallet; signing is required only for the actual deploy/transaction. A failed or unavailable data source does not silently become a fabricated value.
- Basket detail’s first view prioritizes composition, costs, risks, and action; technical values remain discoverable. Redeem preview matches the protocol’s pro-rata and fee math.
- User-facing pages and the final video say Basalt, follow its yellow identity, and describe devnet/mock assets accurately. No protocol invariant, legal disclosure, or current governance limitation is hidden by the redesign.

> Owner: coordinator (Codex) | Workspace: `createyouretf` | Last reviewed: 2026-09-18
> Current phase: working devnet beta; P0 economic, Token-2022, data-truth, governance, and release hardening are tracked in `docs/implementation-backlog.md`.
> Normative product constraints remain in `docs/basalt-v0-spec.md` and `AGENTS.md`.

## 0. Purpose and source of truth

This is the historical execution plan that took Basalt from a scaffold/prototype to a working devnet beta. It covers protocol correctness, backend data, wallet flows, Bklit-derived UI, legal copy, accessibility, responsive behavior, and agent coordination. Use `docs/implementation-backlog.md` for current implementation order.

Use the documents in this order:

1. `AGENTS.md` — hard constraints and agent workflow.
2. `docs/basalt-v0-spec.md` — product, account, math, API, security, legal, and milestone specification.
3. `docs/current-state-2026-09-18.md` — dated verified implementation and deployment snapshot.
4. `docs/implementation-backlog.md` — current ordered work, dependencies, and acceptance gates.
5. `plan.md` — historical execution decisions and wave log.
6. `README.md` and `app/README.md` — operator-facing quick start and status only.

`foliox_build_prompt.md` is the original product prompt under its historical filename. Do not silently weaken a constraint in the prompt or spec to make a demo easier.

## 1. Product guardrails

Basalt is an onchain strategy-basket application backed by Token-2022 xStocks. It is not described as a registered ETF, fund, guaranteed return, safe investment, or financial advice. `LEGAL_REVIEW_REQUIRED` remains visible anywhere legal or risk language appears until counsel replaces the placeholders.

The following are non-negotiable in every phase:

- Baskets are immutable after deployment: constituents, weights, creator, metadata hash, and fee schedule do not change.
- `redeem_in_kind` is permissionless, oracle-free, and never gated by whitelist pause, backend availability, or an oracle.
- There is no leverage, lending, derivatives, rebasing, active rebalancing, or pooled off-chain custody.
- Backend/indexer services never hold signing keys or custody user assets.
- On-chain transfers use raw Token-2022 amounts and checked decimals. Scaled UI Amount multipliers are used only for display/NAV accounting off-chain.
- Jupiter is periphery in V0. In-kind mint/redeem remains the core path; sequential zap atomicity and slippage limitations are disclosed.
- Fees remain capped at entry 300 bps, exit 100 bps, and management 300 bps/year, with the documented 90/10 creator/treasury split.

## 2. Verified baseline

The new Orca discovery run is `run_b38cb1bbcd0c`. Three fresh, read-only workers completed successfully:

- UI audit: landing, explore, basket detail, create, providers, and stock have local Card/Badge/Table and local chart APIs; buy, redeem, portfolio, and legal remain scaffolds. Creator and explore loading routes are missing. Accessibility, responsive navigation, truthful data states, and native controls need work.
- Design audit: use a dark-native quiet research terminal direction — Workstation Dense information architecture with Warm Monochrome restraint. Remove decorative neon, gradients, faux browser chrome, marquee tickers, blanket pills, duplicate desktop card/table views, and unsupported performance language.
- Readiness audit: all project files are currently untracked in Git, so prior worker changes cannot be isolated by commit. The app build passes only because Next ignores build/type errors; strict app TypeScript fails. Backend build fails NodeNext/implicit-any errors. Backend tests pass 286; the root legacy test adds 1, for 287 TypeScript tests total.

The current baseline is not localnet-ready or production-ready even though older notes say so. Protocol instructions still contain stubbed transfer/mint/burn behavior, the backend still has empty/mock basket data, wallet wiring is absent, and the E2E helper scripts referenced by documentation are missing.

## 3. Decision gates before implementation

### G0 — brand and telemetry — RESOLVED 2026-09-01

Resolved by user decision: run `brand-design` (full interview + previews), telemetry **off**. Outcome applied to the repo:

- Palette **Mineral Desk** (warm near-black canvas, mineral-mint primary `#66ccba`, sage/clay/ochre semantic statuses) — picked from 6 AA-verified candidates; user pick recorded.
- Typography **Geist + Geist Mono** via `next/font/google` — user pick recorded.
- No brand gradients (audit anti-slop rule stands).
- `brand.md` written at repo root; `app/app/globals.css` tokens applied (backup `app/app/globals.css.bak`); `app/app/layout.tsx` + `app/tailwind.config.js` wired.
- Telemetry config set to off (`~/.superstack/config.json`); no telemetry events are written.

### G1 — registry provenance — RESOLVED 2026-09-01

Verified live against the official registry on 2026-09-01 (every `/r/{name}.json` endpoint status-checked, 14 payloads byte-diffed against local sources). The original standalone evidence file is not present; the retained findings are summarized below:

1. Local `app/components/charts/*` ARE official Bklit source — official charts are themselves `@visx`-backed (`@visx/*@4.0.1-alpha.0` + `motion`, matching `app/package.json`). candlestick-chart, grid, x-axis, chart-animation byte-identical; area/line/bar/tooltip near-identical with tiny local edits.
2. **Brush is the true gap:** `/r/brush.json` and `/r/chart-brush.json` are 404 and no payload ships ChartBrush source, although docs document the API. The local `chart-brush.tsx` stays as a **justified, documented local adapter** — never labeled official.
3. Naming corrections: official items are `@bklit/candlestick-chart` and `@bklit/chart-tooltip` (AGENTS.md's `candlestick`/`tooltip` names 404). Official `@bklit/legend` exists but is not installed locally — install `npx shadcn@latest add @bklit/legend` in a Wave C worker.
4. Root `recharts@^3.10.1` has zero imports repo-wide and no Bklit component depends on it — removed by the coordinator (Phase 3 task 5 closed).

The frozen chart contract: AreaChart/LineChart/BarChart/Candlestick/Grid/Tooltip/Animation = official Bklit (local copies verified); Brush = documented local adapter pending official distribution; Legend = official, to be installed.

### G2 — protocol/API truthfulness

Decide whether the first public milestone is:

- a clearly labeled read-only/demo UI with no signing claims, or
- a localnet end-to-end milestone with real Token-2022 accounts, wallet signing, and protocol instructions.

The preferred path is localnet correctness before showing actionable mint/redeem controls. A demo may use fixture data only when it is visibly labeled as demo/as-of data and cannot be mistaken for live NAV or executable funds movement.

## 4. Ordered implementation phases

### Phase 0 — documentation and repository baseline

Dependencies: G0 is recorded; no code implementation yet.

Tasks:

1. Keep `docs/current-state-2026-09-18.md`, `docs/implementation-backlog.md`, `AGENTS.md`, `CLAUDE.md`, and `CONTEXT.md` synchronized on status and constraints.
2. Create a safe baseline commit or equivalent immutable snapshot before new code edits. Do not reset, clean, or delete the existing untracked work.
3. Replace stale placeholder IDs and “scaffold pending” claims in operator documentation.
4. Record exact commands, versions, pass counts, and known failures in the phase log.

Exit gate: a new agent can identify the current truth in under five minutes, and no documentation says that the current protocol is localnet-ready.

### Phase 1 — protocol correctness foundation

Dependencies: Phase 0.

Tasks:

1. Whitelist: verify the supplied mint is owned by Token-2022 and the configured decimals match the mint account; preserve active/paused-new-mints semantics.
2. Factory: implement canonical basket/share-mint/vault PDA initialization, canonical Token-2022 accounts, atomic creator seed transfers, and fixed genesis share minting.
3. Basket: implement real Token-2022 transfers, checked decimals, share mint/burn, canonical PDA constraints, expected mint/owner/ATA checks, and fee distribution.
4. Keep `redeem_in_kind` free of whitelist/oracle/backend/pauser accounts and add negative tests proving pause does not block redeem.
5. Preserve all raw/scaled accounting and use `u128` intermediates with floor semantics for on-chain math.

Exit gate: localnet create → seed → mint → redeem → management-fee flow works with real accounts; security checklist P0/P1 is evidence-backed; Rust tests remain green.

### Phase 2 — backend truth and API foundation

Dependencies: Phase 1 account/event shape; can begin schema/type work in parallel after Phase 0.

Tasks:

1. Fix NodeNext imports and strict typing so `npm --prefix backend run build` passes without suppressions.
2. Connect Postgres schema, event decoding, basket discovery, whitelist reads, holdings sync, multiplier reads, and NAV snapshots.
3. Use integer-safe/raw values for token accounting; avoid JavaScript `Number` for amounts that can exceed safe integer range.
4. Make empty/loading/stale/error states explicit in API responses. Keep fallback prices and fixtures behind an explicit `demo`/`source` marker.
5. Implement the documented basket, holdings, NAV history, performance, creator, portfolio, whitelist, and zap quote endpoints. Backend never signs.

Exit gate: a fresh localnet basket appears through the API, source/as-of metadata is present, no endpoint silently returns fabricated production-looking data, and backend build/tests pass.

### Phase 3 — frontend foundation and Bklit migration

Dependencies: G0 and G1; Phase 2 API contracts for live states.

Tasks:

1. Establish semantic design tokens in `app/globals.css` and the chosen brand documentation. Remove hardcoded `zinc`/`white`/decorative gradients from product surfaces.
2. Build a responsive shell: Basalt mark, Explore/Market/Providers navigation, contextual Create/Portfolio actions, network state, freshness state, wallet connection, active route, breadcrumbs, and legal footer.
3. Resolve strict Next 15/React 19 typing: Promise route params, component prop mismatches, `asChild` misuse, Slider unions, chart props, React DOM types, and ES2015+ target requirements.
4. Verify Bklit registry provenance for AreaChart, LineChart, BarChart, Candlestick, Grid, Tooltip, Legend, and Brush. Replace local placeholder adapters or document a justified compatibility wrapper.
5. Remove the root `recharts` dependency and keep chart primitives scoped to the Bklit contract. Use bklit chart APIs for all requested charts.
6. Add shared states: skeletons matching content shape, retryable errors, useful empty states, disabled/loading/pressed/focus states, reduced-motion behavior, and accessible chart summaries.

Exit gate: `npx tsc --noEmit --incremental false` and `npm --prefix app run build` pass without ignored errors; no `@ts-nocheck` remains in product pages; keyboard and mobile smoke checks pass.

### Phase 4 — core user flows

Dependencies: Phases 1–3.

Tasks:

1. Wallet provider: disconnected, connecting, connected, wrong network, and rejected-signature states.
2. Create wizard: select 2–20 active xStocks, weight sum exactly 10,000 bps, fee caps, seed preview, immutable metadata hash, legal checkboxes, transaction review, and status timeline.
3. In-kind mint: raw amount inputs, target-weight validation, scaled display, entry fee/net shares, balance checks, simulation/review, sign, confirm, and recovery.
4. Zap-in: quote provenance, sequential swap legs, slippage inline warning, intermediate-token explanation, and explicit non-atomicity.
5. Redeem: share balance, pro-rata raw-floor outputs, scaled/multiplier display, optional USD estimate clearly marked as NAV/reference, exit fee, irreversible warning, and direct oracle-free transaction path.
6. Portfolio: wallet gate, real positions, raw/scaled/multiplier fields, cost basis, redeem action, and empty/error states.

Exit gate: no primary action is a dead button or a copy-only placeholder; every signing flow has simulation/review, connecting, pending, confirmed, failed, and user-rejected states.

### Phase 5 — page-by-page product polish

Dependencies: Phase 4 foundations; read-only pages may be parallelized by disjoint file ownership.

| Surface | Target composition | Acceptance criteria |
|---|---|---|
| Landing | Asymmetric hero, one clear CTA, sourced/as-of data, featured basket, quiet Create → Mint → Redeem explainer | No fake-live marquee, no faux browser chrome, no unsupported return promise |
| Explore | Search/filter/sort controls and one comparison-first ranking table; cards only as a deliberate mobile representation | AUM, share price, 24h, holders, drift, source/freshness, loading/empty/error |
| Basket detail | Identity/immutable parameters, metric strip, dominant NAV AreaChart, allocation/drift table, fees, risk/redeem explainer, action rail | Raw vs scaled disclosure, target/actual/drift clarity, no duplicated metric-card clutter |
| Buy | In-Kind/Zap tabs with form labels, fee quote, weight validity, route provenance, review/sign modal | Wallet-aware, sequential-swap warning inline, all transaction states |
| Redeem | Wallet/share input, per-constituent preview, raw floor, scaled multiplier, exit fee, oracle-free copy | Never asks for an oracle/whitelist/backend gate; permissionless path is clear |
| Create | Six-step stepper plus summary rail | Blocks invalid 2–20, 10,000 bps, fee caps, inactive mints, and unchecked legal step |
| Portfolio | Wallet gate and positions table | Honest no-wallet/no-position/error states; responsive table behavior |
| Providers | Source registry table, status/freshness/links, xStock issuer context | No fabricated provider health; badges are semantic, not decorative |
| Stock | Required 3-series normalized AreaChart + OHLC Candlestick + Volume BarChart + Brush | xStock/real/benchmark legend, source/as-of, accessible range control, no clipped charts |
| Market | Four-series normalized AreaChart + 30-candle volume/bar view + Brush | Muted consistent palette, benchmark dash, readable axes, responsive chart container |
| Creator | Creator identity, baskets, AUM, fee totals | Explicit placeholder only until API data exists |
| Legal | Reading-width disclosure document | `LEGAL_REVIEW_REQUIRED`, not-advice, jurisdiction, structured-instrument, custody, multiplier, slippage, and risk language |

### Phase 6 — quality, security, and release readiness

Dependencies: Phases 1–5.

Required checks:

```bash
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
npm --prefix backend run build
npm --prefix backend test -- --run
(cd app && npx tsc --noEmit --incremental false)
npm --prefix app run build
git diff --check
```

Then run the localnet E2E only after the scripts and real instructions exist. Run security review, `cargo audit`, `npm audit`, and the relevant `cso`/`review-and-iterate` checks before any devnet/mainnet work.

Release must be blocked if any of these remain:

- protocol transfer/mint/burn behavior is still a stub;
- `redeem_in_kind` is gated or requires an oracle/backend/whitelist pause state;
- frontend build passes only because errors are ignored;
- `@ts-nocheck`, fake live data, dead transaction buttons, or unlabeled native controls remain;
- raw/scaled amounts are mixed, or JavaScript safe-integer limits can corrupt accounting;
- legal placeholders are removed without counsel approval;
- Bklit compliance is asserted without registry/source evidence.

## 5. Orca orchestration protocol

The coordinator owns the Run, decomposition, dependency gates, integration order, and final verification. Workers own bounded tasks and report exact files/tests; they do not silently broaden scope.

Use the current shared worktree only when file ownership is disjoint or a read-only audit is being performed. For implementation waves, prefer one foundation worker followed by parallel page workers with explicit file scopes. Never let two workers edit `globals.css`, shared chart primitives, shared wallet providers, or the same route simultaneously.

For every worker:

1. Create a Task under the active Run.
2. Start with `orca orchestration worker-start` and an explicit worktree/agent.
3. Require a concise `worker_done` containing outcome, files, commands, failures, and remaining risk.
4. Release settled workers; retain only when explicitly requested for debugging.
5. Acknowledge the delivery only after the completion or escalation has been processed.
6. Do not mutate the older UI run `run_7f4b8dbc5e4f`; it is historical context and has failed/ready work from an earlier wave.

Suggested waves after G0/G1:

- Wave A: foundation/type/build + registry provenance (single owner).
- Wave B: protocol/backend truth (parallel only where account/API scopes do not overlap).
- Wave C: shell and shared states, then page groups: research (Explore/Market/Stock/Providers), basket (detail/Buy/Redeem), onboarding (Create/Portfolio/Legal/Creator).
- Wave D: browser QA, accessibility, responsive, legal copy, and regression tests.

## 6. Documentation update protocol

After every phase or material decision:

- update the phase status and exact verification evidence in this file;
- update the dated discovery/decision log when the design or architecture changes;
- keep `AGENTS.md`, `CLAUDE.md`, and `CONTEXT.md` aligned with current reality;
- keep `docs/basalt-v0-spec.md` normative and append an erratum instead of silently rewriting a constraint;
- update README only for operator-facing commands/status, not as a second product specification.

## 7. Decision log

| Date | Decision | Owner | Status |
|---|---|---|---|
| 2026-09-01 | Create a fresh Orca supervised discovery Run with three read-only workers | coordinator | Done |
| 2026-09-01 | Use dark-native quiet research terminal direction as provisional design direction | coordinator/worker | Done (superseded by G0 below) |
| 2026-09-01 | Do not claim current app is localnet-ready; record protocol/backend/frontend gaps | coordinator | Done |
| 2026-09-01 | No frontend implementation before brand/telemetry decision and Bklit registry verification | coordinator | G0/G1 in progress |
| 2026-09-01 | G0 resolved by user: run `brand-design` now to create the deliberate brand; telemetry = off; brand.md is written before design tokens | user | Done — Mineral Desk + Geist applied, `brand.md` written |
| 2026-09-01 | G2 resolved by user: localnet end-to-end milestone first; no actionable mint/redeem UI before protocol truth | user | Decided — governs Wave B/C ordering |
| 2026-09-01 | Orchestration moved to ZCode coordinator with Agent subagents in waves (A foundation, B protocol/backend, C pages, D QA); disjoint file ownership enforced per wave; rolling concurrency ~2 workers due to account limit | user/coordinator | Active |
| 2026-09-02 | Brand superseded: UI monochrome (classic shadcn dark/light) + ethereal chart data palette; Mineral Desk retired; footer removed site-wide; LEGAL_REVIEW_REQUIRED chips removed from UI (review backlog — wizard legal step + /legal stay) | owner | Done |
| 2026-09-02/03 | New IA: Home (hero + product visual + Traditional-vs-Tokenized interactive + gateway) / Stocks (provider grid) / ETFs (pure clickable-card listing) / Baskets (grid-only, name-first, vs-SPY); Market+Providers unlinked from nav; two owner feedback rounds applied; baskets list API carries constituents/weights/metadata for card composition | owner | Done |
| 2026-09-03 | Localnet bring-up reached 6/8 E2E steps PASS (deploy + createWhitelist on-chain); create_basket hits SBF stack-frame overflow → refactor PAUSED at WIP `e961849` (owner: UI-only phase); SBF pins + idl-build features in place — resume on owner request | owner | Paused |
| 2026-09-03 | Devnet phase begins (owner request). T0 research verdict: NO official devnet tokens for xStocks/Ondo (verified on-chain; `docs/devnet-tokens-research-2026-09-03.md`) → devnet test uses self-minted Token-2022 mocks with ScaledUiAmountConfig. NOTE for mainnet: providers.md `Xs…` mints are REAL mainnet xStocks with **8 decimals, not 6** | coordinator | Done |
| 2026-09-04 | Devnet live run — full protocol E2E confirmed on devnet (38 txs; evidence pack `docs/devnet-live-2026-09-04.md`). Wire-limit ceiling at 4 constituents (legacy 1232 B tx: 6→1618 B, 5→1444 B, 4→1270 B; basket live at 3) — NOT a program error; fix path = versioned (v0) transactions + address lookup tables, deferred | owner/coordinator | Done — DEVNET LIVE |
| 2026-09-04 | Pitch deck condensed to 5 slides × ~30 s (owner cap: max 6); BUILT slide dropped (proof folded into closing line), token-flow chip visuals on the solution slide mirroring the LIVE basket (NVDAx 40 / AAPLx 32 / MSFTx 28); 10-slide version kept as `.full10.bak` | owner | Done |
| 2026-09-04 | Owner asks: full devnet switch + "can we really go live?" — gap analysis recorded in §8c; USDC-zap copy gap found (program is in-kind only, no zap instruction) → deck copy corrected to in-kind, zap deferred to roadmap | owner/coordinator | Done |
| 2026-09-04 | Mimosa security gate hard-blocks git commit on 21 pre-existing "high" findings (10 client-fetch SSRF, 4 SQL taint chains, 3 Yahoo-series SSRF, 3 scripts path traversal, 1 taint-boundary). Decision: fix for real, no suppressions/no bypass — security-hardening wave (validated `apiFetch` client, Yahoo ticker validation + host allowlist, SQL bound params + sort allowlists, keypair path containment), iterating the sealed scanner to 0 high; commit + push deferred until clear | owner/coordinator | In progress |

## 8b. Current status snapshot (2026-09-03)

- **Protocol: localnet E2E 8/8 PASS** (twice consecutive) — create_basket SBF stack-overflow fixed (try_accounts 4232 → 0 warnings; handler-side `#[inline(never)]` init helpers, factory authority signer-meta fix, 500k CU on client txs). 178 Rust + 392 backend TS tests green.
- UI: new IA live (12 routes), two owner feedback rounds + restyles applied (detail, buy/redeem, providers). Monochrome chrome + ethereal chart palette; `brand.md` rewritten accordingly. Positions indexer landed (user_positions writer, 392 tests).
- Local dev demo data: 4 mock xStocks + Tech Duo / Index Plus baskets (`demo-seed`).
- Owner redirected work to UI improvements while devnet funding is pending.

## 8c. Current status snapshot (2026-09-04): DEVNET LIVE

- **Protocol: LIVE ON DEVNET — 38 confirmed transactions** (all `err: null`; full phase→signature tables in `docs/devnet-live-2026-09-04.md`). 3 programs deployed and verified at declared IDs — whitelist `FRavMcY…`, basket_factory `3hzoPep…`, basket `6Q43vFh…`; **12 mock xStocks** whitelisted (TSLAx…SPYx, Token-2022 ScaledUiAmountConfig ×1.0); basket live at 3 constituents NVDAx/AAPLx/MSFTx 4000/3200/2800 bps, fees 100/50/200 (`9u5eEx1C…`, share mint `7xo7uw13…`).
- **Mint/redeem/fee verified on-chain**: entry fees split 900/100 and 4,950,000/550,000 (90/10); `redeem_in_kind` succeeded **while NVDAx was paused** (burn 49,500 + 247 exit fee — permissionless exit proven on a live chain); management fee accrued permissionlessly (+4 shares, checkpoint updated). Supply reconciles exactly: 1,000,000 genesis + 100,000 + 550,000,000 − 49,500 + 247 + 4 = **551,050,751 = RPC supply**; the 90/10 split reconciles to the last share across creator/treasury/user2; NAV 145,036,556.6104 USD, share_price 0.263199998089/raw = 263.2 USD per basket-unit = 180×0.40 + 230×0.32 + 420×0.28 exactly, drift 0 bps.
- **KNOWN LIMIT → RESOLVED (same day)**: `create_basket` at 4+ constituents exceeded the legacy 1232 B transaction wire limit (6→1618 B) — a client/transport limit, not a program error. **v0 transactions + Address Lookup Tables landed**: create_basket n=6 now compiles to 631 B; **MAG SIX (6 constituents, nonce 1) is LIVE on devnet** — basket `CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo`, share mint `GZzEofuv…`, weights 2500/2000/1500/1500/1250/1250 on-chain, full mint/redeem/accrue flow proven (incl. redeem under a paused constituent; 90/10 split creator 5 / treasury 1). Legacy path kept where it fits (`sendFitting`); ALT create/extend is idempotent and cached. The UI's own client builders (`app/lib/transactions.ts`) compile v0+ALT for n≥4 and were proven live headlessly (mint `5gc6qYru…`, redeem `5MRGfrWT…`); create wizard gained a `preparing-alt` phase.
- **Backend LIVE against devnet** (indexer + NAV engine + fee crank on `backend/.env.devnet`, pid/log `/tmp/basalt-backend-devnet.log`): 12 `whitelisted_mints` rows, 5 events, 3 `user_positions`, `vault_holdings` + NAV snapshots populated from chain. Fee crank emits **UNSIGNED** txs only (signatures field 0, placeholder feePayer — the backend never signs, AGENTS.md §2 #5). Three real indexer bugs found and fixed during the live run: (1) events inserted before the baskets row (FK) + failed sigs permanently dropped → upsert-first, oldest-first, retry cap 5; (2) WhitelistedMint accounts never synced → new 60 s whitelistSync; (3) holdings sync never wired + `deriveBasketPda` used the basket instead of the factory program id → fixed derivation + 30 s sync pass. Regressions in `backend/tests/livewire.test.ts`.
- **Tests: 620 green** — 178 Rust + 442 backend TS (realistic-price wave added 21, hardening wave added none net).
- **Realistic NAV prices LIVE**: `REALISTIC_MOCK_PRICES=1` routes `mock:<slug>` quotes Yahoo-first (real tickers NVDA/AAPL/MSFT/…, 60 s TTL, 150 ms spacing, per-symbol catalog fallback with honest `source` labels `yahoo`/`mock`). Live result: share_price 0.2632 (static) → **0.3346 → 0.3637 (Yahoo, per basket)**, exact arithmetic cross-check; NAV history shows the clean cutover row-by-row (`{mock}` → `{yahoo}`).
- **Devnet totals now: 2 live baskets** (nonce 0 = 3 constituents 40/32/28; nonce 1 = MAG SIX 6 constituents 25/20/15/15/12.5/12.5), 12 whitelisted mock xStocks, backend index count 2, payer at ~3.31 SOL.
- Balances after the run: payer `y72KA26…` 3.342 SOL (from the owner-funded 12), user2 `48CUGM…` 1.492 SOL, treasury `AAb2TX…` 0 SOL (never signs — the 10% leg is proven via its share ATA). Evidence on disk: `scripts/.e2e-devnet/devnet-evidence.json`, `scripts/.e2e-devnet/logs/`, `backend/.devnet-live-evidence.json`.
- **Live UI verified against the indexed basket**: `/explore` lists the real basket (NVDA 40 · AAPL 32 · MSFT 28, $0.2632 share price, AUM $145,036,557, "devnet" network label), basket detail shows target-vs-actual 40.00/32.00/28.00 with real vault raw balances and an `onchain-indexed` NAV history; app default cluster is now **devnet** (`NEXT_PUBLIC_CLUSTER`), explorer links fixed (pre-existing broken query-order bug). 12-stock Stocks page renders from the new `/api/v1/xstocks/mock` catalog with an honest static fallback.
- **Pitch deck final (5 slides × ~30 s)**: LIVE ON DEVNET badge, live-basket chips, `599 tests · LIVE ON DEVNET` closing line, wire-limit objection prep in speaker notes; 10-slide version in `pitch-deck-20260903-205235.full10.bak`. Deck served at `http://127.0.0.1:8090/pitch-deck-20260903-205235.html`.
- **SECURITY GATE (active)**: Mimosa hard-blocks commits on 21 pre-existing "high" findings (10 client-fetch SSRF, 4 SQL taint chains, 3 Yahoo-series SSRF, 3 scripts path traversal, 1 taint-boundary math). Decision: real fixes only, no suppressions — security-hardening wave iterating the sealed scanner to 0 high (validated `apiFetch` client app-wide, Yahoo ticker validation + host allowlist, SQL bound params + sort allowlists, keypair path containment). Backend 421 tests + app build must stay green. Commit + push deferred until clear.
- **Gap analysis (owner request, "what's missing"):** (1) v0 tx + ALTs for >3 constituents — the largest engineering item; (2) UI wallet-connected buy/redeem never exercised end-to-end on devnet (builders exist, script flow proven) — needs one live Phantom run; (3) USDC zap does NOT exist in the program (deck copy corrected to in-kind; zap = roadmap decision); (4) NAV prices are static mock catalog values — mapping mock symbols to real Yahoo equities prices would make NAV realistic (`priceCompare` infra exists); (5) backlog: ESLint config, legend wiring, roman-empire→main merge.
- **Mainnet path (owner asked "can we really go live?"): YES — staged.** Already right: oracle-free permissionless redeem, decimals-agnostic constituents (8 dp real xStocks pass program checks), indexer/NAV/API proven on real chain, 599 tests. Required in order: v0+ALT → real Backed xStocks whitelist (mainnet mint addresses in `docs/providers.md`) + transfer-hook compat test → upgrade authority to multisig (Squads; currently a single EOA) → keeper service to sign fee-crank txs → external security review + Mimosa 0-high in CI → legal counsel (LEGAL_REVIEW_REQUIRED + Backed ToS) → capped-TVL soft launch (one basket, ~$10k cap).
- **NEXT (owner instruction): the Mimosa commit-gate decision is the owner's** — the gate intercepts only agent-run git commands, so the owner can commit+push from their own terminal (everything staged), or adjust the plugin threshold and the coordinator commits. Meanwhile the gap list shrank: v0+ALT done, realistic prices done, UI client builders proven headless. Remaining gaps: UI Phantom-connected buy/redeem click-through (manual, ~5 min with the owner), USDC-zap roadmap decision, ESLint config + legend wiring backlog, roman-empire→main merge.

## 8d. Current status snapshot (2026-09-03, post Roman phase)

- **Protocol: create_basket stack-overflow FIXED** (handler-side init helpers, factory authority signer-meta fix, 500k CU clients) — **localnet E2E 8/8 PASS, twice consecutive**. 178 Rust + 392 backend TS tests green (positions indexer +19).
- **UI: Roman Empire identity shipped on branch `roman-empire` (pushed, merge pending owner review):** Cinzel display + Roman numerals + laurel monogram logo + Piranesi 1790 Pantheon engraving as hero watermark + imperial/pompeian accents. New IA: Home / Stocks / ETFs / Baskets / Create / Buy+Redeem / Portfolio. Design system consolidated (.font-display/.text-display/.section-label, SectionHeader, RangeLinks). Feedback rounds 1-4 + light-mode/mobile audit applied. `brand.md` rewritten to monochrome + Roman layer.
- **NEXT: pitch deck** (owner request). Input doc `.superstack/idea-context.md` prepared for the `create-pitch-deck` skill.
- Backlog: ESLint config, legend wiring, providers.md 8-decimals correction applied (mainnet note), devnet E2E completion.

### Historical wave log (2026-09-01, superseded by §8c above)

1. ~~User chooses brand/telemetry~~ — Done: `brand-design` run, **Mineral Desk** palette + **Geist/Geist Mono** applied (`brand.md`, `app/app/globals.css`, layout/tailwind wired), telemetry **off** (G0 closed).
2. ~~G2 choice~~ — Done: **localnet E2E first**; Wave B protocol/backend truth workers run before any actionable transaction UI.
3. **Wave A progress (rolling, ~2 concurrent workers):** app strict typing — **PASS** (tsc 0 errors from 52; build green without ignore flags; @ts-nocheck removed; Next 15 Promise params fixed); backend build gate — **PASS** (NodeNext `.js` imports fixed; build clean; 286/286 tests green). G1 — **RESOLVED** (§3 above; recharts removed; naming corrections synced to AGENTS.md/CLAUDE.md/CONTEXT.md).
4. **Wave B — COMPLETE (protocol + backend truth):** basket CPI **PASS** (all instructions real; pause-gate shipped — `mint_in_kind` remaining_accounts is now 4n: 3n token triplets + n WhitelistedMint PDAs, `PausedNewMints` → `MintPaused`; redeem byte-identical, structurally proven gate-free; **178 Rust tests**). Whitelist+factory **PASS** (atomic seeds, genesis 1M with temp-authority handoff, real vault_bump). Backend DB/indexer **PASS** (normative §7 schema live-verified, event decode, holdings sync + f64 multiplier, 328 TS tests). Backend NAV/API **PASS** (exact BigInt fixed-point NAV, all §8-9 routes real with `source`/`asOf` markers, zap quotes honest-503, fee crank builds unsigned txs — backend never signs; **373 TS tests**). Rust 178 + TS 373 (+1 legacy) = 552 tests green.
5. **Wave C — foundation done, page groups rolling:** shell/wallet/states/format foundation **PASS** (12 routes, wallet states complete). Running: C-research (Explore/Market/Stock/Providers + @types/d3-* durable fix + optional @bklit/legend) and C-basket (detail/Buy/Redeem + client-side Anchor instruction builders mirroring program source incl. the 4n contract). Queued: C-onboarding (Create wizard/Portfolio/Landing/Legal/Creator), E2E scripts worker.
6. **Wave D static QA — PASS:** regression green (178 Rust + 373 backend TS + app tsc 0 errors + 12-route build); 9 a11y findings fixed (focus traps, APG tabs, focus return, slider token); anti-slop sweep clean (product `transition-all` 0, hardcoded colors 0, dead BasketCard removed, chart-brush English + de-duplicated); release-gate table (§6) 8/8 evidenced PASS. Pending final integration: wave-boundary `npm install` (phantom/solflare/buffer declarations landed in manifests), legend wiring decision, ESLint config, browser QA pass, commits.
7. **In flight:** localnet E2E + SBF toolchain worker (G2) — the last implementation worker. Documentation synced: AGENTS.md/CLAUDE.md/CONTEXT.md/docs/AGENT_CONTEXT.md (552-test status, 4n contract), README.md + app/README.md (operator truth), spec Amendment 2.
