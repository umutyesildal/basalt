# Managed Basket V2 — UI contract

> Target product/UI contract for Managed V2. The current implementation on `main` is a localnet-only prototype, not a public-cluster deployment. See `managed-basket-v2-prototype-status.md` for implemented features and gaps; the states below include future UX. Immutable V0 and the public concept preview keep their current behavior.

## Product rules

- `/create` remains a wallet-free concept preview. `/create/onchain` is the separate transaction flow.
- Managed V2 is opt-in. Existing V0 baskets and holders never migrate automatically.
- Each Managed basket has one identity NFT, minted to its creator. The NFT identifies the basket; the fungible Token-2022 share is the pro-rata claim on actual vault assets. The NFT grants no share or manager rights; transferring it does not transfer the manager role.
- V2 changes weights only within its fixed asset list. Fees, constituents, treasury, and identity stay fixed.
- Only a confirmed fill updates current holdings and version. Redemption stays visible in every state.
- Use **creator**, **managed basket**, **basket share**, **identity NFT**, **proposal**, **target mix**, and **current holdings**. Avoid “fund”, “ETF”, return promises, and language suggesting Basalt signs for a holder.
- Keep primary copy short. Put protocol mechanics and longer risk explanations in keyboard-accessible **Details** sections.

## Entry and creation

### Public `/create` — concept preview

The current wallet-free preview and sharing flow remains unchanged.

- Page label: **Concept preview**
- Primary action: **Create preview**
- Share action: **Copy preview link**
- **Preview details:** **This preview does not create tokens or move assets.**

Do not show a live wallet state, proposal, trade, or executed version on a concept page.

### On-chain `/create/onchain` — basket type

- Page label: **On-chain basket**
- Choices: **Fixed basket** / **Managed basket**
- Managed helper: **The creator can propose delayed weight changes within a fixed asset list.**
- Disconnected: **Connect a wallet to continue.**
- Pending: **Creating basket… Confirm in your wallet.**
- Success: **Managed basket created · v1** / **View basket**
- Failure: **Basket not created. Try again.**

### Managed setup and review

Show the initial mix, fixed assets, creator, guardian, notice period, expiry, one identity NFT, fee rows, and proposed trade limits in the review. Do not make users infer the terms from a generic acknowledgment.

Primary review labels and copy:

- Section: **Management terms**
- Summary: **Changes: weights within this asset list**
- Roles: **Creator** / **Guardian**
- Identity: **1 identity NFT · sent to creator**
- Fees: **Entry** / **Exit** / **Annual management**
- Fee split: **Creator 90% · treasury 10%**
- Acknowledgment: **I agree that the creator can propose delayed weight changes within this asset list.**
- Review action: **Review managed basket**
- Sign action: **Create managed basket**

**Management details** (available before signing):

- **The creator may propose weight changes among these assets. Assets and fees cannot be changed.**
- **The guardian approves a trade limit. After the notice period, an eligible counterparty may fill it. A proposal does not change holdings.**
- **The identity NFT identifies the basket. Basket shares are separate and represent the redeemable pro-rata claim. The NFT grants no manager rights; transferring it does not transfer the manager role.**
- **The creator receives 90% of protocol fees collected under these terms; the treasury receives 10%. Actual amounts depend on basket activity. No earnings are promised.**
- **Trade costs and price impact are shown separately from basket fees.**
- **Redemption uses actual vault balances. Underlying token transfer restrictions may affect an exit.**

## Holder basket page

Keep **Target mix** and **Current holdings** separate. Current holdings come from confirmed vault balances and show an as-of time. On devnet show the quiet badge **Devnet · mock assets** near the holdings. Its **Details** text: **These project-issued tokens have no economic backing and are not official xStocks.**

Show a compact **Identity NFT** row with **View NFT** and its explorer link. Additional explanation lives in **Details** as above.

### No proposal

- Status: **Current mix · v1**
- Actions: **Buy shares** / **Redeem shares**

### Proposal pending

Keep current holdings as the primary actual view. A compact proposal card shows proposed target diff, rationale, earliest fill, expiry, and estimated trade impact.

- Status: **Proposed · v2**
- Labels: **Why this mix** / **Earliest fill** / **Expires** / **Estimated impact**
- Action: **Review proposal**
- Keep **Redeem shares** visible.

Proposal review includes **Maximum input**, **Minimum output**, source and as-of for estimates, and the trade limit. **Details:** **Current holdings remain in effect until a fill is confirmed.**

### Approved, waiting for fill

- Status: **Approved · fill available after {time}**
- Action: **View trade limit**
- Keep current holdings and **Redeem shares** visible.

Do not present approval as an executed mix.

## Creator proposal flow

The creator can only change positive weights within the fixed asset set; weights total 100%. Show current and proposed targets side by side, plus a bounded trade preview.

- Page title: **Propose a new mix**
- Rationale: **Why this change?**
- Validation: **Weights must total 100%. Every asset must keep a positive weight.**
- Summary: **Current target** / **Proposed target**
- Trade section: **Proposed trade limit**
- Submit: **Submit proposal**
- Wallet pending: **Submitting proposal… Confirm in your wallet.**
- Success: **Proposal submitted · v2**
- Failure: **Proposal not submitted.**

**Details:** **This proposal does not change holdings. The new mix appears after a confirmed fill.**

## Execution and proposal outcomes

### Confirmed fill

Update target version and current holdings only after the execution event is confirmed and balances reconcile. Show actual input/output, execution time, and transaction link.

- Status: **Mix updated · v2**
- Activity: **Basket mix updated · v2**
- Labels: **Actual input** / **Actual output** / **Executed** / **Transaction**
- **Details:** **The fill changed vault holdings; it did not change your share balance.**

### Expired, cancelled, or failed

- Expired: **Proposal expired**
- Cancelled: **Proposal cancelled**
- Failed fill: **Trade failed**
- **Details:** **The last confirmed mix remains current. A reverted transaction may still incur a network fee.**
- Action: **View transaction** when a signature exists; **Try again** only while the proposal remains valid.

Keep the last confirmed version and holdings. Do not publish an “updated” activity or advance the version for a failed, expired, or cancelled proposal.

## Fees and estimates

Show entry, exit, and annual management fees as percentages on create and detail. On proposal review, show **Fees unchanged** and the estimated trade impact. Do not add a rebalance fee.

Extended fee details use: **The creator receives 90% of protocol fees collected under these terms; the treasury receives 10%. Actual amounts vary with basket activity. Past activity does not predict future fees or returns. Trade costs are included in the approved execution limit and are not an additional creator fee.**

Label quoted prices and impact **Estimate**, with provider and as-of time. Use confirmed on-chain amounts for final fees and actual trade deltas.

## Acceptance scenarios

1. **Desktop — concept vs on-chain:** A visitor shares a preview without a wallet; preview details say no tokens or assets move. `/create/onchain` distinguishes Fixed and Managed.
2. **Desktop — creation:** Before signing, creator can inspect the fixed asset set, initial mix, roles, notice/expiry, fees, and identity NFT recipient. Managed details are accessible without obscuring the main review.
3. **Desktop — proposal:** Holder sees actual current holdings separately from proposed targets, review details, and Redeem. Submission or guardian approval never changes the current mix.
4. **Desktop — execution:** After confirmed fill and balance reconciliation, all holders see the same actual holdings and version, actual trade amounts, and transaction link. Their share balances are unchanged by the fill.
5. **Desktop — unsuccessful proposal:** Failed, expired, and cancelled states retain the last confirmed version; no successful activity appears. Revert fee explanation is available in Details.
6. **Mobile — review and proposal:** At 320 px and 390 px, terms, before/after mix, fees, status, trade limits, and Redeem remain readable without horizontal scrolling or overlapping wallet controls.
7. **Mobile — execution:** Version/status appear first; actual amounts, provenance, identity NFT link, and transaction link remain accessible without clipping.
8. **All viewports — truth:** Devnet/mock status remains visible but visually quiet. Concept, mock, stale, and unavailable values are distinguishable. A target is never shown as current holdings; approval is never shown as execution. Each managed basket has one identity NFT, and its transfer changes neither manager authority nor share ownership.
