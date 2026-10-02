# Basalt discovery re-audit

> The lower landing composition and invitation copy below are superseded by the [visual creation revision](design-home-visual-creation-2026-10-02.md). The hero, galleries, artwork, Feed and Managers findings remain applicable.

Date: 2026-10-02, second design revision. Current canonical working tree: `/Users/umutyesildal/orca/workspaces/createyouretf/createyouretf`. This supersedes the earlier chapter design. No commit, push, or remote deployment was performed.

## Decision

The user's latest direction takes inspiration from [Instinct](https://www.instinctfi.com/) and [Cesto](https://cesto.co/): memorable basket names, expressive covers, recognizable people and ideas that are easy to inspect. This supersedes the earlier full-screen landing design. Keep Basalt's dark palette, electric yellow and Chakra Petch, with normal vertical reading and a compact discovery gallery. The mobile gallery's horizontal proximity snapping is separate from the retired full-screen section navigation.

## Current code flow

- [HomeExperience](../app/components/home/home-experience.tsx): hero, basket gallery, creator invitation, future investing steps, xStocks/fee details and final create CTA. The status remains: "Basket sharing is open. Investing is in development."
- [BasketStoryCard](../app/components/basket/basket-story-card.tsx): decorative cover, short thesis, asset marks and optional creator. Clicking the basket opens its wallet-free preview through [concept-share](../app/lib/concept-share.ts). No performance figure is rendered.
- [Feed](../app/app/feed/feed-client.tsx): sample viewpoints paired with compact basket cards. Devnet activity is collapsed and fetched only when opened.
- [People and baskets](../app/app/leaderboard/leaderboard-client.tsx): people are the default tab, with their baskets below; the alternate tab reuses the basket cards. Devnet rankings remain a separate collapsed section. [Page routing](../app/app/leaderboard/page.tsx) preserves the `tab` query.
- [Explore](../app/app/explore/concept-gallery.tsx) now reuses the same full-cover `BasketStoryCard` with basket and person links. Its browse grid has one column on mobile, two from 640px and four from 1024px. The indexed section, search, sort and provenance remain unchanged. [Global CSS](../app/app/globals.css) owns the home and story-card layout.

## Shared examples

The [sample contract](../app/lib/concept-samples.ts) preserves stable IDs, allocations, starting amount, zero fee fields and href functions. Names, symbols, short theses, bios and activity copy changed together. `BASKET_STORY_COVERS` maps the existing IDs to four `/images/baskets/*.png` covers.

| Previous name | New name | Symbol | Existing allocation story |
| --- | --- | --- | --- |
| Mega-Cap Tech | Terminally Online | ONLINE | Platforms and chipmakers |
| Index Core | Touch Grass | GRASS | SPY core with additional picks |
| Motion | No Hands | AUTO | Mobility, chips and platforms |
| Quality Compounders | Daily Ritual | DAILY | Familiar brands and services |

These are illustrative baskets and profiles. The covers are editorial artwork, not holdings or performance charts. The names do not imply automated management, lower risk or an investment track record. Current copy describes management fees as a future feature; it does not claim current earnings or a live xStocks deployment.

## Performance findings

No trustworthy published basket performance record is attached to these four examples. No return fields or new return API were added in this pass.

- [Yahoo fetch](../backend/src/workers/yahooFetch.ts) and the [Yahoo proxy](../backend/src/api/server.ts) support underlying stock/ETF daily close history, including `1y`. This can support a separately labeled historical price reference. Runtime availability and complete coverage were not verified here. The parser reads `quote.close`; it does not implement dividend-reinvested total return. The existing [card price-series helper](../app/lib/price-series.ts) requests `5d` and retains close values rather than all timestamps, so it should not be used blindly to align multi-asset histories.
- [priceCompare](../backend/src/workers/priceCompare.ts) generates the chart's `xStock` candles with random jitter around Yahoo values. That series is synthetic and cannot supply real xStocks performance.
- [basketPerformance](../backend/src/api/server.ts), [basket rankings](../backend/src/api/social.ts) and the [ranking view](../backend/src/db/schema.sql) compare total NAV. Deposits and withdrawals can change these numbers without an investment return. The devnet leaderboard also labels the total NAV value "NAV / share". These are existing issues, not fixed by this discovery pass.

Future reference performance needs complete constituent coverage, common dates, a documented buy-and-hold calculation, source and as-of metadata, and explicit fee/dividend treatment. Missing data must stay unavailable. Do not attach invented percentages or curves to sample baskets or sample people.

## Verification

Production build and type validation passed, with 25 static pages generated. The existing concept-preview test passed, including allocation validation and share-link round trips for all renamed samples. Final browser evidence is recorded below.


## Composition and interaction

The hero is centered, with one headline, two short lines, a discovery CTA and a secondary create link. The gallery comes before the explanation. Its four original editorial covers carry the visual energy. It uses four columns on desktop, two on tablet, and a manually scrollable row on mobile. No vertical scroll hijacking, scene timer, animated progress rail or pause/replay control remains. The obsolete chapter hook was removed after a temporary backup.

The middle preserves “Good stock picks can come from anyone.” and adds an explicit invitation to publish a strategy and earn future management fees. The xStocks explanation now introduces the investment steps. Three short steps explain the investment flow being built. Optional native disclosures hold the instrument and fee details. The create invitation is last. Native keyboard scrolling and reduced-motion preferences are preserved. Existing Card primitives are reused; no new chart or motion dependency was added. Next Image serves responsive versions of the original PNG covers.

Create, Stocks and ETFs were preserved. Baskets now uses the same visual cards and sample names as Home, Feed and Managers. Its old inline allocation lists and duplicate gallery create CTA were removed; full weights remain available inside each linked basket. `/leaderboard` defaults to people, while explicit `?tab=people` and `?tab=baskets` remain supported. Existing devnet components are preserved and only mounted when their disclosure is opened.

## Follow-up: strategy invitation and Baskets gallery

The owner liked the new landing and requested a stronger reason to create a basket. The left headline stays unchanged. The right column now reads:

> Think your stock picks deserve a following?
>
> Build a basket around your investment strategy. Share your picks and give people a reason to follow your lead.
>
> When investing opens, you can earn management fees as people back your basket.

The filled “Build your basket” action opens `/create`. This frames publishing a strategy, attracting people and earning fees without implying current revenue. The how-it-works introduction retains the product explanation: “Bring stocks and ETFs together with xStocks, their tokenized counterparts on Solana.” No em dashes or new status notices were added.

Baskets now presents Terminally Online, Touch Grass, No Hands and Daily Ritual with the same original covers, asset marks, short theses and separate person links used on the landing. One “Sample baskets” heading identifies the examples. This is a vertical responsive grid, including on mobile. The indexed basket section and its controls are unchanged.

Follow-up verification: the final production build passed, including TypeScript and 25 static pages. Browser review confirmed four columns at 1165px, two at 768px, one at 390px and no horizontal document overflow at those sizes. The new landing invitation also fits at 390px. “Build your basket” opens the existing builder; the first gallery card opens Terminally Online with its seven allocations; its separate person link opens Maya Chen. The indexed results and controls still render. No chain transaction was performed.

Follow-up screenshots: [desktop invitation](assets/discovery-2026-10-02/invitation.jpg), [mobile invitation](assets/discovery-2026-10-02/invitation-mobile.jpg), [desktop Baskets](assets/discovery-2026-10-02/baskets.jpg), [mobile Baskets](assets/discovery-2026-10-02/baskets-mobile.jpg). Earlier screenshots below record the preceding revision.

## Artwork

Four original PNG covers are saved in [app/public/images/baskets](../app/public/images/baskets/). They were generated with the built-in image_gen tool. The [complete prompt set](basket-cover-prompts-2026-10-02.md) records the subjects and restrained halftone/cut-paper direction. These are decorative editorial images, not stock logos or financial evidence.


## Final browser evidence

- Reviewed at 320×740, 390×844, 768×1024, 1024×768 and 1280×720, plus the default 1165×984 desktop viewport. No horizontal page overflow was observed. The tablet gallery has two columns; the desktop gallery has four.
- Confirmed native vertical scrolling (`scroll-snap-type: none` on the document), Home/End behavior, discovery anchor, horizontal mobile gallery movement, and a visible 2px keyboard focus outline on basket cards.
- Opened both native xStocks/fee disclosures. Mobile create and disclosure links remain above the floating navigation at the end of the page.
- Confirmed the Terminally Online card opens the validated preview with its seven exact allocations. The create CTA opens the unchanged wallet-free builder. Its existing template names and allocations are separate from the shared discovery samples and remain unchanged.
- Confirmed `/leaderboard` defaults to people; explicit people/basket query tabs work. The devnet rankings disclosure loads existing indexed results when opened. This checks UI access, not the correctness of those financial metrics.
- Reviewed Feed and Managers on mobile and desktop. Compact cards omit repeated thesis and asset-count text, since the nearby viewpoint or person provides context.
- Reduced motion was source-reviewed, not emulated through OS settings. No automated browser test suite or chain transaction smoke was run. Protocol/math code was not changed.
- Final production build passed with 25 static pages, including TypeScript checking. The sample-integrity script passed. `git diff --check` passed. Existing non-fatal workspace-lockfile and pure-JS bigint warnings remain.

| Saved view | Evidence |
| --- | --- |
| Hero and basket preview | [hero.jpg](assets/discovery-2026-10-02/hero.jpg) |
| Basket gallery | [gallery.jpg](assets/discovery-2026-10-02/gallery.jpg) |
| Steps and create invitation | [steps.jpg](assets/discovery-2026-10-02/steps.jpg) |
| Feed | [feed.jpg](assets/discovery-2026-10-02/feed.jpg) |
| Managers | [managers.jpg](assets/discovery-2026-10-02/managers.jpg) |
| Mobile hero | [mobile-hero.jpg](assets/discovery-2026-10-02/mobile-hero.jpg) |
| Mobile gallery after horizontal scroll | [mobile-gallery.jpg](assets/discovery-2026-10-02/mobile-gallery.jpg) |
| Mobile footer | [mobile-footer.jpg](assets/discovery-2026-10-02/mobile-footer.jpg) |

The local production preview remains available at `http://127.0.0.1:3000/`. The current browser viewport override was reset. No commit, push or remote deployment was performed; existing governance, wallet and package changes were preserved. Source backups are in `/private/tmp/basalt-discovery-before-2026-10-02`, and previous Markdown versions are in `/private/tmp/basalt-discovery-docs-before-2026-10-02`.
