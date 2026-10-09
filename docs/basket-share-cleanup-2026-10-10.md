# Share poster cleanup, 2026-10-10

Status: implementation prepared; production verification pending.

The owner requested a quieter exported image. Removed the percentage and ticker labels underneath each stock stack and the `+N holdings below` line. Stock logos and proportional stack heights/colors remain; every holding’s name, ticker and percentage still appear in the full ledger. Removed the visible `Stock-close model · date` line beneath the weekly percentage. The signed `7D` figure remains.

This is a presentation-only change to the Canvas PNG. Existing exact-mix matching, finite-value and source-time eligibility guards, shared cache and image regeneration remain. Source/date provenance is retained internally and in the existing accessible description; no historical number or eligibility rule changed. The preview’s broader source explanation and compact social-link OG renderer are outside this cleanup.

The latest release baseline is `6eba591`; existing backend/devnet security, namespace/readiness and transaction code are untouched. ## Verification

- 31 focused existing image, layout and performance-eligibility checks passed, zero failures/skips. Existing Canvas assertions were adapted to the owner’s new output requirement; no additional test suite was introduced for this visual-only deletion.
- Production build passed on Next.js 15.5.27 with 29 static pages.
- Independent read-only review found no scope mistakes or regressions. The previous grid reservation/export dimensions are retained.
- The local production browser generated the actual Terminally Online PNG: unlabelled stock stacks, only `7D +1.11%` beneath the thesis, and every holding’s ticker/weight in the ledger.

![Local cleaned share poster](assets/basket-share-cleanup-2026-10-10/local-share.jpg)

Exact published source and live verification will be appended after promotion.
