# Create feedback and session-aware token prices, 2026-10-03

## Owner decisions

Keep the accepted landing layout. Simplify public Create by removing the three template choices and opening directly on asset selection. New drafts start with a 2% annual management fee and an explicit recommendation marker; copied drafts retain their existing fee settings. Share basket should give a short success message and a small confetti burst.

The owner asked us to evaluate refresh frequency rather than automatically choosing one minute for the full catalog. After measuring upstream coverage, choose a five-minute full-catalog refresh and one-minute refresh for recently viewed assets. The owner then explicitly selected the **US cash-equity session: 09:30–16:00 America/New_York, excluding holidays**. This session policy applies globally to public token-price refreshes, including non-US issuer assets. It deliberately excludes token trading outside the NYSE session.

## Create implementation

- `/create` starts with no selected assets. The template chooser is removed. The existing two-asset guard, weight-row removal, exact allocation redistribution, search, clickable fade and grouped amount input remain.
- Issuer-catalog scrollbars use dark native color scheme and theme colors for the track/thumb, including WebKit and Firefox. Browser computed styles confirmed `dark`, a dark track and a muted thumb.
- Fresh drafts default to `managementBps: 200`. The existing 300-bps cap stays intact. A cyan marker and `Recommended 2%` label identify the suggested position; the range exposes the recommendation through its accessible description. This is a product default, not a computed estimate of returns or income.
- Review → Share basket arms a one-time completion intent, navigates to the validated shared draft and displays `Your stock basket is ready to share`. Eighteen small CSS particles disappear after about two seconds. Reduced motion suppresses the particles in both JS and CSS.
- Ordinary shared links and reloads do not replay the celebration. The transient `created` query flag is removed from the URL and is absent from copied share links. Session storage has an in-memory fallback.
- Public Create still shares a basket idea; it does not deploy or acquire tokens. The existing public onchain-action gate remains unchanged.

## Measured missing-price cause

The [complete public coverage evidence](assets/create-price-cache-2026-10-03/price-coverage.json) records the source URL, timestamps, every mint and provider response shapes. All observations were collected before the owner requested the NYSE session gate. Quotes are evidence, not hardcoded application prices.

| Measured universe | Usable Solana token price | No usable token price |
|---|---:|---:|
| Full official catalog | 176 / 1,271 | 1,095 |
| Verified ETFs | 29 / 69 | 40 |
| Stocks first visible page | 19 / 24 | 5 |
| ETFs first visible page | 10 / 24 | 14 |

The 26 initial batches produced 25 HTTP 200 responses and one HTTP 429. A paced retry succeeded, leaving no unresolved request. Most unpriced mints returned metadata, including `stockData`, without a positive token `usdPrice`. This is distinct from a transport outage. `stockData.price` is an underlying-equity reference and must not be substituted for a Solana token price.

Among 25 distinct, source-resolved first-page quotes, eight source observations were more than one day old; the oldest were PALLx and MMMx. More polling cannot create a trade or a reliable quote for those assets. [Jupiter Price V3](https://developers.jup.ag/docs/price/index) documents its trade and reliability checks. Its current [rate-limit documentation](https://developers.jup.ag/docs/portal/rate-limits) permits keyless 30 requests/minute and free-key 60 requests/minute, with a shared bucket and backoff headers.

## Backend cache and scheduling

`backend/src/workers/xstockQuotes.ts` owns a shared public quote service independent of database/indexer or transaction readiness. It refreshes the full catalog every 300,000 ms and recently viewed mints every 60,000 ms while the selected session is open. Recently viewed mints expire after ten minutes and are bounded. Requests contain at most 50 mints and start at least 2.1 seconds apart. Visible cold requests can run between full-catalog batches. A cold read waits at most 6.5 seconds; known cached values return immediately while due refreshes run in the background.

HTTP failures and successful-but-unpriced results have separate outcomes. Both preserve any last valid same-mint quote, marked stale. Never-priced assets remain null. A lower source block cannot overwrite a newer cached observation. Same-block refreshes preserve a known source timestamp when RPC timestamp resolution fails.

The optional runtime snapshot defaults to `backend/.cache/xstocks-prices.json`, is atomically replaced and is excluded from Git. Only official mint identities, positive finite prices, explicit Jupiter/scaled-UI provenance and valid dates are restored. Restored prices remain stale until successfully refreshed. Read-only hosts continue to use memory; multi-instance deployments should mount persistent storage or adapt this service to a shared store before relying on cross-instance continuity.

The local preview migrated 176 previously recorded public quotes into this ignored runtime snapshot without a new upstream request. Twenty-six preserve already-resolved source times, including VTIx recovered from the same immutable block in the prior integration evidence. Other records retain their true source block and explicitly unknown source time. This is local continuity evidence, not a seeded price fallback shipped with the product. A new production installation without a snapshot stays unpriced during a closed session until the next opening.

`fetchedAt` is the retrieval time of the last valid quote. `observedAt` is the original source block time and can be null. `refreshedAt` is the latest provider attempt. These fields are never interchangeable. The API adds cache freshness/outcome and market-session metadata without changing existing available/unavailable quote status or scaled-UI units.

## NYSE policy

`backend/src/workers/marketSession.ts` uses the official [NYSE hours and calendars](https://www.nyse.com/trade/hours-calendars) for 2026–2028. It accounts for holidays, 13:00 early closes and DST via `America/New_York`, without a fixed UTC offset. Beyond the published calendar it fails closed, so the calendar must be extended before 2029. Unscheduled exchange emergency closures require an operational calendar update.

Outside the session, startup, full/hot refreshes and price reads use cached quotes without triggering provider or block-time requests. The shared Jupiter provider layer also gates direct NAV and legacy comparison consumers, and returns their last valid cached points with unchanged retrieval time. Snapshot restoration seeds this read cache. Mainnet spot comparison skips fresh Yahoo requests while closed; NAV computation can continue from saved prices. Historical chart reads and unrelated account/indexer RPC are separate from spot-price refresh scheduling. The worker wakes at the next opening and stops queued work at the close. This policy governs convenience pricing only and never affects permissionless redemption or transaction authorization.

Stocks/ETFs show `Market closed` and saved prices. Their browser polling pauses until the reported next opening. A failed refresh retains a known same-mint price and source dates. Wrong-identity or invalid quotes still fail closed. A 24-hour movement is displayed only for a non-stale quote with a known source observation less than 24 hours old.

## Other price sources investigated

No primary source established complete reliable Solana token-price coverage for all 1,271 assets. The issuer public price endpoint mixes onchain and Nasdaq/Blue Ocean references without enough source/venue time to silently fill missing market quotes. [xChange RFQ](https://docs.xstocks.fi/developers/xchange-atomic-rfq) is an amount-specific issuer execution quote and requires separate onboarding.

Pyth distinguishes xStock/USD feeds from equity and redemption-rate feeds. The [issuer oracle directory](https://api.xstocks.fi/api/v2/public/oracles?network=Solana&page=0&pageSize=200) listed 51 Solana Pyth mappings, with only EWYx, GEVx and LITEx outside this Jupiter priced set; these require further access/unit validation. Chainlink [v10 `tokenizedPrice`](https://docs.chain.link/data-streams/reference/report-schema-v10) aggregates CEX token trading and differs from its underlying-equity `price`. Neither automatically becomes a Solana execution price.

[Birdeye's documented Scaled UI support](https://bds-support.birdeye.so/hc/en-us/articles/48443824197785-Birdeye-Now-Supports-Scaled-UI-Amounts-for-Solana-Token-2022) makes it a suitable next exact-mint coverage evaluation, but coverage was not measured or claimed and no credentials were requested. No unverified fallback was added.

## Validation and delivery

Final verification passed. Earlier xStocks integration counts and chain checks remain dated evidence in [the prior integration audit](xstocks-integration-2026-10-03.md).

| Check | Result and evidence |
|---|---|
| Focused frontend | **29 passed**: copied fees, one-time feedback, quote identity, fetch-plus-merge omission/outage retention, old-source movement suppression and closed-session metadata. [Log](assets/create-price-cache-2026-10-03/frontend-tests.log). |
| Legacy preview/sample integrity | Passed. [Log](assets/create-price-cache-2026-10-03/share-tests.log). |
| Full backend | **755 passed, 18 PostgreSQL-dependent tests skipped** in this database-free local runtime. Includes worker persistence, session boundaries, holidays/DST/early close, backoff recheck, visible-request priority, source-block regression, closed provider/NAV behavior and quote API checks. [Log](assets/create-price-cache-2026-10-03/backend-tests.log). |
| Backend/app production builds | Both passed, including TypeScript checking. [Backend log](assets/create-price-cache-2026-10-03/backend-build.log), [app log](assets/create-price-cache-2026-10-03/app-build.log). A missing helper import caught by an intermediate app build was repaired before this final passing build. |
| Final closed-session API | Compiled backend served eight requested mints in **19.89 ms**, with 176 cached assets, `refreshing:false`, original quote/source dates and `nextOpenAt: 2026-10-05T13:30:00Z`. Never-priced SGOVx/BIDUx stayed null. [Observed JSON](assets/create-price-cache-2026-10-03/closed-market-api.json). |
| Browser Create | Fresh empty selection; dark scrollbar while scrolling through the expanded catalog; AAPL/MSFT selection and weights; 2% range and cyan recommendation; Review → Share success; URL flag removed; reload does not replay success; copied mix/fee preserved. [Catalog](assets/create-price-cache-2026-10-03/catalog-dark.png), [fee desktop](assets/create-price-cache-2026-10-03/fee-desktop.png), [success](assets/create-price-cache-2026-10-03/share-success.png). |
| Browser quotes and responsive layout | ETF page visibly reports `Market closed · Saved prices`, SPYx/QQQx/GLDx keep recorded prices, old PALLx/PPLTx dates remain visible and 24h changes are suppressed. VTI search/detail preserves Sep 27 source time independently of Oct 2 retrieval time. No horizontal overflow in Create at 320/375px, ETF grid at 320px or detail at 375px; final console errors empty. [ETF desktop](assets/create-price-cache-2026-10-03/etfs-closed-desktop.png), [VTI mobile](assets/create-price-cache-2026-10-03/vti-closed-mobile.png), [ETF 320px](assets/create-price-cache-2026-10-03/etfs-closed-320.png), [Create 320px](assets/create-price-cache-2026-10-03/create-320.png), [fee mobile](assets/create-price-cache-2026-10-03/fee-mobile.png). |

Reduced-motion behavior and closed-browser polling pause were source reviewed; session boundaries/provider cancellation were tested with controlled clocks. This pass did not change onchain fee math or programs, so the prior Rust evidence was not rerun. The local app uses the compiled build on port 3000 and the compiled backend runs on 3001 with database/indexer/transaction workers disabled. [Runtime log](assets/create-price-cache-2026-10-03/runtime.log). Temporary browser viewport overrides were reset and the ETF page was left open.

This pass is local and uncommitted. No new push or public deployment has been performed. The accepted landing commit `7a16c18` remains the last verified pushed checkpoint. Existing transaction/release boundaries remain unchanged.
