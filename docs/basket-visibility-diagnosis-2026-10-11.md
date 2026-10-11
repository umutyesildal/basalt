# Created basket visibility diagnosis, 2026-10-11

The human-provided devnet transaction `2ACW8Phh5HNAeBHJmVriqWHUUUjwDSuFw6L1diENWD9m1HyPqoRaLNiQH4iFiGTfe9HAw2YHKta7TyboimKNfVvF` finalized successfully at slot `509862802`. Its authenticated creation belongs to wallet `HEEb58k3QhwVqghxWTHwD9HmmjCGrpqapyTfoQH1DuKr` and basket `14dbVJmT5Ja9iLnAHETB4N17ukAYMjLsdPDx1hdiCXxx`.

[Public basket](https://basalt.markets/basket/14dbVJmT5Ja9iLnAHETB4N17ukAYMjLsdPDx1hdiCXxx), [finalized transaction](https://explorer.solana.com/tx/2ACW8Phh5HNAeBHJmVriqWHUUUjwDSuFw6L1diENWD9m1HyPqoRaLNiQH4iFiGTfe9HAw2YHKta7TyboimKNfVvF?cluster=devnet).

## Observed cause

The initially open Chrome Explore page showed 14 baskets, without this address. A later public API read included the basket; after reloading the existing Chrome tab, the page showed 15 baskets and this exact address as the first onchain card, under fallback name “Triple Play”. Indexing is asynchronous. Explore fetches the list at mount or explicit reload, with no ongoing refresh, so a page opened before indexing retains its original list.

There is a second independent presentation gap. Creation saves name, thesis and cover as hash-verified browser-local metadata. The immutable chain commitment is only the metadata hash. The backend row has `metadata_json: null`; Explore reads only backend metadata and does not hydrate the local metadata. Consequently the creator's name/cover are replaced by deterministic fallback artwork and names in the public gallery. Different browsers cannot retrieve the creator's original metadata from local storage. Refresh solves the stale list, but does not publish metadata.

## Scope and remaining work

No code, program, database, financial projection or runtime deployment was changed during this diagnosis. No user wallet transaction was sent. The frontend/backend runtime remains the previously documented `6cacb49` release. A durable fix needs list refresh and hash-authenticated shared metadata publication/retrieval, without modifying immutable chain fields or weakening financial guards. This diagnosis does not claim those fixes are implemented. Unknown devnet mock prices/returns remain unavailable.


## Implemented correction, 2026-10-11

This section supersedes the diagnosis-only status above. The implementation adds shared immutable metadata publication, verifies it on read and automatically refreshes visible Explore pages every 30 seconds and on focus or creation events. The creator's existing browser record is recovered only when its exact UTF-8 SHA-256 matches the indexed chain commitment. Names, descriptions and cover IDs retain their original values. Unavailable creator text now uses a shortened basket address and no invented thesis; stable local artwork remains a placeholder.

`POST /api/v1/baskets/:pubkey/metadata` accepts only the exact original JSON document, at most 16 KiB. The backend admits registered factories only, requires an existing indexed basket, and atomically preserves the immutable metadata hash and all other chain/financial fields. Repeated identical publication is safe. Conflicting documents, changed names, foreign factories, malformed input and oversized bodies are rejected. HTTP admission uses bounded socket-peer/global write/concurrency budgets. Reads recheck the stored raw document rather than trusting a mutable decoded JSON column. The additive `metadata_document` migration is idempotent.

Creation retries metadata publication up to four times, 31 seconds apart, to cover asynchronous indexing. It never repeats the signed creation transaction. If publication still fails, the original browser record remains available for later list/detail hydration. Recovery requires the browser that retains that record to open the updated site; a metadata hash alone cannot reconstruct lost text. Unknown devnet prices, performance and guarded historical projections remain unchanged.

Validation before release: complete backend suite passed 1,596 tests with an isolated local PostgreSQL 14 database, including seven actual PostgreSQL metadata cases. The additional HTTP admission suite and all focused metadata cases passed 25 tests. Five client cases cover original-byte verification, public retrieval, deduplication and bounded indexing/offline retries. Full app tests and production build are recorded in release evidence below. No additional human wallet signature or program deployment is required.

Release evidence will be appended after the exact frontend and VPS runtime are verified. Older dirty checkouts remain preserved; implementation and releases use the canonical release checkout only.
