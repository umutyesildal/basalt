# Owner devnet lifecycle proof and creation activation plan

Date: 2026-10-10. Read-only review of source `5ed2db1fa6e7b2b77d5bb209e47835b6229c59cd` in the canonical release checkout. This document is a preparation plan. It does not assert that the owner has signed, that setup has completed, or that creation is active. No transactions or source activation were performed for this review.

## Decision

A dedicated, fixed-policy lifecycle proof can run **after genuine owner setup and before public creation activation**. The app builders already accept an explicit internal namespace routing. Use those builders in an isolated operator context, retain every onchain safety check, and leave the production registry and creation selection disabled until the proof passes.

Do not execute `scripts/testXStockBaskets.ts` against this namespace. Its instruction helpers target the legacy programs, its payer must be the fixture issuer and whitelist authority, and its negative cases intentionally alter shared issuer and whitelist state.

## Fixed public identities

| Role | Public key |
| --- | --- |
| Owner and explicitly selected treasury | `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea` |
| Bootstrap fee payer | `8B2wktjNVETgnkoe92r2hTL9THw7umh4zF7iuidMt5H4` |
| Owner whitelist program | `37UVmx2uysqkKibBcSP5EZMycUeKnWRmnXVpr967juKF` |
| Owner factory program | `2xvJKG8DTmSZFu1zXpNVP3wvaCCCgGC2ufGGhYjzr4DH` |
| Owner basket program | `8XPKfAYPaDSvUH95CeyjkgujTXAE5nFBJyFSqZvFvX7T` |
| Official devnet genesis | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |

Use the committed `backend/src/config/devnetOwnerPolicy.json` and `app/lib/devnet-owner-artifacts.json` as the identity/artifact inputs. A future UI-only source commit need not equal the build commit, but the program source and every relevant path dependency/build input must remain bound to the attested build. Reuse `verifyOwnerHandoffSourceBinding` in `scripts/devnet-owner-handoff.ts` rather than comparing only commit labels.

## Required finalized prerequisites

Call `devnetOwnerSetup.inspect(connection)` from `app/lib/devnet-owner-setup.ts:365`, then require all of the following explicitly:

- All three loaders have the genuine owner's upgrade authority and their finalized executable bytes, deployed slots and zero padding match the reviewed artifacts.
- `loaderAuthority === "owner"`, `whitelist === "owner"`, `factoryInitialized === true`, all four exact test-token admissions are present, and `steps.length === 0`.
- Whitelist pending authority is empty; its count is four. Each admission is active, its mint is exact, decimals are eight, and its source remains the fixed `mock:BSTEST*` value.
- Factory authority is owner, treasury is the user's explicitly selected wallet, split is 9,000/1,000 bps, and entry/exit/management caps are 300/100/300 bps.
- The four fixed test mints retain their exact multiplier/extension configuration. The public faucet is executable and each vault can fund two full claims.

An empty `steps` array alone is insufficient, because a waiting whitelist proposal is a separate state. Do not infer owner acceptance from SOL funding, a prepared package, or a deployment receipt. The owner setup inspection authenticates source-pinned program data; retain a finalized public evidence snapshot for the proof.

## Internal routing and exact builder reuse

The active registry currently contains only `devnet-legacy-v1`, with creation disabled. `DEVNET_OWNER_NAMESPACE` is prepared but not registered for production; `CREATION_NAMESPACE_ID` is null (`backend/src/config/programNamespaces.ts:46`, `:58`, `:66`).

For a future dedicated proof script only, create an immutable local routing from the prepared owner namespace and the fixed treasury, with its local `creation.enabled` true and selected ID `devnet-owner-v1`. This permits the reviewed operator to derive owner-namespace instructions without changing production globals. It must be fixed from committed policy, never an arbitrary CLI/API/env program-ID override. The public app's `APP_NAMESPACE_ROUTING.creation()` should continue to throw before activation.

| Purpose | Existing source |
| --- | --- |
| Internal registry construction and resolution | `app/lib/program-namespaces.ts:13` `createNamespaceRouting`; `:31` `namespacePrograms`; `:38` `requireBasketNamespace` |
| Creation argument validation and canonical PDA derivation | `app/lib/create-basket.ts:91` `CreateBasketArgs`; `:185` `deriveCreateBasketPdas`; `:329` `buildCreateBasketInstruction` |
| Finalized devnet/factory/treasury guard | `app/lib/create-basket-security.ts:12` `assertSafeCreateBasketFactory` |
| Creation transaction, size and lookup checks | `app/lib/transactions.ts:681` `buildCreateBasketTransaction` |
| Creation lookup address set / setup | `app/lib/transactions.ts:607` `deriveCreateBasketAltAddresses`; `:876` `ensureCreateBasketAlt` |
| Mint/redeem instruction encoders | `app/lib/transactions.ts:408` `buildMintInKind`; `:461` `buildRedeemInKind` |
| Mint/redeem transaction builders | `app/lib/transactions.ts:1389` `buildMintInKindTransaction`; `:1414` `buildRedeemInKindTransaction` |
| Mint/redeem lookup address set / setup | `app/lib/transactions.ts:1236` `deriveMintRedeemAltAddresses`; `:1286` `ensureMintRedeemAlt` |
| Permissionless fee crank | `app/lib/transactions.ts:501` `buildAccrueManagementFee` |
| Fixed test-token faucet claim | `app/lib/devnet-faucet.ts:25` `buildDevnetFaucetClaim`; `:44` `assertDevnetFaucetReady`; `:56` `readDevnetFaucetClaimed` |
| Raw account authentication | `app/lib/basket-account-security.ts:15` `authenticateBasketAccount`; `:44` `assertBasketCoreKeysOnChain` |
| Direct basket/wallet reads | `app/lib/devnet-baskets.ts:85` `decodeDevnetBasketAccount`; `:268` `readDevnetBasket`; `:308` `readDevnetWallet` |
| Exact carried management-fee math / split | `backend/src/workers/feeMath.ts:31` `managementFeeWithRemainder`; `:60` `splitFeeBigInt` |

There is no generated IDL dependency in these builders. Their Anchor discriminators, argument encoding, account order and PDA seeds are defined directly from the three Rust programs (`app/lib/transactions.ts:1`, `app/lib/create-basket.ts:1`). Reuse these source-checked encoders rather than inventing a second IDL or copying legacy helpers.

Pass the explicit routing through **every** relevant builder and read. Low-level `deriveVaultAuthority`, `deriveShareMint`, `deriveWhitelistedMint` in `app/lib/transactions.ts` still have legacy defaults; use `deriveCreateBasketPdas` or explicit namespace programs. `readDevnetWallet` otherwise falls back to the first registered namespace while creation is disabled. Root-level execution that imports the app helpers also needs the app's `@/*` resolver, for example `tsx --tsconfig app/tsconfig.json`; prove imports in an offline test before RPC use.

`CreateBasketArgs.nonce` is a JavaScript number. Read the finalized factory counter, require it to fit `Number.MAX_SAFE_INTEGER`, and derive a fresh unused PDA. Do not assume zero or reuse a previous partial run's basket. The counter is a useful nonce selection source, not a reason to skip absence verification.

## Why the existing legacy proof must remain separate

`scripts/lib.ts:39-49` hardcodes the legacy trio:

- Whitelist `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS`.
- Factory `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF`.
- Basket `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k`.

`scripts/testXStockBaskets.ts:139-150` requires payer-owned whitelist and issuer fixtures. It funds test actors by transfers from the fixture issuer's ATAs (`:215`), pauses whitelist admissions (`:286` onward), changes issuer hooks/default state and pause state (`:295-325`), and temporarily changes the scaled multiplier (`:327` onward). Those actions are unnecessary and inappropriate for a permissionless owner-namespace lifecycle proof using shared faucet tokens.

Its pure arithmetic assertions and fee-checkpoint decoding are useful examples (`:80` onward), but use the shared BigInt fee helpers and authenticated account decoder wherever possible. Its send path persists the report after submission (`:168-185`) and has retry behavior; the new proof requires a durable pre-send journal and no ambiguous economic replay.

## Future dedicated proof script

Suggested new path: `scripts/devnet-owner-lifecycle-proof.ts`, with meaningful offline tests. Implementation/execution can wait until genuine owner setup. Default invocation should be offline; RPC/execution requires explicit arguments and fixed devnet identity checks. No backend signer or owner private key is needed for these permissionless lifecycle actions.

1. Authenticate a clean committed source binding, finalized program artifacts, complete owner setup, exact faucet/mints, and global public creation still disabled. Create a fresh owned 0700 run directory outside Git, fresh creator/investor keys in 0600 files, and a public report containing no secret bytes. Distinguish actors from owner, treasury, bootstrap and every program/PDA.
2. Quote current rents and transaction fees before funding. Fund only the two fresh public actor addresses within the bounded budget below. Persist an atomic, fsynced journal before every broadcast, including funding and lookup-table setup. Never load the issuer's legacy key.
3. Have each actor claim the existing faucet once. Verify exact raw increases of `100_000_000_000` per mint, exact claim PDA, correct mint/account owners, and unchanged multipliers. Fresh actors avoid already-claimed ambiguity.
4. Create a three-token basket and then a four-token basket from the fixed mock token order. Use weights `[4,000, 3,200, 2,800]` and `[3,000, 2,700, 2,300, 2,000]`, raw seeds `weight * 1,000`, and test fees entry 100 / exit 50 / management 200 bps. Hash a concrete immutable test metadata document and retain those exact bytes publicly. Verify creator raw seed debits, vault raw balances, actual immutable metadata/weights, canonical PDA ownership, and exactly `1_000_000` raw genesis shares to creator.
5. For each basket, investor deposits raw seeds multiplied by 1,000. This consumes at most 40 base units of any mint for the first basket and 30 for the second, comfortably within the 1,000 base units per-mint faucet claim. Use actual raw vault/supply snapshots. Assert gross/net shares, exact entry fee, 90/10 fee split, raw debits/credits and share-supply conservation.
6. Wait a bounded interval (up to 45 seconds, with spaced nonblocking checks) for an observable management fee on the roughly 1 billion raw share supply. Crank permissionlessly. Calculate expected fees using the actual before/after onchain timestamps and carried remainder. Assert share deltas, exact remainder, 90/10 split and unchanged underlying raw balances.
7. Redeem part, then the remaining investor position if desired. Include any automatic management accrual before calculating pro-rata outputs. Assert `floor(vaultRaw * burn / supplyAfterAccrual)` for every leg, exit fee and split, exact investor raw-share debit, outputs, and total share supply. Verify the instruction contains only the constituent triplets and core accounts, with no whitelist, oracle or backend gate.
8. Exercise the four-token path with address lookup tables, verify exact lookup coverage/activation and serialized packet size ≤ 1,232 bytes. Persist lookup addresses in the operator's durable journal; do not rely on the browser's in-memory/local-storage ALT receipt behavior.
9. Optionally simulate a deliberately off-proportion mint and compare all relevant writable account bytes before/after. Do not submit state-changing issuer or whitelist negative tests. Retain existing local security tests and historical issuer-restriction evidence separately.
10. Finish with monotonic finalized snapshots and public transaction links, source/artifact hashes, program/factory/basket/share addresses, exact raw accounting assertions and result per lifecycle stage. Leave public creation disabled if anything is failed, uncertain, or unreconciled.

All signed transactions should use the exact reviewed message, quoted fee/budget, and simulation with signature verification. Write signature, signed-wire hash, message lifetime, intent and pre-state to an fsynced atomic receipt **before one send** with automatic retries disabled. After an ambiguous result, stop and reconcile that signature; do not construct a new economic transaction. Obtain final account snapshots at finalized commitment with nonregressing slot bounds rather than treating the UI's confirmed convenience reads as release evidence.

## Bounded SOL and token budget

Proposed fresh actor funding targets: creator **0.09 devnet SOL**, investor **0.06 devnet SOL**, total **0.15 devnet SOL**. Bound bootstrap outflow including funding fees to **0.16 devnet SOL**, preserve at least **0.10 devnet SOL** in bootstrap, and reject before signing if fresh exact rent/fee quotes exceed those limits. These are conservative funding ceilings, not asserted present balances or guaranteed spend. No owner wallet spend or refund is implied by this plan.

Account sizing inputs for an exact fresh quote: up to four profile-aware underlying ATAs per actor; conservative SDK profile account size 482 bytes including required extensions and immutable owner; seven vault ATAs across both baskets; two 888-byte Basket accounts; two 82-byte share mints; creator/investor/treasury share ATAs of 170 bytes; two 1-byte claim PDAs; one four-token creation ALT (56 + 28 × 32 = 952 bytes) and one four-token mint/redeem ALT (56 + 29 × 32 = 984 bytes), subject to the actual deduplicated address sets. Recompute from the actual mint extension profiles and compiled key sets, then use current `getMinimumBalanceForRentExemption` and `getFeeForMessage`; rent constants and old observed balances are not a safe budget source. Standard transaction builders also request a 500,000 CU budget and 20,000 micro-lamports/CU; account for priority fees explicitly.

The current faucet claim is 100,000,000,000 raw units per mint; at 8 decimals this is 1,000 base units, with differing scaled display values. The proof needs only existing faucet transfers, not new token issuance or any real xStocks. Stock-themed artwork remains decorative and test-marked; do not claim issuer backing, market value or real-equity performance.

## Separate source activation only after proof

1. Keep the legacy registry entry unchanged and creation-disabled so existing legacy basket reads and permissionless redemption still resolve correctly.
2. Register the owner namespace alongside legacy in `backend/src/config/programNamespaces.ts`, set only its reviewed creation entry enabled, and select `CREATION_NAMESPACE_ID = "devnet-owner-v1"`. Move declarations as needed so the owner namespace is defined before using it in the union. Keep exact treasury and collision/PDA validation; no env-provided program registration.
3. Re-run routing/security and app tests, backend tests/typechecks, production builds and the focused offline proof tests. Cover rejected unknown/mixed factories, exact owner creation routing, legacy redeem routing, unavailable factory and wrong treasury. Confirm normal app builders now produce exactly the same owner-namespace messages proven by the isolated context.
4. Deploy/restart the backend and frontend from the same registry source. `backend/src/indexer/listener.ts:991-1005` requires the environment's three PROGRAM_* values to match one registered trio, then indexes the complete registered union. Keeping the existing legacy env is valid once both entries are registered; it is not necessary to blindly replace global constants or every env value.
5. Allow authenticated history discovery/projection for the new namespace and inspect truthful readiness/backfill status. The registered union now contains six program IDs. Do not fabricate history-complete or projected balances while the indexer catches up. Check new owner baskets appear and legacy baskets remain usable.
6. `backend/src/api/server.ts:661` and `:1253` default `/whitelist` to the first registry entry. The direct devnet creation path uses RPC, but any API-backed creator selector should explicitly request the selected owner namespace. Do not silently reinterpret legacy admissions as owner admissions.
7. Smoke-test the genuine user wallet's UI flow: claim, create, invest and redeem, preserving wallet consent and immutable basket metadata. New onchain baskets must retain test-token identity even when stock logos/colors decorate the UI.

The proof removes the need to activate public creation merely to test runtime. Genuine owner setup remains the prerequisite; a separate reviewed activation commit is the final application change after finalized proof evidence.
