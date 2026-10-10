> **Live release verified, 2026-10-10 at 17:39:14 UTC:** The owner setup and complete 19-transaction lifecycle passed before the separately reviewed activation. Website and VPS backend now run `6cacb49f2b1a1fecd7398174c189c9bb65cec895`. [Create on devnet](https://basalt.markets/create/onchain) completes the live factory check; no additional owner setup signature is required. Current runtime identities, hosted verification, the guarded manual cutover continuation and remaining history limits are recorded in [Verified live release](#verified-live-release). Earlier pending-release sections below are retained historical checkpoints.

# Owner devnet lifecycle and activation, 2026-10-10

## Finalized prerequisite and complete lifecycle

The genuine human owner setup finalized at slot `509606852`, transaction [5Xkj…FNhy](https://explorer.solana.com/tx/5XkjbrtExkx719PoyVsZUxc2AAnDCLma2CvwGGCpCVRe1ETPv7ENFX37wQuq3FGNCvryUuAerosZPkuUfJRfFNhy?cluster=devnet). [Independent owner setup evidence](./evidence/owner-initialization-finalized-2026-10-10.json) authenticates the actual signature/message, all three deployed artifacts/loader authorities, singleton owner/treasury, fee split/caps and four exact admissions. No further owner setup signature is required.

Fresh lifecycle run 03 completed on clean source `5c9bdb5c8f92226d2eabd2f396315747219f1225` using official devnet and the existing fixed public mock faucet. All 19 single-send transactions finalized, through slot `509611849`. [Full public lifecycle receipt and accounting snapshots](./evidence/owner-lifecycle-finalized-2026-10-10.json). Private bootstrap/actor keys remain outside Git and the website.

| Proof | Three-token basket | Four-token basket |
| --- | --- | --- |
| Basket | `GatK6Dut1yjRJbwnxqPSTrWRov47xkDfZaTPieLEw9sP` | `8GWauztbdTHXy3N8uGppQXtB1HYXQJGSgz9J4VeFvWFV` |
| Share mint | `HSs65RhrLQRJkh4YCeTnhKg7ZKFT6h5SSxp7gdfJBfHJ` | `7iVdhKHBNak4ncA4g8rmEEMLe5HrbFuZkQE4aJ49R1KY` |
| Actual signed create/mint/redeem packet bytes | 1,110 / 1,047 / 928 | 543 / 392 / 356 |
| Explicit accrued fee, raw shares | 13 | 12 |
| Partial / remaining redeem exit fee, raw shares | 1,650,000 / 3,300,000 | 1,650,000 / 3,300,000 |
| Remaining investor shares | 0 | 0 |

Assertions cover atomic raw seed debit/credit, fixed genesis, actual factory increments 1→2→3, exact 90/10 fee split, carried management remainder, raw/share conservation, unchanged underlying supply/configuration, immutable basket fields and permissionless oracle-free redemption. Four-token execution uses its own finalized lookup tables with exact authority and address coverage. Bootstrap allocation including quoted fee was 150,015,000 lamports; creator/investor cumulative quoted costs were 55,802,360 / 24,934,840, inside fixed funding and reserve ceilings. These mocks prove contract flow, not issuer backing, prices or investment returns.

Earlier run 01 stopped after a non-success RPC response, with two finalized transactions. Run 02 stopped before management broadcast because the crank builder included an extra user share account. Both are permanently retained as incomplete, reconciled evidence. The fixes serialize bounded RPC reads and match the deployed 11-account Anchor fee ABI. No previous economic messages were replayed. Details and before/after simulation evidence are in the [operator record](./devnet-owner-lifecycle-operator-2026-10-10.md).

## Historical checkpoint before activation

The complete receipt is retained. Independent final verification and the separate source-controlled creation activation release follow. At this checkpoint, the production frontend still uses runtime source `b5fecf67c10915b0e17e4db1059f3fdd6635a753`, VPS source remains `307053da1310331c658c0401d0107f8405912199`, and public creation is disabled. Do not infer a live activation from the successful proof alone.


Independent final audit passed for all 19 actual actor signatures, message/wire hashes, exact instruction arguments, raw transaction effects, fee/carry arithmetic, final accounts and both lookup tables. Both investors end at zero shares; each final basket supply is 15,950,022 held by creator/treasury. Owner setup remains complete and factory counter is three. [Independent completed proof](./evidence/owner-lifecycle-finalized-independent-2026-10-10.json).

The separately reviewed 13-file activation patch was applied only after that proof passed. It registers owner alongside unchanged legacy, selects owner-only creation with the approved treasury, verifies the exact six-program union and archives the preactivation operator against further execution. Legacy redemption remains available. Candidate financial recovery manifests keep the legacy trio, while collection inspects six. Full application/backend/security verification and the coherent hosted release are the next gates; this paragraph does not claim live deployment.


## Historical local activation verification

The complete activation change was independently reviewed with no blockers. The source change registers the two namespaces, selects only the approved owner namespace for creation, keeps legacy redemption, and checks the exact six registered program histories. Historical bootstrap/handoff fixtures explicitly inject a closed isolated namespace; the real production operators reject before RPC, proof or signer access after activation.

Final local verification passed: application 463 Node tests plus 58 Vitest tests and concept integrity; backend 1,281 tests with 292 PostgreSQL-dependent skips in this local environment; backend build; application typecheck; security 70 passing, one environment skip. The exact committed source must also pass the six hosted CI jobs, including database-backed tests, before production cutover. No source-controlled owner preparation policy or deployed program bytes were modified.

The private VPS preparation/cutover bundle received independent review. All five helper hashes match manifest SHA256 `fab1a6b87b8c74fcf7dca04641cbb29522c57abec3b84630745550908f7d424d`. Preparation authenticates the previous source/image/config, retains rollback source/image and a consistent backup, restores a restricted candidate, rehearses schema and bounded six-program collection. A contained replay can acknowledge only exit 1 with completed finalized discovery and the exact unchanged four legacy quarantines, zero owner quarantines and matching counts/digests. The backend cutover takes a further stopped-writer backup and uses that same rehearsed image. Financial recovery remains disabled. This records reviewed release safeguards, not a deployment result.


## Historical hosted verification caught a stale SQL fixture

Activation source `e934ec52ffa3f6e2d9851393692693a744e65d5f` was pushed, but [CI run 38071431300](https://github.com/umutyesildal/basalt/actions/runs/38071431300) blocked release: the current-balance API SQL fixture inserted the newly expanded six-program global readiness union into a per-basket snapshot. The unchanged schema correctly requires three programs belonging to that basket's namespace. Production snapshot writing and API checks already use the namespace trio.

The correction changes only that test fixture to the basket namespace and adds actual PostgreSQL coverage for the activated owner trio, cross-namespace refusal and six-program-union rejection. All 18 focused SQL cases passed on a fresh isolated local PostgreSQL instance. No production schema or runtime guard was relaxed. The failed exact-source hosted run passed 1,558 backend cases and all other five CI jobs; app/build steps after backend were skipped and are not counted as passed for that revision.

The `e934ec52` VPS candidate restored successfully, rehearsed schema and bounded collection with six program histories, retaining exactly four unchanged legacy quarantines and zero owner quarantines. It left 116 pending signatures and was accepted only under the explicit contained devnet guard. Its image `sha256:7c96c983774669e9cc76c541c43430ed56febeae9260177456e4a7cf3c82ba80` and READY Vercel candidate `dpl_51kYMpqmzkvSBmrGWz5G6yNCQu8o` were not cut over or promoted. The corrected commit must receive its own complete CI run and matching fresh deployment evidence.


## Verified live release

The corrected activation source `6cacb49f2b1a1fecd7398174c189c9bb65cec895` is pushed to main and verified on the public website and existing VPS. The deployed program bytes were not changed by this application/backend release. [Final public release receipt](./evidence/owner-live-release-2026-10-10.json).

| Identity | Verified value |
| --- | --- |
| Public website | https://basalt.markets |
| Normal creation flow | https://basalt.markets/create/onchain |
| Frontend and backend source | `6cacb49f2b1a1fecd7398174c189c9bb65cec895` |
| Vercel deployment | `dpl_Adt1AnMKW2Y1TDsE9mCpicsruaDu` |
| READY deployment URL, promoted to the public alias | https://basalt-jil9vknvp-yesildaladams-projects.vercel.app |
| Backend origin | https://basalt.178.104.34.252.sslip.io |
| Backend image | `sha256:73349768e70e6104296ed613e4cffb8233ce38ef5e6828ea9544f41fa7aeca73` |
| Exact-source hosted CI | [Run 38071804667](https://github.com/umutyesildal/basalt/actions/runs/38071804667) |
| Final release observation | `2026-10-10T17:39:14.758548+00:00` |

All six hosted jobs succeeded for this exact SHA: Secret scan, Rust workspace, Backend Node 20 container, Rust dependency reachability gate, Node workspace and Dependency audit. The hosted backend passed 1,575 cases, including 294 real PostgreSQL cases across 11 files and all 18 corrected current-balance API cases. Application verification passed 463 Node and 58 Vitest cases; security passed 71; Rust passed 249 normal and 250 owner-devnet tests. Builds, typecheck and the configured Rust checks passed. These final hosted suites had no failed or skipped tests. [Sanitized hosted CI evidence](./evidence/owner-activation-ci-2026-10-10.json).

### Owner-only creation and legacy routing

The approved owner and immutable new-basket treasury is `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea`. New creation selects only the owner namespace, with the authenticated factory, 90/10 creator/treasury split and 300/100/300-bps entry/exit/management caps. Legacy baskets retain their exact factory/program identity and permissionless oracle-free redemption. The runtime registers both namespaces, so global finalized discovery checks six program histories; per-basket snapshots and legacy financial recovery manifests still use their own authenticated trio.

| Role | Owner namespace, new creation | Legacy namespace, existing baskets |
| --- | --- | --- |
| Whitelist | `37UVmx2uysqkKibBcSP5EZMycUeKnWRmnXVpr967juKF` | `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS` |
| Factory | `2xvJKG8DTmSZFu1zXpNVP3wvaCCCgGC2ufGGhYjzr4DH` | `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF` |
| Basket | `8XPKfAYPaDSvUH95CeyjkgujTXAE5nFBJyFSqZvFvX7T` | `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k` |

The owner program build remains `cdc2e8b978470d12335d2186d7eaafdf52abc8a0`. The completed setup and lifecycle receipts above attest the genuine owner signature, exact mock admissions and deployed behavior. Earlier bootstrap, handoff and lifecycle execution tooling is now archival: activation makes it reject before RPC, signer access or economic execution. Read-only reconciliation of retained public receipts is still permitted. No previous economic transaction is automatically resent.

### Guarded VPS cutover and continuation

The final candidate was built from the exact corrected source, restored against a retained database backup and rehearsed before cutover. Schema rehearsal passed. Bounded historical replay returned exit 1, accepted only as a contained devnet result with the retained four quarantine rows matching the existing digest and all six registered histories collected. It was not accepted as complete financial recovery. The rehearsal had 116 pending signatures. [Candidate rehearsal evidence](./evidence/owner-backend-rehearsal-2026-10-10.json).

The initial cutover stopped because `/opt/basalt/scripts` did not exist, before source synchronization or new-image startup. The operator then reverified the prepared image, exact config, stopped old container, original and stopped-writer backups, other service containers and all four volumes. Only the missing fixed directory was created. The source synchronization and reviewed release checks were then used without modification; image health, public verification and completion passed. Original failure logs and the database dump were retained. This was a guarded manual continuation, not an uninterrupted script success or a bypass of the release gates. [Final release continuation receipt](./evidence/owner-live-release-2026-10-10.json).

The stopped-writer backup digest is `cdd10376ecdf7141e50680dc656e833ef97ddce893334d632eac58ddf87252f7`. The previous image/source remain `sha256:8e7d0ab276307af13ad71d71da78aded59f82d3f249b93f31fd678d17c399f3a` / `307053da1310331c658c0401d0107f8405912199` for rollback. Existing config, four volumes and unrelated service containers were preserved. [Backend live release and stopped-writer evidence](./evidence/owner-backend-live-release-2026-10-10.json).

### Live UI verification

Chrome verified the public Create on devnet mode, completed factory check, absence of the temporary new-basket unavailability notice and visible test-token identity. No owner initialization signature remains necessary. This read-only release check did not sign a wallet transaction and did not execute a fresh human basket creation. Actual finalized create/mint/accrual/redeem behavior is established separately by the 19-transaction proof above.

The public API authenticated legacy basket `38VG85nUbemsfKzozHtnr3oaf4VKFdAk1ySPCt4LDM4S` against factory `CfxquMe4MAPksEEsVyw8XmcxYH5W7qftRWNySgHjLi6e`. Its [live withdrawal route](https://basalt.markets/basket/38VG85nUbemsfKzozHtnr3oaf4VKFdAk1ySPCt4LDM4S/redeem) loaded First Move, selected Withdraw, amount 0.1 and the actual 0% entry / 0% exit / 2% annual management summary. Withdrawal remained disabled with the wallet disconnected; no transaction was sent. Browser proof hashes are retained in the [public release receipt](./evidence/owner-live-release-2026-10-10.json).

### Remaining data and release boundaries

The fresh readiness observation at `2026-10-10T17:37:59.136Z` is later than the immediate cutover snapshot. Finalized discovery was fresh through slot `509617801` and the service was ready. Financial projection was not ready; the release was explicitly contained devnet. [Fresh readiness evidence](./evidence/owner-live-readiness-2026-10-10.json).

| Fresh readiness measure | Value |
| --- | --- |
| Indexed baskets | 13 |
| Exact registered program histories | 6 |
| Pending discovery scans / missing coverage | 0 / 0 |
| Pending history signatures / collected pending effects | 111 / 111 |
| Pending evidence | 0 |
| Projection-blocked signatures | 2 |
| Quarantine rows / distinct quarantined transactions | 4 / 2 |
| Basket rebuilds still required | 7 |
| Available current USD valuations | 0 |
| Guarded reconciliation writes | Enabled, guarded |
| Automatic historical recovery activation / activated recovery runs | Disabled / 0 |

These counts preserve the distinction between complete current finalized collection and incomplete historical financial application. Seven is the overall current rebuild count, not a claim that all seven baskets belong to the legacy namespace. No synthetic USD valuation, cost basis, return or recovered financial history was published. Guarded current-balance reconciliation can run while automatic historical recovery activation remains disabled.

The runtime uses four exact project-issued Token-2022 mock tokens, not funded issuer xStocks. Governance remains the approved single devnet owner. This release does not approve mainnet, multisig/timelock completion, legal review or official issuer-token investing. Preserve immutable basket fields, raw transfer accounting, actual fee disclosures and permissionless oracle-free redemption.
