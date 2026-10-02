# Calm stock-basket hero restored, 2026-10-02

The owner's final clarification was to retain the earlier calm discovery opening and change its basket noun to **stock basket**. This supersedes the fee-first two-column hero recorded in [the earlier home/Create audit](home-create-feedback-2026-10-02.md). Its catalog, weight-removal and amount-formatting improvements remain in place, as do [all ten unique basket covers](basket-cover-refresh-2026-10-02.md).

## Current composition and copy

The centered opening uses **Stock baskets, made by people**, followed by **Find a stock basket / you believe in.** with the second line highlighted in yellow. Its two-line body reads **Stock baskets built around a point of view. / Find one you like, or share your own.** The primary **Explore baskets** action links to `#discover`; **Create a basket** links to `/create`. The single status sentence remains **Basket sharing is open. Investing is in development.**

The **Different takes.** gallery immediately follows the hero. After that gallery, the in-page `#build` section pairs **Good stock picks / can come from / anyone.** with **Share your strategy in a stock basket. When investing opens, earn management fees as people back it.** and **Build your stock basket** linking to `/create`. The existing creator-reward visual is in this lower section, beside the creator invitation. No new route was introduced.

The visual retains the planned **annual management rate up to 3%** and the separately labeled **90% creator / 10% Basalt fee-share split**. These are different concepts: the rate accrues over time whether prices rise or fall; the split divides fee shares. Newly issued share payment dilutes existing holders. Public investing and creator fee revenue remain unavailable. This pass changes no fee formula, protocol, model performance or deployment claim.

## Source and scope

`app/components/home/home-experience.tsx` restores the copy, action order and gallery-before-creation structure. `app/app/globals.css` restores centered spacing and responsive typography. Historical CSS was reconstructed from screenshots because the temporary backups were absent; this is not a claim of byte-for-byte CSS recovery. A desktop rule for viewport heights at most 800px compresses only hero vertical spacing so discovery images remain visible. Native scrolling and text-grade focus outlines are retained.

The ten-cover mapping, sample-only 64/80px preview thumbnail, all 41 reachable Create assets, exact positive 10,000-bps redistribution, two-stock progression guard, focus recovery and comma-preserving amount editing remain unchanged by the restoration.

## Final evidence

Root completed the final production build after the short-height spacing adjustment. The durable [build log](assets/hero-restoration-2026-10-02/build.log) records successful compilation, TypeScript checking and 25 static pages. Existing workspace-lockfile and optional native bigint warnings remain in the log.

| Check | Result and evidence |
|---|---|
| Desktop, 1280 × 720 | Discovery starts at y=502px with cards visible on the first screen; no horizontal overflow. [Screenshot](assets/hero-restoration-2026-10-02/home-desktop.png) |
| Mobile, 375 × 812 | Discovery starts at y=441px; no horizontal overflow. [Screenshot](assets/hero-restoration-2026-10-02/home-mobile.png) |
| Small mobile and tablet | Root checked 320 × 740 and 768 × 1024 without overflow. The 320px heading wraps cleanly over three lines. |
| Lower creation section | Fee visual follows the gallery in `#build`. [Screenshot](assets/hero-restoration-2026-10-02/build-section.png) |
| Weekly leaderboard | At desktop and 375px, all ten distinct cover URLs loaded with `complete && naturalWidth > 0`; no overflow or browser console errors. [Screenshot](assets/hero-restoration-2026-10-02/leaderboard.png) |

Root also reported recognized-sample preview checks at 320px with a 64px cover and 1280px with an 80px cover, without overflow. The implementation agent reported the existing concept-preview/sample integrity test passed after the thumbnail addition. The earlier **38-test** frontend run belongs to the previous home/Create freeze and was **not rerun** for this final restoration. Its logs and Create interaction evidence remain in the earlier audit.

This documentation pass edits Markdown only and checks local links. It did not run an app build, test, server or browser session. No commit, push or remote deployment is claimed.
