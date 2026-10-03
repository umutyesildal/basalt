# Basalt implemented architecture

> **Current devnet wallet UI, 2026-10-03:** `/devnet` and `/create/onchain` now expose wallet-signed test-token claim, atomic basket creation, in-kind mint and redemption. The same four project-issued eight-decimal Token-2022 mocks, BSTESTA–D, back every new test basket; each basket gets its own share mint. `/create` offers **Try on devnet** and a shared preview offers **Create on devnet**. The funded, once-per-wallet faucet is `2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf`. Verified basket, supply, vault and wallet reads use direct devnet RPC, without a database or backend signer. [The wallet-flow record](devnet-ui-wallet-flow-2026-10-03.md) links the finalized claim and shipped UI-builder proof: **seven finalized transactions and 20 assertions**. Names and theses are browser-local, verified against the immutable onchain metadata hash. An owner extension-wallet signature was not performed; build and responsive checks are recorded separately. This supersedes earlier redirect-only and incomplete mock-UI statements. Official xStocks, mainnet and Managed V2 release boundaries remain unchanged. Source changes remain local and unpushed.

> The base architecture below records 2026-09-18. The scoped 2026-10-03 updates in this document and the dated admission erratum in `docs/basalt-v0-spec.md` supersede older policy statements; other dated deployment claims retain their original scope.


## Devnet wallet UI increment, 2026-10-03

`/devnet` and `/create/onchain` use the same four eight-decimal BSTESTA–D mock mints for every new immutable V0 basket. `basket_factory` still atomically transfers the seed, initializes vaults and creates a separate six-decimal share mint. The connected wallet signs lookup-table preparation and the main create/mint/redeem transaction. Reviewed raw token deposits remain the transaction amounts, and the wallet/network are checked around signing.

`app/lib/devnet-baskets.ts` verifies the devnet genesis, account owners, discriminators, canonical PDAs, composition, fees and Token-2022 identities. It reads the current basket fee checkpoint, raw share supply, vaults and optional wallet balances in one confirmed RPC batch, uses the existing BigInt management-fee helper and preserves actual active display multipliers. Discovery is limited to the fixed mock pack with bounded materialization and paced, cached reads. USD NAV and prices remain null. The read path accepts whitelist mint pause as data; redemption adds no whitelist, price or backend gate.

The separately deployed faucet `2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf` transfers a fixed pack from funded onchain vaults once per signing wallet. The frontend builds unsigned claims and reads funding/claim state; it holds no server signing key. Browser metadata is displayed only when its exact bytes hash to the basket's immutable metadata hash, with a verified session fallback when persistent storage is denied. This is local presentation, not public metadata publishing.

[The wallet-flow record](devnet-ui-wallet-flow-2026-10-03.md) links the finalized faucet claim and seven-transaction, 20-assertion proof using the shipped UI builders. This scope requires no database or indexer, adds no core ABI/math change and does not deploy Managed V2 or real official xStocks investing.

## Scoped update, 2026-10-03

Immutable V0 source now uses `crates/token-policy` at whitelist admission, factory seed and new deposits. It accepts validated Plain/DisplayOnly profiles and the complete observed eight-extension issuer profile only while default accounts are Initialized, Pausable is unpaused and TransferHook has no program. Deposit source/vault accounts must use supported public account extensions; raw balance delta and canonical identity checks remain. All unrecognized or malformed TLVs fail closed. [Decision](xstocks-token-policy-decision-2026-10-03.md), [source review](xstocks-devnet-basket-proof-2026-10-03.md).

Redemption has no added policy gate and continues to use raw pro-rata accounting. PermanentDelegate, freeze, issuer pause or a later hook can still affect backing or transfer availability. Mainnet issuer metadata discovery does not populate the onchain whitelist. Managed V2 admission remains separately defined and unchanged.

The public Stocks/ETF catalog now uses compact quote-only cards and never requests per-card history. Detail pages retain real exact-mint Bklit 7D/1M history and historical multiplier normalization. Internal NYSE cash-session spot refresh rules remain. [UI verification](compact-asset-cards-2026-10-03.md).

The current V0 whitelist, factory and basket binaries are upgraded on devnet and byte-attested at finalized slot 506820772. Fresh three/four-asset full-profile mock tests passed: 54 transactions, 38 successes, 16 expected rejections and 28 assertions, with issuer settings restored. The [completed runtime report](xstocks-devnet-runtime-2026-10-03.md) carries program and transaction evidence. Real mainnet AAPLx/SPYx fixtures separately prove parser compatibility; no funded official issuer transfer, public investing release or V2 upgrade is claimed. Source changes remain local and unpushed.

## Product model

Basalt creates immutable strategy baskets with 2–20 constituents. Each basket has Token-2022 constituent vaults, fixed constituents and target weights, a fixed fee schedule, a Token-2022 share mint, and creator/treasury fee recipients. The backend is an observation and convenience layer; it never controls funds.

## Components

| Layer | Responsibility | Money movement |
|---|---|---|
| `whitelist` program | Accepted mint metadata and status | None |
| `basket_factory` program | Basket PDA, vaults, share mint, and atomic seed | Moves creator constituents and mints genesis shares |
| `basket` program | Mint, redeem, and management-fee accrual | Real Token-2022 transfer/mint/burn CPIs |
| Frontend | Transaction building, simulation, wallet signing, confirmation | User wallet signs |
| `devnet_faucet` program | Fixed BSTESTA–D starter pack and once-per-wallet claim record | Transfers funded mock tokens; connected wallet pays rent/fees |
| Backend/indexer | Events, holdings, NAV, positions, and social read models | Never signs; no custody |
| Price providers | Reference USD prices and chart data | Never gates mint or redeem |

## Core flows

### Create

1. The client reads active whitelist entries and user token accounts.
2. The creator selects constituents, weights, fees, metadata, and seed amounts.
3. The client prepares basket/factory accounts and an address lookup table when required.
4. The wallet signs.
5. The factory initializes the basket, transfers seed assets, and mints genesis shares atomically.
6. The indexer records `BasketCreated` and vault state.

### In-kind mint

1. The client reads raw vault balances and share supply.
2. Deposit ratios are compared against current vault ratios.
3. The program accrues management fees.
4. Raw constituent amounts move from the user to vaults through `transfer_checked`.
5. Net shares go to the user; fee shares go to creator and treasury.
6. The indexer updates events and position views.

### Redeem

1. The user selects a share amount.
2. The program accrues management fees.
3. Exit fees are separated and the remaining shares are burned.
4. Each constituent pays `floor(vault_raw * burned_shares / supply_before)`.
5. No oracle, price provider, backend, or whitelist status is required.

### Zap-in

1. The backend returns Jupiter quote legs with expected and minimum raw outputs and never signs.
2. After constituent ATAs exist, the client freezes one raw pre-swap balance snapshot bound to the wallet and quote fingerprint.
3. The user signs sequential swap legs; each confirmed leg must produce a `post - pre` raw delta at or above its minimum output.
4. Confirmed legs are not repeated. Ambiguous sends retain and resend identical signed bytes, while positive below-minimum deltas block automatic recovery.
5. The client freezes only the verified deltas and sends a separate `mint_in_kind` transaction.

The V0 Zap is not atomic. If a leg fails, intermediate tokens remain in the user's wallet. A new quote takes a new snapshot, so those existing tokens are excluded from the next Zap deposit. The V0 admission change does not enable a public official-xStocks Zap route or arbitrary active hooks. End-to-end swap, whitelist and issuer-state compatibility must be verified separately before exposing that flow.

## Trust boundaries

| Boundary | Trusted input | Must not be trusted as a gate |
|---|---|---|
| Redeem correctness | Program state, raw vault balances, share supply | Oracle, backend, UI, whitelist pause |
| NAV | Indexed holdings, Token-2022 multiplier, market price | Settlement or redemption |
| User transaction | Wallet signature, simulation, program validation | Backend signing |
| Metadata/social | Off-chain database and content | On-chain ownership truth |
| Demo data | Explicitly labeled presentation dataset | Live/on-chain proof |

## Invariants

1. Constituents, weights, fee schedule, creator, and metadata hash are immutable.
2. Redeem remains permissionless and oracle-free.
3. On-chain transfers use raw Token-2022 amounts only.
4. Multipliers are display/NAV-only.
5. The backend never signs fund-moving transactions.
6. Shares represent pro-rata claims on vault constituents.
7. Rounding stays in the vault; redemption cannot overdraw.
8. Mock/simulated data never implies issuer backing or real AUM.

## Known architecture debt

- The deployed V0 program now carries management-fee numerator remainder in the append-only five-byte field, with new-basket accrual verified in the 2026-10-03 mock flow. Existing-account migration/smoke coverage remains a separate requirement; the new-basket proof does not retroactively validate every historical account.
- Whitelist state does not encode a Token-2022 policy version; current V0 instructions revalidate the shared allowed profiles and mutable issuer state on admission/new deposits. A previously Active record cannot bypass current admission checks.
- V0 fee split divergence is resolved: `creator_fee_split_bps` remains only as a legacy factory ABI/account-layout field, is pinned to 9,000, and the basket program uses the protocol-wide 90/10 split on every fee path. The client policy helper and docs derive the same labels/formula.
- `events.sig` as a sole primary key can drop multiple events from one transaction.
- BullMQ is listed as a dependency, while runtime orchestration uses direct interval loops.
- Health combines liveness and readiness.
- Deployments do not publish commit-to-program-binary provenance.

Canonical tasks live in `implementation-backlog.md`.
