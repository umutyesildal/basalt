# Real xStock charts and compatibility follow-up, 2026-10-03

> Later owner correction: catalog cards are now compact and quote-only, with no inline chart/history requests. See [compact catalog evidence](compact-asset-cards-2026-10-03.md). The detail-page charts and historical pricing decisions below remain current. The contract review below is a pre-change audit; [current admission and devnet work](xstocks-devnet-runtime-2026-10-03.md) govern the subsequent source and deployment.

The owner requested real charts on Stocks and ETFs, restored 7D figures, and an honest check of whether the contracts work with official xStocks. The verbose price/source sentence and visible market/cache labels are removed. The internal owner-selected NYSE spot-refresh schedule is retained.

This follows the [Create and quote-cache update](create-price-cache-2026-10-03.md), superseding its visible price-label decisions only. The accepted landing remains pushed at `7a16c18`; subsequent catalog, cache and chart work is local. No new commit, push, deployment or chain transaction was performed in this follow-up.

## What changed

- Stocks and ETF cards show a small Bklit price chart and 7D price change when an exact historical window exists.
- Asset details show a larger Bklit chart with 7D and 1M selection. Source/time and token identity remain in collapsed details rather than a technical sentence beside the price.
- No visible `Market closed`, `Saved prices`, `Cached price` or per-unit provenance wall remains in the app source. The quote cache still pauses spot-provider requests outside the chosen NYSE session.
- Charts survive same-mint, same-range pending refreshes and transport outages. Invalid identity or units clear them. Warm history wakes once at the next UTC daily boundary; cold pending jobs poll every eight seconds only while visible. Hidden tabs recover on visibility return.
- Unavailable history stays empty with concise copy. It does not substitute underlying stock prices or draw a fabricated curve.

## Actual token history and units

The [history API](../backend/src/workers/xstockHistory.ts) reads exact-mint Solana pool discovery and daily OHLCV from GeckoTerminal. It selects an identity-matched pool with at least $1,000 reported liquidity and an approved cash-side token (USDC, USDT or wrapped SOL), preferring sufficiently old pools and then liquidity. Zero current 24h volume is eligible: no recent trades must not hide valid earlier history. Each displayed candle itself requires real positive volume. Requests specify the exact asset mint and USD, including when the asset is the pool's quote side.

GeckoTerminal's token quantities and prices use the unscaled/raw token unit. A real NFLXx swap confirms the reported quantity equals raw pool balance delta divided by 10^8, before the issuer multiplier. Each completed candle close is therefore divided by the historical issuer multiplier effective at that completed UTC boundary. The full paginated issuer history must form a valid chain beginning at multiplier 1. Unknown, malformed or incomplete history fails closed. Jupiter V3 spot quotes are already in displayed-token units and are not divided again.

[Public unit evidence](assets/xstocks-history-2026-10-03/unit-proof.json) includes the NFLXx raw delta/10x split and QQQx dividend multiplier history. Primary documentation: [issuer developer guide](https://docs.xstocks.fi/developers), [multiplier guide](https://docs.xstocks.fi/developers/multipliers), [pool OHLCV reference](https://docs.coingecko.com/reference/pool-ohlcv-contract-address) and [GeckoTerminal API](https://api.geckoterminal.com/docs/index.html).

The endpoint is `GET /api/v1/xstocks/history?mints=<1-24 official Solana mints>&range=7d|30d`. It returns actual completed daily points, source, pool, scaled units, retrieval time and an explicit completed-UTC-day-close timestamp meaning. The 7D/1M percentage compares exact closing prices at the current completed boundary and exactly 7/30 calendar days earlier. No interpolation, forward-filled candles or arbitrary first-point return is used. These are displayed-token price changes, not total investment return, realized profits or fee-adjusted returns. Spot price and completed-close history have different timestamps by design.

Historical requests are explicit readbacks of completed past trading data, independent of live spot polling. The live quote worker is still NYSE-session gated. A final API check retained AAPLx spot source time `2026-10-02T22:52:58Z` and retrieval time `2026-10-02T22:59:37.494Z` while chart reads continued.

## Cache and limitations

History uses bounded in-flight deduplication, at most two asset jobs, globally paced provider calls (2.1 seconds minimum), HTTP429 backoff, six-hour good-cache reuse and sixty-second retry cooldown for failed/absent data. A new completed UTC day gets an immediate first attempt, even if the old window was retrieved just before midnight; subsequent failed attempts respect cooldown. The API bounds initial waiting and lets cards fill progressively.

Validated public history persists atomically to ignored `backend/.cache/xstocks-history.json`. `XSTOCK_HISTORY_CACHE_PATH=0` disables persistence. Restored old points preserve original retrieval dates and cannot become a fresh 7D percentage without the exact new endpoint. No history seed or generated price series is committed.

Five initial real histories were warmed (AAPLx, MSFTx, SPYx, QQQx, NFLXx); an initial NVDAx request was rate limited. Subsequent runtime discovery filled more actual histories, including NVDAx and GLDx. This is scoped evidence, not universal history coverage for all 1,271 catalog mints. Thin pools, absent candles, provider limits and invalid multiplier history can still leave charts or percentages unavailable. A cold page can fill progressively over approximately a minute or longer under provider limits.

## Contract answer

The [dedicated compatibility audit](xstocks-contract-compatibility-2026-10-03.md) and its [HTML review](assets/xstocks-contract-compatibility-2026-10-03/review.html) preserve current source references, fresh RPC observations and historical transaction links.

V0 has a 2-20 constituent model and real variable-length transfer paths. Historical three- and six-token mock basket create/mint/redeem transactions remain finalized and successful. Four constituents need the current address-lookup-table transaction builder; an exact successful four-token current-SBF E2E was not established.

Official xStocks do not work with the current admission policy: whitelist, factory and new-deposit validation reject every mint extension, while real issuer mints have several modern Token-2022 extensions. A multiplier-only display implementation cannot fix transfer compatibility. The checked official mainnet addresses are not usable mints on devnet. Existing devnet mock tokens are project-issued and different.

Fresh ProgramData block times show the three devnet programs were last deployed September 4, before current hardening, and lack current source-to-byte attestation. All authorities are still one key. Managed V2 is separately a fixed-pair localnet prototype. This audit changed no contract gate, program, authority or deployed account. The public Create route still shares basket ideas.

## Final verification

- **779 backend tests passed, 18 database-dependent tests skipped.** The 24 new focused history tests cover units, exact windows, quote-side pool identity, zero-current-volume historical availability, incomplete multipliers, persistence, outage retention, pending jobs, backoff and real midnight rollover. [Full log](assets/xstocks-history-2026-10-03/basalt-xstock-charts-backend-tests.log).
- **39 focused frontend checks passed**, covering catalog/sharing/Create preservation and strict history identity, units, dates, anchors and refresh retention. [Log](assets/xstocks-history-2026-10-03/basalt-xstock-charts-frontend-tests.log). [Existing preview/sample integrity](assets/xstocks-history-2026-10-03/basalt-xstock-charts-legacy-test.log) passed.
- **214 Rust library tests passed** during the compatibility audit. These are host library tests, not a new SBF/CPI integration proof.
- [App production build](assets/xstocks-history-2026-10-03/basalt-xstock-charts-app-build.log) and [backend build](assets/xstocks-history-2026-10-03/basalt-xstock-charts-backend-build.log) passed. Final compiled servers were restarted locally.
- Root browser checks verified real stock/ETF mini charts, exact 7D/1M changes, keyboard period selection, collapsed details, and no visible rejected labels. Desktop and 375/320px layouts had no horizontal overflow. Console errors were empty. A transient browser-control timeout recovered through the documented native observation API; the final page and percentage were verified.
- Real runtime UTC rollover was observed: QQQx updated to `2026-10-03T00:00:00Z`, 31 completed closes, +0.4110% 7D and +6.3534% 1M. [API evidence](assets/xstocks-history-2026-10-03/basalt-xstock-charts-qqq-api.json). [Spot provenance remained unchanged](assets/xstocks-history-2026-10-03/basalt-xstock-charts-preserved-spot.json).

Screenshots: [Stocks cards](assets/xstocks-history-2026-10-03/basalt-stocks-charts-desktop.png), [ETF cards](assets/xstocks-history-2026-10-03/basalt-etfs-charts-desktop.png), [Apple 7D](assets/xstocks-history-2026-10-03/basalt-stock-aapl-7d.png), [Apple 1M](assets/xstocks-history-2026-10-03/basalt-stock-aapl-1m.png), [Apple mobile](assets/xstocks-history-2026-10-03/basalt-stock-aapl-mobile.png), [final QQQx 7D](assets/xstocks-history-2026-10-03/basalt-stock-qqq-final-7d.png), [final QQQx 1M](assets/xstocks-history-2026-10-03/basalt-stock-qqq-final-1m.png), [final QQQx mobile](assets/xstocks-history-2026-10-03/basalt-stock-qqq-final-mobile.png).

Changed code: `backend/src/workers/xstockHistory.ts`, `backend/src/api/server.ts`, `backend/tests/xstocks-history.test.ts`, `backend/.env.example`; `app/lib/xstock-history.ts`, `app/tests/xstock-history.test.ts`, `app/components/xstocks/use-xstock-history.ts`, `xstock-history-chart.tsx`, `xstock-market-chart.tsx`, `xstock-catalog-grid.tsx`, and `app/app/stock/[ticker]/page.tsx`. Existing catalog, quote-cache, Create and basket-share changes remain preserved. Arena and video artifacts were not touched.
