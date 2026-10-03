# One-action devnet baskets, 2026-10-03

Status: published and verified on the existing public Basalt website. The owner tested the published devnet mint successfully and requested a simpler UI pipeline.

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

- Product source: [`b5039f5063c6d183dc388112b6f3f487ceb51c3e`](https://github.com/umutyesildal/basalt/commit/b5039f5063c6d183dc388112b6f3f487ceb51c3e), pushed to `main`.
- All four GitHub CI jobs passed: Rust, Node workspace, dependency audit and secret scan. [CI](https://github.com/umutyesildal/basalt/actions/runs/37123403331).
- Existing Vercel project: `basalt`, `prj_qqKHz0ys2JAFFrWOVaYfPdljZFAR`, scope `yesildaladams-projects`.
- Deployment: `dpl_3SGmPVkrWxRmAk7a1wbwqBtqUepf`, Ready, then promoted after staged HTTP/client-bundle checks.
- Immutable URL: `https://basalt-2nwhnthfo-yesildaladams-projects.vercel.app`.
- Public route: [Create on devnet](https://basalt-coral.vercel.app/create/onchain). `/devnet` serves the same workspace.
- Live HTTP returned 200 and referenced the same checked UI and setup chunks. Browser hydration read the actual public basket and showed the single Add/Withdraw action with a real onchain share estimate. Disconnected controls stayed disabled. [Live screenshot](assets/devnet-single-pipeline-2026-10-03/live.png), [deployment checks](assets/devnet-single-pipeline-2026-10-03/deployment-checks.json).
- The prior Vercel deployment `dpl_FNSeEzmNUyoK5DesY3jfcwnXmJAj` remains the rollback target. Existing public API/devnet settings are preserved. The VPS/backend/program deployment is unchanged by this frontend revision.

The first staged marker assertion only examined workspace chunks; the lookup-table marker belongs to the shared transaction chunk. Inspecting the actual linked shared chunk verified it before promotion. This was a check-scope error, not a missing implementation.

### Accidental temporary project and approved cleanup

The first deployment preparation failed to copy an old temporary project-link file, but the following command was still launched. Vercel created `basalt-pipeline-publish-20261003` (`prj_zsjpfBrBE2TRtAJ3cBYiRPzSaOK1`) rather than using the existing project. Before cleanup, it had one failed deployment (`dpl_9LoBvzESrXqrvm2sPG1GuUGXpyUZ`), zero environment variables and no Git link, verified through read-only Vercel metadata. The linked existing Basalt project and production promotion above are the actual release.

Automatic approval review initially rejected permanent deletion because explicit human authorization for destructive cleanup was absent. The owner then explicitly approved cleanup. On October 3, 2026, Vercel confirmed removal of `basalt-pipeline-publish-20261003`; a subsequent read-only project lookup returned 404. The live Basalt route still returned HTTP 200 and referenced the verified UI and transaction chunks. Cleanup is complete.
