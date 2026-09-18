# Security hardening plan

> Goal: move Basalt from a proven devnet beta to a mainnet security standard. No real-value assets are enabled while a P0 item in this document remains open.

## SEC-001 — Management-fee dust/crank grief

**Problem:** `last_fee_accrual_ts` advances when the calculated fee rounds to zero. A permissionless caller can repeatedly accrue before one raw share is due and suppress fees indefinitely.

**Implemented in the working tree (deployment pending):**

1. Carry the exact fractional numerator remainder across every accrual.
2. Checkpoint elapsed time even when no whole share is minted; the remainder preserves the economic value.
3. When supply or the immutable fee rate is zero, checkpoint and reset the remainder so a later holder never inherits empty-period debt.
4. Store the remainder in a five-byte append-only field that fits the live 888-byte account allocation without reallocating or changing existing offsets.
5. Keep `FeeAccrued` wire compatibility; the event remains a record of shares actually minted. The Basket account is authoritative for sub-share remainder.

**Tests:**

- One thousand small accruals equal one combined accrual for fixed supply.
- Frequent crank calls cannot reduce an annual fee to zero.
- Creator plus treasury always equals the minted fee.

**Residual behavior and pending evidence:**

- Fee shares join supply, so frequent cranks intentionally compound the nominal rate. At the maximum 300 bps rate, minute-level cranking produces about 304.54 bps relative to starting supply over one year (about 4.54 bps above a single annual crank). BAS-005 must decide and disclose the intended simple-versus-compounded semantics before mainnet.
- Existing accounts start the new remainder at zero; fractional fees already lost to pre-upgrade zero-fee checkpoints are not recoverable.
- The zero-supply reset branch is implemented but still needs instruction-level coverage proving that the first later holder inherits no empty-period fee debt.
- Backend estimates assume remainder zero. The remainder alone causes at most a one-raw-share understatement for the same supply and elapsed inputs, while stale indexed inputs can create a larger estimate-to-execution difference.

**Acceptance:** Met in local code and tests. Devnet remains pending until the `basket` program is upgraded and the existing-account accrue/mint/redeem smoke passes.

## SEC-002 — Token-2022 extension compatibility

**Problem:** Mint owner and decimals validation does not prevent TransferFee, TransferHook, or other extensions from invalidating deposit assumptions.

**Plan:**

1. Record the extension combinations used by official xStocks as fixtures.
2. Define an explicit whitelist allowlist/denylist policy.
3. Use vault `post_balance - pre_balance` as the economic deposit for seed and mint transfers.
4. If expected and actual deltas differ, either calculate from the actual delta safely or fail explicitly.
5. Fail closed for unknown extensions.

Test TransferFee, TransferHook, DefaultAccountState, PermanentDelegate, memo requirements, current/pending scaled multipliers, and unsupported extensions.

**Acceptance:** Program, client, and backend enforce one documented compatibility matrix and pass E2E tests against representative xStocks fixtures.

## SEC-003 — Zap received-amount correctness

**Status:** Completed for Zap-in on 2026-09-19. Zap-out remains a quote-only API and has no frontend execution path.

**Resolved problem:** The client previously treated the full post-swap ATA balance as received, which could include tokens the user already owned.

**Plan:**

1. Snapshot each constituent ATA raw balance immediately before swaps.
2. Read post-balances after confirmations.
3. Calculate `received_i = max(post_i - pre_i, 0)`.
4. Block mint review when a delta is zero or outside quote/min-out tolerance.
5. Bind snapshots to quote id, slot/blockhash, and wallet; remeasure after expiry.
6. Show quoted, minimum, and actual amounts separately.

**Acceptance:** Existing balances are never included in a Zap deposit, and partial-leg failure has a tested recovery path.

Evidence: `app/lib/zap-balance-delta.ts`, `app/components/basket/zap-in-form.tsx`, and `backend/tests/zap-balance-delta.test.ts`.

Residual limitation: balance-delta accounting excludes inventory present at the snapshot, but the same ATA cannot attribute a concurrent external deposit to a specific Jupiter transaction. The UI cancels stale wallet/input contexts and freezes deltas immediately after all legs settle; transaction-meta attribution or dedicated temporary accounts would be required to eliminate that residual race completely.

## SEC-004 — Arithmetic and cast safety

**Status: Completed and locally verified in the 2026-09-19 repository state; hosted CI and deployment evidence remain separate release gates.**

- Economic `u128 -> u64` casts now use checked division plus `u64::try_from` in gross-share, fee, split, and redemption helpers.
- `diff * 100`, bps validation, supply/elapsed-time products, treasury remainder subtraction, account-size conversions, remaining-account length products, and the whitelist counter now fail safely instead of wrapping or panicking.
- Boundary and deterministic property tests cover max-u64 values, invalid bps, narrowing failures, zero-supply redemption, fee conservation, pro-rata floor bounds, and repeated randomized arithmetic cases.
- Factory and whitelist peripheral hardening is included without changing the immutable basket model or the permissionless, oracle-free, unpausable redeem path.

**Acceptance:** No unchecked narrowing cast or multiplication remains in an economic path.

**Residual scope:** Instruction-level ProgramTest/LiteSVM, Token-2022 extension, and adversarial-hook coverage remain open under BAS-016. This arithmetic completion does not waive the independent audit, governance, attestation, legal, or official-xStocks gates required before mainnet.

## SEC-005 — Single source for fee split

The factory stores `creator_fee_split_bps`, while the basket program uses a fixed 90/10 split.

Choose one design:

- If V0 is permanently 90/10, remove the configurable factory parameter and document the constant.
- If configurable, copy the split into immutable basket state and use it in every fee path.

The system must not document both behaviors simultaneously.

## SEC-006 — Upgrade governance

- Move upgrade authority to a hardware-wallet-backed multisig.
- Define signer threshold and emergency procedure.
- Define a timelock/announcement period.
- Display program IDs, upgradeability, and authority status.
- Track a separate decision for eventually making programs immutable.

**Acceptance:** No single hot wallet can upgrade a program.

## SEC-007 — Reproducible deployment attestation

Publish a version-controlled manifest per deployment containing the git commit, cluster, program IDs, toolchain versions, ELF SHA-256 hashes, upgrade authority, and deployed slot.

CI produces ELF hashes; post-deploy verification compares them with on-chain program data.

## SEC-008 — Backend event integrity

Replace `events.sig` with `(sig, event_index)` or an equivalent deterministic event id.

Migration:

1. Add nullable `event_index`.
2. Backfill existing rows with `0`.
3. Write event order from the decoder.
4. Add a composite unique key.
5. Add replay and idempotency tests.

## Independent security gate

Before mainnet:

- complete an internal threat-model and invariant review,
- run Rust/npm dependency and secret audits,
- obtain an independent Solana/Anchor smart-contract audit,
- remediate and retest findings,
- prepare a capped pilot and incident communication runbook.

Redeem must remain permissionless and unpausable under every emergency design.
