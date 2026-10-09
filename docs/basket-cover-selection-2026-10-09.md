# Required basket artwork, 2026-10-09

## Implemented scope

Fresh baskets now require an explicit image choice in public `/create` and both devnet entry points, `/create/onchain` and `/devnet`.

Public **Set up** contains the name, optional thesis, artwork and weights. The gallery has 34 original Basalt cover identities: ten existing sample covers and 24 new choices. Image buttons have accessible names, pressed states and visible selected feedback inside a bounded, theme-aware scroll region. Missing artwork blocks progression and sharing, with an independent submission guard. Copied baskets preserve their cover. Review, the live summary and custom preview headings display it. Existing sample cards retain their original distinct artwork.

The shared `CoverPicker` supports disabling selection during an active wallet pipeline. The registry references fixed local PNG/WebP assets. The 24 new WebP covers are 1254 × 1254 pixels and total 10,326,280 bytes, compared with 89,623,880 bytes for their PNG versions, an 88.48% reduction. The ten existing PNG covers remain unchanged. All 34 social JPEG thumbnails are 600 × 600 pixels, decode successfully and are distinct; together they total 3,454,580 bytes.

## Portable data and old links

`app/lib/basket-covers.ts` exports `BASKET_COVERS`, `getBasketCover`, `isBasketCoverId` and `resolveLegacyBasketCover`. Shared data contains an allowlisted ID, never a caller-provided image URL.

`ConceptBasket.coverId` remains optional at the input boundary for old callers. Validation supplies a valid cover for accepted legacy data and rejects explicitly invalid IDs. Fresh creation keeps a separate unset selection until the user chooses, so legacy normalization cannot bypass the requirement.

New compact v4 links contain:

```text
[4, name, amount, [symbol, weight, mintOrNull, ...], thesis, [entryFee, exitFee, managementFee], coverId]
```

Unprefixed JSON objects, compact v2 and mint-bearing v3 remain readable. Their fallback covers are deterministic from name and symbols; the ten sample names retain their established covers. Reordering legacy holdings does not change the fallback. v4 requires its complete cover-bearing shape. Unknown IDs, remote URLs, traversal strings and malformed shapes fail validation.

## Devnet commitment and compatibility

`devnetCreateHref` carries an allowlisted image ID from public creation or a preview into the fixed-four-mock workspace. A fresh devnet draft without a valid choice cannot submit. New metadata includes `coverId` before the existing SHA-256 hash and draft fingerprint are computed, committing the selection alongside the name, thesis, composition and fees. Review displays the selected artwork.

`app/lib/devnet-cover.ts` resolves old artwork only for display. It never rewrites old metadata, changes the exact bytes used by hash verification, or alters an existing onchain commitment. Newly stored metadata displays its chosen cover; missing/unknown legacy values use a safe local fallback. Mint and redemption validity do not depend on a cover.

No program ABI, token accounting, fees, transfer builder or legacy metadata validator changed. The previous `app/app/create/create-client.tsx` wizard is not routed. `/managed/lab` remains a separate localnet protocol lab.

## Verification performed

- Public cover/preview/catalog/draft run: **30 tests passed**, including all 1,271 bundled issuer assets, sample identity, mint/fee round trips and seven new cover/link checks.
- Cover + fresh/copy draft focused rerun: **12 passed**. Fresh drafts explicitly have no image selected; copied drafts retain their image.
- Cover/devnet Node run: **29 passed**, including six new propagation/metadata tests and 16 existing devnet account/hash tests.
- Existing Vitest devnet pipeline and retry regressions: **30 passed**.
- Final integration app TypeScript checking passed.
- Ten social-sharing tests passed.
- The final combined Node test run passed **65/65**, covering allocation colors, image layout, the logo route, social sharing, covers, devnet cover metadata and concept draft behavior.
- Production compilation, type checking and generation of **28 static pages** passed. The build emitted the existing nonblocking lockfile warning.
- `git diff --check` passed.

Commands used:

```text
node_modules/.bin/tsx --tsconfig app/tsconfig.json --test app/lib/basket-covers.test.ts app/tests/concept-preview.test.ts app/tests/xstock-catalog.test.ts app/components/create/create-feedback.test.ts
node_modules/.bin/tsx --tsconfig app/tsconfig.json --test app/lib/devnet-cover.test.ts app/tests/devnet-baskets.test.ts app/lib/basket-covers.test.ts
node_modules/.bin/vitest run app/components/devnet/create-draft.test.ts app/components/devnet/pipeline-state.test.ts --maxWorkers=1 --minWorkers=1
npm --prefix app run typecheck
npm --prefix app run build
```

## Cover-aware sharing

**Create image** now includes the chosen cover alongside the basket name, thesis, all holdings and allocation weights in a branded Canvas poster. The poster retains the shared allocation palette and does not invent performance figures.

**Share on X** opens an editable draft with safely encoded text and the basket link. It does not upload the image or publish a post. Users download the PNG and attach it to the draft themselves. **Share image** appears when the browser reports native file-sharing support; the capability was visible in the integration browser check.

The share dialog locks background scrolling while open and uses theme-aware scrollbars. OG thesis truncation preserves whole graphemes, including combined emoji.

The basket-specific `/api/basket-image/social` endpoint produces the link-card image. Preview metadata uses the basket name in its page title and points both `og:image` and `twitter:image` at the encoded basket-specific endpoint. This is separate from manually attaching the full downloadable PNG.

## Browser verification

Desktop at **1280 × 900**: a fresh basket without artwork could not continue. Selecting **Moon Shot**, then completing an NVDA/GLD 50/50 basket through Review and Share, preserved the image in the shared preview and Canvas poster. X draft text/link encoding and the native-sharing capability were checked.

Mobile at **375 × 812**: a copied basket retained its cover, a new **Fresh Start** selection worked, all 34 gallery images loaded and there was no horizontal overflow.

Captured evidence:

- [Desktop cover picker](assets/basket-covers-2026-10-09/desktop-picker.jpg)
- [Desktop cover-aware share poster](assets/basket-covers-2026-10-09/desktop-share.jpg)
- [Mobile cover picker](assets/basket-covers-2026-10-09/mobile-picker.jpg)
- [English basket link card](assets/basket-covers-2026-10-09/link-card.png)
- [Long Unicode basket link card](assets/basket-covers-2026-10-09/link-card-long-unicode.png)

## Final link-card and build verification

The social endpoint returned **HTTP 200**, `image/png`, at **1200 × 630** for both the English Moon Shot example and a maximum-length Unicode case with a 60-character CJK name, 240-character CJK thesis and 0.01%/99.99% weights. Both rendered images were visually inspected and fit their layouts. The actual preview DOM contained the basket-specific title and matching Open Graph/Twitter image URLs.

The production build passed compilation, type checking and generation of 28 static pages. Its social-route NFT file trace contains exactly the 34 small JPEG thumbnails and none of the large original cover images. The existing lockfile warning was nonblocking. The final production build is served locally on port 3000. The final browser check produced a 1600 × 1000 PNG poster, confirmed the dark modal scrollbar and verified that background scrolling is locked only while the modal is open. Closing the modal restores the previous body overflow. The screenshot was refreshed from this final build.

The earlier `preview-share-image-2026-10-09.md` records the preceding color/export implementation; this document records the later required-artwork and social-sharing integration. No new extension-wallet signing or onchain transaction was performed for this artwork update.

This work is local and uncommitted. No wallet-signed transaction, GitHub push or production deployment was performed by this subtask.

## Generated artwork provenance

The 24 new covers were produced in separate built-in Imagegen calls. Exact prompts, original output locations and hashes are recorded in [generation set A](basket-cover-prompts-2026-10-09-a.md) and [generation set B](basket-cover-prompts-2026-10-09-b.md). [View all 24 new covers](assets/basket-covers-2026-10-09/contact-sheet.jpg).
