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

## Release checkpoint

The complete receipt is retained. Independent final verification and the separate source-controlled creation activation release follow. At this checkpoint, the production frontend still uses runtime source `b5fecf67c10915b0e17e4db1059f3fdd6635a753`, VPS source remains `307053da1310331c658c0401d0107f8405912199`, and public creation is disabled. Do not infer a live activation from the successful proof alone.


Independent final audit passed for all 19 actual actor signatures, message/wire hashes, exact instruction arguments, raw transaction effects, fee/carry arithmetic, final accounts and both lookup tables. Both investors end at zero shares; each final basket supply is 15,950,022 held by creator/treasury. Owner setup remains complete and factory counter is three. [Independent completed proof](./evidence/owner-lifecycle-finalized-independent-2026-10-10.json).

The separately reviewed 13-file activation patch was applied only after that proof passed. It registers owner alongside unchanged legacy, selects owner-only creation with the approved treasury, verifies the exact six-program union and archives the preactivation operator against further execution. Legacy redemption remains available. Candidate financial recovery manifests keep the legacy trio, while collection inspects six. Full application/backend/security verification and the coherent hosted release are the next gates; this paragraph does not claim live deployment.


## Activation source verification

The complete activation change was independently reviewed with no blockers. The source change registers the two namespaces, selects only the approved owner namespace for creation, keeps legacy redemption, and checks the exact six registered program histories. Historical bootstrap/handoff fixtures explicitly inject a closed isolated namespace; the real production operators reject before RPC, proof or signer access after activation.

Final local verification passed: application 463 Node tests plus 58 Vitest tests and concept integrity; backend 1,281 tests with 292 PostgreSQL-dependent skips in this local environment; backend build; application typecheck; security 70 passing, one environment skip. The exact committed source must also pass the six hosted CI jobs, including database-backed tests, before production cutover. No source-controlled owner preparation policy or deployed program bytes were modified.

The private VPS preparation/cutover bundle received independent review. All five helper hashes match manifest SHA256 `fab1a6b87b8c74fcf7dca04641cbb29522c57abec3b84630745550908f7d424d`. Preparation authenticates the previous source/image/config, retains rollback source/image and a consistent backup, restores a restricted candidate, rehearses schema and bounded six-program collection. A contained replay can acknowledge only exit 1 with completed finalized discovery and the exact unchanged four legacy quarantines, zero owner quarantines and matching counts/digests. The backend cutover takes a further stopped-writer backup and uses that same rehearsed image. Financial recovery remains disabled. This records reviewed release safeguards, not a deployment result.
