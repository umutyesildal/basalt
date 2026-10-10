# Owner setup diagnostics and mock-token UI, October 10, 2026

The owner reported signing initialization, but finalized RPC still showed absent whitelist/factory/admissions and unchanged owner balance. Chrome displayed a pre-broadcast failure with no saved setup signature. A separate read-only run of the exact submitSetup path reached the owner signing callback successfully; no signature was requested or created by that check, and its send method was explicitly disabled. Ordinary serialized standard-wallet roundtripping also passes a real-signature regression. The exact live post-signing cause remains unresolved until the improved diagnostic is observed.

The old generic catch hid every pre-broadcast reason. The UI now renders only internally generated reviewed messages directly, classifies common expiry/rate-limit/decline/network failures into fixed text, and gives an action-stage fallback for unknown errors. Arbitrary wallet/RPC payloads are never displayed. Pending signature reconciliation and no-automatic-resend rules are unchanged. Focused setup suite: 43 passing tests.

A parallel follow-through review fixed public Buy/Redeem for genuine 2–4-token subsets of the fixed devnet mock pack. These routes render the existing authenticated direct-RPC workspace instead of depending on a priced NAV snapshot. Indexed forms remain for other compositions. The old Redeem ALT prewarmer is disabled for this branch to avoid duplicate background approvals. Creation, mint/redeem builders, raw math, guards and production namespace activation are unchanged.

Full four-token copying now preserves actual mint-aligned weights, management fee, name/thesis and cover. Unsupported token/entry/exit-fee copies stop visibly. Whitelist context requests explicitly bind the basket factory to its registered namespace and validate the returned namespace identity; mixed Explore/Portfolio labels read the registered union. Seven new flow/API regressions and the existing routing/direct-basket suites passed (44 total). Combined app typecheck passed.

This source update does not prove owner initialization or any owner-namespace basket lifecycle. Creation remains disabled. The owner setup release is recorded separately in [completion](devnet-owner-completion-2026-10-10.md).


## Live diagnostic observation

Source `b075cbea25edcf3e4acbb4b03dc1e77abf535fb4` is live at https://basalt.markets in Vercel `dpl_9as2xcijMATprUxkJKg5BHfCJJbJ`. All six exact-source CI jobs passed. The actual owner signed again, and Chrome exposed the exact pre-broadcast guard: **The wallet changed the reviewed transaction. Nothing was broadcast.** This combined guard checks both local constructor identity and exact serialized message bytes, so this message alone does not establish that Phantom altered instructions. The next investigation separates cross-constructor wallet return objects from genuine wire-message changes. No changed instructions, compute budgets, fees or blockhash will be silently accepted. Creation is still disabled and the VPS backend is unchanged. See [release evidence](evidence/owner-diagnostics-live-release-2026-10-10.json).


## Signed-wire compatibility correction

The installed deduplicated web3 1.99.0 package exposes distinct Node/browser constructors. An offline regression now reproduces exact signed message bytes with a foreign constructor for both initialization and the durable nonce handoff; the previous local instanceof check rejects that legitimate shape. This establishes a possible failure mechanism, not the exact cause of the earlier production return.

The wallet boundary now reads at most 1,232 serialized bytes, reparses a local legacy transaction, requires a canonical full-wire roundtrip, exact reviewed message bytes, all exact independently verified signatures, unchanged bootstrap signature and unchanged original message. Signed simulation and broadcast use that normalized local transaction. It accepts no changed instruction, compute budget, fee payer, blockhash or account. Fixed public diagnostics distinguish actual changed message fields without exposing arbitrary wallet payloads. Original expiry, finalized account checks, pre-send receipt persistence and no automatic resend remain intact.

All 68 setup tests pass, including 25 new foreign-constructor and rejection regressions. App typecheck passes and independent source review found no concrete blocker. [Offline evidence](evidence/owner-wallet-wire-compatibility-2026-10-10.json). A later live owner signature and finalized setup inspection are still required; these tests do not claim initialization or creation activation.


## Wire compatibility release live

Exact source `d137a895071917c4b9389ae8a4f7ef35125b76a5` passed all six CI jobs and is live at https://basalt.markets in Vercel `dpl_56PFB4tLJYW33Rq81yJQg9gjciF9`. The hosted build, pinned deployment metadata and Chrome program verification passed. Backend source remains `307053da1310331c658c0401d0107f8405912199`; read-only SSH inspection confirmed actual image `sha256:8e7d0ab276307af13ad71d71da78aded59f82d3f249b93f31fd678d17c399f3a`, healthy and zero restarts. No backend cutover was performed.

The owner setup screen is prepared for a fresh human signature with strict canonical signed-wire verification. Owner initialization, lifecycle runtime and public creation remain unverified/disabled at this checkpoint. [Exact release evidence](evidence/owner-wallet-wire-live-release-2026-10-10.json).


## Repeated stalled attempt and explicit fee preparation

The owner reports that the transaction still does not complete, with no visible error. The existing Chrome tab had reloaded and was disconnected when inspected, so its prior transient notice was unavailable. Reconnecting did not reveal a saved setup receipt. A fresh finalized read at slot 509602524 still showed an absent owner whitelist, factory and all four admissions, with owner balance unchanged at 13,926,514,492 lamports. This is not successful owner initialization.

Current [official Phantom documentation](https://docs.phantom.com/developer-powertools/solana-priority-fees) states that `signTransaction` adds priority-fee instructions when a transaction has no signatures, has no existing compute-budget instructions, and still fits after augmentation. The old 812-byte initialization transaction satisfies all three conditions. The already completed loader handoff has a bootstrap signature and does not satisfy the first condition. This is a concrete integration mismatch consistent with the earlier combined message-integrity rejection; it does not prove the exact latest live failure, whose diagnostic was lost.

Initialization now prepares an explicit 200,000-unit compute limit and zero micro-lamport price before sizing, fee quotation, unsigned simulation and signing. Strict canonical wire, exact message, signer, expiry and account verification remain required. No post-signing mutation is accepted. The durable nonce handoff is unchanged. A real unsigned official-devnet simulation passed all six remaining setup actions at slot 509603285: 864 bytes, 98,956 compute units, 7,167,880 lamports rent and 5,000 lamports network fee. It requested no signature, sent no transaction and initialized no account.

The UI is also being changed to preserve only bounded, fixed public progress/error diagnostics across reloads and show them near the status. Existing saved receipts remain authoritative and reconciliation never resends. [Read-only state, documentation and simulation evidence](evidence/owner-explicit-budget-simulation-2026-10-10.json). Actual human-signed initialization and finalized lifecycle proof are still required before activation; backend remains unchanged.

The diagnostic implementation is complete: fixed account-verification, simulation, wallet-signature and confirmation stages are saved before their awaited actions, with a maximum 1,024-character exact schema, 30-day age bound, fixed message vocabulary and separate storage key. The latest note is displayed directly below status. Pending receipts override historical notes; old failed/expired receipts do not mask a newer pre-broadcast failure. Dismissal changes only the note. Independent combined verification passed **83 tests** (70 setup, 13 diagnostic); app typecheck and patch checks passed. Review found no remaining blocker. Live Phantom signing is still unverified.


## Explicit fee preparation and persistent diagnostics live

Source `b5fecf67c10915b0e17e4db1059f3fdd6635a753` passed all six exact-source CI jobs and is live at https://basalt.markets in deployment `dpl_9dt51ubjeVGozeJYMWWaaiFgUuQn`. The hosted build, exact deployment metadata and Chrome finalized program verification passed. A separate read-only run of the actual submission path reached checking, simulating and signing; its wallet callback and sender were explicitly disabled, so it requested no signature and sent nothing. The same live Chrome tab is connected to the designated owner. Actual owner initialization and runtime lifecycle execution remain pending, creation stays disabled, and no backend cutover was performed. [Exact live release evidence](evidence/owner-explicit-budget-live-release-2026-10-10.json).


## Genuine initialization finalized, 16:53 UTC

Human owner transaction `5XkjbrtExkx719PoyVsZUxc2AAnDCLma2CvwGGCpCVRe1ETPv7ENFX37wQuq3FGNCvryUuAerosZPkuUfJRfFNhy` finalized at slot `509606852`, with no instruction error. Independent verification authenticated the actual owner signature and exact eight-instruction message, 864-byte packet, 200,000-unit limit, zero compute-unit price, 5,000-lamport fee and 98,956 consumed units. Owner whitelist, factory treasury `TcAg…ANea`, 90/10 split, caps 300/100/300 and all four active fixed mock admissions match. No initialization actions remain. [Public proof](./evidence/owner-initialization-finalized-2026-10-10.json). Chrome displayed “Owner setup verified on devnet.” No further owner setup signature is required.


## Final live follow-through, 2026-10-10

The genuine owner-signed setup later finalized with the explicit 200,000 compute-unit limit and zero priority price. This confirms successful delivery after the compatibility fixes; it does not independently prove that Phantom mutation caused every earlier stall. Exact message/signature guards and persistent sanitized diagnostics remain intact.

Website and VPS backend are live from `6cacb49f2b1a1fecd7398174c189c9bb65cec895`. [Create on devnet](https://basalt.markets/create/onchain) is the normal user entry point. [Final release, owner setup, completed lifecycle and hosted evidence](devnet-owner-live-activation-2026-10-10.md) supersede earlier pending/disabled checkpoints in this record without deleting their history. The live release uses project-issued mocks; historical financial projection remains guarded, USD values remain unavailable, and no mainnet or fresh human UI creation transaction is claimed.
