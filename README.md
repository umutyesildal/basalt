# Basalt

**Your stock picks deserve a basket.**

Basalt lets creators turn a stock-market thesis into a basket people can discover, inspect, and share. Choose the assets, set the allocation, give it a name and a cover, and share the idea. The Solana protocol gives a deployed basket its own share token, backed by the tokens in its vaults.

[Explore baskets](https://basalt.markets/explore) · [Build a basket idea](https://basalt.markets/create) · [Try on devnet](https://basalt.markets/create/onchain) · [Follow Basalt](https://x.com/basalt_sol)

## What you can do today

- **Discover a thesis.** Browse stock-basket ideas, their allocations, and creators.
- **Build and share.** Create a wallet-free preview with chosen assets, weights, a thesis, and artwork. Share a short link or download a basket poster.
- **Explore tokenized stocks.** Browse the official Solana xStocks catalog, token quotes, and asset-detail charts. Missing prices remain unavailable.
- **Try the complete devnet flow.** Connect a wallet, claim project-issued test tokens, create an immutable basket, add tokens to mint shares, and redeem shares for proportional underlying tokens.
- **Keep your basket identity.** Original creator names, theses, and selected covers are published only when the original document matches the immutable onchain metadata hash. The gallery hides incomplete creator records by default; **Show all** reveals them.
- **Claim an optional handle.** Open the one-field dialog without signing; authenticate when saving. A handle is optional for creating, minting, or redeeming a basket.

**Release boundary:** The transaction demo runs on Solana devnet with project-issued BSTESTA–D Token-2022 mocks. They have no market value. Official xStocks metadata and quotes are read-only integrations; funded official-xStocks investing and mainnet access are not available. Shared previews do not deploy vaults or earn fees. Model performance for sample ideas is separate from onchain basket returns; unavailable devnet USD values and incomplete historical projections remain guarded.

## Try it

### Build a basket idea

Open [Create](https://basalt.markets/create), choose assets, set an allocation totaling 100%, add your thesis and cover, and share the preview. No wallet is required.

### Create a basket on devnet

1. Open [Create on devnet](https://basalt.markets/create/onchain) or the [wallet workspace](https://basalt.markets/devnet).
2. Connect Phantom or Solflare on devnet and obtain devnet SOL for transaction fees and account rent.
3. Choose **Get test tokens** to claim the fixed mock pack once per wallet.
4. Review the test-token allocation, fees, seed amounts, and disclosures, then sign the basket creation transaction.
5. Add constituent tokens to mint more basket shares, or redeem shares to withdraw proportional tokens.

New creation uses the approved owner namespace. Existing legacy baskets retain their read and redemption routes. Owner initialization is complete; visitors do not need to initialize the factory. Governance remains single-owner and devnet-only.

The [owner lifecycle record](docs/devnet-owner-live-activation-2026-10-10.md) contains the independently verified 19-transaction proof for three- and four-token baskets. It establishes mock-token contract behavior, not issuer-backed investing or returns.

## How the protocol works

```text
Creator's constituent tokens → Basket vaults → Basket share token
Investor's constituent tokens → Mint shares
Redeem shares → Proportional constituent tokens
```

- **Immutable V0 baskets:** constituents, target weights, creator, fee schedule, and metadata hash are fixed at deployment. Holdings can drift as asset values change; V0 does not actively rebalance.
- **Atomic creation:** the factory seeds the vaults and mints genesis shares in one transaction. Genesis is 1,000,000 raw units at six decimals, displayed as one basket share.
- **In-kind mint and redemption:** deposits mint shares against current vault ratios; redemption returns raw proportional holdings after disclosed share fees.
- **Permissionless, oracle-free redemption:** the protocol does not gate redemption on the indexer, price providers, or whitelist pause. Token issuer controls can still constrain underlying transfers.
- **Capped fees:** entry ≤3%, exit ≤1%, annual management ≤3%. Generated fee shares split 90% to the creator and 10% to the treasury, with rounding remainder to the treasury.
- **Raw settlement, scaled display:** Token-2022 transfers use integer raw amounts. Display and valuation account for admitted Scaled UI Amount configurations.
- **No backend custody:** the backend indexes and serves data and builds unsigned transactions; wallets sign asset movements.

V0 has no leverage, lending, derivatives, or active rebalancing. Managed Basket V2 is a separate localnet prototype, not a public deployment. Jupiter zap support is periphery and sequential; it is not a public official-xStocks investment flow.

## Repository

| Directory | Responsibility |
| --- | --- |
| [`programs/`](programs/) | Anchor programs: `whitelist`, `basket_factory`, and `basket`; separate Managed V2 prototype |
| [`app/`](app/) | Next.js 15 / React 19 frontend, Bklit-derived charts, wallet adapters, basket creation and sharing |
| [`backend/`](backend/) | Node.js / TypeScript API, PostgreSQL indexer, holdings and valuation workers, optional Redis cache |
| [`scripts/`](scripts/) | SBF builds, transaction proofs, localnet workflows, and security checks |
| [`docs/`](docs/README.md) | Protocol specification, decisions, dated release evidence, and operating guides |
| [`brand/`](brand/) | Basalt brand and social assets |

Program routing uses the shared [namespace registry](backend/src/config/programNamespaces.ts). New creation selects the owner namespace; each existing basket resolves its registered factory. Legacy compatibility IDs are not the current creation target.

## Local development

Use Node.js 20.17+ with npm 11.6.2. Rust and the Solana/Anchor toolchain are required for program work; PostgreSQL 15 is used for indexed data. Redis is optional.

```bash
git clone https://github.com/umutyesildal/basalt.git
cd basalt
npm ci --legacy-peer-deps=false
cp app/.env.example app/.env.local
cp backend/.env.example backend/.env
```

Configure `backend/.env` for your local PostgreSQL database and devnet RPC. Leave `REDIS_URL` empty to use the in-memory cache. The backend applies its schema at startup. The checked-in examples contain legacy defaults; consult the namespace registry and [deployment guide](deploy/DEPLOY.md) for registry configuration rather than substituting arbitrary program IDs.

Start the backend in one terminal:

```bash
cd backend
set -a
. ./.env
set +a
SOCIAL_AUTH_ALLOW_DEV_SECRET=1 npm run dev
```

The opt-in above uses a process-random local authentication secret; restarting invalidates its tokens. Leave `SOCIAL_AUTH_SECRET` empty for this local mode. Production requires a generated secret and rejects the development fallback. Never commit private environment files or keys.

Start the frontend in another terminal:

```bash
npm --prefix app run dev
```

Open [localhost:3000](http://localhost:3000). The API defaults to port 3001; `/api/v1/health` reports liveness and `/api/v1/ready` reports subsystem readiness. Direct-RPC devnet wallet operations do not require the indexer; publishing/retrieving shared basket metadata and indexed/social features require the backend. Read-only mainnet quote data does not switch transaction signing away from devnet.

## Verification

```bash
cargo test --workspace
cargo test --workspace --features owner-devnet --locked
npm --prefix backend run build
npm --prefix backend test
npm --prefix app test
npm --prefix app run typecheck
npm --prefix app run build
npm run test:security
npm run proof:txsize
```

For deployable V0 artifacts, use `npm run build` with a supported `cargo-build-sbf` toolchain. The script builds each program separately and checks the SBF artifacts; a host `cargo build` is not a deployable program build. Build and tests do not deploy programs.

Test totals are dated evidence, not permanent claims. The [11 October metadata release](docs/basket-visibility-diagnosis-2026-10-11.md) records all six exact-source CI jobs passing, including 1,600 backend tests and 71 security checks. The subsequent [handle release](docs/claim-handle-2026-10-11.md) records 468 app Node tests, 67 Vitest tests, typecheck, and the hosted build. Those are previous release results, not checks rerun by this README update.

## Documentation and release evidence

- [V0 specification](docs/basalt-v0-spec.md): account model, instructions, accounting, and invariants.
- [Owner devnet activation](docs/devnet-owner-live-activation-2026-10-10.md): finalized lifecycle, deployed identities, and legacy routing.
- [Public basket metadata and gallery filter](docs/basket-visibility-diagnosis-2026-10-11.md): exact creator records, publication checks, and remaining data limits.
- [Optional handle claiming](docs/claim-handle-2026-10-11.md): wallet authentication and final frontend release.
- [Backend security](docs/backend-devnet-security-2026-10-09.md): authorization, canonical indexing, and recovery safeguards.
- [Operations](deploy/DEPLOY.md) and [mainnet roadmap](docs/mainnet-readiness-roadmap.md): environment setup, release procedures, and remaining gates.
- [Full documentation map](docs/README.md): additional product, protocol, and historical evidence.

The runtime recorded on 11 October is frontend `b649a4a860e21b974317be2473512d4d07dec170` and backend `f8195cf4c386edeeee074ed3dc958b7aa5637b5f`. Later documentation commits do not imply a runtime redeployment. Dated records retain their historical scope.

## Risk and legal status

Basalt is an experimental strategy-basket product. Tokenized stocks are issuer-backed instruments, not direct ownership of company shares. Issuer controls, smart-contract risk, liquidity, and jurisdiction restrictions require review. Current single-owner governance is not a production multisig or timelock. `LEGAL_REVIEW_REQUIRED` remains in the product disclosures; legal review, security review, and the mainnet readiness gates must be completed before any mainnet launch. Nothing here is investment advice or a promise of returns.
