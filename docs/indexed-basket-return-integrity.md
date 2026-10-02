# Indexed basket return integrity

Updated: 2026-10-02. Applies to legacy indexed V0 reference NAV APIs. These observations do not authorize transactions or change on-chain accounting.

Returns compare `nav_snapshots.share_price` values, not total NAV. Deposits and proportional withdrawals change NAV and raw supply together and leave this return unchanged. Management-fee dilution remains reflected in the reference share price.

## API units and unavailable history

- Storage and basket list/leaderboard `share_price` or `sharePrice` remain USD per **raw share unit**. Display a whole-share price by multiplying by 1,000,000 exactly once.
- `/api/v1/baskets` `return_24h`, `return_7d`, and `return_30d` are fractional NUMERIC strings or `null`. A ratio of `0.04` means 4%.
- `/api/v1/baskets/:pubkey/performance` `windows.*.pct` is an exact **percent string** or `null`. `latest.nav` is total NAV; `latest.supply`, `latest.sharePrice`, and `latest.ts` describe the same current observation. Baseline NAV is context only.
- `/api/v1/leaderboard/baskets` `returnPct` is a display percent number. Unrankable baskets are excluded, including missing/zero baselines, incomplete periods, non-finite SQL prices, and stale or future current observations. Clients remain nullable for older responses.
- A current observation must be at most 15 minutes old. A window baseline must be at or before the cutoff calculated from the current observation's timestamp and no more than one hour before that cutoff. Seven days of unavailable history never becomes a shorter “7d” return.
- Inception/all uses the first valid positive-supply, finite positive-price observation. A single observation is not history.
- List and leaderboard NAV, supply, price, and `asOf` are selected from the same latest row even if the rankings materialized view has an older cache.
- Trade history/feed value is `shares_raw * stored_share_price`. History's displayed whole-share price scales by 1,000,000; its share count divides raw shares by 1,000,000. Value has no extra division.

These are indexer quality limits, not executable pricing or redeem gates. No real xStocks backing, live investing, or guaranteed return is implied by reference snapshots.

## Existing database upgrade

The schema contains a bounded one-time upgrade of the old `basket_rankings` materialized view. When its definition lacks the share-price baseline calculation, the schema transaction drops **only that derived view**, recreates it with complete 30-day share-price returns, and recreates its indexes. Base tables and stored raw-unit prices remain unchanged. The drop does not use `CASCADE`: unexpected dependent objects cause the transaction to fail rather than being removed. Subsequent applications keep the upgraded view; the NAV worker continues its normal refresh.

Backend schema bootstrap applies this on startup. To apply the same source explicitly, from the repository root:

```sh
psql "$DATABASE_URL" --set=ON_ERROR_STOP=1 --file=backend/src/db/schema.sql
```

Source: `backend/src/db/schema.sql`. Rebuild/upgrade is atomic with the schema's existing `BEGIN`/`COMMIT`. Restart or apply the schema before relying on cached 30-day rankings. The real PostgreSQL regression checks upgrade behavior and stable view identity on a second application.

## Verification

`backend/tests/basket-returns.test.ts` covers exact values, cashflows, real reference price changes, dilution, zero/missing history, stale/future observations, baseline boundaries, huge decimals, and timestamp normalization.

`backend/tests/basket-returns.sql.test.ts` executes the actual list, performance, leaderboard, trade-history, feed, and schema-upgrade SQL against PostgreSQL. It is opt-in through `BASKET_RETURNS_TEST_DATABASE_URL` and never falls back to `DATABASE_URL`. It owns and removes a unique schema. Supply an isolated disposable database only:

```sh
BASKET_RETURNS_TEST_DATABASE_URL="$DISPOSABLE_DATABASE_URL" npm --prefix backend test -- tests/basket-returns.sql.test.ts
```

For this change, tests used a newly initialized temporary local PostgreSQL server with network listening disabled, not a project or production database. Full backend tests passed: **25 files, 672 tests**, including **27 return unit tests and 18 real PostgreSQL tests**. The backend TypeScript build passed. `cargo test --workspace` passed 214 tests without program edits; existing Anchor macro cfg warnings remain.
