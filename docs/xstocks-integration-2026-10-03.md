# Official xStocks discovery and Solana token prices, 2026-10-03

The accepted landing revision was committed and pushed to `origin/main` as [`7a16c18e5809ae3b955dc334b4af016afae9eb56`](https://github.com/umutyesildal/basalt/commit/7a16c18e5809ae3b955dc334b4af016afae9eb56). The subsequent xStocks integration described here is local work, not a new deployment or protocol release. It replaces the small public discovery catalog with official issuer metadata and separates actual Solana token prices from underlying-stock references.

## Catalog and evidence

`backend/src/catalog/xstocks.ts` reads the [official public assets API](https://docs.xstocks.fi/apis/openapi/assets/list_public_assets), using `network=Solana`, zero-based pages and `pageSize=100`. It follows `hasNextPage`, validates the page sequence and canonical 32-byte Solana public keys, selects the actual Solana deployment address, and deduplicates mints. It never uses nested payment-stablecoin addresses or decimals as xStock metadata. Malformed or incomplete pagination cannot replace a complete catalog.

The captured catalog has **1,271 distinct assets** over 13 pages. Public mainnet mint-account reads verified all 1,271 addresses as initialized Token-2022 mints with eight decimals and Scaled UI Amount at the recorded slots. The metadata-only backend and frontend snapshots preserve that evidence's date. This does not mean each asset has a liquid market or is approved for a Basalt vault. See [the research record](xstocks-live-data-research-2026-10-03.md) and [per-mint RPC evidence](assets/xstocks-2026-10-03/mint-verification.json).

Issuer `underlying.type` was null on every captured row. **69 assets have positive ETF classification evidence**, from a standalone `ETF` word in the issuer's name or independently verified issuer product pages. The remaining **1,202 stay `unknown`** rather than being called stocks by assumption. All remain searchable in the complete catalog; the ETF tab shows the verified subset. Six issuer-halted assets remain visible with that status. The snapshot's `classification.etfSources` and [additional ETF sources](assets/xstocks-2026-10-03/additional-etf-sources.json) preserve the classification evidence.

The backend caches complete issuer results for 15 minutes and shares an in-flight refresh. On failure it returns the last complete cache or the saved snapshot with `stale: true`, preserving the original metadata timestamp. A 30-second failure backoff avoids retrying the full pagination on every price request. Forced refresh bypasses this backoff. Known issuer mints use a synchronous complete metadata lookup for pricing, so a slow catalog refresh cannot hold up their quote. Unknown mints still require a successful issuer lookup before pricing. A fresh backend quote request for AAPLx and QQQx completed in 0.283 seconds during the final smoke check; this is an observation, not a latency guarantee. The backend starts warming the catalog without blocking server startup; the frontend renders saved metadata immediately and allows 35 seconds for catalog refresh. The measured cold live fetch in this session took 18.65 seconds and returned all 1,271 assets with `source: issuer`, `stale: false`.

Lookup order is exact mint, exact token ticker, case-insensitive underlying alias, then case-insensitive token ticker. Ambiguous aliases return no match. Exchange-qualified aliases such as `XETR:SHLD` and `MTAA:GM` are preserved. Regression coverage protects `MAx` from a potential `MAX` underlying-name collision without inventing that asset in the official snapshot.

## Prices and units

Public quotes use [Jupiter Price V3](https://developers.jup.ag/docs/price) at `https://api.jup.ag/price/v3`, keyed by the official Solana mint. `usdPrice` is already USD per **scaled UI token**. It must not be divided by the multiplier again. `stockData.price` is an underlying-equity reference and is never substituted for the token quote. Optional pre-scaled price and effective-multiplier metadata are retained separately for provenance.

The API exposes `fetchedAt` as retrieval time and resolves Jupiter's `blockId` through mainnet [getBlockTime](https://solana.com/docs/rpc/http/getblocktime) to obtain `observedAt`. These are different timestamps. An unavailable RPC block time remains null; retrieval time does not establish the age of the source price. `createdAt` is not quote freshness. The UI distinguishes unavailable source time and old observations instead of labeling every response as a fresh quote.

Missing, invalid or failed public quotes remain null, with `source: unavailable` and an explicit status. The public endpoint forces `fallback: none` even if legacy development configuration enables mock prices. Yahoo prices remain separately labeled underlying references and historical basket-model inputs; they never fill a missing public token price. The retained legacy comparison path only reads development mock rows when explicitly requested with `network=devnet`.

The price worker batches at most 50 mints per provider request, with at most two concurrent batches, deduplication of identical in-flight batches, ordering guards against older overlapping responses, and a 30-second per-mint positive/negative cache. Short searches match names and tickers; mint substring search starts at eight characters to avoid accidental ticker matches inside addresses. Exact ticker results rank first. The catalog grid requests only its visible **24 assets**, preserving the full search catalog even when some tokens have no quote. Known block timestamps cannot be erased by an overlapping failed RPC lookup. Catalog and price freshness are independent. Optional `JUPITER_API_KEY` remains server-side; `PRICE_MAINNET_RPC_URL` controls mainnet block-time reads independently of the project's devnet `RPC_URL`.

The holdings parser now selects the scheduled `newMultiplier` at and after its activation timestamp, matching [Solana's Scaled UI Amount rules](https://solana.com/docs/tokens/extensions/scaled-ui-amount). NAV uses scaled holdings with the already-scaled display price. Raw transfer/account quantities and permissionless redemption math remain separate and unchanged.

## API and frontend scope

| Surface | Implemented behavior |
|---|---|
| `GET /api/v1/xstocks` | Complete issuer metadata, source, fetched timestamp and stale state. It works without an indexed-basket database. |
| `GET /api/v1/xstocks/prices?mints=...` | Validates 1 to 100 official mint addresses and returns nullable token prices with source, units, observation/retrieval timestamps, block and 24-hour change. |
| `/stocks`, `/etfs` | Search the complete metadata before 24-card pagination. ETF classification uses verified evidence; missing quotes do not hide assets. |
| `/stock/[ticker]` | Resolve official ticker, underlying alias or mint and show the token price with separate provenance. |
| `/providers` | Identify issuer metadata and Jupiter token pricing; underlying references remain distinct. |
| `/create`, `/preview` | Select official issuer assets and preserve token identity through mint-bearing shared drafts. Public creation still shares basket ideas. |

Compact **v3** share links retain each selected symbol, weight and mint. Existing v2 and original validated links remain readable. Known symbol/mint contradictions are rejected; an unfamiliar but valid future pair can remain self-contained without requiring a backend lookup. Names and logos may be enriched from current metadata, but old links do not lose their identity or become executable investment instructions.

## Validation record

Completed focused evidence so far:

- Catalog loader: **35 tests passed**, including pagination, malformed pages, invalid mints, complete-cache/snapshot fallback, retry backoff, ETF provenance, scheduled cache refresh, single-flight behavior, alias priority and caller mutation safety.
- Real official fetch: 13 HTTP 200 pages, 1,271 assets, 69 verified ETF classifications, `source: issuer`, `stale: false`.
- Research agent's scheduled-multiplier and existing backend-truth checks: **53 passed**. These overlap other suites and must not be added to a combined count.
- Research agent's isolated API contract checks: **13 passed**, using fake issuer/Jupiter/RPC responses. These are not live-provider tests.

Final integration evidence is maintained by the root agent below. Earlier dated landing and protocol test counts are not automatically fresh results for this change.

| Final check | Status |
|---|---|
| Combined backend tests | **725 passed, 18 skipped**, 28 passing files and one skipped file. [Log](assets/xstocks-2026-10-03/backend-tests.log). Database-dependent skipped cases were not represented as exercised. |
| Frontend tests and type checking | **19 focused tests passed**, legacy preview/sample integrity passed, and production build type checking passed. [Focused log](assets/xstocks-2026-10-03/frontend-tests.log), [compatibility log](assets/xstocks-2026-10-03/share-compatibility.log). |
| Backend and app production builds | Both passed. [Backend build](assets/xstocks-2026-10-03/backend-build.log), [app build](assets/xstocks-2026-10-03/app-build.log). |
| Rust workspace libraries | **214 passed** with no program changes. [Log](assets/xstocks-2026-10-03/rust-test.log). |
| Browser search, quotes, detail, Create/share and responsive checks | Passed in the local production build: 1,271 assets/69 ETFs; QQQ/QQQx and exact mint search; VTI excludes unrelated mint matches; real SPYx/QQQx/GLDx prices and 24h changes; VTI source date Sep 27; nullable SGOVx; detail source/retrieval times; SGOV+VTI selection, 50/50 weights, v3 sharing and Use this mix round-trip. No overflow at desktop 1280px, detail/Create 375px, and preview 320px. Final browser console errors were empty; the ETF tab was left open on real prices. |

Evidence images: [ETF catalog desktop](assets/xstocks-2026-10-03/etfs-desktop.png), [token detail mobile](assets/xstocks-2026-10-03/detail-mobile.png), [new ETF basket mobile](assets/xstocks-2026-10-03/create-mobile.png), [shared basket at 320px](assets/xstocks-2026-10-03/preview-320.png). [Live API smoke](assets/xstocks-2026-10-03/live-api-smoke.json) records actual nullable quotes and source times; those values are observations, never baked into UI prices.

The ignored local `app/.env.local` previously pointed the local UI to the old remote API. Only `NEXT_PUBLIC_API` was changed to `http://127.0.0.1:3001` for this preview, preserving other local settings. The current frontend and public-data backend run locally on ports 3000/3001. No database/RPC transaction workers are configured in this local backend process; catalog and prices work independently. This setting and the new code have not been deployed to the remote site.

## Release boundary

This adds public read-only discovery and price data. It does not admit these mints into the onchain whitelist, launch public investing, enable fee revenue, verify swap execution, or clear extension/transfer-hook/security/legal deployment requirements. Existing V0 and Managed V2 gates remain in force. The metadata snapshot contains no prices, credentials or private keys. Generated video folders, Arena work and unrelated changes remain outside this integration's scope.
