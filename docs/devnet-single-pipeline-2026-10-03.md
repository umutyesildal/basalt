# One-action devnet baskets, 2026-10-03

Status: implementation and local verification complete; publication in progress. The owner tested the published devnet mint successfully and requested a simpler UI pipeline.

## Product change

The workspace presents one task at a time: **Use a basket** or **Create a basket**. Adding tokens and withdrawing use one primary form action. The repeated review modal and second mint/redeem confirmation button are removed. The wallet still explicitly approves every signature; the app never signs for the owner.

The user selects a basket, enters an amount and presses **Add to basket** or **Withdraw to wallet**. The app validates fresh balances, prepares accounts, simulates, opens the wallet and confirms. Progress and the outcome stay inside the same card. Creation keeps its immutable terms, fee cap, positive 10,000-bps weights and required acknowledgment before its single **Create basket** action.

Estimated shares and fee rates remain visible before clicking. Per-token debits, network cost, annual-fee dilution and transaction details are available through keyboard-accessible disclosures. Devnet/mock identity stays visible once. No USD purchase, automatic stock swap or official funded xStock mint is implied.

## Safety and actual friction

Read-only inspection confirmed that the owner's prior mint finalized and the basket share balance changed. The same sequence included four account-lookup setup transactions before the mint. This establishes extra approvals, but does not prove why the first setup was interrupted.

A synchronous pipeline lease is acquired before the first asynchronous read. Two rapid clicks cannot create two flows. Wallet or connection changes reject stale authorization. Mint keeps the exact per-token debits displayed at the click; fresh reads validate them rather than replacing the allocation silently. Redemption retains the existing oracle-free, whitelist-free protocol path.

The existing simulation/sign/broadcast state machine is retained. Economic-send retries use one signature and the same signed bytes. Setup-send callbacks now share one signing promise per transaction, retain preflight and use the same signed-byte transport handling. An uncertain submitted economic transaction disables new actions and offers **Check status** and Explorer. Only RPC confirmation/finalization or an actual onchain error releases that signature's lease. The lease is local to the mounted workspace; economic-action idempotency across a full reload is not claimed.

Public lookup-table receipts are scoped to chain genesis, configured programs, wallet and exact account fingerprint. They preserve partial setup so a retry can use the validated existing table. Receipts contain public setup signatures and validity context, never private keys or signed transaction bytes. Saved tables are rechecked for program ownership, wallet authority, active state and complete account coverage. Browser storage is optional; the tab cache remains available when storage is blocked, but storage-disabled reloads lose receipts. Pre-fix tables were never persisted or automatically discovered, so an existing user can need one initial setup under this version before future reuse. A custom sender that never returns a signature cannot supply a recovery receipt.

Unchanged creation drafts reuse a nonce keyed by owner, chain, programs, metadata and raw seed amounts. Only the nonce is stored under a SHA-256 key. Confirmed creation clears it independently of the currently connected wallet. If a reload loses the economic confirmation UI, a pre-existing draft PDA is strictly read and its immutable creator/hash/composition/fees are matched before opening it. No replacement creation or fabricated transaction confirmation is used.

## Verification

- Pipeline, draft reuse, raw-amount and same-signed-byte tests: 44 passed.
- Frontend Node suites including 24 lookup-table recovery cases: 77 passed. The 24 recovery tests were independently rerun and passed.
- App TypeScript check passed. Offline transaction-size proof passed for 2–10 constituents with all wire sizes within 1,232 bytes.
- Production build passed for the exact changed UI/transaction source in an isolated archive. Existing localhost build output was not overwritten. [Build log](assets/devnet-single-pipeline-2026-10-03/build.txt).
- Browser checks: the real public basket loads through direct devnet RPC; amount changes update estimates; Add/Withdraw and Create routes switch without transactions. At 375/768/1,280 px the document has no horizontal overflow; the primary action is 48 px tall. Disconnected economic actions remain disabled. [Desktop](assets/devnet-single-pipeline-2026-10-03/desktop.png), [mobile](assets/devnet-single-pipeline-2026-10-03/mobile.png), [tablet](assets/devnet-single-pipeline-2026-10-03/tablet.png).
- No owner-wallet signature was performed by the agent in this revision. Prior owner execution and this revision's mock tests/read-only rendering checks are distinct.

[Verification summary](assets/devnet-single-pipeline-2026-10-03/validation.json), [Node tests](assets/devnet-single-pipeline-2026-10-03/frontend-node-tests.txt), [wire-size proof](assets/devnet-single-pipeline-2026-10-03/wire-size.txt). Independent source review cleared the nonce continuation, cached-table checks, signature reconciliation and original redemption boundaries.

## Publication

Source commit, deployment identity, final test results and screenshots will be recorded after verification. The VPS/backend/program deployment is unchanged by this frontend revision.
