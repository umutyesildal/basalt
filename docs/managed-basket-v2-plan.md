# Basalt Managed Baskets V2 — product and implementation plan

> Status: architecture plan, 2026-09-24. No Managed V2 instruction is deployed or enabled by this document. This track is separate from immutable Basalt V0 and from the holder-signed migration in `basalt-rebalance-v1-draft.md`.
>
> Working branch: `codex/managed-baskets-v2`, created from canonical `main` at `82e9196` in a separate worktree. The pre-existing uncommitted governance/deployment verifier work in canonical `main` must stay untouched.
>
> Companion contracts: `managed-basket-v2-product-flow.md` (English UI states and copy), `managed-basket-v2-threat-model.md` (trust boundaries and instruction-level test matrix). `managed-core/` is a host-side arithmetic/state proof only; it is not a Solana program.

## 1. The product we are building

A creator publishes a **managed strategy basket** with a fixed set of eligible assets and a visible mandate. People can hold one transferable Token-2022 basket share. The creator can propose a new target mix within that asset set. After a public delay, an authorized bounded trade changes the assets in the **single shared vault**. Every existing share then represents the same fraction of the vault's new, actual holdings. Holders do not sign an individual migration or receive a replacement token.

This is an opt-in product type. Existing immutable V0 baskets, their accounts, mint/redeem instructions, and the wallet-free `/create` concept preview do not change or migrate automatically. The current `basalt-rebalance-v1-draft.md` remains a separate user-signed, new-basket migration idea. Its rejection of *different compositions per holder in one vault* does not rule out trading the *whole common vault*: the latter preserves pro-rata claims, while adding manager trust and execution risk.

The first release is deliberately narrow: 2–3 project-issued mock Token-2022 assets on localnet/devnet; fixed constituent mints, fee schedule, treasury, and metadata identity; manager proposals may change target weights only. No constituent add/remove, leverage, lending, yield, automatic return claims, or default opt-in for V0 holders. Widening the asset universe or increasing fees requires a new basket with an explicit holder choice.

### Token model

| Object | Role | Authority |
| --- | --- | --- |
| Fungible Token-2022 share mint | Economic claim on the common vault; six decimals, transferable and burnable for redemption | Only the basket PDA mints; holder signs burns. No freeze authority, permanent delegate, transfer fee, or transfer hook on shares in the first release. |
| Basket identity NFT | One zero-decimal, supply-one Token-2022 mint per basket with name, mark and URI | Minted to the creator at creation in the target V2 product; further minting and metadata edits are disabled after initialization. It is **not** the fractional share and does not control the vault. The first math/execution proof may omit the artwork/mint wiring until the economic invariant is proven. |
| Manager role | May propose allocation changes within the immutable mandate | Separate `manager` key in V2 state, with explicit two-step rotation. NFT transfer does not rotate this role. |
| Guardian / execution policy | Independently approves the execution price bound and controls emergency proposal cancellation | Distinct role from manager; cannot withdraw vault assets or stop redemption. This is a prototype price policy, not a substitute for a production oracle/auction review. |

Token-2022 supplies mint, burn, transfer and optional metadata. It does not split a supply-one NFT into pro-rata claims or perform a rebalance. The identity NFT and the fungible share mint are **two distinct mints**; issuing and redeeming shares is the split/merge experience for holders. Existing V0 already issues fungible Token-2022 shares; the new work is managed-vault authority and safe execution. Extensions generally need to be planned when creating a mint, so NFT and share metadata must be specified before initializing V2 mints. [Solana extensions](https://solana.com/docs/tokens/extensions), [metadata](https://solana.com/docs/tokens/extensions/metadata), [token groups](https://solana.com/docs/tokens/extensions/group-member).

## 2. Product behavior and plain-English UX

1. Public `/create` stays a wallet-free concept preview. It may illustrate a managed strategy, but a preview never claims a trade, investment return, on-chain position, or manager action occurred.
2. The real `/create/onchain` flow offers **Fixed basket** (V0) and **Managed basket** (V2). The managed path shows the fixed eligible asset set, what the strategy manager may change, the notice period, entry/exit/annual fees and who receives them, then asks for wallet signature at the transaction step.
3. A managed detail page leads with the idea, current **actual holdings**, a clean allocation graphic, fee summary, and Buy/Redeem. A small “Managed” label links to the mandate. “Target mix” and “current holdings” are separate; a proposal is never presented as an executed allocation.
4. A proposed change shows old and new target percentages, manager's short reason, earliest execution time, expiry, estimated trade cost, and a persistent Redeem action. A successfully executed change gets a version number, transaction link, actual token deltas and time. A reverted or expired attempt remains clearly unsuccessful.
5. Portfolio and social activity use confirmed chain state for holdings/version. The feed may say “proposed a new mix” or “updated the basket” only when the respective proposal or execution is confirmed. The backend never signs a trade and does not fabricate activity.
6. Every real on-chain view identifies devnet/mock assets and source/time in a calm, visible way. Concept preview data stays separate from real transactions. Copy remains English; avoid “fund”, “ETF”, guaranteed earnings or a claim that creators manage a holder's wallet.

Manager compensation can use an immutable V2 fee schedule and the existing 90/10 creator/treasury split, with the protocol caps enforced at creation. This needs a distinct, honest “earn when people use your strategy” explanation; no projected income or return is shown. Rebalance execution costs are disclosed separately from entry, exit and annual fees.

## 3. On-chain contract and accounting invariants

V0 program IDs and accounts remain untouched. Create separate V2 programs (or one V2 program plus a factory module if measured account/CPI costs favor it) with new seeds and an explicit schema version. Never reinterpret a V0 `Basket` account as mutable V2 state.

**Core invariant:** for constituent `j`, holder entitlement is `floor(vault_raw_j * holder_shares / total_share_supply)` before any exit fee adjustment. The vault's *actual raw token balances*, not target weights or a backend NAV, determine in-kind redemption. A successful rebalance changes vault balances, **not share supply**. The share supply changes only through seed/mint/redeem and the documented management fee accrual. All intermediate products use checked `u128` arithmetic and floor on conversion back to raw `u64`.

The first managed version requires each fixed constituent's initial and target weight to stay strictly positive. This avoids silently inheriting the V0 `gross_shares = min(deposit*S/vault)` assumption when a target becomes zero. A later asset-removal design must define dust, empty-vault and zero-balance share math explicitly.

**Redemption invariant:** a holder can redeem current actual vault assets with only holder signature and canonical basket/share/vault accounts. No manager, guardian, proposal status, whitelist status, price feed, backend, indexer or timelock account may gate redemption. In-kind exit may still fail if an underlying token issuer pauses its own transfers or an external hook rejects a transfer; the UI and admission policy must not promise unconditional 24/7 completion for such assets.

**Authority invariant:** manager/guardian can propose or approve within policy, but cannot transfer to arbitrary recipients. Rebalance's only asset movement is an atomic exchange between canonical vault ATAs and the counterparty's canonical token accounts. Destination received by the vault must be measured after transfer, not trusted from arguments or a quote. No unrestricted manager-supplied CPI or extra writable vault account set.

### V2 state and instruction boundaries

| Module | State / instruction | Required checks |
| --- | --- | --- |
| `state` | `ManagedBasket`: schema version, creator, manager, pending manager, guardian, fixed mint list/decimals, share mint, target weights/version, immutable fee config and mandate hash, PDA bumps | 2–3 fixed mocks first, ultimately bounded 2–20; unique eligible mints; weights sum 10,000 bps; fee caps and 90/10 split; no mutable fee fields |
| `create` | Create basket, share mint and one identity NFT mint, canonical vault ATAs, atomic positive seed and genesis share | Token-2022 program ownership, allowed extensions, canonical authorities/ATAs, correct raw amounts; no unseeded share supply; NFT supply exactly one and no vault authority derived from its owner |
| `shares` | `mint_in_kind`, `redeem_in_kind`, permissionless fee accrual | Live vault/share balances, raw arithmetic, checked floor and fee math; V0-equivalent redeem independence |
| `proposal` | `propose_rebalance`, `approve_price_bound`, `cancel`/permissionless expire, propose/accept manager rotation | Manager and guardian distinct. Manager commits basket/version/nonce, fixed pair, exact input, target weights, approval deadline, notice duration and execution-window duration. Guardian supplies the minimum output and approves a final hash binding **all** terms. Approval before its deadline stamps `approved_at`, then derives `not_before` and `expires_at`; holders see the full executable terms for the whole notice period. Replay/duplicate rejection. |
| `execution` | `fill_rebalance` via a bounded two-party RFQ / limit-order transfer, then finalize target version | Any counterparty can fill after delay; transfer output to vault and input to counterparty in one transaction; validate mint, token program, owner, ATA, balance deltas, committed limits and positive residual balances for every constituent; no arbitrary DEX CPI |
| `events` | Created, shares minted/burned, proposal/approval/expiry, executed with actual raw in/out and version | Indexer reads events and reconciles account balances; an attempted or merely approved proposal does not become current holdings |

For the first executable proof, a **single pair and single atomic fill** is the simplest rebalance. The manager and separate guardian commit an exact `max_in` and `min_out`; the visible delay begins after both have approved, and the taker fills the entire order or the transaction reverts. This removes arbitrary DEX CPI from the initial on-chain surface. A manager-authored `min_out` alone is not a price safeguard. Guardian approval is an explicit trust assumption; production would require independent price bounds or a reviewed auction/limit-order design and liquidity/MEV analysis. No “best execution” claim is made for the prototype.

Multi-leg and multi-transaction execution is a later gated extension. If required, each leg has a persisted status/nonce and re-reads live balances; new deposits may pause while execution is active, but redeem remains callable from every state. A holder exit between legs must not strand the proposal or permit a later leg to withdraw a stale amount. Solana atomic rollback covers one transaction only. The first implementation should avoid this state machine until measured transaction size/compute forces it.

## 4. Token admission and release boundary

Current V0 admission policy deliberately fails closed on Token-2022 extensions. Do not simply add official xStocks to V2. Before admission, exercise every relevant extension with instruction-level fixtures: Scaled UI Amount (raw transfers versus displayed amounts), Transfer Hook (remaining accounts and mutable authority), Permanent Delegate (vault seizure risk), Pausable (exit liveness), Confidential Transfer (observable balance requirement), Transfer Fee (actual received delta), and account-level guards. Pin a per-mint allowlist and re-check authorities/extension state where they can change. The official xStocks compatibility question remains open.

The prototype uses project mock mints without these hostile extensions and never labels them issuer-backed xStocks. Mainnet needs an independent protocol audit, supported real-asset extension matrix, proven governance transfer, measured compute/account limits and release review. The target multisig/time lock in governance docs is a policy target, not an executed authority migration.

## 5. Modules and parallel work packages

These packages have file ownership so agents can work in parallel without editing the same files. Integrate contracts first, then UI and indexing against those contracts.

| Package | Owner / files | Deliverable and gate |
| --- | --- | --- |
| A. V2 contract + tests | Protocol agent: new `programs/managed_basket/` and V2-only Rust tests; root owns `Cargo.toml`/`Anchor.toml` integration | Typed state, share math, guarded create, redeem, proposal and atomic RFQ fill. Local test must show manager cannot redirect assets and redeem during/after a proposal. |
| B. Indexer/API | Data agent: `backend/src/managed/`, additive DB migration, backend tests; root integrates existing route/worker entrypoints | Confirmed versions, proposal status, actual holdings and trade deltas; rebuildable from on-chain events/accounts. Read-only backend, no signer. |
| C. UI/product | UI agent: isolated `app/components/managed/`, `app/app/managed/` routes and UI tests; root integrates existing navigation/create/detail | Managed creation, mandate/fee review, proposal diff and history, current holdings and Redeem. Existing concept and V0 routes remain intact. |
| D. Integration/security | Root plus review agent: SDK account/transaction builders, fixture wiring, docs, adversarial tests, desktop/mobile review | Every user-visible execution status reconciles with chain state. V0 regression suite passes; no mock-to-live confusion. |

Do **not** extract a shared V0/V2 Rust math crate at the start: V0 is live and parity risk is larger than small isolated duplication. After V2 math and instruction tests pass, extract reviewed common helpers only if behavior and serialization remain byte-for-byte compatible with V0. Shared TypeScript read models can use a discriminated `basketType: "immutable" | "managed"` type so API and UI cannot treat a V0 account as mutable.

## 6. Delivery sequence and acceptance gates

1. **Architecture contract:** freeze manager/guardian roles, NFT identity decision, fixed-universe policy, price-bound/trade model, fee schedule, expiry and notice length. Write V2-specific normative spec and threat model; do not edit V0's normatively immutable language.
2. **Executable local proof:** V2 mock share mint + two mock assets; create, second holder mint, proposal, delay, guardian approval, permissionless atomic fill, partial and full redeem. Show two holders' share balances unchanged across fill and both receive the new composition pro-rata. An aborted fill must leave all accounts unchanged.
3. **Adversarial protocol suite:** wrong manager/guardian, duplicate/expired/stale proposal, zero or manipulated price bound, substituted mint/ATA/token program, fake output, excessive source debit, no output, attempted vault redirect, rounding/dust, fee accrual before/after fill and redeem in every relevant state. Use instruction-level ProgramTest/LiteSVM-style execution, not host math tests alone.
4. **Indexer/API:** migrations, event replay/idempotency, RPC reconciliation, proposal versus executed state, version history, read-only outage behavior. Bad or delayed indexer data must never affect redeem.
5. **Product UI:** create/review and manager proposal screens, holder detail/portfolio/feed updates, shareable version history. Desktop, mobile, keyboard and accessible chart review; concept preview stays wallet-free. Run app typecheck/build and backend tests.
6. **Devnet mock pilot:** deploy **new** V2 program IDs only after local proofs, compare transactions/events/balances, execute one complete rebalance with two holders and both exit paths. Record exact program IDs, signatures, hashes and current authority evidence; never substitute this for mainnet readiness.
7. **Mainnet gate:** extension compatibility, price/liquidity design, independent audit, actual multisig/time-lock governance and applicable legal/release work completed. No production launch before these gates.

### Testable definition of done for the first working slice

- V0 program IDs and immutable behavior are unchanged; all existing Rust/backend/app regression checks pass.
- One V2 share mint has two independent holders, and the basket has one separate identity NFT. A bounded, delayed, guardian-approved trade changes only canonical vault balances, never share supply. Both holders' pro-rata entitlement changes together.
- Unauthorized actions, malicious token accounts and bad fills revert; proposal expiry/cancel/replay rules work.
- Holder can redeem before proposal, during notice, after execution and when backend/indexer or manager is unavailable; redemption has no oracle/manager/proposal gate.
- UI distinguishes proposal from executed portfolio state and mock/devnet from real backing. The owner can inspect before/after target, actual holdings, fees, trade cost and version history without reading raw protocol fields.

## 7. Decisions and assumptions to revisit

The working assumption is **identity-only NFT; management rights live in an explicit role account**. If an NFT transfer should also transfer the manager role and fee recipient, that changes the threat model and transaction model; decide before coding NFT issuance. The initial arithmetic/RFQ proof can omit NFT wiring, but the complete V2 creation flow includes one identity NFT.

Other deliberate defaults for a testable first slice: fixed 2–3 mock assets; positive weights; fees immutable after create; 24-hour public notice (use slots/time safely, exact constant chosen in the normative spec); distinct manager and guardian; full-fill RFQ with committed price bound; no DEX CPI; no automatic execution by the backend. These are architecture defaults to verify against a working prototype, not claims that liquidity or production governance already exist.

## 8. Branch checkpoint (2026-09-24)

This branch currently includes the plan, UI contract, threat/test matrix, and a standalone `managed-core/` Rust **host proof**. Its two-asset model covers live raw-balance in-kind mint, pro-rata redeem, manager proposal, guardian approval, public delay, expiry and an atomic bounded pair fill. Eight integration tests pass. The model deliberately omits fees, account ownership/signature enforcement, Token-2022 CPI, NFT issuance, indexer, API and UI wiring. Those remain the work packages above; the proof must never be presented as a deployed or security-reviewed V2 product.
