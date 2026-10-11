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


## Verified live release

Frontend and VPS backend run source `f8195cf4c386edeeee074ed3dc958b7aa5637b5f`. All six [exact-source CI jobs](https://github.com/umutyesildal/basalt/actions/runs/38131084770) passed: backend 1,600 tests (including actual PostgreSQL tests), app 468 Node tests plus 58 Vitest tests, 71 security checks, Rust workspace/owner identity tests and dependency/secret gates. The hosted production build used the canonical npm 11.6.2 workspace installer and Next.js 15.5.27. Vercel deployment `dpl_6kyeUmet1kcEeFmiUsqGzMZF6e1X` was checked before promotion to [basalt.markets](https://basalt.markets/explore).

Backend image: `sha256:c8e68274998f6be0f715ebcb50caa3c1d9528838f6bf437f2bca1168874ef810`. Before release, the existing image, source, Compose/private configurations and online database backup were retained. Restoring into isolated `basalt_metadata_candidate_20261011` and applying the schema twice preserved all 15 baskets and the human basket's exact commitment. A fresh database dump was captured with backend writers stopped immediately before cutover. Only the backend was recreated, and both private environment-file checksums remained unchanged. PostgreSQL/cache/Caddy volumes were preserved. Private rollback/rehearsal material remains at `/opt/basalt/release-backups/metadata-20261011-f8195cf`; do not publish that directory or its env files.

At `2026-10-11T10:18:04.786Z`, public readiness verified the exact source, database/schema/workers and devnet program identity. Historical projection remains incomplete and guarded: 115 pending signatures, four quarantined signatures, seven baskets requiring rebuild, zero eligible current USD valuations. This contained release does not claim those older financial-history blockers are fixed. Metadata publication does not clear those guards.

Chrome opened the updated production Baskets page and automatically recovered the original creator browser records. The human basket now shows **Super Duper Big Guys**, **These guys are awesome!**, and cover **home-team**. Another retained creator basket now shows **Super good basket**, **They are super good**. Remaining baskets without original metadata use address labels and no invented thesis. A separate public API GET returned the human basket's exact JSON document, independently rehashed to `0b8213980c923c11153872f7b481bffe547eff9836985c968a9bd3ec2b938194`. The record is now shared by the backend rather than visible only in the creator browser. The live gallery screenshot verified both recovered cards and the absence of the previous generated names/descriptions.

No human wallet transaction, program deployment, token transfer or new owner signature was requested or sent in this release. Browser-local records that have been lost cannot be reconstructed from hashes; retained original records recover when that browser opens the updated list or basket workspace. See [machine-readable public release evidence](basket-metadata-live-2026-10-11.json).
