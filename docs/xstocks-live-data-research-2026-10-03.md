# xStocks catalog and onchain price research

Verified on 3 October 2026, Europe/Berlin. This record covers public data research and the scheduled-multiplier parser fix. The catalog and API implementation are documented separately by the integration owner.

## Catalog

The [official asset API](https://docs.xstocks.fi/apis/openapi/assets/list_public_assets) uses `https://api.xstocks.fi/api/v2/public/assets?network=Solana&pageSize=100&page=0`. Pagination is zero-indexed with `page.currentPage` and `page.hasNextPage`. This session fetched 13 pages, twelve with 100 assets and one with 71. The 1,271 assets have unique symbols and mints; each contains exactly one Solana deployment.

Useful fields are `id`, `symbol`, `name`, `description`, `logo`, `isin`, `underlying`, `isTradingHalted`, `trading`, and `deployments`. The xStock mint is `deployments[].address` where `network` is `Solana`. Nested stablecoins are payment assets, so their decimals are not the xStock decimals. `trading.openNow` concerns issuer trading availability and does not prove DEX liquidity. Keep halted assets searchable and preserve their status.

All 1,271 mints were read with public mainnet `getMultipleAccounts` at slots 452745210 through 452745214. Every account existed, was initialized, belonged to Token-2022, had eight decimals and Scaled UI Amount, and was not paused. [Per-mint verification](assets/xstocks-2026-10-03/mint-verification.json) preserves those observations. This verifies asset metadata, not eligibility for a Basalt vault or live investing.

## ETF classification gap

Although the official schema supports `underlying.type` equal to `Equity` or `ETF`, all fetched values were null and the server's `underlyingType=ETF` filter returned no assets. Do not use that filter to discover the complete universe. Keep null classifications searchable. An issuer name containing the standalone word `ETF` provides classification evidence; substring matching would incorrectly match Netflix.

Issuer product pages independently identify the underlying ETFs for [SPYx](https://assets.backed.fi/products/sp500-xstock), [QQQx](https://assets.backed.fi/products/nasdaq-xstock), [GLDx](https://assets.backed.fi/products/gold-xstock), [VTIx](https://assets.backed.fi/products/vanguard-xstock), [TQQQx](https://assets.backed.fi/products/tqqq-xstock), [TBLLx](https://assets.backed.fi/products/tbll-xstock), [IWMx](https://assets.backed.fi/products/russell-2000-xstock), and [SLVx](https://assets.backed.fi/products/ishares-silver-trust-xstock).

Further verified overrides cover [VOOx](https://assets.backed.fi/products/vanguard-s-p-500-xstock), [VTx](https://assets.backed.fi/products/vanguard-total-world-xstock), [IEMGx](https://assets.backed.fi/products/core-msci-emerging-markets-xstock), and [SCHFx](https://assets.backed.fi/products/schwab-international-equity-xstock). Another 25 issuer pages are recorded in [additional ETF sources](assets/xstocks-2026-10-03/additional-etf-sources.json). Do not classify by issuer-brand substring alone: Invesco and Franklin Templeton also have company stocks.

## Price provenance and units

The [xStocks developer guide](https://docs.xstocks.fi/developers) describes `/public/assets/{symbol}/price-data` as indicative data from cached onchain sources and Nasdaq/Blue Ocean. Its response is just `{ quote: number | null }`; it has no venue, network or source timestamp. It is unsuitable for labeling a value strictly as a Solana market price.

[Jupiter V3](https://developers.jup.ag/docs/price) derives prices from swaps and reliability checks. Query at most 50 official mints per call. Unpriced mints are omitted, not returned as zero. Current official [rate-limit documentation](https://developers.jup.ag/docs/portal/rate-limits) supports keyless access at 30 requests/minute and free-key access at 60 requests/minute. The buckets are shared with other Jupiter APIs; obey response backoff headers. Support an optional server-only key and handle authentication failure honestly. The measured coverage audit is recorded in [the cache follow-up](create-price-cache-2026-10-03.md).

The live production response included `usdPrice`, `blockId`, `decimals`, `priceChange24h`, `scaledUiConfig`, and `stockData`. Use `usdPrice`, not `stockData.price`, for the onchain value. `createdAt` is token creation and is not quote freshness. The docs say `blockId` can verify recency. Public RPC accepts batched [getBlockTime](https://solana.com/docs/rpc/http/getblocktime); three tested slots returned Unix timestamps. Cache each slot's timestamp. A fetch timestamp alone does not establish the source's age.

Live AAPLx values verified the scaling relationship:

| Field | Observed value |
| --- | ---: |
| `usdPrice` | 333.6010298111938 |
| `scaledUiConfig.usdPricePrescaled` | 334.69157576094307 |
| Effective multiplier | 1.0032690125398187 |

The prescaled price divided by the effective multiplier equals `usdPrice`. Jupiter's current `usdPrice` is already the scaled display price; dividing it again would be wrong. Preserve both the source unit and raw/scaled relation in tests. Do not substitute underlying equity quotes when token prices are unavailable.

## Scheduled multiplier fix

[Solana's Scaled UI Amount documentation](https://solana.com/docs/tokens/extensions/scaled-ui-amount) selects `new_multiplier` at or after its activation timestamp. The installed SPL package exposes `multiplier` and `newMultiplier` as numbers, and `newMultiplierEffectiveTimestamp` as bigint. The existing holdings parser only selected the old field, even after activation.

`backend/src/indexer/holdingsSync.ts` now chooses the effective field and accepts an optional test clock. It returns null for invalid active values. Raw-token math, transfer behavior and existing fallback handling were not changed. `backend/tests/holdings-multiplier.test.ts` adds 11 cases covering activation boundaries, reverse splits, invalid fields and propagation through holdings with unchanged raw amounts.

Verification: `npm --prefix backend test -- tests/holdings-multiplier.test.ts tests/backend-truth.test.ts` passed 53 tests. This is a focused integration check, not a claim of mainnet transaction readiness.

## API contract tests

`backend/tests/xstocks-api.test.ts` exercises the real `createHandler` with a null database and fake issuer, Jupiter, and Solana RPC responses. Its 13 cases check official metadata and ETF enrichment, scaled token pricing, distinct observation/retrieval timestamps, missing/invalid/401 prices remaining null even with `PRICE_FALLBACK=mock`, mint validation, snapshot provenance, and cache behavior. No test calls a live provider.

Verification: `npm --prefix backend test -- tests/xstocks-api.test.ts` passed 13 tests. The integration owner runs the combined backend suite and application checks separately.
