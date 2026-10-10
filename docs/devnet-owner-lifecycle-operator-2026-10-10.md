# Bounded owner devnet lifecycle operator

Prepared 2026-10-10. This is source and offline test preparation. No lifecycle transaction or creation activation was performed while implementing it. Genuine owner initialization remains a live prerequisite, verified from finalized chain state rather than policy declaration flags.

## Files

- `scripts/devnet-owner-lifecycle-proof.ts`: default offline plan, explicit bounded execution, and read-only receipt reconciliation.
- `app/lib/devnet-owner-lifecycle-proof.test.ts`: focused Node tests with synthetic actors and mock RPC. The normal app Node test command discovers this file.
- [Independent review checklist and outcome](./devnet-owner-lifecycle-review-2026-10-10.md).
- [Lifecycle and activation plan](./devnet-owner-lifecycle-plan-2026-10-10.md): required owner setup and separate later production registry activation.

The operator imports the actual app instruction/transaction builders through an explicit fixed internal owner-namespace routing. Production `APP_NAMESPACE_ROUTING` remains creation-disabled. It does not change the registry, deploy programs, initialize owner configuration, change admission/issuer state, or use an owner/issuer private key.

## Offline verification

From the canonical repository root:

```bash
npx tsx --tsconfig app/tsconfig.json scripts/devnet-owner-lifecycle-proof.ts
npx tsx --tsconfig app/tsconfig.test.json --test app/lib/devnet-owner-lifecycle-proof.test.ts
npm run typecheck --workspace app
```

Default mode contacts no RPC, opens no private signer, and writes no files. App path aliases require the explicit app tsconfig. The focused tests cover real owner routing and manual Anchor encoding, exact metadata hashing, raw post-accrual accounting, fee splits/remainders, unchanged underlying configuration, strict owner/actor/budget guards, persistence failure, transport ambiguity, replay rejection, fresh private file permissions, faucet exhaustion after exactly two legitimate claims, and full packet sizes.

Full signed wire sizes measured offline, including the compute-budget pair and signature-count prefix:

| Transaction | Three tokens, no ALT | Four tokens, complete ALT |
| --- | ---: | ---: |
| Create | 1,110 bytes | 543 bytes |
| Mint | 1,047 bytes | 392 bytes |
| Redeem | 928 bytes | 356 bytes |

All six are within Solana's 1,232-byte packet limit. These measurements prove encoding/packet shape, not onchain execution success.

## Later reviewed execution

Do not run execution merely because SOL is funded or loader authority has transferred. It first requires a complete genuine owner-signed whitelist, factory, and four exact admissions. `devnetOwnerSetup.inspect` verifies all three finalized deployed artifacts, loader authorities, exact singleton roles/treasury/caps, admission identities and fixed multipliers. Empty setup steps alone are insufficient: authority, whitelist owner, initialized factory and all four unique admissions must also match.

Execution requires a clean committed checkout whose program/build inputs match the committed artifact build source. It accepts no RPC override or arbitrary program IDs. The fixed endpoint and genesis are official Solana devnet only.

A future operator invocation has this form, after root review and genuine setup completion:

```bash
npx tsx --tsconfig app/tsconfig.json scripts/devnet-owner-lifecycle-proof.ts \
  --execute \
  --run-dir /absolute/private/parent/basalt-devnet-lifecycle-UNIQUE-RUN-ID \
  --bootstrap-run-dir /absolute/private/parent/basalt-devnet-owner-EXISTING-RUN-ID
```

The lifecycle directory must be new, outside every Git checkout, and below a real parent directory. Existing execution directories are always refused. The operator creates fresh creator/investor keys there with directory mode 0700 and file mode 0600, fsyncs them, and never prints or exports their private bytes. It only opens the fixed bootstrap signer from the separately isolated bootstrap directory and holds that directory's existing exclusive operator lock.

Funding targets are 0.09 devnet SOL for creator and 0.06 for investor. Bootstrap cumulative outflow is capped at 0.16 devnet SOL with at least 0.10 devnet SOL reserve; actors retain at least 0.001 devnet SOL. Current exact rent quotes and network fee quotes must fit those ceilings before signing. Account sizes are conservative and derived from the actual fixed mint profiles. There are no automatic topups or refunds.

Each fresh actor claims the existing public mock-token faucet once. The operator creates a three-token and four-token basket, mints proportional in-kind shares, accrues an observable management fee, then performs partial and remaining investor redemption. The four-token path uses its own durable single-send lookup-table setup, with exact authority/coverage and finalized activation checks. It deliberately does not reuse the browser ALT transport retry loop.

Raw assertions use existing BigInt gross/entry/redeem helpers and the canonical carried-management-fee/split helpers. Every transition compares actual before/after onchain fee checkpoints, post-accrual supply, raw balances, share conservation, immutable fields, unchanged underlying mint supply and configuration. No market prices, issuer backing or real xStocks performance are inferred from test tokens.

## Durable transport and recovery

Before every broadcast, including funding and ALT setup, the operator verifies the single actor signature, simulates the exact signed message, rechecks complete owner setup, and fsyncs an atomic public receipt containing signature, signed-wire/message hashes, blockhash lifetime, intent, pre-state, ALT identities, and fee/rent allocation. It attempts one broadcast with automatic retries disabled, then waits for finalized status. A failed persistence operation prevents the send. An uncertain send/confirmation or failed raw assertion stops the run; it never constructs a replacement economic message.

Public receipts and proof snapshots are stored in `lifecycle-receipt.json` alongside the private actor files. Only that explicitly public JSON may be copied into repository evidence. Do not copy the directory or actor files.

Read-only recovery:

```bash
npx tsx --tsconfig app/tsconfig.json scripts/devnet-owner-lifecycle-proof.ts \
  --reconcile \
  --run-dir /absolute/private/parent/basalt-devnet-lifecycle-EXISTING-RUN-ID
```

Reconciliation reads only the public bounded receipt and statuses for the same recorded signatures. It never loads a signer, resends, continues the economic run, or marks missing lifecycle accounting proofs complete. A finalized transaction status alone does not replace the stage's finalized accounting evidence. Any interrupted run needs explicit human/root review before a separate fresh proof is considered.

Successful proof execution also leaves public creation disabled. Registering the owner namespace alongside legacy, selecting its creation ID, rebuilding both app/backend, preserving legacy redemption, and verifying indexer history readiness are a separate reviewed release described in the activation plan.


## First actual execution and transport correction

Owner initialization genuinely completed at slot `509606852`. The first lifecycle run used clean source `06258516e61b4ac2bfdbbd048134964115a48f17`. Funding finalized at `509608280`; creator faucet claim finalized at `509608290`. A subsequent balance read received a non-success HTTP response. The old generic diagnostic did not retain its status, so HTTP 429 is a plausible explanation, not an established fact. Read-only reconciliation confirms both recorded transactions succeeded. No basket was created, the claim accounting snapshot was not completed, and the run remains `completed: false`. It must never be resumed or replayed. [Exact public stopped receipt](./evidence/owner-lifecycle-stopped-proof01-2026-10-10.json). Private actor files remain outside Git.

The operator now serializes physical RPC requests with at least 500 ms between starts. Only an explicit HTTP 429 on an allowlisted read or simulation may receive at most two bounded retries, respecting Retry-After up to 15 seconds. All attempts count against the original 600-attempt and 20-minute limits. Broadcasts, transport failures and other HTTP errors are never retried. The original signed blockhash, exact message, durable receipt, one-send protocol and all actual accounting/owner/artifact checks remain. Errors expose only numeric HTTP status and allowlisted method. This follows [official Solana public RPC guidance](https://solana.com/docs/references/clusters).

Focused operator tests: 38 passing, including serialized concurrent requests, exact finite read retry behavior, broadcast no-retry, excessive delays, deadline, disallowed RPC/method and physical attempt ceiling. App typecheck passed. Independent review also required an immutable URL/body/header snapshot before queuing, covered by a queued read-to-broadcast mutation regression; the correction is included. A separately reviewed fresh run can follow definitive reconciliation; it uses fresh actors and another bounded allocation, never the existing actors or messages. Public creation remains disabled until a complete independently reviewed lifecycle proof.


## Second actual execution exposed a fee-crank builder mismatch

Fresh run 02 used `097127b746e2a41c976b60dbacaf93383c3afc1a`. Funding, both faucet claims, the three-token basket creation and proportional mint finalized. Actual create/mint accounting assertions passed, including atomic raw seeds, fixed genesis, factory count increment, immutable configuration, entry split, carried accrual and raw/share conservation. The following management transaction failed exact signed simulation before receipt creation or broadcast. No management/redeem/four-token proof completed; public creation stays disabled. [Stopped public receipt](./evidence/owner-lifecycle-stopped-proof02-2026-10-10.json).

Unsigned reproduction using public actor identities isolated Anchor `InvalidProgramId` 3008 on `token_program`. `buildAccrueManagementFee` reused mint/redeem's 12-account list, including `user_share_ata`; deployed Anchor `AccrueFee` requires 11 accounts without that account. Subsequent account positions were shifted. The builder now omits that one account for the crank. Program binaries, immutable baskets, owner authorities and fee math are unchanged. The corrected unsigned simulation succeeds at slot `509610575`, consumes 63,902 units and produces the expected fee-mint CPIs. This simulation does not commit fee accrual. [Before](./evidence/owner-management-simulation-before-2026-10-10.json) and [after](./evidence/owner-management-simulation-after-2026-10-10.json).

An ABI regression compares the actual Rust `AccrueFee` field order with the builder, plus exact program/account addresses, signer and writable roles under both namespaces. Focused lifecycle/routing/ABI checks: 58 passing. Existing run 02 is retained and never resumed. A later separately reviewed fresh run must complete the whole proof before activation.


Independent review confirmed all five run-02 actual actor signatures, message/wire hashes, finalized transaction effects and 17 current account hashes. Factory count is one. Mint gross shares were 1,000,000,000 raw; entry fee 10,000,000 split 9,000,000/1,000,000; total supply 1,001,000,000 with creator/investor/treasury 10,000,000/990,000,000/1,000,000. Native reserves remain intact. [Independent evidence](./evidence/owner-lifecycle-stopped-proof02-independent-2026-10-10.json). Full app verification after the ABI fix passed 462 Node tests, 57 Vitest tests, concept integrity checks and typecheck. Independent ABI/routing review passed 20 tests with no remaining blocker.


## Final live follow-through, 2026-10-10

The bounded operator completed fresh run 03 once, with all 19 transactions finalized and independently audited. Runs 01 and 02 remain stopped and separately reconciled; their economic messages were not replayed. After source-controlled owner activation, the preparation/bootstrap/handoff/lifecycle execution paths reject before RPC, signer access or economic execution. Public-receipt reconciliation remains read-only. Do not rerun or resume the archived lifecycle to test the live UI.

Website and VPS backend are live from `6cacb49f2b1a1fecd7398174c189c9bb65cec895`. [Create on devnet](https://basalt.markets/create/onchain) is the normal user entry point. [Final release, owner setup, completed lifecycle and hosted evidence](devnet-owner-live-activation-2026-10-10.md) supersede earlier pending/disabled checkpoints in this record without deleting their history. The live release uses project-issued mocks; historical financial projection remains guarded, USD values remain unavailable, and no mainnet or fresh human UI creation transaction is claimed.
