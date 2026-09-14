# Basalt agent guide

How an AI agent reads Basalt: list baskets, read NAV and holdings exactly, interpret events, and stay honest about what the indexer knows. Pair this with `/llms.txt` for the one-screen index.

## 1. What Basalt is — and is not

- Basalt runs **onchain strategy baskets powered by xStocks** on Solana. A basket is one immutable Token-2022 share mint plus one vault per constituent. `mint_in_kind` takes constituents in target weight and mints shares; `redeem_in_kind` burns shares and returns the underlying tokens pro rata — permissionless and oracle-free by construction.
- **Never call a basket an "ETF" or a "fund."** Compliant vocabulary: strategy basket, index basket, onchain equity basket, xStocks-backed strategy token. No performance promises, no "safe", no "guaranteed".
- The backend (REST `/api/v1`) is a **read-only indexer**: it decodes Anchor events, syncs vault holdings, snapshots NAV, and serves rows. It never signs transactions and never custodies funds. Anything that moves funds is a transaction the user's wallet signs client-side.

## 2. Status: devnet

Basalt is **live on Solana devnet (since 2026-09-04)** and nowhere else. Three programs are deployed at declared IDs; one basket is verified end-to-end on-chain (mint, redeem, management fee; full evidence in `docs/devnet-live-2026-09-04.md` in the repo). Consequences for agents:

- xStock tokens reachable today are **repo-issued devnet mocks** (12 whitelisted mints, `TSLAx`…`SPYx`). Jupiter can never quote them — treat `price_source: "mock:*"` whitelist rows as zap-unavailable.
- Transaction sizing is resolved: `create_basket` / `mint_in_kind` / `redeem_in_kind` compile offline to version-0 messages ≤ 1232 B for 2–10 constituents; n ≥ 4 routes through one address-lookup table. Reproduce with `npm run proof:txsize` at the repo root (`scripts/checkTxSize.ts`).
- Never present devnet figures as mainnet state.

## 3. Programs

| Program | ID (devnet) | Notes |
|---|---|---|
| `whitelist` | `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS` | `Active` / `PausedNewMints`; paused blocks mint only, never redeem |
| `basket_factory` | `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF` | permissionless create; validates 2-20 constituents, weights sum 10,000 bps, fee caps |
| `basket` | `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k` | mint / redeem / `accrue_management_fee` |

## 4. Listing baskets

```
GET {API}/api/v1/baskets?sort=aum&limit=100
```

- `sort` — `aum` (default) | `return_24h` | `return_7d` | `return_30d` | `holders` | `mint_count`.
- `creator`, `minAUM`, `search`, `limit` (1-500) filter the list.
- Rows carry `pubkey`, `metadata_json` (parse for `name`/`description`), `weights_bps`, `share_price`, `return_24h`…, `holders`, `source`, `asOf`. Postgres numerics arrive as **text strings**; convert defensively and render `null` as "unknown" — never as 0.
- **An empty list means nothing is indexed yet.** It is an answer, not an error, and never a license to invent baskets.

## 5. Reading one basket in depth

```
GET {API}/api/v1/baskets/{pubkey}
```

Response highlights: `constituents` (mint addresses), `weights_bps` (target, sum 10,000), `entry_fee_bps` / `exit_fee_bps` / `management_fee_bps`, `nav` (`{ value, supply, sharePrice, asOf, source }` or `null`), `drift` (`actualWeightsBps` vs target) and `holdings`.

```
GET {API}/api/v1/baskets/{pubkey}/holdings
GET {API}/api/v1/baskets/{pubkey}/nav/history?interval=1h&from=<ISO>
GET {API}/api/v1/baskets/{pubkey}/performance
GET {API}/api/v1/whitelist          # mint -> ticker, decimals, multiplier, status
```

- NAV fields are BigInt-exact decimal strings. `sharePrice` is NAV per share in USD; `value` is total basket NAV; `supply` is share supply (raw units).
- No NAV snapshot yet ⇒ `nav: null`. Say "no NAV snapshot yet", do not extrapolate from constituent prices.
- Per-constituent labels: map mint → `ticker` from `/whitelist`. Display-only — tickers never go on-chain.

## 6. Token-2022 accounting: raw vs scaled

- On-chain truth is **raw** integer amounts (`transfer_checked` with decimals).
- Display/NAV amounts are **scaled**: `scaled = raw × multiplier` (constituents carry a Token-2022 `ScaledUiAmountConfig`; e.g. mock xStocks use multiplier 1,000,000 with 6 decimals so 1 raw unit displays as 1 token). The API hands you both: `raw_amount`, `multiplier`, `scaled_amount`.
- **Move numbers between modules as decimal strings** and compute with BigInt. A raw amount of `1_000_000_000_000` exceeds float safety; parsing it as a JS number can silently corrupt it.
- Basket **share mints are fixed 6 decimals with no multiplier**: share units = raw / 10^6.

## 7. Events and how to interpret them

The programs emit four Anchor events; the indexer stores them in its `events` table:

- `BasketCreated { basket, creator, num_constituents, share_mint, ts }` — genesis minted 1,000,000 shares to the creator's seed deposit.
- `Minted { basket, user, gross_shares, net_shares, entry_fee_shares }` — shares are u64 raw units (divide by 10^6). `net = gross − entry_fee`.
- `Redeemed { basket, user, shares_burned, exit_fee_shares }` — burning shares returns underlying tokens pro rata; redemption output is computed from vault balances, not an oracle.
- `FeeAccrued { basket, shares_minted, elapsed_sec }` — management fee accrues by dilution (new shares to creator/treasury 90/10); a permissionless crank triggers it.

Where to observe them today:

- The indexer's raw events ledger is queryable: `GET /api/v1/events?basket={pubkey}&type=&limit=`. `basket` is required (else 400 `INVALID_PUBKEY`); `type` must be one of `BasketCreated|Minted|Redeemed|FeeAccrued` (else 400 `INVALID_TYPE`); `limit` is an integer clamped to 1..500 (non-integer ⇒ 400 `INVALID_LIMIT`). An unindexed basket answers 404 `NOT_INDEXED`; no Postgres answers 503 `DB_UNAVAILABLE`. Rows carry `sig`, `slot` (decimal string — parse with BigInt), `basket`, `type`, `data`, `ts`, plus `source`/`asOf`.
- Derived views still exist: `GET /api/v1/feed?type=trades&limit=50` (filter items by `basket`) and per-wallet history from `GET /api/v1/users/{wallet}/history` — both are built on the same indexer ledger.
- For anything binding, go to the chain: signatures referenced by the feed resolve on a Solana explorer (devnet cluster).
- Every trade is on-chain settlement — a feed row is evidence, not a claim. If the feed page you fetched contains no trades for a basket, say exactly that ("none in the latest feed page"); do not conclude "no activity ever".

## 8. Honesty contract

- **Never fabricate.** No endpoint returns production-looking filler. Empty list, `null` NAV, and missing windows are the truthful answers.
- Every success payload carries `source` (e.g. `onchain-indexed`) and `asOf` (ISO timestamp). Quote them when you report a figure; stale `asOf` means stale figure.
- Error shape: `{ error: { code, message } }`. Codes you must surface verbatim:
  - `NOT_INDEXED` (HTTP 404) — the basket/pubkey exists on-chain maybe, but this indexer has no row for it. It is not "does not exist".
  - `DB_UNAVAILABLE` (HTTP 503) — the backend has no Postgres; indexed views are down. On-chain mint/redeem still work.
  - `QUOTE_UNAVAILABLE` (quotes) — Jupiter could not quote a leg. Do not retry by inventing a price.
- Quote and ranking numbers are estimates: zap legs are **sequential and non-atomic**, slippage is not guaranteed; leaderboard returns derive from NAV snapshots.
- Local demo data (a seeded dev database) is always marked `demo-seed` — never present it as live.
- The UI never uses legal chips, but the substance stands: informational only, not investment advice; counsel review precedes any mainnet launch.

## 9. Building transactions (agents that execute)

- Client instruction builders live in the repo at `app/lib/transactions.ts` and `app/lib/create-basket.ts` (mirrored from the Anchor programs, discriminators cross-verified). Assemble and sign **in the user's wallet** — server-side signing does not exist in Basalt.
- `redeem_in_kind` takes no oracle and no pauser account; it works even while a constituent mint is paused for minting. This is structural (test-enforced), not a promise.
- Sizing a basket for deployment: `npm run proof:txsize` at the repo root proves offline that create/mint/redeem stay ≤ 1232 B for 2–10 constituents (v0 messages + one address-lookup table at n ≥ 4).
- If you only read, prefer `GET /api/agent/basket/{pubkey}` on this site — the whole detail view as markdown, with provenance.

## 10. Quick reference

```
GET  /api/v1/baskets                                   list (sort, creator, minAUM, search, limit)
GET  /api/v1/baskets/{pubkey}                          detail + NAV + drift + holdings
GET  /api/v1/baskets/{pubkey}/holdings                 raw / multiplier / scaled per mint
GET  /api/v1/baskets/{pubkey}/nav/history              interval 1m|5m|15m|1h|1d, from, to
GET  /api/v1/baskets/{pubkey}/performance              inception|24h|7d|30d where snapshotted
GET  /api/v1/whitelist                                 mints, decimals, multiplier, status
GET  /api/v1/users/{wallet}/portfolio                  indexed positions
GET  /api/v1/positions?wallet={wallet}                 same by query param
GET  /api/v1/creators/{pubkey}                         creator profile
POST /api/v1/quotes/zap-in | zap-out                   Jupiter legs (non-atomic, unsigned)
GET  /api/v1/feed?type=trades                          recent verified trades (proxy for events)
GET  /api/v1/events?basket={pubkey}                    events ledger (type, limit 1..500)
GET  /api/v1/leaderboard/baskets?window=7d|30d|all     ranked baskets
GET  /api/v1/health                                    indexer lag / staleness
GET  /api/agent/basket/{pubkey}                        this basket as markdown (this site)
```
