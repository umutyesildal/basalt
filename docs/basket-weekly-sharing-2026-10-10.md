# Seven-day basket performance in shared images, 2026-10-10

Status: implementation and local production build verified; live promotion pending.

## Owner request and visible behavior

Show the existing baskets’ weekly performance as `7D +4.56%`, including the downloaded sharing image. Existing curated cards already use the shared real-close model feed. Their PNG posters now include the same signed percentage, with a small `Stock-close model · Oct 9, 2026` date line. Positive, negative and zero values retain their actual sign and percentage-point scale. The original artwork, stock-logo colors, proportional stacks and full holdings ledger remain.

The image waits for an initial model request, remains exportable without a metric if the feed is unavailable, and regenerates when the selected basket’s valid weekly value/window changes. Old in-flight renders cannot replace newer results; replaced blob URLs are released. Custom mixes still export immediately without an invented history. The compact social-link OG renderer is unchanged; this request updates the downloadable PNG.

## Data and identity boundaries

The source remains the existing `/api/basket-performance` server loader, its five-minute shared cache and completed USD stock/ETF closes. These figures describe illustrative fixed-quantity buy-and-hold sample mixes, not achieved investor returns or onchain xStocks quotes. No new performance field is accepted in portable share links.

A shared exact-mix helper requires the named sample, matching unordered symbols and weights, unique holdings, and catalog-verified identity for any explicit mint. Changed names/weights/stocks, unknown mints and ticker/mint conflicts cannot borrow another model’s return. The selected item must be ready with finite positive model price, finite weekly return, aligned dates and the existing four-day completed-close/baseline tolerance. A partial response remains usable for a complete selected item.

The indexed onchain card now consumes the existing `return_7d` API field, converting its fractional ratio to percentage points exactly once and retaining valuation eligibility/finite-value guards. At the audit time all ten indexed devnet mock baskets had unavailable valuations and null returns. They correctly receive no sample-model substitute.

No backend deployment, program upgrade, authority transfer, wallet action or financial recovery activation is included. Namespace/readiness and transaction safeguards are preserved from current main `a8c260b`.

## Validation

- Full frontend checks: **290 Node tests and 57 Vitest tests passed**, zero failures/skips; concept-preview/sample-integrity script passed.
- The 18 added checks cover exact sample matching, reordered holdings, known/unknown/conflicting mints, edits, duplicate evidence, partial/unavailable data, date/staleness guards, positive/negative/zero signs, rendered PNG text/provenance and long-text clearance. Existing indexed-card quality behavior is covered.
- Next.js 15.5.27 production build passed, **29 static pages**.
- Independent read-only review found a response-wide partial-data suppression bug, corrected before validation. No remaining actionable issues in cache invalidation/cancellation, layout or indexed eligibility were identified.

The local production browser verified Terminally Online at `7D +1.11%`, using the October 2 to October 9 comparison. The image decoded as a 1600 × 1270 PNG and retained all seven holdings. At 1280 × 900 the document had no horizontal overflow, and Download PNG/native-share/X controls remained available. No social post was sent.

![Local 7D poster](assets/basket-weekly-sharing-2026-10-10/local-desktop.jpg)

Exact source/deployment identities and final public-domain checks will be appended after promotion.
