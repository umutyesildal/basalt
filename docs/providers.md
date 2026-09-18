# xStocks Provider Inventory — Basalt V0.1 Minimal

> Prices are comparative, not a single-source truth. Each ticker has three series: `xStock (Jupiter/on-chain) vs underlying equity (Yahoo) vs benchmark (Nasdaq/QQQ)`.

## 1. Providers

| ID | Name | Type | Data | Notes |
|----|----|-----|------|-----|
| `backed` | Backed Finance | xStocks issuer | Token-2022 `ScaledUiAmount`, mint → ticker mapping | Official mints require BAS-002 compatibility approval; current V0 admits extension-free dev mocks only |
| `jupiter` | Jupiter Price API v6 | On-chain price | `price.jup.ag/v6/price?ids=mint` | NAV only; it never gates redemption |
| `yahoo` | Yahoo Finance | Underlying equity | `query2.finance.yahoo.com/v8/finance/chart/TSLA?interval=1d&range=1mo` | Used for comparison; a CORS proxy may be required |
| `nasdaq` | Nasdaq Benchmark | Index | Yahoo `QQQ` / `SPY` / `^IXIC` | Basket benchmark |

## 2. Ticker → Mint Mapping (V0.1 initial four)

**Correction (2026-09-03, `docs/devnet-tokens-research-2026-09-03.md`):** The `Xs…` mints below are real mainnet xStocks (not mocks) and use 8 decimals, not 6. On-chain observations show `ScaledUiAmountConfig` and `TransferHook`. No official xStocks are used on devnet; devnet tests use self-minted Token-2022 mocks with project-selected decimals. Under the current BAS-002 policy, these official mints remain fixture-only and must not be admitted until the extension-aware dependency and transfer path are approved.

| Ticker | Underlying | xStock Mint (MAINNET) | Decimals | Provider | Notes |
|--------|---------------|-------------------------------|----------|----------|-----|
| TSLAx | TSLA | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | **8** | backed | Observed on-chain; not V0-approved |
| AAPLx | AAPL | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | **8** | backed | Observed on-chain; not V0-approved |
| NVDAx | NVDA | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | **8** | backed | Observed on-chain; not V0-approved |
| SPYx | SPY | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | **8** | backed | Catalogue entry; not V0-approved |

The local dev database keeps a separate 6-decimal mock whitelist seed for devnet demos. Mainnet admission must use freshly verified mint accounts and the approved extension policy, not this seed.

## 3. Price Source Details

### Jupiter (on-chain xStock)
```
GET https://price.jup.ag/v6/price?ids=XTSLA...,XAAPL...
→ { data: { "XTSLA...": { price: 251.34 } } }
```
Fallback 0; cache for 30 seconds in Redis at `price:jupiter:{mint}`.

### Yahoo (underlying equity)
```
GET https://query2.finance.yahoo.com/v8/finance/chart/TSLA?interval=1d&range=1mo
GET https://query2.finance.yahoo.com/v8/finance/chart/QQQ?interval=1d&range=1mo
→ chart.result[0].indicators.quote[0].close[] + timestamps
```
Backend proxy: `GET /api/v1/prices/yahoo?symbol=TSLA&range=1mo` normalizes the response. A `User-Agent` header is required; rate-limit requests to 2 seconds.

### Comparison logic
- Each snapshot: `{ ts, jupiter, yahoo, diffBps = (jupiter - yahoo)/yahoo *10000 }`
- Depeg alert: `|diffBps| > 200` (2%) → amber UI badge.
- Normalize xStock and `QQQ` prices to a 100 base at inception and plot them side by side.

## 4. Minimal Schema Additions

Add the following tables to `backend/src/db/schema.sql`:

```sql
CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT, type TEXT);
INSERT INTO providers VALUES ('backed','Backed Finance','xstock'),('jupiter','Jupiter','price'),('yahoo','Yahoo Finance','price'),('nasdaq','Nasdaq','index');

CREATE TABLE price_snapshots (
  mint TEXT, provider TEXT, price_usd NUMERIC, ts TIMESTAMPTZ, PRIMARY KEY (mint, provider, ts)
);
CREATE TABLE index_snapshots (symbol TEXT, price_usd NUMERIC, ts TIMESTAMPTZ, PRIMARY KEY (symbol, ts));
```

SQLite is sufficient for V0.1 if needed: run a one-minute cron for `price_snapshots` and `index_snapshots`.

## 5. Priority

First target: make **TSLA, NVDA, and QQQ** live; keep AAPL/SPY explicitly marked as mock where applicable. Then expand to 15 xStocks after BAS-002 approval.

*LEGAL_REVIEW_REQUIRED: xStocks are Backed instruments and are not direct equity ownership.*
