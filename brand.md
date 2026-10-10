> **Shared Stock mix, 2026-10-10:** Preview and onchain About now use the same boxed Bklit allocation card. Exact devnet mocks use visibly test-marked stock themes and the preview logo colors, superseding Core/Pulse/Orbit/Wave artwork. Actual mint/weights and financial eligibility remain intact; direct Create opens the correct mode. Published at https://basalt.markets from `b145e324062f6a82d612959a06ee27f4a214a983`; all six CI jobs, hosted build and live Chrome verification passed. Backend remains at `307053d`. See [implementation and release evidence](docs/stock-mix-parity-2026-10-10.md), [devnet onboarding audit](docs/devnet-onboarding-audit-2026-10-10.md) and [issuer research](docs/xstocks-devnet-availability-2026-10-10.md).

> **Onchain gallery, 2026-10-10:** Missing devnet identities use stable decorative basket names and varied local collage covers. Render illustrated token marks with actual weights, and local line portraits for missing creator avatars. Use real public profile names when available; do not invent creator identities, asset backing or returns. Preserve exact mint identity in the detailed view. [Implementation and release record](docs/onchain-basket-identities-2026-10-10.md).

# Brand — Basalt

Basalt helps people create, explore and share stock-basket ideas. The calm centered opening names stock baskets directly and leads into the gallery; conditional future management fees belong in the lower creator section. Public investing and fee revenue remain unavailable. The wallet-free builder keeps both journeys easy to explore. Public onchain creation uses project mock tokens on Solana devnet. The wallet workspace presents one action at a time, with a single submit button and inline preparation, wallet approval and confirmation. [Current flow](docs/devnet-single-pipeline-2026-10-03.md).

_Last updated 2026-10-03. The Basalt name and three-column mark supersede the historical FolioX, Roman, and Foundry identities. The electric-yellow system in `docs/design-cyberpunk-yellow-v1.md` supplies the color tokens; `docs/design-basalt-v1.md` defines the mark. Telemetry remains off._

## Identity

- **Name:** Basalt, capitalized in prose. “BASALT” is reserved for graphic wordmarks.
- **Mark:** the three hexagonal columns on a shared baseline in `app/components/shell/site-header.tsx`. Reuse its geometry for favicon, social image, and video. Columns represent constituents and their target allocations.
- **Wordmark:** the mark plus a yellow “B” and foreground “asalt” in Chakra Petch. The quiet “· xStocks baskets” suffix may accompany the header wordmark, but must not imply the current devnet assets are issuer-backed.
- **Canvas:** near-black industrial surfaces in dark mode. Electric yellow `#FCEE0A` is the primary action, focus, and key state accent. Light mode uses the darker yellow fill and text tokens from `app/app/globals.css` to keep contrast. Use semantic tokens in components, rather than hardcoded hex.
- **Data:** cyan, magenta, green, and violet are chart-series colors only. They do not decorate product chrome. Muted gray may represent a benchmark; source and as-of time must accompany financial data.
- **Typography:** Chakra Petch (`--font-display`) for wordmark, headings, and hero numbers; Geist for body and controls; Geist Mono for compact labels, prices, percentages, and addresses. Keep critical mobile text readable.
- **Motifs:** causeway tessellation, stacked allocation bars, hexagon and plus details, and zero-padded step numbers. Original grainy editorial collage is now used for basket covers. Keep those expressive images inside basket discovery; avoid decorative gradients, faux browser chrome and historical Roman/Foundry motifs.

## Current landing direction, 2026-10-03

Keep the calm centered **Find a stock basket / you believe in.** headline. Use **Or create one that fits your needs.** The four featured cards lead into six compact benefits, the existing `#build` creator/fee visual, then `#how-it-works`. Remove the home status and landing-only model source/date/methodology note; retain per-card **Model price** and truthful historical-model meaning elsewhere.

Use exactly **I am an investor** for the two-step journey, and **I am a basket manager** for stock mix → thesis → management fee. Real original covers provide continuity. Investing and earnings stay conditional on launch, with no automatic copy/rebalance or performance promises. Two collapsed issuer/fee details may remain at the bottom; avoid a large FAQ. [Current scope and recorded validation](docs/landing-journeys-2026-10-03.md) supersede the composition instructions below.

## Previous accepted landing narrative, 2026-10-02

Use a calm centered opening: **Stock baskets, made by people**, then **Find a stock basket / you believe in.** The body is **Stock baskets built around a point of view. / Find one you like, or share your own.** Lead with **Explore baskets** to `#discover`, followed by **Create a basket** to `/create`. Keep one status: **Basket sharing is open. Investing is in development.**

The **Different takes.** gallery follows immediately. After the gallery, `#build` pairs **Good stock picks can come from anyone.** with one paragraph: **Share your strategy in a stock basket. When investing opens, earn management fees as people back it.** Its action is **Build your stock basket**. Keep the existing creator-reward visual beside this lower invitation, with the annual cap separate from the 90/10 fee-share allocation. Fee meanings, dilution and future availability remain explicit. This is an in-page section, not a new route.

All ten covers remain distinct, the original four featured artworks remain unchanged, and Create's catalog/removal/grouped-input improvements remain. [The hero restoration](docs/home-hero-restoration-2026-10-02.md) and [cover refresh](docs/basket-cover-refresh-2026-10-02.md) are the current layout/artwork evidence. Older composition records below are historical.

## Previous fee-first narrative, superseded for hero/layout, 2026-10-02

The large heading is **“Create stock baskets. Earn management fees.”** Its body makes earnings conditional on investing opening. The filled action says **Create a stock basket** and the secondary action explores baskets. One adjacent sentence says **“Basket sharing is open. Investing and fees are in development.”** Keep the annual management-rate cap (**up to 3%**) distinct from the **90% creator / 10% Basalt fee-share split**. Those percentages are fee allocation, never investment returns. Payment is in newly issued basket shares with holder dilution; annual management fees accrue whether prices rise or fall and are not contingent on investment gains.

The stock/basket/people illustration and compact Bklit fee bar now sit in the hero, with fee information first. The lower section retains only the “Good stock picks can come from anyone.” statement and **Share your stock basket**. Preserve the four featured original covers and model metrics, native scrolling, responsive stacking and concise English without em dashes. Home focus outlines use the theme's text-grade yellow token.

Create keeps all 41 available catalog entries in a bounded native scroll region, with a clickable fade that disappears at the end. Weight removal retains exact positive 10,000-bps totals; fewer than two assets blocks Continue and Add stocks returns focus to search. USD/count/percentage displays use full comma grouping, safe unavailable values and directional tiny-value labels. Grouped amount input preserves decimal intent, caret and existing copied precision without changing submitted values or protocol math.

Read [the earlier home/Create audit](docs/home-create-feedback-2026-10-02.md) for its dated source map and 38-test/build evidence. The final correction places the fee visual below discovery; its Create improvements remain current.

## Historical landing narrative, superseded by the home/Create owner feedback

The calm hero and four named basket cards lead discovery. The lower landing now combines the creator story and action in one `#build` section. On the left, “Good stock picks can come from anyone.” has one short paragraph about sharing a strategy and earning management fees when investing opens, followed by “Build your basket” linking to `/create`. On the right, stock logos lead to an original-cover “Your basket / by you” card and generic people. A compact Bklit bar shows the planned management-fee share split: 90% to the publisher and 10% to Basalt. Keep those numbers secondary to the basket journey, with labels that identify fee shares. Native vertical scrolling remains.

Feed pairs short viewpoints with visual basket cards; Managers pairs people with their baskets. The four sample names are Terminally Online, Touch Grass, No Hands and Daily Ritual. Covers are original editorial artwork with no financial meaning. On `/explore`, the Baskets gallery reuses full-cover `BasketStoryCard` cards with person links in one column on mobile, two on tablet, and four on wide screens. This browse page uses a vertical grid. Its separately identified indexed section, search, sorting, and provenance boundaries are unchanged. Show sample context once per surface and never invent returns, assets under management, rankings or fee revenue.

A single line below the creator section says “Built for xStocks, tokenized stocks and ETFs on Solana.” Two native details contain the issuer-instrument explanation and planned V0 fee model: up to 3% annually, a 90/10 publisher/protocol split, paid in newly issued shares with dilution. The hero retains one status sentence: “Basket sharing is open. Investing is in development.” The latest visual and build verification is recorded in the current landing audit.

Native scrolling applies at every viewport. The landing’s mobile basket row allows manual horizontal browsing; the Baskets browse page uses its one/two/four-column grid. Do not restore the retired full-screen chapter hook, timed demonstrations, donut hero or large fee panel. Use existing Card primitives, optimized images and visible keyboard focus. See [the current visual-creation audit](docs/design-home-visual-creation-2026-10-02.md) and [earlier gallery design](docs/design-home-discovery-2026-10-02.md).

## Product hierarchy

Basalt supports discovery and creation. The creation path lets people choose a template or assets, set a **100%** mix and optional fees, choose an illustrative dollar amount, then review and share a concept preview. A $1,000 example is prefilled and $10/$100/$1,000 shortcuts are offered; these are preview amounts, never a purchase or deposit. No wallet, token balance, or backend is required.

The discovery path lets people explore sample creators and basket ideas, inspect a thesis and current allocation, then bring that mix into their own wallet-free preview. Following a creator is a social subscription; it does not mirror future activity or buy assets. Sharing a preview makes the creator’s thesis and composition easy to inspect.

As of 2026-10-02, `/create/onchain` redirects to `/create`. The retained transaction implementation still contains owned-token deposits, legal acknowledgments, exact 10,000-bps totals, fee caps, integer rounding, raw Token-2022 transfers, and on-chain checks. Those requirements apply if the transaction flow is exposed again. Allocation controls say “Balance to 100%.”

Keep each decision screen scannable: one task heading, one actionable validation message, and short visible copy. Optional fee controls have plain explanations. The concept review reuses the live composition preview and finishes with “Share basket.” It does not show a hypothetical minted share. In the on-chain flow, required legal explanations remain accessible and a creator receives **one display basket share** at genesis; the 1,000,000 raw units are not a million user-facing shares.

The basket first view explains its thesis, constituent allocation, entry/exit/annual fees, risks, and buy/redeem actions. Reference price, performance, source timestamps, raw amounts, mint addresses, drift arithmetic, fee formulas, and operator data belong in clearly labeled advanced details that remain keyboard accessible.

Redemption copy says that basket shares are exchanged for proportional underlying tokens. The exit fee is charged **in shares**; the fee shares go to fee recipients, and the remaining shares are burned to determine the tokens returned. Show actual quantities and the effective fee before signing. “Oracle-free” and “permissionless” describe protocol behavior in advanced information; there is no oracle fee.

## Truth and legal voice

Use short, natural English sentences and direct action labels. Do not use em dashes in interface copy. Give each section one main thought, usually one heading and one short paragraph. Avoid repeated disclaimers, extra context chips, and slogans that restate the heading. “Stock Baskets” names the concept in navigation and marketing; explain that the idea uses stocks and ETFs. Reserve “onchain equity basket” and “xStocks-backed strategy token” for pages where actual backing is substantiated. Never call a concept preview a deployed basket or a completed investment, and never call the product a registered ETF, fund, guaranteed return, safe investment, financial advice, or managed money.

Current devnet basket constituents are **project mock Token-2022 mints**, not official issuer-backed xStocks. The owner removed repeated concept/preview badges and no-purchase notices on 2026-10-02. Keep the main pages minimal, and describe outcomes through accurate action labels such as “Share basket” and “Coming soon.” Illustrative activity and allocation must never be presented as on-chain execution. The on-chain transaction pages continue to identify devnet/mock assets and sourced reference values where used. A real token balance is not proof of issuer backing. Do not fabricate NAV, holdings, price, performance, or a live-data timestamp; show an honest unavailable state when the source fails. Avoid “live AUM” for an estimated reference NAV.

Keep the legal acknowledgments in the retained transaction implementation and the legal page; the `/create/onchain` route currently redirects. The wallet-free concept preview has no deploy action. `LEGAL_REVIEW_REQUIRED` remains a release requirement in `AGENTS.md` and `docs/basalt-v0-spec.md`, including jurisdiction, issuer-instrument, fee, and risk review. UI review chips were removed by the owner; their absence is not legal approval. Redemption must remain accessible regardless of a mint pause, backend outage, or price-feed outage.

## Interaction checks

Primary actions and focus rings use the yellow token with accessible contrast. Desktop and mobile create, detail, buy, and redeem flows must support keyboard focus, visible errors, at least 44×44 px touch targets, reduced motion, and honest loading/empty states. Use the existing Bklit-derived chart components and meaningful text summaries. Keep primary information out of tiny micro-labels.

Historical palette and type choices from the 2026-09-01 Mineral Desk pass and 2026-09-03 intermediate directions are superseded by this Basalt identity.


## Model metrics and weekly discovery, 2026-10-02

Preserve the four featured covers and all ten unique sample identities; the opening follows the calm stock-basket discovery correction above. Keep only Model price and 7D on basket cards; use signed green/red returns and tabular numerals. The ten-basket leaderboard is a restrained artwork/name/price/return table. One source/date note and collapsed methodology explain historical models. Never imply sample profile returns are achieved investor results. People remains a leaderboard tab. Keep copy concise and avoid em dashes.


## Earlier basket allocation and share artwork, 2026-10-09

The product domain is **https://basalt.markets**. Basket allocation graphics use the owner's approved bright reference colors: NVDA `#F9F528`, QQQ `#1FDBF8`, WMT `#F33EA3`, GLD `#36D887`. Other assets use stable bright identity colors from `allocationColor`; general price-chart palettes stay separate. These colors encode holdings rather than decorating the product chrome.

For share posters, use the chosen editorial cover as a small header identity and weighted isometric stock stacks as the main illustration. Keep the full logo/name/ticker/percentage ledger. The footer contains basalt.markets only, with no duplicate allocation strip or annual-fee line. Actual fee disclosures remain in the product. [Implementation and evidence](docs/basket-share-refinement-2026-10-09.md).


## Current basket colors from stock and ETF logos, 2026-10-09

Use each asset's actual stock/ETF logo as the source for its basket allocation color. The newest owner direction supersedes the earlier fixed bright four-color mapping above and the earlier restrained ticker palette. Colors should read as belonging to their asset, with representative colors extracted from real logo pixels and cached for consistent rendering. All 1,271 issuer logos have cached colors, with alpha-weighted dominant hue and a minimal visibility lift for dark colors. The confirmed algorithm, example colors and evidence are in [the current logo-color record](docs/logo-derived-basket-colors-2026-10-09.md). Do not treat earlier screenshots or hex tables as the latest color authority.

Keep the Basalt primary action/focus accent `#FCEE0A`, public domain **https://basalt.markets**, selected-cover identity, weighted isometric stock stacks and full holdings ledger. The share poster footer shows the domain without a duplicate allocation strip or annual-fee label; actual product fee disclosures remain. No return, investment outcome or brand endorsement is implied by an extracted logo color.
