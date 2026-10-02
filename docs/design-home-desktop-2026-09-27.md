# Desktop homepage direction — 2026-09-27

> **Historical design:** The composition, scrolling behavior, and four-scene implementation below were superseded by the [three-chapter landing on 2026-10-02](design-home-chapters-2026-10-02.md). Keep this file as reference history, not the current implementation contract.

This note records the visual cues reviewed for the homepage refresh and the choices applied in `app/components/home/home-experience.tsx`.

## Observed references

- [Stax](https://stax.finance/) — a large, clean headline paired with one animated flow diagram that explains a deposit moving through a vault, stocks, and a basket.
- [Cesto Labs](https://app.cesto.co/labs) — an idea card with its author beside a contributors sidebar, presenting social proof as part of the idea rather than as long copy.

These are composition references only; this note records the visible patterns reviewed in Chrome.

## Basalt implementation

The home page uses a centered canvas up to 1,680 px wide, scoped to the homepage component. Its four scenes remain in normal document flow with no scroll snapping; native anchor links scroll smoothly with a single 96 px header offset and revert to automatic motion for reduced-motion preference:

1. A centered stock-and-social headline sits above a broad creator-story stage. Three numbered sample stories pair the creator’s post and thesis with a large, pinned allocation graphic and a “Copy this idea” action. The story sequence advances once at five-second intervals, pauses while hovered, focused on story content, offscreen, or while the tab is hidden, and has pause, resume, replay, and manual selection controls. Native links carry the reader from ideas to ownership, then to the closing actions.
2. A featured sample idea with its author and allocation bar, beside other sample creators and ideas.
3. A managed-share example with working 10-share and 25-share controls that recalculate each asset’s proportional amount.
4. Two large starting paths for building a stock mix or meeting creators, followed by direct links to baskets and the feed.

The design keeps Basalt’s electric-yellow action color, Chakra Petch display type, Geist body type, Geist Mono labels, and asset-specific chart colors. Story changes use a short spring transition; reduced-motion preference disables autoplay and transform motion.

## Product truth shown in the page

Concept ideas and profiles are illustrative. Copying an idea starts an editable concept preview; it does not create automated future trades or a purchase. The V0 devnet fee note says generated basket fees split 90% to creators and 10% to treasury, and that concept previews earn no fees; current devnet assets are project mocks. The managed V2 scene stays labeled as a simulated localnet prototype with 0% fees.

## Desktop review targets

Review at 1440×900 and 1920×1080, plus the short 1280×720 case. Check that the story stage and allocation pins fit without clipping, all three creator stories and copy actions work, anchor links move smoothly without scroll snapping, each scene reads as a separate composition while scrolling naturally, and the 10/25 ownership values update. Confirm the mobile layout stacks the same actions without horizontal overflow.
