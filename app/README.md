# Basalt App (Next.js 15)

## Current landing revision, 2026-10-03

Source is saved; the production build and recorded responsive/role checks passed. The hero description is **Or create one that fits your needs.**, without a home status or home-only methodology/source note. Four featured cards retain Model price labels. Six benefits follow the gallery, then the existing creator/fee section, then **I am an investor** (two steps) and **I am a basket manager** (three steps) in `#how-it-works`. Use actual basket covers and conditional future investing/fees. [The audit](../docs/landing-journeys-2026-10-03.md) and [session](../docs/session-updates-2026-10-03.md) track final evidence. Checkpoint `0ac63ae` was pushed; the owner accepted this new layout and requested a commit and push to `origin/main`.

## Previous accepted hero restoration and ten covers, 2026-10-02

The final owner correction restores **Find a stock basket / you believe in.** in a calm centered hero, with **Different takes.** directly below. The creator invitation and future-fee visual sit after the gallery in `#build`. All ten sample baskets have unique covers, including matching 64/80px thumbnails on recognized previews; custom drafts stay unassigned. Catalog/removal/focus/grouped-input improvements are retained. The final production build passed and browser checks covered 320/375/768/1280px without overflow. See [the restoration audit](../docs/home-hero-restoration-2026-10-02.md) and [cover audit](../docs/basket-cover-refresh-2026-10-02.md). The earlier 38-test result is dated evidence, not a new run.

## Previous fee-first interpretation, superseded for hero/layout, 2026-10-02

At that revision, the opening said **“Create stock baskets. Earn management fees.”** and places the annual-rate cap and 90/10 fee-share visual beside the hero copy. The adjacent status states that investing and fees remain in development. The lower “Good stock picks” invitation stays compact. Public Create exposes all 41 catalog assets with an end-aware clickable fade, supports weight-row removal with exact positive 10,000-bps redistribution and a two-stock progression guard, and preserves focus and grouped amount editing. USD/count/percentage displays use shared comma grouping. Read [the current home/Create audit](../docs/home-create-feedback-2026-10-02.md) for the five requests, precise fee meaning, final 38-test/build evidence and browser checks. The final owner correction above supersedes that hero placement; Create improvements and their dated verification remain valid.

## Historical basket performance, 2026-10-02

`/api/basket-performance` fetches completed real underlying closes server-side. Shared cards show Model price and 7D; `/leaderboard` ranks ten curated examples by seven-day return and defaults to the basket tab. The model starts at $100 on its fixed September base date and holds quantities without rebalancing. It excludes fees/dividends and is not an xStocks quote or achieved investor return. Missing inputs fail closed.

Read the [product/performance audit](../docs/product-performance-audit-2026-10-02.md) for methodology, evidence, tests and all UI changes. The public creation path remains wallet-free sharing; investing is in development.

Previous visual-creation revision, superseded by the home/Create feedback above. The public experience builds, explores, and shares basket ideas without a wallet. The calm hero and four expressive basket cards remain. The lower landing now uses one `#build` section: “Good stock picks can come from anyone.”, one short paragraph about sharing a strategy and future management fees, and “Build your basket” linking to `/create`. Beside it, a stock-to-basket-to-people illustration ends with a compact planned 90/10 management-fee share split. One xStocks line and two native issuer/fee details follow. `/create/onchain` currently redirects to `/create`. Retained transaction code and historical mock-devnet evidence do not imply that public investment or official xStocks support is live.

Read the [complete session record](../docs/session-updates-2026-10-02.md), [current landing design](../docs/design-home-visual-creation-2026-10-02.md), [earlier gallery design](../docs/design-home-discovery-2026-10-02.md), [brand](../brand.md), and [handoff](../handoff.md). The earlier discovery implementation passed app typecheck and production build, with 25 static pages generated. That earlier lower-landing revision also passed production build and TypeScript checks, responsive browser review, the create CTA, keyboard fee disclosure, and exact 90/10 SVG measurements. Older route/test counts are dated snapshots.

## Current route map

- `/`, accepted revision: calm stock-basket hero and four featured cards, six benefits, lower `#build` invitation/fee visual, investor/manager journeys in `#how-it-works`, then native issuer/fee details. Home-only status and methodology/source notes are removed; Model price labels remain.
- `/create`: four tasks to choose stocks, set weights and optional fees, try an example amount, and review/share a validated link. No wallet is required.
- `/preview?d=...`: validated basket link, thesis, allocation, example amount, fees, “Use this mix”, and “Copy basket link”. The onchain action is disabled and labeled “Coming soon”.
- `/create/onchain`: redirect to `/create`; earlier transaction-wizard UI remains retained source.
- `/explore`: shared original-cover `BasketStoryCard` gallery with person links, arranged in one mobile, two tablet, and four wide-screen columns. No horizontal mobile strip. The separately identified indexed devnet section, search/sort behavior, provenance copy, and loading/error/empty states are unchanged.
- `/feed`, `/leaderboard?tab=people`, `/creator/[pubkey]`: consistent sample identities and basket links; navigation says Managers. Actual indexed activity remains distinct from basket ideas.
- `/basket/[pubkey]`, `/basket/[pubkey]/buy`, `/basket/[pubkey]/redeem`, `/portfolio`: retained transaction and accounting surfaces with mock-devnet/provenance requirements. Their deployment evidence is in the dated V0 documents.
- `/managed`: simulated public explainer. `/managed/lab`: loopback localnet prototype, as described in the [V2 status](../docs/managed-basket-v2-prototype-status.md).
- `/stocks`, `/etfs`, `/stock/[ticker]`, `/market`, `/providers`, `/legal`: asset, market, provider, and disclosure routes.

## Shared implementation

- `components/home/home-experience.tsx`: server-rendered centered hero/discovery, new benefits and role-journey composition, retained lower `#build` creator visual and native issuer/fee details. Source is saved; the production build and recorded responsive/role checks passed. The obsolete chapter scroll hook remains removed.
- `components/home/creator-reward-visual.tsx`: lower `#build` visual with annual-rate cap, an existing Bklit horizontal stacked bar for planned management-fee shares, stock logos, original basket cover and generic people. The 90/10 split is policy, not performance or current revenue.
- `components/basket/basket-story-card.tsx`: reusable full/compact basket cards with optimized original editorial covers, constituent logos and person links; full cards serve both landing discovery and the Baskets gallery.
- `lib/concept-samples.ts`: shared illustrative identities, theses, allocations, and activity.
- `lib/transactions.ts` and `lib/create-basket.ts`: retained client instruction builders; keep account order, raw amounts, and validations aligned with protocol source.
- `lib/format.ts`: exact raw/scaled conversion; grouped USD/count/percent displays, safe missing/tiny values, and grouped input parsing. Public Create preserves draft/caret behavior through `components/create/concept-create-utils.ts`.
- `components/shell/`: responsive header and floating mobile navigation. Wallet connection is visible across header routes; network context remains route-specific.
- `lib/wallet-connect-scheduler.ts`: deferred connection after provider effects, used with selected-adapter matching. Its regression tests are not evidence of real extension-wallet signing.
- `components/states/`: shared loading, error, empty, and freshness presentations.

## Charts and styling

Preserve Basalt's electric-yellow tokens, dark surfaces, Chakra Petch headings, and readable body copy. Use existing Card and Bklit-derived chart components. `chart-brush.tsx` is a documented local adapter, not official registry source. The landing uses editorial basket covers in existing Card primitives and a compact Bklit bar for the future management-fee share split. Keep its 90/10 labels secondary to the basket journey and explicit about fee shares; no new chart dependency was added.

## Verification

```bash
npm run typecheck
npm run build
```

The earlier discovery pass's responsive, native-scroll, route, screenshot, build and sample-integrity evidence is recorded in the [earlier discovery design](../docs/design-home-discovery-2026-10-02.md); reduced motion was source-reviewed. The latest lower-landing revision has its own successful build, responsive browser, CTA, disclosure and exact fee-chart checks in the [current design audit](../docs/design-home-visual-creation-2026-10-02.md). No fresh chain or protocol verification is claimed for this presentation revision.

## Known gaps

Official xStocks admission, public investment, retrievable onchain metadata, direct-RPC redeem UI fallback, verified extension-wallet E2E, production metadata URLs, governance, and legal/release gates remain governed by the [backlog](../docs/implementation-backlog.md). Do not treat the landing's future fee explanation as currently generated revenue. Historical BAS-001/devnet and Zap limitations remain in the dated state documents.
