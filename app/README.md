# Basalt App (Next.js 15)

Current status: **working devnet frontend** — 21 generated route entries, wallet-wired, and brand-applied per [`../brand.md`](../brand.md). Gates: `npm run typecheck` = 0 errors; `npm run build` = green with no ignored errors (`next.config.js` is empty — no `ignoreBuildErrors`). See the repository-level [implementation plan](../plan.md) and [current-state snapshot](../docs/current-state-2026-09-18.md).

## Pages (spec §9 — all real)

- `app/page.tsx` — Landing (asymmetric hero, one CTA, featured basket only from real data)
- `app/explore/` — comparison-first ranking table + mobile cards, search/sort, loading/error/empty
- `app/basket/[pubkey]/` — detail: NAV chart, drift table (target/actual), protocol-wide creator/treasury fee split, oracle-free redeem explainer, action rail
- `app/basket/[pubkey]/buy/` — In-Kind (exact BigInt 1%-tolerance weight validation, limiting-leg named) | Zap USDC (Jupiter legs + provenance + non-atomic warning); full simulate → review → sign state machine
- `app/basket/[pubkey]/redeem/` — pro-rata floor preview (raw + scaled + labeled USD estimate), irreversible/oracle-free copy, quiet accrue crank
- `app/create/` — 6-step wizard: 2–20 Active mints → exact 10,000 bps → fee caps 300/100/300 → seed preview → 4 legal checkboxes (`LEGAL_REVIEW_REQUIRED`) → account-level deploy review modal
- `app/creator/[pubkey]/`, `app/portfolio/`, `app/legal/` — honest empty/wallet-gated states, no fabricated numbers
- `app/market/`, `app/stock/[ticker]/`, `app/providers/` — Bklit-derived chart and provider surfaces; the stock page currently uses one fit-domain area chart and Market retains the local Brush adapter

## Foundation (consume, don't rebuild)

- `lib/transactions.ts` + `lib/create-basket.ts` — client-side Anchor instruction builders (no IDL), mirrored from program source; discriminators + account orders cross-verified (incl. the 4n `mint_in_kind` remaining-accounts contract)
- `lib/format.ts` — BigInt-exact raw↔scaled, token/USD/bps formatting, address truncation
- `lib/wallet.ts` + `app/providers.tsx` — wallet state machine (disconnected/connecting/connected/wrong-network/rejected) + `useWalletFeedback()`
- `components/shell/` — responsive header, wallet button, and network indicator
- `components/states/` — Skeleton variants, `ErrorState`, `EmptyState`, `FreshnessBadge({source, asOf, demo})`

## Charts

`components/charts/*` are recorded as verified official Bklit registry source in [`../plan.md`, gate G1](../plan.md#g1--registry-provenance--resolved-2026-09-01). `chart-brush.tsx` is a **documented local adapter** (official Brush has no distributable source — 404); never label it official. `@bklit/legend` is installed but not yet wired (pending a `--legend` token decision in `globals.css`).

## Known gaps

- The BAS-001 management-fee fix is locally verified but still needs a basket-program upgrade and existing-account devnet smoke test.
- Zap-in received-token accounting now uses wallet/quote-bound raw `post - pre` deltas, validates Jupiter minimum output, and blocks unsafe partial retries. Mock devnet still has no Jupiter routes for the local constituent mints.
- Playwright/wallet E2E coverage, consistent mock/demo labeling, and final legal review remain release blockers.
