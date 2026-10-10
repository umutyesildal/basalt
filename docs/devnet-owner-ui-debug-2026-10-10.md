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
