# Preview allocation colors and basket share images, 2026-10-09

## Scope and current status

The owner reported that the Create summary and shared preview used different colors for the same NVIDIA, Nasdaq, Walmart and Gold basket. They also requested an attractive image containing a basket's name, thesis and holdings, with Basalt branding, created directly from the preview page.

The implementation now uses one stable allocation color across Create, `/preview` and the exported poster, and adds **Create image** followed by a preview dialog and **Download PNG**. This is local source work in the canonical checkout, `/Users/umutyesildal/orca/workspaces/createyouretf/createyouretf`. The existing dirty working tree is preserved. This update does not change program instructions, transaction signing, price calculations or investing availability.

**Final scoped verification:** 14 allocation/layout checks, six mocked logo-route security checks and app TypeScript checking passed. A real PNG export was exercised through the UI. Desktop checks, a centered 375 × 812 dialog without horizontal overflow, the 1280 × 900 maximum-content case with 20 holdings/60-character name/240-character thesis, and Escape returning focus to Create image passed. The final Next.js production build passed, generating 27 static pages and including the new logo API route. This verifies the local source; no remote deployment is claimed.

## Shared allocation identity

`app/lib/allocation-colors.ts` resolves a known issuer mint to its canonical underlying symbol, then uses the established calm ticker palette. Old symbol-only share links and current mint-bearing drafts therefore retain the same color. Reordering or removing assets and changing weights do not recolor the surviving holdings. Unknown mint-bearing identities use their case-sensitive mint address and do not inherit a known ticker's branding.

Create's allocation chart and legend, the shared preview's stock-mix chart, and the poster's sculpture, holdings markers and allocation strip use this shared helper. Brand yellow remains the Basalt accent; allocation data keeps the restrained palette.

## Image experience and poster

The `/preview` share controls offer **Create image**. The browser creates the poster, opens a native modal dialog with the resulting image and exposes **Download PNG**. Loading, retry and close controls are included. A request counter prevents late generation results from updating an unmounted or changed basket, and object URLs are revoked when replaced or unmounted.

`app/lib/basket-image.ts` draws the artwork directly with the browser Canvas API from a validated `ConceptBasket`. It waits for the existing app fonts rather than capturing the page. The poster uses the canonical three-column Basalt mark, Chakra Petch headings, Geist body copy, Geist Mono tickers/weights, near-black, warm white and electric yellow.

The export is 1,600 pixels wide, with height calculated from wrapped content and holdings count. It includes the full basket name, full thesis, every supported holding and its allocation weight, plus the annual management fee. Limits remain the existing 60-character name, 240-character thesis and 2–20 assets. Long unbroken Unicode text wraps at grapheme boundaries where `Intl.Segmenter` is available; pasted control characters and whitespace are normalized. The generated filename strips path separators and unsafe punctuation.

The column sculpture visualizes the largest six holdings when a basket has more than six assets. The ledger and allocation strip preserve all holdings and weights. The ledger uses two columns for up to ten assets and three columns above ten. Its calculated height reserves space for the footer. No prices, returns, holder counts, AUM or revenue are invented or added to the image. This graphic communicates an allocation and thesis; it does not establish live backing or investment execution.

## Real stock logos and fallback

Direct issuer/CDN image fetches from the browser encountered CORS restrictions, so the export uses the read-only same-origin endpoint:

```text
GET /api/basket-image/logo?symbol=NVDA&mint=<optional-known-issuer-mint>
```

The endpoint resolves the asset through the server's trusted catalog. It accepts only the symbol and optional mint, rejects malformed or contradictory identities and unknown query keys, and never accepts a caller-supplied URL, basket name or thesis. Upstream requests are restricted to HTTPS on `xstocks-metadata.backed.fi` or `assets.parqet.com`, with no URL credentials, no custom port, no cookies or credentials, no redirects and a four-second timeout.

Successful PNG, JPEG, WebP, GIF or SVG responses are streamed with a strict two-megabyte limit and returned with a one-day public cache policy, `nosniff`, same-origin resource policy and a restrictive sandbox CSP. Invalid, oversized, unavailable or timed-out images return a short-cache 404. The client has bounded fetching and image decoding, with a colored ticker chip as its fallback. Missing logos cannot taint the canvas or prevent PNG creation. This route does not proxy arbitrary resources or require the VPS price backend.

## Changed implementation files

- `app/lib/allocation-colors.ts` and `app/lib/allocation-colors.test.ts`: stable identity-based data color and four regression checks.
- `app/components/create/concept-create.tsx`, `app/components/create/create-preview.tsx` and `app/app/preview/preview-client.tsx`: shared colors and preview image action.
- `app/lib/basket-image.ts`: local Canvas poster and bounded logo loading.
- `app/lib/basket-image-layout.ts` and `app/lib/basket-image-layout.test.ts`: text wrapping, grid/filename helpers and ten edge-case checks.
- `app/components/preview/basket-image-button.tsx` and `basket-image.module.css`: image dialog, loading/retry, object URL lifecycle and download.
- `app/app/api/basket-image/logo/route.ts` and `app/lib/basket-image-logo-route.test.ts`: restricted catalog-logo response and six security regressions.

## Validation

```bash
node_modules/.bin/tsx --tsconfig app/tsconfig.json --test \
  app/lib/allocation-colors.test.ts app/lib/basket-image-layout.test.ts \
  app/lib/basket-image-logo-route.test.ts
npm --prefix app run typecheck
```

All **14 pure checks passed**. They cover canonical/legacy/mint colors, ordering and removal stability, unknown mint identity, 240-character unbroken Unicode, emoji families/flags/combining marks, pasted newlines and controls, a single oversized grapheme, 2/20-asset footer clearance, every supported asset count and safe download filenames.

All **six mocked route checks passed** in `app/lib/basket-image-logo-route.test.ts`. They exercise rejection before fetch, cached response bytes and constrained fetch options, the five supported image MIME types, advertised and streamed size limits, empty/error/timeout/redirect fallbacks, and forbidden configured hosts, credentials, protocols and ports. The tests are persisted in the repository; their upstream fetches are mocked. Root separately verified the real issuer-logo path through the UI.

App TypeScript checking passed. Root reported the responsive, maximum-content and Escape/focus checks above passing. A real [poster example](assets/preview-share-image-2026-10-09/basket-image-example.png) and [desktop dialog image](assets/preview-share-image-2026-10-09/desktop-dialog.jpg) are saved. The final Next.js production build passed with 27 static pages, including the new logo API route. The existing multiple-lockfile workspace-root warning remains unchanged. No commit, push or remote deployment is recorded by this documentation pass.

## References and design rationale

[Trading 212's Pies introduction](https://helpcentre.trading212.com/hc/en-us/articles/30661163244317-Pies-AutoInvest-Introduction) provides a useful example of presenting several stocks or ETFs as an understandable grouped allocation. This informed the simple basket/composition language; its AutoInvest and rebalancing behavior is not adopted or claimed for Basalt.

[MDN Canvas `toBlob`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob) documents PNG export and origin-clean requirements. [MDN `FontFaceSet.ready`](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/ready) documents waiting for font loading before rendering. [Vercel's image-generation documentation](https://vercel.com/docs/og-image-generation) supplied additional share-card layout reference; this implementation renders locally with Canvas and adds no image-generation service dependency.
