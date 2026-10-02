# Data integrity and demo policy

> Goal: users must understand whether each value comes from the chain, a market provider, a derived calculation, or a demo dataset.

## Data classes

| Class | Meaning | Required visible label |
|---|---|---|
| `onchain-verified` | Account or event verified through RPC/indexer | Onchain · slot/as-of |
| `market-reference` | External provider price; not settlement truth | Reference price · provider · as-of |
| `derived` | On-chain holdings combined with reference prices | Reference NAV · sources · as-of |
| `mock-asset` | Project-issued devnet token with no real backing | Mock asset · no economic value |
| `historical-model` | Fixed sample quantities valued from completed real underlying closes | Model price · 7D · shared source/date and collapsed methodology |
| `simulated` | Generated value or series, not an observation | Simulated |
| `demo` | Static/synthetic basket or user presentation data | Accurate example/action context; shared product status where needed, per the 2026-10-02 owner decision |
| `stale` | Data outside its freshness SLA | Stale · last successful time |
| `unavailable` | No trustworthy data | Unavailable; never fabricate a number |

## Non-negotiable rules

- A mock-asset basket value is not labeled AUM; use Reference NAV or Simulated basket value.
- Randomly jittered charts are never attributed to Yahoo, Jupiter, or “live” data.
- Concept basket tickers never appear as live financial metrics or verified activity.
- `onchain-indexed` describes provenance, not issuer backing.
- Market prices never gate mint or redeem.
- Financial metrics require source and `asOf`.

## UI requirements

### Concept preview and environment context

The wallet-free `/create`, `/preview`, and sample gallery build and share basket ideas. The owner removed repeated concept/preview and no-purchase notices on 2026-10-02. Accurate actions such as “Share basket” and “Use this mix”, example dollar amounts, and the landing's single status sentence communicate the available behavior. The shared page's onchain action is disabled and says “Coming soon”. Sample activity still has no transaction signatures, fake returns, AUM, or fabricated timestamps. Preview links contain no wallet or balance data. This copy decision does not relax provenance for financial metrics or indexed transactions.

The indexed basket routes retain transaction-specific context. `/create/onchain` currently redirects to `/create`; the retained creation code is not exposed at that route. Its cluster, backing, and price provenance must remain visible near the actual decision or value. Hide raw protocol fields in accessible details when they are not needed for the initial decision.

### Global environment banner for transaction pages

Every actionable devnet transaction page shows:

`DEVNET · MOCK ASSETS · NO REAL ECONOMIC VALUE`

If dismissible, a persistent environment badge remains in the header.

### Basket surfaces

On-chain basket detail, buy, redeem, portfolio, and any social/OG output that claims indexed activity show:

- cluster,
- asset-backing status,
- value kind,
- price source and as-of,
- raw/scaled multiplier context.

### Demo mode

Concept pages use a shared presentation catalog independent of the devnet API. The public UI no longer requires a repeated concept label on each page or card; use the accurate action and example context described above. Every link from sample gallery, feed, and leaderboard must resolve to a concept preview or concept creator page. Write actions and verified-activity language are absent from sample surfaces. The legacy `NEXT_PUBLIC_HOME_DEMO` flag is not the source of truth for the primary concept experience.

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
- Concept samples remain visibly labeled whether or not the legacy demo flag is set; they never enter verified on-chain result sets.
- Stale values never appear silently live.
- Deterministic fixtures reconcile basket NAV with raw/scaled holdings.


## Discovery cards, 2026-10-02 revision

Original basket covers and playful names are illustrative presentation, not evidence of live community participation or performance. One sample-context sentence identifies each sample surface. No percentage, price curve, AUM or earnings was added to these cards. See [the discovery audit](design-home-discovery-2026-10-02.md) for the total-NAV and synthetic-series findings that must be resolved before adding financial evidence.


## Approved historical sample models, 2026-10-02

The owner approved a separate historical-model data class for the ten curated baskets. This exception allows measured underlying-market price returns on sample cards; it does not create investor history, live basket prices, realized creator revenue or official xStocks support. Models anchor at $100 on the fixed September base close, use fixed quantities and common comparison dates, exclude dividends/fees/slippage, and fail closed for missing/stale/non-USD prices. They use the dedicated same-origin `/api/basket-performance` contract, not the legacy indexed-data provenance enum. See [the audit](product-performance-audit-2026-10-02.md).
