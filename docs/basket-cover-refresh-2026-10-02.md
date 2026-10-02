# Ten basket covers, 2026-10-02

All ten sample baskets now have a distinct original editorial cover. The four featured covers remain unchanged; six new images replace the reused artwork on Chip Happens, After Hours, Payday, Offline Mode, Power Hungry and Main Character.

The root agent generated one square image per exact prompt with the built-in image_gen tool, without image references. Each uses a strong photographic cutout, coarse halftone, paper grain and a restrained black/cream palette over colored paper. Root visually inspected the native outputs and reported no text or logos. These images convey basket identity and mood; they do not depict acquired assets, achieved returns or issuer backing.

## Artwork and reuse

| Basket | Subject | Paper color | File |
|---|---|---|---|
| Terminally Online | Vintage CRT monitor and pixel cursor | Electric yellow | [terminally-online.png](../app/public/images/baskets/terminally-online.png) |
| Touch Grass | Sculptural palm tree | Muted sage | [touch-grass.png](../app/public/images/baskets/touch-grass.png) |
| No Hands | Car wheel and robotic hand | Muted cobalt | [no-hands.png](../app/public/images/baskets/no-hands.png) |
| Daily Ritual | Espresso cup and blank receipt | Rust orange | [daily-ritual.png](../app/public/images/baskets/daily-ritual.png) |
| Chip Happens | Semiconductor chip with a clipped corner | Dusty lavender | [chip-happens.png](../app/public/images/baskets/chip-happens.png) |
| After Hours | Disco ball and crescent moon | Indigo-violet | [after-hours.png](../app/public/images/baskets/after-hours.png) |
| Payday | Wallet, blank cards and plain coin | Coral-pink | [payday.png](../app/public/images/baskets/payday.png) |
| Offline Mode | Grocery bag, baguette and oranges | Sky blue | [offline-mode.png](../app/public/images/baskets/offline-mode.png) |
| Power Hungry | Industrial plug and paper lightning bolt | Chartreuse | [power-hungry.png](../app/public/images/baskets/power-hungry.png) |
| Main Character | Theatrical spotlight and star | Burgundy | [main-character.png](../app/public/images/baskets/main-character.png) |

All files are **1254 × 1254 PNGs** under `app/public/images/baskets/`. [Exact prompts](basket-cover-prompts-2026-10-02.md) preserve the first four prompts and append the six new prompts verbatim.

`app/lib/concept-samples.ts` maps each of the ten stable basket IDs to its own cover path. Shared cards and weekly ranking thumbnails use that mapping. Recognized sample previews now show the matching cover beside the heading at 64px, or 80px from the small-screen breakpoint. Recognition uses the existing matching name/assets/weights rule. Custom drafts receive no assigned sample artwork.

This refresh changes artwork references and the recognized-preview thumbnail only. Names, stable IDs, links, allocations, example amounts, fees, model prices/returns and release boundaries are preserved. The home still features the same original four covers. The calm stock-basket hero and gallery-first order are confirmed in [the final restoration](home-hero-restoration-2026-10-02.md). See [the earlier home/Create feedback](home-create-feedback-2026-10-02.md) and [performance audit](product-performance-audit-2026-10-02.md) for retained controls and preceding scoped work.

## Verification

- Read-only file inspection confirmed all ten canonical files have PNG signatures, square 1254px dimensions and **ten distinct full SHA-256 hashes**.
- Hash comparison before and after the root asset copy confirmed the four original files are unchanged.
- Source inspection confirmed all ten mappings point to different existing files and the sample-only preview thumbnail is conditional.
- Root's final production build passed after the artwork and calm-hero restoration; [the durable log](assets/hero-restoration-2026-10-02/build.log) records compilation, TypeScript checking and 25 static pages.
- Desktop and 375px leaderboards loaded all ten distinct image URLs with `complete && naturalWidth > 0`, without overflow or console errors. [Final leaderboard screenshot](assets/hero-restoration-2026-10-02/leaderboard.png).
- Root reported sample-preview checks at 320px with a 64px cover and 1280px with an 80px cover, without overflow. The implementation agent reported the existing concept-preview/sample integrity test passed after the thumbnail addition.
- Earlier 38-test/home-Create results belong to the prior freeze; the 38-test suite was not rerun for this refresh/restoration.
- This documentation pass edits Markdown only. No app build, server, image edit or browser operation was performed here.

## Evidence and prompt provenance

The six exact source prompts were received from `/private/tmp/basalt-cover-refresh-prompts.json` and are now saved in the repository prompt record. No temporary path is needed to recover the prompts. The [final restoration audit](home-hero-restoration-2026-10-02.md) links the completed build and actual home/build-section/leaderboard screenshots. No commit, push or remote deployment is claimed.
