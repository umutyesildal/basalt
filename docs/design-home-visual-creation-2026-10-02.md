# Basalt visual creation section

Date: 2026-10-02. Canonical checkout: `/Users/umutyesildal/orca/workspaces/createyouretf/createyouretf`.

## Owner direction

The owner liked the hero and basket artwork but found the lower landing too text-heavy. This revision replaces the community paragraphs, “From idea to investment” steps and repeated final create invitation with one visual section. The earlier [discovery audit](design-home-discovery-2026-10-02.md) still records the hero, original artwork, Baskets gallery, Feed and Managers work. Its previous lower-page composition is superseded here.

## Design brief

- Direction: Basalt's existing dark editorial design, with one connected product illustration.
- Density: one short paragraph and one create action beside the retained statement.
- Surface: a single cover card, free-standing stock/person symbols and a compact fee graphic.
- Type: existing Chakra Petch heading, Geist body, restrained fee labels.
- Motion: static illustration; no timed scenes, auto-scroll or chart reveal.
- Keep: original covers, yellow actions, native scroll, a direct path to creation.
- Remove: repeated explanations, numbered text-only steps, the final duplicate CTA block and extra fee label.

## What changed

[HomeExperience](../app/components/home/home-experience.tsx) keeps the hero and discovery gallery intact. Its `#build` section now contains:

> Good stock picks can come from anyone.
>
> Share your strategy in a basket. When investing opens, earn management fees as people back it.
>
> Build your basket

The action opens the existing wallet-free `/create` builder.

[CreatorRewardVisual](../app/components/home/creator-reward-visual.tsx) shows three stock marks flowing into an original cover card, followed by generic person icons. “Your picks”, “Your basket”, “by you” and “Their portfolio” describe the intended future journey. These are a schematic illustration, not an allocation, live investors, follower count or transaction record.

A small Bklit horizontal bar shows the planned management-fee split: 90% to the publisher, 10% to Basalt. “Future management fees” explicitly identifies the metric and its status. There is no return percentage, hypothetical AUM or dollar-income estimate. The figures describe shares of the management fee, not investor returns or the annual fee rate. The visual has a text alternative, and the percentages remain visible text.

The former `#how-it-works` anchor remains for compatibility, now around the compact xStocks line and native disclosures. “Built for xStocks, tokenized stocks and ETFs on Solana.” preserves the product context. Optional details explain issuer-instrument status, the planned 3% annual fee cap, newly issued basket shares and holder dilution. These are intended product mechanics; the hero still says investing is in development.

[Global CSS](../app/app/globals.css) removes the obsolete belief/step/invitation selectors and adds the connected composition. Desktop has text and art in two columns; mobile puts the illustration below the invitation. Stock images have a ticker fallback. The illustration has no animation or controls to distract from creation. Existing cover artwork is reused without generating new assets.

## Scope

The hero, gallery, shared allocations, Baskets, Feed, Managers and Create behavior are unchanged by this pass. No protocol math, backend, transaction path, dependencies, commit, push or remote deployment is included. Existing unrelated dirty work is preserved.

## Verification

- Final `npm --prefix app run build` passed, including TypeScript checks and 25 static pages. Existing workspace-lockfile and pure-JS bigint warnings remain non-fatal.
- Browser review: 320px, 375px, 768px, 1280px and default 1165px show no horizontal document overflow. The 640px transition was also inspected during the layout pass.
- Actual rendered fee SVG at 375/768/1280px was measured and asserted against 90% and 10% of plot width. Both segments have positive widths and exactly fill the plot. [Saved geometry](assets/visual-creation-2026-10-02/fee-geometry.json).
- “Build your basket” opens the unchanged `/create` builder on mobile. Native fee disclosure opens by click and closes with the space key. No wallet or chain transaction was performed.
- The picture and bars are static. Bars explicitly disable animation, so no reduced-motion mode is needed for the new composition. Existing page reduced-motion CSS remains. OS motion preferences were not changed.
- `git diff --check` and current Markdown link checks passed. New interface copy contains no em dashes.
- No Rust/backend suites were run because no financial math, accounts or transactions changed.

## Chart correction and cost

The new illustration exposed a pre-existing bug in the local Bklit-derived [Bar](../app/components/charts/bar.tsx): a horizontal stacked segment subtracted the previous cumulative position from its own value position, producing a negative width for the 10% segment. It now uses `scale(offset + value) - scale(offset)`. Horizontal stack gaps shorten internal segments without moving cumulative starts past the endpoint. Grouped and vertical bar geometry remain unchanged.

[BarChart](../app/components/charts/bar-chart.tsx) now accepts an optional `valueDomain`. Supplied bounds bypass automatic padding/nice so a percentage chart can occupy the exact 0–100 range. Existing consumers without the prop retain automatic bounds. The new visual passes `[0, 100]` with no stack gap. Agent checks covered 54 width/gap geometry cases and explicit/default domain behavior; actual browser SVG measurements above verify the integrated result.

The existing Bklit renderer increases the reported landing First Load JS from the preceding 128kB build to 201kB. No package was added. This pass favors reuse of the required chart system; it does not claim a performance improvement.

## Saved views

- [Final desktop composition](assets/visual-creation-2026-10-02/final.jpg)
- [1280px desktop](assets/visual-creation-2026-10-02/desktop.jpg)
- [768px tablet](assets/visual-creation-2026-10-02/tablet.jpg)
- [375px mobile fee section and footer](assets/visual-creation-2026-10-02/mobile.jpg)

The local preview is left at `http://127.0.0.1:3000/#build`; the viewport override is reset. Source backups are in `/private/tmp/basalt-visual-create-before-2026-10-02`. No commit, push or remote deployment was performed.
