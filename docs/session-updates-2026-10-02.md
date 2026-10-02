# Basalt session updates, 2026-10-02

## Current revision: calm stock-basket hero and gallery first

The owner's final clarification retained the earlier calm discovery opening with **stock basket** in the headline. The centered hero now reads **Find a stock basket / you believe in.**, keeps the old two-line body and one investing-development status, and leads with **Explore baskets** to `#discover`. **Different takes.** follows immediately. The creator invitation, conditional future-fee paragraph and annual-cap/90/10 visual sit in the lower `#build` section. No new route was added. The preceding fee-first hero interpretation is superseded; all ten distinct covers and Create improvements remain.

The final production build passed after a short-height desktop spacing adjustment. Root verified 1280 × 720 with discovery at y=502px, 375 × 812 at y=441px, 320 × 740 with a clean three-line H1, and 768 × 1024 without horizontal overflow. Fee content appears after discovery. Desktop and 375px leaderboards loaded ten distinct image URLs; console errors were empty. The [restoration audit](home-hero-restoration-2026-10-02.md) links the actual [build log](assets/hero-restoration-2026-10-02/build.log) and final desktop/mobile/build-section/leaderboard screenshots. The earlier 38-test result remains scoped to the previous freeze and was not rerun. Protocol math and public-release boundaries are unchanged.

## Current artwork update: one cover per sample basket

The root generated six additional original editorial collages and copied them to `app/public/images/baskets/`. Chip Happens, After Hours, Payday, Offline Mode, Power Hungry and Main Character now have their own subjects and colored-paper palettes. The four featured originals remain unchanged. Ten file signatures/dimensions and ten distinct full SHA-256 hashes were verified; the original four hashes match their pre-copy values.

The shared cover map uses ten different paths. Recognized sample previews now retain that cover beside their heading at 64/80px; custom drafts receive no sample art. Existing basket data, model performance, links and release boundaries are preserved. [The cover refresh audit](basket-cover-refresh-2026-10-02.md) records scope and checks; [the prompt record](basket-cover-prompts-2026-10-02.md) now contains all ten exact prompts.

The final production build and responsive cover/browser checks passed. Desktop and 375px leaderboards loaded ten distinct cover URLs without overflow or console errors; recognized sample preview thumbnails fit at 64px on 320px and 80px on 1280px. The implementation agent reported the existing concept-preview/sample integrity test passed after the thumbnail addition. [Final durable evidence](home-hero-restoration-2026-10-02.md) covers the completed artwork and corrected home layout. The earlier 38-test home/Create run was not repeated. This documentation pass changes Markdown only and makes no public investing or fee-revenue claim.


## Previous fee-first interpretation: hero/layout superseded, Create controls retained

The owner requested a concrete large stock-basket heading, management fees as the leading motivation, a complete scrollable asset catalog, deletion while setting weights, and comma-formatted values without broken amount editing. The home now reads **“Create stock baskets. Earn management fees.”** with the annual-rate cap and planned 90/10 fee-share illustration beside it. The body conditions fees on investing opening and one status sentence says investing and fees are in development. The lower “Good stock picks” quote remains compact without a repeated fee panel.

Create exposes all 41 assets with a clickable, end-aware bottom fade. Weight-row removal preserves positive exact 10,000-bps totals, guards progression below two stocks, announces changes, and recovers focus. Add stocks returns to asset search. Shared displays group USD/count/percentage values; the amount editor preserves decimals, trailing zeros, caret and validated copied precision, with unchanged numeric bounds. Management fee appears first and remains a future feature.

The final code freeze passed **38 frontend tests** (format 10, Create 7, model 12, store 8, concept integrity 1) and the Next.js production/TypeScript build. This replaces the earlier 37-test report before the copied-precision regression. Four legacy backend price/share tests were separately reported earlier; the previous full 672-backend/214-Rust evidence remains in its own audit.

Root browser checks covered aligned columns at 1280px, first-screen fee content at 375px, all catalog entries/end fade/search, deletion to one stock with exact totals and Continue disabled, and Add stocks search focus. Grouped `12,345.67` edited in the middle became `1,234.67` with caret recovery and matching preview; blank/over-cap values blocked and $1,000,000 fit at 320px. The final Create copy clarified fees, removed a duplicate review summary and fixed singular-count accessibility wording.

The [home/Create owner-feedback audit](home-create-feedback-2026-10-02.md) records that earlier freeze; its hero placement is superseded by the final restoration above. Logs were read from `/private/tmp/basalt-home-create-tests.log` and `/private/tmp/basalt-home-create-build.log`. Root saved durable [tests](assets/home-create-feedback-2026-10-02/tests.log), [build](assets/home-create-feedback-2026-10-02/build.log) and seven screenshots to `assets/home-create-feedback-2026-10-02/`, all linked in the audit. Final production checks found no overflow at 320/375/768/1280px and no browser console errors. This documentation pass edits Markdown only. No protocol math, release boundary, public investing, fee revenue, commit/push or remote deployment is established by the UI revision.


## Previous revision: a visual creation invitation, now superseded

The owner requested less text below discovery and a clearer reason to create a basket. The lower landing is now one section with the retained “Good stock picks” statement, one short paragraph and “Build your basket”. A connected stock-to-basket-to-people illustration replaces the former text steps. A compact Bklit graphic shows the future 90/10 management-fee split. xStocks and fee mechanics remain available in two native disclosures. The hero, gallery and Baskets page are unchanged.

See the [visual creation audit](design-home-visual-creation-2026-10-02.md) for implementation and verification. Earlier composition notes below are historical. Final production build and TypeScript checks passed; mobile/tablet/desktop browser review, exact rendered 90/10 SVG ratios, the create CTA and keyboard fee disclosure were verified. Screenshots and geometry evidence are saved in `assets/visual-creation-2026-10-02/`. A bounded horizontal stacked-bar fix and optional exact chart domain were required for the fee visual. No financial math or chain behavior changed.

## Previous follow-up: publish a strategy and browse visual baskets

The “Good stock picks can come from anyone.” headline is preserved. Its companion copy now invites people to build a basket around their investment strategy, give others a reason to follow their picks, and earn management fees when investing opens. The question is “Think your stock picks deserve a following?” and the filled “Build your basket” CTA opens `/create`. The xStocks explanation moved to the how-it-works introduction so the invitation stays focused.

`app/app/explore/concept-gallery.tsx` now reuses `BasketStoryCard`, with original covers, concise theses, stock marks, and separate person links. The browse grid has one column on mobile, two from 640px and four from 1024px. The previous allocation-heavy cards and duplicate gallery create action were removed. Indexed browsing, search, sorting, and provenance were preserved. No shared allocations, fees, data APIs or protocol code changed.

The [current audit](design-home-discovery-2026-10-02.md) holds the exact copy, file map and verification evidence. Updated brand, app README and handoff notes record the same design direction. The final production build passed with TypeScript checking and 25 static pages. Browser checks covered the new creation CTA, basket and person links, 390px mobile, 768px tablet and 1165px desktop with no horizontal overflow. Four follow-up screenshots are saved in `assets/discovery-2026-10-02/`. No commit, push or remote deployment was performed.

## Previous revision: basket discovery

The landing now uses a calm hero, four named basket cards, a short community/xStocks explanation, three future-investment steps, optional fee details, and a final create CTA. Native vertical scrolling replaces the earlier three full-screen demos. Feed pairs short viewpoints with visual basket cards; Managers pairs people with their baskets. This is the latest owner decision and supersedes the chapter requirements recorded below. The hero reads “Find a basket you believe in.” The shared examples are Terminally Online, Touch Grass, No Hands and Daily Ritual, with original generated covers. Sample IDs, weights, amounts and fee fields are preserved.

See the [current audit](design-home-discovery-2026-10-02.md) for the full file map, performance-source findings and final verification. The final production build, sample-integrity test, responsive browser review, and Markdown-link check passed. The [cover prompts](basket-cover-prompts-2026-10-02.md) and new screenshots in `assets/discovery-2026-10-02/` are durable repository assets. Feed and Managers now reuse `BasketStoryCard`; devnet data is loaded only when its separate disclosure opens. No returns were invented and no protocol math or deployment changed.

## Earlier iteration record

This records the landing redesign, copy cleanup, Colosseum setup and research, and verification completed in this conversation. It describes the canonical working tree at `/Users/umutyesildal/orca/workspaces/createyouretf/createyouretf`, branch `main`, based on commit `e18d6f429dbb657ef32b10bc8d83e27ae42b3c3b`. These changes remain uncommitted. The old `/Users/umutyesildal/orca/projects/createyouretf` directory is not the current product source.

## Earlier owner decisions, now superseded for layout

- Use separate full-screen desktop sections. One wheel gesture should move one section up or down.
- Align the left copy and right illustration at common top and bottom boundaries. Keep the calls to action at the bottom of the copy column.
- Explain xStocks, choosing someone else's basket, and publishing a basket that others can eventually invest in.
- Explain management fees as a future investment feature, consistent with the current implementation.
- Write short, natural English. Do not use em dashes in interface copy.
- Remove repeated preview/concept badges, no-purchase notices, and implementation explanations from the main flow.
- Preserve Basalt's dark industrial surfaces, electric yellow, stock marks, and Chakra Petch headings.
- Let illustrations play automatically in sequence. Keep page advancement under the reader's control.

## Earlier three-chapter landing

The earlier four-section version was replaced by three sections. [Detailed design and verification](design-home-chapters-2026-10-02.md).

| Section | Main copy | Illustration and action |
|---|---|---|
| 01, The idea | “Stock baskets. One token.” xStocks are tokens that track stocks and ETFs on Solana. | NVIDIA, Apple, and Tesla combine into a composition ring and a basket token. Primary action: Explore baskets. Secondary action: Build a basket. |
| 02, Discover | “Choose a strategy.” See the stock picks, the mix, and the person behind a basket. | One fixed Mega-Cap Tech example by Maya Chen, with holdings, weights, the sample's fee, and working links to other sample baskets. |
| 03, Build | “Build your own basket.” Pick stocks, set the mix, and share; explain future investment and management fees. | A 40/35/25 starting mix and the future V0 fee split: 90% to the publisher and 10% to the protocol, paid in basket shares with holder dilution. |

The status sentence appears once, above the first section's buttons: “Basket sharing is open. Investing is in development.” The last section's navigation row contains the xStocks and disclosure links. There is no separate fourth fee section or footer scroll stop.

Each illustration has three timed steps, advancing every three seconds while visible. It plays once and supports pause, resume, and replay. It pauses offscreen and when the tab is hidden. Reduced motion shows the completed illustration. The discovery animation highlights the same basket rather than changing the person, thesis, or allocation while the reader is looking at it.

Desktop chapter navigation supports wheel gestures, native anchor links, PageUp/PageDown, arrow keys, Home, and End. Custom scrolling requires a fine pointer, a viewport at least 1024px wide and 720px tall, and content that fits. Mobile, tablet, short windows, and overflowing content retain natural scrolling. Fit checks cover the chapter and the inside of the Card, since Card overflow can otherwise hide content. If content stops fitting, both CSS snapping and pending navigation state are released. Forms, dialogs, buttons, and nested scroll areas retain their native input behavior.

## Copy and navigation cleanup

This section also records relevant changes already present in the working tree before the final landing refresh. A Git diff establishes the current behavior, not authorship or a new verification date for every change.

- Landing, Create, Explore, shared baskets, Feed, manager discovery, and sample profiles use shorter descriptions and action labels.
- Public Create finishes with “Share basket”. Shared baskets retain “Example amount”, “Use this mix”, and a disabled onchain action labeled “Coming soon”.
- Sample bios, basket theses, and activity text were shortened in the shared sample dataset. Existing concept links and exact allocation validation remain in place.
- Public language explains people's stock picks directly. Navigation uses “Managers”; this is not evidence that sample profiles are licensed fund managers or that their performance has been verified. Internal creator identifiers and route names remain unchanged.
- The primary desktop navigation is Stocks, ETFs, Baskets, Feed, and Managers. The floating mobile navigation is Baskets, Feed, Managers, and Create. The Managers route selects the people tab.
- Header, home, and page metadata use the updated stock-basket wording. The metadata base is still localhost; BAS-026 remains open.
- The wallet button is visible across header routes. The current wallet connection code defers a pending connection until provider effects have attached and matches the pending request to the selected adapter.
- `/create/onchain` currently redirects to `/create`. Older descriptions of an accessible separate creation wizard are superseded. The transaction implementation remains in source, but that route does not currently expose it.

## Implementation map

| Files | Recorded change |
|---|---|
| `app/components/home/home-experience.tsx` | Three chapters, concise copy, composition illustrations, stable discovery example, timed scene controls, and existing-route CTAs. |
| `app/components/home/use-home-chapter-scroll.ts` | One-gesture navigation, keyboard support, momentum handling, content-fit detection, and native-scroll fallback. |
| `app/app/globals.css` | Scoped landing columns, viewport sizing, large headings, flat rows, responsive spacing, focus states, reduced motion, and mobile navigation clearance. |
| `app/app/layout.tsx` | Updated title and metadata descriptions. |
| `app/components/shell/nav-items.ts`, `mobile-nav.tsx`, `site-header.tsx` | Manager naming, matching route selection, and public versus onchain header context. |
| `app/components/create/concept-create.tsx`, `app/app/create/page.tsx`, `app/app/create/onchain/page.tsx` | Shorter create copy, share action, metadata, and the redirect described above. |
| `app/app/preview/page.tsx`, `preview-client.tsx` | Shared-basket wording, example amount, reusable mix, share link, and coming-soon onchain action. |
| `app/app/explore/concept-gallery.tsx`, `explore-client.tsx` | Shorter basket discovery copy and sample cards. |
| `app/app/feed/page.tsx`, `feed-client.tsx` | Shorter feed headings and sample activity copy. |
| `app/app/leaderboard/page.tsx`, `leaderboard-client.tsx` | Manager discovery wording and sample profile presentation. |
| `app/app/creator/[pubkey]/page.tsx`, `layout.tsx` | Shorter sample profile copy and metadata. |
| `app/lib/concept-samples.ts` | Shared sample bios, basket theses, and activity descriptions. |
| `app/components/shell/wallet-picker.tsx`, `app/lib/wallet-connect-scheduler.ts`, `backend/tests/wallet-connect-scheduling.test.ts` | Pre-existing connection scheduling work and two regression tests; preserved and documented without claiming a new extension-wallet signing check. |
| `brand.md`, design notes, entry-point docs | Durable product language, layout decisions, current route behavior, evidence, and handoff. |

## Colosseum Copilot setup

The owner explicitly requested the [official onboarding guide](https://colosseum.com/copilot/onboard.md) and installation of [ColosseumOrg/colosseum-copilot](https://github.com/ColosseumOrg/colosseum-copilot).

- Official skill version 2.0.1 was installed at `~/.agents/skills/colosseum-copilot`.
- `~/.codex/skills/colosseum-copilot` points to that installation with a symlink.
- The owner completed the browser sign-in approval. Authenticated research access was verified during setup; this records that check rather than guaranteeing a future session remains signed in.
- Credentials are handled by the local helper and keychain. No token, approval URL, or credential is included in repository documentation.
- Session sharing was disabled at the recorded status check. Superstack telemetry remains off.
- The legacy installation was backed up to `/private/tmp/colosseum-legacy-backup-2026-10-02/codex-colosseum-copilot`.

## Research and design decisions

The full, dated [Colosseum comparison](colosseum-comparison-2026-10-02.md) is now stored in the repository. It combines Colosseum project history, current primary sources, The Grid records, and repository evidence. Product/code review, competitor research, and judging context were delegated to separate agents. The later implementation also received independent copy and scroll-behavior reviews.

Cesto and Instinct informed the landing's visual hierarchy: one large, concrete basket example and a short explanation. Basalt keeps its own palette and typography. Symmetry and GLAM show why a basket token and management fees alone are insufficient differentiation. The report distinguishes historical hackathon evidence, current product claims, and independently verified behavior. Its proposed user interviews and future investment flow are recommendations, not completed work or existing traction.

## Product boundaries

The public flow creates and shares basket ideas without a wallet. It does not currently execute an investment or generate fees. The landing describes the intended xStocks model and marks future fees accordingly.

Immutable V0 has historical September devnet proof with project mock tokens. Official xStocks admission remains pending. Managed V2 is a separate fixed-pair localnet prototype; `/managed` is simulated and `/managed/lab` is a loopback development interface. This UI work does not establish a public V2 deployment, live xStocks backing, verified investment returns, or extension-wallet signing. On-chain redemption rights and the application's outstanding direct-RPC fallback remain distinct.

## Verification

The implementation pass completed app typecheck and production build successfully, with 25 static pages generated and the dynamic route list produced. `git diff --check` passed. The earlier copy pass also recorded the concept-share integrity test and a successful four-step share-link flow; see the dated design note for that evidence.

Browser checks covered 375×812, 768×1024, 1024×720, 1280×720, 1440×900, and a 1280×600 short window. The checked layouts had no horizontal overflow or clipped scene bodies. At 1280×720, the three sections each measured 664px. Keyboard PageDown moved the first section to the second; one wheel gesture moved to the third and an upward gesture returned to the second. Anchors, animation controls, Explore, Create, and featured-basket links were checked. Mobile disclosure links remain reachable above the floating navigation.

Reduced motion was source-reviewed, not tested through OS-level emulation. No protocol/math code changed in the landing pass, and no new chain smoke, mainnet deployment, or full Rust/backend test run was claimed. The local preview was served at `http://127.0.0.1:3000/#overview`; no remote UI deployment or Git commit/push was performed in this pass.

## Evidence and preserved work

Final screenshots are stored with the documentation:

- [Desktop overview](assets/landing-2026-10-02/overview.jpg)
- [Desktop discovery](assets/landing-2026-10-02/discover.jpg)
- [Desktop build](assets/landing-2026-10-02/build.jpg)
- [Mobile overview](assets/landing-2026-10-02/mobile-overview.jpg)
- [Mobile build and footer](assets/landing-2026-10-02/mobile-build.jpg)

Temporary source backups remain at `/private/tmp/basalt-landing-before-2026-10-02`, `/private/tmp/basalt-copy-pass-2026-10-02`, and `/private/tmp/basalt-home-before-refresh-2026-10-02`. The repository copies of the report and screenshots remove the documentation's dependency on those temporary evidence files.

The working tree also contains pre-existing governance/deployment-verifier changes, package-file changes, wallet connection scheduling work, and generated video directories. These were preserved, not reset or included in an unrelated commit. The wallet scheduler defers connection until provider effects have subscribed and tracks the selected adapter; its dedicated test file exists, but this landing pass does not claim a fresh wallet-signing test. Governance completion and deployment authority changes remain governed by their own evidence.

## Earlier iteration entry points (superseded)

Read [handoff](../handoff.md), [brand](../brand.md), the [landing design](design-home-chapters-2026-10-02.md), and the [documentation map](README.md). Use the [operational backlog](implementation-backlog.md) for unfinished release work. Preserve the existing working tree. Do not restore the superseded four-chapter design or a public onchain create route solely because an older note describes it.


## Documentation sync

The follow-up documentation pass updated 20 Markdown files, reconciled active route and copy descriptions, preserved older design/research records as historical, and copied five screenshots into the repository. README, app README, AGENTS, CONTEXT, CLAUDE, handoff, plan, brand, the documentation map, and relevant product/design/backlog documents now point to the current record. Local Markdown links and `git diff --check` passed. This follow-up changed documentation and evidence assets only; it did not rerun application builds or tests.


## Real-close model performance and full public-flow audit

The owner approved historical sample-basket performance computed from real market closes. Added six baskets while keeping the first four featured models and existing links intact. Shared cards, preview and profiles now show Model price and 7D; `/leaderboard` defaults to the ten models in return order with a People tab. The home keeps its visual creation/management-fee section and links to the weekly table.

The audit also corrected indexed share-price returns, missing 7D values, snapshot freshness, raw-share/percentage units, benchmark consistency, null rendering, short-allocation counts, malformed copy recovery, mobile action widths and step focus. Shared requests refresh after expiry and when a hidden tab returns. All details, source observations and final verification are in the [current audit](product-performance-audit-2026-10-02.md). Earlier session sections are chronological history.
