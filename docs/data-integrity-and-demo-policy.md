# Data integrity and demo policy

> Goal: users must understand whether each value comes from the chain, a market provider, a derived calculation, or a demo dataset.

## Data classes

| Class | Meaning | Required visible label |
|---|---|---|
| `onchain-verified` | Account or event verified through RPC/indexer | Onchain · slot/as-of |
| `market-reference` | External provider price; not settlement truth | Reference price · provider · as-of |
| `derived` | On-chain holdings combined with reference prices | Reference NAV · sources · as-of |
| `mock-asset` | Project-issued devnet token with no real backing | Mock asset · no economic value |
| `simulated` | Generated value or series, not an observation | Simulated |
| `demo` | Static/synthetic basket or user presentation data | Demo data |
| `stale` | Data outside its freshness SLA | Stale · last successful time |
| `unavailable` | No trustworthy data | Unavailable; never fabricate a number |

## Non-negotiable rules

- A mock-asset basket value is not labeled AUM; use Reference NAV or Simulated basket value.
- Randomly jittered charts are never attributed to Yahoo, Jupiter, or “live” data.
- Demo basket tickers never appear in global navigation without a visible DEMO label.
- `onchain-indexed` describes provenance, not issuer backing.
- Market prices never gate mint or redeem.
- Financial metrics require source and `asOf`.

## UI requirements

### Global environment banner

Every devnet page shows:

`DEVNET · MOCK ASSETS · NO REAL ECONOMIC VALUE`

If dismissible, a persistent environment badge remains in the header.

### Basket surfaces

Explore, basket detail, buy, redeem, portfolio, and social/OG output show:

- cluster,
- asset-backing status,
- value kind,
- price source and as-of,
- raw/scaled multiplier context.

### Demo mode

When `NEXT_PUBLIC_HOME_DEMO=1`, home, feed, leaderboard, creator, and marquee use one shared demo-state component. Every demo card and ticker carries its own visible label. Write actions are disabled with a reason.

## API provenance contract

The current wire contract uses `onchain-indexed`, `jupiter-quote`, `mock`, `dev-catalog`, and `unavailable`. These values describe concrete origins, while the UI-facing classes above describe how the data must be presented. New endpoints must not invent an unlabeled source value; any future normalization should be versioned and migrated across backend and frontend together.

Financial responses should converge on these fields without silently renaming existing wire values:

~~~json
{
  "source": "onchain-indexed|jupiter-quote|mock|dev-catalog|simulated|demo|unavailable",
  "asOf": "ISO-8601",
  "cluster": "devnet",
  "assetBacking": "mock|official-xstocks|unknown",
  "valueKind": "raw|scaled|reference-nav|simulated",
  "provider": "solana-rpc|xstocks|jupiter|yahoo|null",
  "stale": false
}
~~~

For mixed-source responses, preserve provenance per constituent or mint.

## Price and chart corrections

1. Migrate legacy Jupiter Price v6 to the current API.
2. Keep the API key server-side.
3. Replace the old `data[mint].price` parser with the current response contract.
4. Label Yahoo fallback as `market-reference:yahoo`.
5. Remove random jitter from `/prices/compare` and `/prices/chart`, or mark it `simulated`.
6. Show an honest unavailable state when real OHLCV does not exist.

## Official xStocks integration

- Reconcile official asset metadata and mint lists through the xStocks developer API.
- Track current/pending multiplier and activation timestamp.
- New minting may pause briefly around a scheduled multiplier change; redeem never pauses.
- Display proof-of-reserves/issuer metadata as separate provenance.
- Replace the static dev catalog with actual `/whitelist` data joined to official metadata.

## Health and deployment provenance

Use the existing `/api/v1/health` route for process liveness. Add a future `/api/v1/ready` route for DB access, indexer lag, NAV freshness, RPC access, configured cluster/program IDs, commit SHA, and demo mode. Return 503 when a required dependency is not ready.

## Acceptance tests

- Screenshot tests confirm a visible label for every mock/demo metric.
- API contract tests fail when provenance fields are missing.
- With demo mode off, `DEMO_BASKETS` never enters the runtime path.
- Stale values never appear silently live.
- Deterministic fixtures reconcile basket NAV with raw/scaled holdings.
