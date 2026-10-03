# Issuer-profile basket proof harness, 2026-10-03

Status: the root-operated full repaired devnet run passed on 2026-10-03. All three current V0 programs are upgraded and byte-attested at finalized slot 506820772. [Primary runtime report](xstocks-devnet-runtime-2026-10-03.md), [complete proof JSON](assets/xstocks-devnet-runtime-2026-10-03/basket-proof.json). Initial harness preparation was read-only; execution and upgrades were performed subsequently by the root agent under the authorized task.

## Scope

`scripts/testXStockBaskets.ts` consumes the four isolated project-issued fixtures from `scripts/setupXStockDevnet.ts`. These are devnet mocks with the eight observed Token-2022 mint extensions, not official xStocks. State lives only in `.cache/devnet-xstocks/<run-id>`.

The default command prints the plan without RPC requests, signer reads, directory creation or transactions:

```sh
node --import tsx scripts/testXStockBaskets.ts --run-id RUN_ID
```

Execution is an explicit, separately authorized step:

```sh
node --import tsx scripts/testXStockBaskets.ts --run-id RUN_ID --payer /absolute/path/to/existing-keypair.json --execute
```

It checks the canonical devnet genesis hash before signer access, pins the fixture payer and mock identities, verifies the existing deployed programs and whitelist authority, and reads the existing immutable factory treasury. It never initializes/replaces the factory or deploys programs. Generated creator and investor keys stay inside the isolated run directory. All financial actor addresses are distinct so fee legs are independently observable.

## Proofs

Both three-asset and four-asset baskets use the existing create, mint, redeem and fee instruction builders. Versioned transactions reuse one run-scoped address lookup table; serialized messages must fit the 1,232-byte packet limit.

- Seed checks exact creator debits, vault credits, fixed genesis supply and creator shares.
- Mint checks actual raw asset debits/credits, gross/net shares, entry fees and 90/10 split.
- Management accrual checks the actual before/after onchain timestamp, five-byte carried numerator remainder, fee shares, both recipients and unchanged underlying vaults.
- Redeem checks the raw pro-rata floor using supply after accrual, share burn, exit fee and both recipients. All three holder balances reconcile to total supply after every snapshot.
- Whitelist pause rejects new deposits while redemption still succeeds without a whitelist account.
- Issuer pause, a nonzero hook program and Frozen default account state reject both new deposits and basket creation. Each rejection is simulated for the expected cause, then submitted once as an expected failed transaction. All writable non-signer account data must equal the pre-transaction bytes, including absent accounts and factory counters.
- A paused issuer token also blocks underlying redemption. This demonstrates the issuer limitation; it does not add a basket administrator gate.
- A doubled issuer multiplier doubles display units while raw balances, share supply and basket state stay unchanged. The subsequent redemption is checked against raw pro-rata math. Original multiplier and issuer/whitelist settings are restored in `finally` blocks. The default-state test restores Initialized; it does not freeze existing ATAs.

Negative tests affect the final constituent, including a redemption where earlier legs could transfer before the issuer-blocked leg fails. Transaction rollback must restore the entire operation.

## Operational limits

The hardcoded endpoint is Solana devnet. There are no airdrops. The run reserves 0.2 devnet SOL and checks a 0.2 SOL spending budget before sends. One signed economic transaction is submitted only once; an ambiguous confirmation stops the run rather than retrying with a new signature. RPC-level retries resend the same signed bytes. Confirmed transaction metadata must independently agree with success or the expected program failure.

Successful and expected-failed signatures, slots, wire sizes, compute units and accounting evidence are written to `basket-proof.json` as work progresses. A partial run is not a pass. Preserve its report, verify restored issuer/whitelist settings and use fresh basket nonces for a complete rerun. The root preserved the first partial attempt before rerunning against the same isolated fixture keys; this harness does not resume an earlier basket midway. Cleanup can fail if RPC becomes unavailable, so inspect issuer and whitelist state after any interrupted run.

## Validation

Focused harness tests cover the default no-network/no-signer mode, explicit execution arguments, exact fixture selection, account checkpoint offsets, raw mint/redeem arithmetic and share conservation. Type checking includes the harness and imported setup helpers. The root subsequently completed current-SBF deployed-byte verification and the full onchain proof described below; earlier preparation and partial-run records are retained separately.

```sh
node --import tsx --test scripts/xstocks-devnet/basket-harness.test.ts
./node_modules/.bin/tsc --noEmit --target ES2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck scripts/testXStockBaskets.ts scripts/xstocks-devnet/basket-harness.test.ts
```

## Independent source review

Reviewed the shared `crates/token-policy/src/lib.rs` parser, its 29 fixture/mutation tests and current whitelist, factory and basket integration. AAPLx and SPYx binary lengths and SHA-256 hashes were independently checked against `mainnet-mints.json`. The policy validates complete TLV framing, bounded metadata strings, exact extension payloads, duplicate/unknown types, both stored multiplier encodings, metadata identity, current issuer pause/hook state and initialized public deposit accounts. Program ownership, canonical ATA identities, whitelist authority and raw delta checks remain separate caller checks.

No actionable security defect was identified in this change's source boundary. The redemption handler is unchanged and receives no new policy/whitelist gate. This review does not claim unconditional issuer-independent exit availability or an external security audit. Current SBF execution and deployment byte verification were subsequently completed in the linked runtime report; they are separate evidence from this source review.

An initially suspected error-mapping mismatch was resolved without a code change: the retained `StateWithExtensions::unpack` precheck rejects the legacy 166-byte empty-TLV fixture before the shared parser runs, so the existing `InvalidMintAccountData` assertion is correct. The program owner verified that focused case. Factory mint-policy errors remain explicitly mapped to `UnsupportedMintExtensions`, as the harness expects.

Harness validation completed: **7 focused tests passed**, standalone TypeScript check passed, and default plan mode created no run directory. No devnet transaction was sent by the harness author.

Source-review signoff preceded the authorized current-SBF devnet verification. It covers the reviewed parser and admission/deposit wiring; the completed onchain proof and deployed-byte attestation are recorded separately. Mainnet and independent external review remain open.

A second agent independently reviewed the harness execution path and found no signing/accounting blocker. They verified immediate multiplier-update semantics, effective-multiplier selection and whitelist state offset against the setup helpers. Frozen-default create/deposit rejection was added after that review.

## Runtime confirmation follow-up

The first root-operated runtime attempt reached the expected issuer-paused redemption rejection, then stopped because the SDK's HTTP confirmation path rejected with a plain `InstructionError` object while the websocket path returns a result object. The issuer pause was restored in `finally`. The root preserved the partial report and log; this is not a completed proof.

The harness now persists every submitted signature before confirmation. A thrown confirmation of an expected failed transaction triggers one history-enabled lookup of that exact signature. Only confirmed/finalized status with the exact simulated instruction error is accepted; absent/processed status, successful execution, a different error or failed status lookup stops the run. No signed economic transaction is rebuilt or resent. The final transaction metadata and expected log cause are still checked separately. Positive confirmation errors still stop the run. Non-Error diagnostics print only the public instruction index/error code, never an arbitrary thrown object.

Focused confirmation regressions cover both plain SDK objects and normal Error objects, confirmed/finalized failure, missing/processed status, unexpected success, wrong failure, failed lookup and positive error handling. Execution of the repaired harness remains root-controlled; no program source changed for this fix.

Confirmation follow-up validation: **16 focused harness tests passed** and standalone TypeScript checking passed. The recovered issuer-paused redemption is signature `J5DjvMq3N8dUg72yordZKRAM2E7BiHE4idcopeFynh7LLirHhxpH3uiUGzoMVm2RjyVKpFxXmCMPGiuY5mrQ5X2`, slot `506819830`, Token-2022 custom error `67`, matching the intended pause rejection. [Read-only recovery evidence](assets/xstocks-devnet-runtime-2026-10-03/attempt-1-failure-recovery.json). The repaired full run subsequently passed as recorded below.

## Completed repaired run

The root-operated repaired run completed **54 transactions: 38 successful and 16 expected onchain rejections**, with **28 proof assertions**. Raw seed, deposit and redemption deltas, share supply reconciliation, management accrual and separate 90/10 fee recipients matched. Whitelist-paused redemption worked. Issuer pause, active hook and frozen-default create/deposit rejections preserved state; issuer-paused redemption failed for the expected underlying token reason. Multiplier updates changed displayed units without changing raw ownership or pro-rata redemption math. All mutable fixture and whitelist settings were restored.

- Three-asset basket: `HYq16UQLv8HnBnzZDgjEJWnYS1mrUs5rzzbycQEGduSW`.
- Four-asset basket: `YZuBJ6PmVZXvaGHmNC8g84j1H61zDWpZ1mkENjGcrd8`.
- All three V0 program binaries were byte-attested against current isolated SBF artifacts at finalized slot `506820772`; the source hash did not change after attestation.
- Final validation: **243 Rust tests (214 program + 29 shared policy), 807 backend passes with 18 database skips, 16 harness tests and 14 controlled build-wrapper tests**. Isolated SBF builds and compact frontend build/browser checks passed.

The four fixtures are project-issued devnet mocks carrying all eight extensions. Captured real mainnet AAPLx/SPYx bytes are separate parser fixtures. This is not proof of a funded official issuer transfer, a mainnet release or changed Managed V2 support. External audit, legal and real-issuer integration work remains open. Current V0 source is loaded on devnet; repository changes remain local and unpushed. Final transaction/account evidence is owned by the [primary runtime report](xstocks-devnet-runtime-2026-10-03.md), with the [full proof ledger](assets/xstocks-devnet-runtime-2026-10-03/basket-proof.json).
