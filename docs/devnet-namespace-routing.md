# Devnet namespace routing preparation

The current release keeps the deployed legacy trio registered and `CREATION_NAMESPACE_ID=null`. No clean program ID, signer, treasury or governance approval is invented. Registration is a reviewed source change in `backend/src/config/programNamespaces.ts`; neither an API response nor runtime environment can extend the trust roots.

A namespace binds one devnet genesis, three distinct deployable program IDs and their canonical factory/whitelist singleton PDAs. The registry supports at most two disjoint trios. Each basket resolves through its authenticated immutable factory; arbitrary combinations of otherwise registered roles fail closed.

## Client behavior

Basket reads, transaction builders, explorer links and lookup-table preparation resolve the registered trio from the factory. Fresh finalized RPC checks authenticate the basket owner/layout/PDAs, share mint, factory and vault token accounts before wallet account preparation or swaps. Lookup-table caches remain bound to basket, RPC and trio, including asynchronous context changes. Production creation has no selected namespace and fails before setup payments. A later clean creation namespace must specify its exact reviewed treasury, which the client compares against fresh chain bytes.

Legacy redemption does not require whitelist admission, prices, indexed history or backend availability. The source does not add a program instruction, account, pause gate, admin withdrawal or treasury setter. Raw amounts and existing immutable account layouts remain unchanged.

## Backend behavior

One durable coordinator discovers the closed program union under the existing global discovery lock and finalized watermark. Effects drain in canonical order within each namespace. A legacy quarantine continues to block its namespace; it cannot clear a basket rebuild guard or falsely make global projection readiness true. A transaction emitting recognized effects from multiple namespaces is quarantined before parent, fact or financial writes. The exact expected factory is rechecked under the position lock before claiming effects.

Late-discovered queue rows inherit quarantine. Reusable canonical completion additionally requires the same decoder program-union provenance, preventing an older decoder that ignored a then-unregistered emitter from certifying its effects. Signature identity and financial event claims remain idempotent across restart.

`namespace_whitelisted_mints` stores authenticated, fresh admission for each namespace/mint pair. Refresh failure or disappearance invalidates that scope, including a failure before the first successful observation. Shared mint facts/pricing remain separate; foreign namespace status cannot overwrite legacy admission. `/whitelist?namespace=<registered id>` returns only fresh evidence for the expected whitelist program.

Holdings, finalized current balances and reconciliation partition by canonical factory and authenticate the exact per-basket trio. Snapshot portfolio reads require that same tuple; unknown factories remain uncovered. Current snapshots always declare incomplete financial history and unknown acquisition costs. NAV supply authentication and unsigned fee preparation route to the same selected basket program. Unregistered baskets cannot receive a fallback legacy instruction or eligible valuation.

## Activation boundary

The two-namespace tests use isolated synthetic public identities only. They are never added to production registration. Actual clean activation still requires owner-supplied public identities, consistently compiled new Rust/IDL/SBF bindings, source/deployed-byte evidence, approved governance and the real signer ceremony, plus clean and legacy runtime verification. Refer to [the unsigned bootstrap plan](clean-devnet-bootstrap-plan.md). Existing deployment evidence continues to refer to the actual legacy trio; a registry entry alone is not deployment or recovery activation approval.
