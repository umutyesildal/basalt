# Owner-devnet lifecycle proof review checklist

Scope: source-only independent checklist for the dedicated proof operator. No program changes, key reads, RPC writes or execution are authorized by this checklist. Read the current `docs/devnet-owner-lifecycle-plan-2026-10-10.md` and canonical `docs/basalt-v0-spec.md` alongside the actual programs; the older FolioX spec path is renamed in this checkout.

## Independent source review outcome

Reviewed the saved operator read-only on 2026-10-10. The reviewer found and the implementer fixed one runtime evidence mismatch: faucet readiness had been required even after the second legitimate claim exhausted a source vault. Identity/profile verification now accepts zero remaining balance; explicit capacity checks remain before claims. A regression covers a source beginning at exactly two claims.

The reviewer requested full signed packet regressions and two create-evidence additions. The implementation now verifies all six signed create/mint/redeem packet shapes, compares underlying mint configuration before/after creation, and checks the finalized factory counter increments exactly once while other factory configuration bytes remain unchanged. No further safety/runtime blocker was identified in this independent source review.

Validation at preparation: 32 focused offline Node tests and app typecheck pass. No operator chain execution or public creation activation was performed. The checklist below describes the review criteria; synthetic tests and source review do not substitute for the later genuine finalized lifecycle proof.

## Preconditions and identities

- Default invocation is offline and does not fetch RPC, open signer files or mutate public creation configuration. Execution is explicit and fail-closed.
- Bind the exact clean committed checkout and every program/build input to the reviewed deployment source using `verifyOwnerHandoffSourceBinding`; hash the operator source and reviewed artifact manifest in evidence.
- Pin official devnet endpoint/genesis, owner, selected treasury, bootstrap, trio, four mints and faucet from committed policy. No environment or CLI program-ID overrides.
- Require genuine finalized owner loader authority, owner whitelist with no pending authority, initialized owner factory, all four exact active admissions and no remaining setup steps. An empty steps array alone is insufficient.
- Require all trio ProgramData identities, deployed slots, ELF lengths/hashes and zero padding to match the reviewed artifact manifest. Recheck before each operation that can write.
- Keep public creation disabled; only the isolated internal routing selects the owner namespace. Pass it through all builders/derivations/reads. Never fall back to legacy defaults.
- Create two fresh distinct actors in an owned 0700 run directory outside Git, secret files 0600 with exclusive no-symlink creation. Actors must differ from owner, treasury, bootstrap, programs and PDAs. Never read owner or legacy issuer keys.

## Finalized account evidence

- Capture each stage's relevant accounts in a finalized batch with nonregressing finalized context slots. Convenience reads with confirmed commitment are insufficient release evidence.
- Authenticate canonical factory, Basket, vault authority, share mint, constituent mints, vault ATAs and actor/creator/treasury ATAs. Require correct owners, identities, account kinds, initialization and nonfrozen state.
- Reuse the canonical Basket decoder and `authenticateBasketShareMint`: plain 82-byte Token-2022 share mint, six decimals, canonical vault PDA mint authority and no freeze authority.
- Retain exact immutable metadata bytes and hash, nonce, constituent order, weights, creator, treasury and fees. Require the factory counter to fit a JavaScript-safe nonce, but independently prove the fresh basket PDA absent.
- Treat null or canonical System-owned, nonexecutable, empty-data prefunded PDA targets according to actual init semantics; foreign-owned or nonempty accounts must fail closed.
- Confirm exact mock extension profiles/multipliers remain unchanged. Raw token and share quantities are BigInt, serialized publicly as decimal strings. Never use scaled UI amounts or market prices in lifecycle formulas.

## Exact raw accounting

Use the actual before/after Basket fee checkpoint timestamps, not wall time or an estimated block time. Let `S` be pre-operation raw supply, `R` the carried numerator remainder and `d` the elapsed checkpoint seconds. For the positive-supply, 200-bps test baskets:

```text
denominator = 315360000000
M = floor((S * 200 * d + R) / denominator)
R_after = (S * 200 * d + R) % denominator
S_accrued = S + M
split(F).creator = floor(F * 9000 / 10000)
split(F).treasury = F - split(F).creator
```

Check the exact identity `M * denominator + R_after = S * 200 * d + R`. If the checkpoint does not advance, the contract accrues nothing and preserves the old remainder. Use the shared BigInt management-fee and split helpers rather than duplicating number arithmetic.

- Faucet: each actor receives exactly `100000000000` raw units of each mint; the exact faucet vault loses that amount; claim PDA belongs to the faucet and contains the expected one-byte claimed state. Underlying mint raw supplies remain unchanged.
- Creation: exact creator raw seed debits equal each new vault raw balance. Creator receives exactly `1000000` raw genesis shares, and share supply is exactly that amount. No genesis entry fee is charged. Factory counter advances as expected; immutable fields and all canonical owners match.
- Mint: `G = min_i(floor(D_i * S_accrued / V_i))`; enforce the program's 1% spread tolerance. Entry fee `E = floor(G * 100 / 10000)`. Investor shares increase by `G-E`; creator and treasury increase by the separate splits of `M` and `E`; supply increases by `M+G`; each investor raw constituent balance decreases by `D_i` and each vault increases by exactly `D_i`.
- Explicit management crank: require an observable positive fee within the bounded waiting window; supply and recipients increase by exactly `M` and its split, checkpoint/remainder match, and all underlying raw balances remain unchanged.
- Redeem requested raw shares `B`: exit fee `E = floor(B * 50 / 10000)`, burn `B-E`, each output `floor(V_i * (B-E) / S_accrued)`. Investor shares decrease by the full `B`; supply becomes `S_accrued-(B-E)`; creator/treasury receive separate splits of `M` and `E`. Exit fees transfer existing shares and do not increase supply. Vault debits equal investor constituent credits.
- Assert share-balance/supply conservation and unchanged underlying mint supplies at every stage. Retain per-account before/after raw values, not only a boolean summary.
- Redeem instruction contains only the reviewed core accounts and constituent triplets, with no whitelist, oracle or backend gate.
- Any external donation/crank or unrelated state drift that makes exact before/after attribution uncertain stops the proof. Do not reinterpret a mismatch as success.

## Durable single-send orchestration

- Before every broadcast, including actor funding and ALT setup, atomically fsync a receipt containing the explicit stage intent, public actor identities, target basket/nonce, authenticated pre-state, signature, exact signed-wire/message hashes, lifetime, quoted fee/rent limits and lookup-table addresses.
- Capture blockhash and last-valid block height before signing; mutable client transaction metadata must not change saved lifetime evidence.
- Verify the exact message and every required signature after signing. Simulate the fully signed wire with signature verification and no replacement blockhash, then recheck the finalized prerequisites/state before a single send.
- Set automatic send retries to zero. A transport error or unknown status stops the run with the same saved signature. Do not create a fresh economic transaction, top up actors or advance to another stage after an ambiguous result.
- Reconcile that saved signature with transaction-history lookup until finalized success/failure or bounded unresolved stop. Signature-status RPC uses a processed context; never feed its context slot into a finalized minimum-slot requirement. Use the stored prior finalized observation bound.
- Existing `ensureCreateBasketAlt` and `ensureMintRedeemAlt` helpers contain retrying send orchestration and convenience reads. Reuse address sets/builders, but do not silently inherit their send/recovery path. The operator needs its own pre-journaled single-send ALT transport.
- Reports and journals use explicit public schemas. Do not serialize Keypair instances, arbitrary objects or private key arrays. Test that failures never export secret bytes or overwrite an existing run/journal.

## ALT, fee and budget checks

- Verify each ALT's canonical program owner, exact actor authority, no deactivation, exact expected address coverage and activation at a finalized slot after its last extension. Persist its address before sending setup and reuse that recorded table.
- Verify the actual compiled transaction lookup indexes resolve to the expected account set. Both unsigned and signed wire packets must be no larger than 1232 bytes.
- Reuse the reviewed 500000-CU and 20000-micro-lamport instructions. That priority fee is 10000 lamports in addition to base fees; use exact `getFeeForMessage`, not just signature-rate multiplication.
- Quote current rents from actual account/mint profiles and actual deduplicated ALT address sets. Do not assume old rent constants, mint decimals or actor balances.
- Creator funding ceiling: 0.09 devnet SOL. Investor: 0.06. Bootstrap total funding outflow plus funding fees: at most 0.16. Bootstrap remaining reserve: at least 0.10. Reject before signing if exact quotes cannot fit; no automatic top-ups or refunds.

## Tests that should fail closed

Wrong genesis; changed artifact bytes/slot/padding; bootstrap or mixed loader ownership; missing/pending whitelist authority; altered treasury/split/caps/admissions/mint profile; public creation unexpectedly enabled; legacy routing; missing or aliased actors; stale/existing basket; unsafe nonce; malformed share mint/ATA; wrong raw balances/remainder; stale supply; omitted auto-accrual; exit fee incorrectly minted; wrong ALT coverage/authority/activation; oversized packet; excessive fee/rent/funding; journal failure; changed signed message/signature/lifetime; ambiguous funding, ALT or economic send; processed/finalized context mismatch; secret-bearing report fields.

After finalized proof, public creation activation is a separate reviewed source change with its own tests, coherent frontend/backend deployment and truthful indexer readiness. Passing synthetic tests does not assert that the genuine owner has signed or that any lifecycle transaction has run.
