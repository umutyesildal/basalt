# Basket share refinement, 2026-10-09

> **Palette superseded later on 2026-10-09:** The newest owner direction derives allocation colors from actual stock/ETF logos. Read [the current logo-color record](logo-derived-basket-colors-2026-10-09.md). The fixed four-color palette and its screenshots below document this earlier revision; the domain, selected-cover/stack composition and removal of the exported fee label/footer strip remain current.

## Domain

The owner selected **https://basalt.markets** as the public product and sharing domain. The retired Vercel hostname was replaced in 24 text files: the README, deployment instructions, brand/social copy, dated submission and release documents, HTML pitch decks, HTML bounty submission, source-check JSON records, and saved video composition/share-copy sources. The share-image renderer is updated in the coordinated artwork pass.

`app/lib/site-origin.ts` now holds the canonical URL. Metadata, robots and sitemap use `siteUrl()` with that production fallback. An explicit `NEXT_PUBLIC_SITE_URL` remains supported; Vercel aliases resolve to the custom domain. Root layout metadata now uses the same origin rather than localhost. Basket copy links, X drafts and native image sharing use the same public-origin normalization. Localhost and loopback links remain local so an unpublished basket can still be reviewed on the running local app.

`app/.env.example` documents the public domain. The existing ignored `app/.env.local` has the public-domain value; its other settings were preserved. Restart or rebuild the app to pick up this environment change. No DNS change, Vercel configuration mutation, VPS update, commit, push or deployment was performed in this pass.

Replacing URLs in dated source/check records updates their link targets only. Their earlier timestamps and verification claims were not rerun against the custom domain. Existing PNG/JPEG screenshots, PDFs and rendered videos were preserved; old text baked into those binaries was not repainted.

## Domain verification

- Five origin checks and ten existing social-share checks passed together: **15/15**. Coverage includes canonical metadata without configured public origin, Vercel alias normalization, explicitly configured independent domains, localhost review, copied basket/X draft URLs and rejection of executable or credential-bearing origins.
- The final retired-hostname text scan excludes `.git`, `node_modules`, `.next`, `.cache`, `cache`, `target`, and binary image/PDF/video outputs. No retired-hostname matches remain in searched source/text files after the coordinated renderer change.
- UI/artwork verification and the final production build are recorded below after the coordinated refinement is complete.


## Artwork direction

Direction: a dark, geometric Basalt share poster with the actual allocation as its main visual. Comfortable spacing, Chakra Petch headlines, Geist body and Geist Mono numbers. The selected editorial cover is a small 96 × 96 header identity; the stock stacks occupy the main illustration area. Each vivid data color identifies an actual holding. No extra decorative gradients, allocation heading or duplicated footer chart.

The owner’s first reference image is the palette authority for this refinement. Its flat colors were sampled directly: NVDA `#F9F528`, QQQ `#1FDBF8`, WMT `#F33EA3`, GLD `#36D887`. `allocationColor` now returns those exact colors for verified identities, with stable bright colors for other assets. All existing Create, preview, poster and social-image callers share the helper. Generic market-chart `tickerColor` was left alone.

The downloadable poster combines the selected cover and isometric stacks. Stack heights are proportional to actual basis-point weights. Baskets with up to six holdings retain their list order; larger baskets show the six largest allocations and an explicit remaining-holdings label. Every holding still appears with its logo, name, ticker and exact percentage in the full ledger. Stack logos use original asset indices, preserving exact issuer/mint identity through sorting. Extremely small weights produce a shallow prism without crossed faces or invented minimum allocations.

The annual management-fee line and colored allocation strip have been removed from the exported poster. The link-card fee line is also removed. The footer now contains only a quiet separator and `basalt.markets`. Actual fee disclosures and the fee data remain in Create, Review and basket details.

## Integration verification

- Palette, wrapping/layout, tiny-weight stack geometry, six-stack limits, source-index preservation and public-origin/social-link checks: **33/33 passed**.
- A four-stock reference basket generated a **1600 × 1082** PNG preview with the selected cover, live catalog logos, exact approved bright colors, all percentages and the updated domain. No fee line or footer allocation strip remains in the poster.
- Mobile at **375 × 812** has no horizontal overflow; all share controls have a 44px height.
- Actual preview Open Graph metadata uses `https://basalt.markets/api/basket-image/social` and preserves the complete encoded basket. Local test X links remain local; deployed Vercel-origin links normalize to the custom domain, covered by tests.
- The 99.99%/0.01% two-holding case generated a 1600 × 1000 poster with a correctly shallow tiny stack. A 20-holding case with a 240-character thesis generated a 1600 × 1552 poster with six stacks, an explicit +14 label and the full twenty-holding ledger. Both were visually inspected.
- The link-card endpoint returned HTTP 200, image/png, 1200 × 630 with the selected cover, approved palette and basalt.markets; its management-fee label is absent.
- The first-mount image reset no longer cancels a fast initial Create image interaction. Basket changes and unmounts still invalidate pending generation.
- Final production compilation, TypeScript checking and generation of all 28 static pages passed. The pre-existing multiple-lockfile warning remains nonblocking. The resulting production build is served locally on port 3000.
- A final hidden/ignored text scan, excluding dependency/build caches, found no remaining retired-hostname text references.


## Visual evidence

- [Four-stock poster with selected cover and stacks](assets/basket-share-refinement-2026-10-09/desktop-share.jpg)
- [Mobile share controls](assets/basket-share-refinement-2026-10-09/mobile-share.jpg)
- [Tiny allocation geometry](assets/basket-share-refinement-2026-10-09/tiny-weight.jpg)
- [Twenty holdings and maximum-length thesis](assets/basket-share-refinement-2026-10-09/twenty-holdings.jpg)
- [Updated link card](assets/basket-share-refinement-2026-10-09/link-card.png)
