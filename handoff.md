# Basalt handoff — current 2026-09-25; historical audit below

## Current handoff — 2026-09-25

- **Canonical checkout:** `/Users/umutyesildal/orca/workspaces/createyouretf/createyouretf`, branch `main`; the Managed V2 merge was pushed to `origin/main` at `3eeb7be0d56fccd659df04ff09c395ccafbef317`. Recheck `git status` and `git rev-parse HEAD` before making changes. The old `/Users/umutyesildal/orca/projects/createyouretf` directory and its FolioX artifacts are not the product source. Its worktree was detached and the fully merged local `master` branch deleted on 2026-09-25; its untracked files remain in place and must not be treated as current. The `codex/managed-baskets-v2` worktree/branch is implementation history; its commits are already in `main`.
- **Preserve existing dirty work:** tracked `docs/README.md`, `docs/implementation-backlog.md`, `docs/upgrade-governance-policy.md`, `package.json`, and `package-lock.json`; untracked `backend/tests/deployment-verifier.test.ts`, `deploy/deployment-verification.schema.json`, `docs/governance-ceremony-runbook.md`, `scripts/deployment-verifier.mjs`, and `scripts/verify-deployment-manifest.mjs`. Four untracked `brag-output-*` directories also predate this pass. Do not reset, overwrite, or include these files in an unrelated commit.
- **Read order:** `AGENTS.md` and `docs/basalt-v0-spec.md` for immutable V0 constraints; this handoff for checkout and preserved work; `docs/managed-basket-v2-prototype-status.md` for implemented V2 behavior; `docs/managed-basket-v2-wallet-lab.md` for localnet operations; `docs/managed-basket-v2-plan.md`, `docs/managed-basket-v2-product-flow.md`, and `docs/managed-basket-v2-threat-model.md` for target architecture and tests. `CONTEXT.md` is an older copy of `AGENTS.md`; its current note redirects agents here. The 2026-09-18/19 state and counts in older docs remain dated evidence.
- **Product boundary:** immutable V0 and wallet-free `/create` concept preview remain separate. Managed V2 is a fixed-pair, shared-vault prototype: manager proposal, distinct guardian approval, delayed bounded fill, holder shares, identity token, and permissionless pro-rata redemption. The public `/managed` page is simulated; `/managed/lab` signs against loopback localnet with project mock tokens. No Managed V2 public-cluster deployment, fee revenue, official xStocks support, live indexer API, metadata-rich identity, role rotation, or verified Phantom/Solflare local-validator signing is claimed. See the prototype status for the full gap list.
- **Merge verification:** after the merge, relevant TypeScript tests passed (21 managed-chain/local-send/projection), `managed-core` tests passed (9), `managed_basket` Rust tests passed (6), app typecheck and production build passed, and a disposable-key localnet smoke passed create/propose/guardian approval/notice-period redemption. This is local proof, not production readiness.

## Historical handoff — 2026-09-22

The audit, HEAD, branch inventory, plan, and recommendations below are preserved as historical context. They do not describe the current `main` checkout or authorize a new video pass.

## Purpose

This handoff records the branch/worktree audit and the starting point for the product/UX work in `plan.md`. It is an audit of repository history, key product surfaces, and documented release status; it is not a claim that every code path or deployed account was independently retested today. This pass changed only `plan.md` and `handoff.md` in the canonical worktree.

## Canonical checkout and branch audit

- **Repository:** `https://github.com/umutyesildal/basalt.git`.
- **Work from:** `/Users/umutyesildal/orca/workspaces/createyouretf/createyouretf`, branch `main`, HEAD `8d4a5f9` (`test: exercise upgrade authority transfer locally`, 2026-09-19). At audit time `main` matched `origin/main` (0 ahead, 0 behind). Remote heads were checked with `git ls-remote --heads origin` on 2026-09-22.
- **Do not use as the product source:** `/Users/umutyesildal/orca/projects/createyouretf`, branch `master`, HEAD `5698f9f` (2026-09-01 initial commit). It is 79 commits behind `main` and contains untracked scaffold and prior `brag-output` artifacts. The FolioX video from that directory reflects the old scaffold, not the current Basalt app. Its local `AGENTS.md` is also stale; read the canonical `main` version before implementation.
- **All 12 current remote branch heads are included in `main`:** `design/cyberpunk-yellow`, `feat/chart-shareprice-demo-links`, `feat/demo-creator-pages`, `feat/demo-feed-leaderboard`, `feat/demo-home-live`, `feat/friendly-home-preview`, `feat/home-refresh`, `feat/social-polish`, `feat/social-trading`, `roman-empire`, `ui-touch-targets-microlabel`, and `main`. Each non-main tip was checked as an ancestor of `main`; no committed feature branch has changes waiting to merge.
- Local tracking refs `origin/design/stax-inspired` and `origin/feat/expand-mock-universe` exist but no longer appear among remote heads. Both commits are already ancestors of `main`. Do not treat these stale refs as unmerged work.

## Existing work in `main` that must be preserved

The canonical `main` worktree was already dirty before this documentation pass. These changes belong to an in-progress BAS-006 governance/deployment verification effort; do not reset, overwrite, or mix them into the UX implementation:

| Tracked changes | New untracked files |
| --- | --- |
| `docs/README.md`, `docs/implementation-backlog.md`, `docs/upgrade-governance-policy.md`, `package.json`, `package-lock.json` | `backend/tests/deployment-verifier.test.ts`, `deploy/deployment-verification.schema.json`, `docs/governance-ceremony-runbook.md`, `scripts/deployment-verifier.mjs`, `scripts/verify-deployment-manifest.mjs` |

The tracked diff links the ceremony runbook, clarifies that current governance is verified as single-key while the target multisig/time lock is not active, and adds `ajv`. The new files implement read-only deployment verification, schema/tests, and a migration runbook. Their presence is **uncommitted work**, not evidence that governance migration has occurred. Inspect `git status` again before any later edits or branch operations.

## Product and release truth at this handoff

- **Name/identity:** Basalt. `brand.md` and `docs/design-basalt-v1.md` define the three-column mark, dark industrial base, electric yellow `#FCEE0A`, Chakra Petch display, and restrained data colors. Some older `brand.md` sections have superseded palette/type language, so the next docs pass should reconcile them.
- **Current product:** a working devnet beta, with real Token-2022 basket create, in-kind mint, and pro-rata redeem paths; backend indexes events/holdings/NAV; wallet transaction UX exists. The app uses mock devnet constituents. Official mainnet xStocks are not yet admitted by the extension-free V0 policy. Zap execution and data provenance have separate limitations; see the dated state and backlog.
- **Security/release boundary:** basket terms are immutable; redeem stays permissionless, oracle-free, and independent of backend, whitelist pause, and pricing. No mainnet-ready claim: the single-key upgrade authority, official xStocks compatibility, instruction-level tests, independent audit, legal work, release attestation, and other backlog gates remain open. Current numbers in `docs/current-state-2026-09-18.md` are a dated snapshot, not a fresh test run.
- **Documentation order:** `AGENTS.md` and `docs/basalt-v0-spec.md` for constraints; `docs/current-state-2026-09-18.md` for dated state; `docs/implementation-backlog.md` for active order; `docs/product-ux-improvement-plan.md` for prior UX work; `brand.md` and `docs/design-basalt-v1.md` for identity. Existing `plan.md` is a historical execution log; the 2026-09-22 section at its top is the new UX/video work package. `foliox_build_prompt.md` is a historical filename.

## Specific findings behind the new plan

1. The create wizard has real templates, sliders, preview, clone, seed, legal, and deploy flows (`app/app/create/create-client.tsx`, `app/components/create/*`). Its weights editor still displays `10,000 bps`, raw bps input, “Normalize to 10,000,” and “MarketCap-ish.” The fee editor leads with bps. `Next` is disabled without a connected wallet even in early steps. Relevant backlog items: BAS-023/024/025/027.
2. Basket detail (`app/app/basket/[pubkey]/basket-detail-client.tsx`, `app/components/basket/basket-page-about.tsx`) already has About/History/Risk/Thesis tabs and a buy/redeem rail. The About view combines composition with raw/scaled holdings, addresses, and fee formula text, making the first view dense. `app/components/basket/basket-page-trade-rail.tsx` gives “oracle-free” a prominent sentence better suited to advanced information.
3. The current redeem page (`app/app/basket/[pubkey]/redeem/page.tsx`) shows an actual exit fee. A literal “redeem oracle fee” was not found in current `main`; it should not be carried into copy or video. The redemption protocol uses no oracle fee or oracle gate.
4. The previous video was based on stale `master`. Rerender only after the actual `main` UI, source documents, and video script agree on Basalt, yellow, percentage-based allocation, clear fees, honest devnet/mock labeling, and a simpler detail story.

## Recommended next execution

1. Open the canonical `main` worktree and recheck `git status` and the latest remote head. Preserve the governance verifier changes above. Read `plan.md`’s 2026-09-22 section and the source documents in the listed order.
2. Produce one desktop and one mobile review of the **current** create, basket detail, and redeem routes. Implement the percentage-first create flow, clearer first-view detail, plain redemption copy, and Basalt visual consistency with the acceptance gates in `plan.md`. Keep 10,000-bps and raw-token exactness at transaction boundaries.
3. Update the relevant durable design/UX docs and backlog as the UI changes, run the appropriate app/backend/protocol checks for touched code, and then make a new `brag` video from this worktree. Inspect rendered frames against the real app before sharing.

## Verification performed for this handoff

Read-only checks: local branch and worktree inventory, remote branch head query, branch ancestry versus `main`, `main` worktree status/diff, and targeted reads of brand, current-state/backlog, create, basket detail, and redeem files. No builds, tests, devnet transaction, deployment, merge, or video render were run for this audit. The pre-existing uncommitted governance work was not modified.
