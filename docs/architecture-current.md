# Basalt implemented architecture

> This document describes how the system works as of 2026-09-18. The normative constraints remain in `docs/basalt-v0-spec.md`.

## Product model

Basalt creates immutable strategy baskets with 2–20 constituents. Each basket has Token-2022 constituent vaults, fixed constituents and target weights, a fixed fee schedule, a Token-2022 share mint, and creator/treasury fee recipients. The backend is an observation and convenience layer; it never controls funds.

## Components

| Layer | Responsibility | Money movement |
|---|---|---|
| `whitelist` program | Accepted mint metadata and status | None |
| `basket_factory` program | Basket PDA, vaults, share mint, and atomic seed | Moves creator constituents and mints genesis shares |
| `basket` program | Mint, redeem, and management-fee accrual | Real Token-2022 transfer/mint/burn CPIs |
| Frontend | Transaction building, simulation, wallet signing, confirmation | User wallet signs |
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

The V0 Zap is not atomic. If a leg fails, intermediate tokens remain in the user's wallet. A new quote takes a new snapshot, so those existing tokens are excluded from the next Zap deposit. Zap remains unavailable for the extension-bearing official xStocks until the BAS-002 dependency and hook-aware transfer work is complete.

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

- The working tree carries management-fee numerator remainder in an append-only five-byte field; the deployed devnet program still requires an upgrade and existing-account smoke test.
- Whitelist state does not encode a Token-2022 policy version; V0 enforces an extension-free, fail-closed boundary in instructions.
- V0 fee split divergence is resolved: `creator_fee_split_bps` remains only as a legacy factory ABI/account-layout field, is pinned to 9,000, and the basket program uses the protocol-wide 90/10 split on every fee path. The client policy helper and docs derive the same labels/formula.
- `events.sig` as a sole primary key can drop multiple events from one transaction.
- BullMQ is listed as a dependency, while runtime orchestration uses direct interval loops.
- Health combines liveness and readiness.
- Deployments do not publish commit-to-program-binary provenance.

Canonical tasks live in `implementation-backlog.md`.
