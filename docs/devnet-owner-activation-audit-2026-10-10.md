# Owner namespace activation release audit, 2026-10-10

Read-only audit at source d9c649fe7b350dd133beb31163a860098f2c8996. No activation or VPS mutation occurred. Owner initialization and finalized lifecycle proof still precede these changes.

## Minimal release scope

1. Define the reviewed owner namespace before the active registry, append it after unchanged legacy, enable only owner creation and select devnet-owner-v1 in backend/src/config/programNamespaces.ts. Preserve the exact approved treasury and legacy redemption.
2. scripts/verify-backend-rollout.mjs currently pins three legacy IDs and requires indexedPrograms === 3. Change it with activation to the exact six source-controlled IDs and expected length. Add exact-union acceptance and missing/extra/mixed/duplicate rejection tests in scripts/security/rollout-verifier.test.mjs. Do not discover trust roots from a remote response or environment.
3. Update production routing expectations in backend/tests/program-namespaces.test.ts, backend/tests/indexer-namespaces.test.ts, app/lib/program-namespaces.test.ts and app/components/devnet/create-availability.test.ts. Keep closed-routing fixtures and add owner creation plus legacy redemption assertions.
4. Preserve the preactivation lifecycle receipt. The proof operator intentionally rejects active public creation and is not a postactivation test runner.

## Coherent backend and frontend deployment

Backend startup indexes the complete registered union once its existing PROGRAM_* environment trio matches one registered entry. The legacy environment remains valid; do not blindly replace global identities. Public creation and trading use explicit per-basket/selected routing. API whitelist selectors should explicitly request namespace; lower priority SEO/OG/agent helpers still use the default legacy whitelist.

The existing VPS uses /opt/basalt, Compose under /opt/basalt/deploy, without a Git checkout. Follow deploy/DEPLOY.md backup, isolated restore rehearsal and fresh stopped-writer cutover backup before backend-only recreation. Preserve private environments and all database/cache/Caddy volumes. Build with BASALT_BUILD_SHA set to the exact activation source, then recreate only backend. Run the corrected read-only verifier with the same exact SHA and explicitly retain incomplete legacy projection acknowledgement where necessary.

deploy/prepare-candidate.sh pins the legacy trio. Its candidate proves legacy backup/recovery identity, not the six-program activated union; keep those evidence scopes distinct. Update the runbook's three-program-history wording when the active union changes.

Latest public ready check at 12:22:50 UTC reported source 307053da1310331c658c0401d0107f8405912199, healthy services, three legacy programs and disabled creation. Historical projection remained incomplete: 104 pending signatures, four quarantined signatures, six rebuild-required baskets. Container identity was not independently inspected in this audit. Do not claim history repair or activation from service readiness alone.

Retained prior release material: /var/backups/basalt/sharelinks_20261010_307053da, source archive /var/tmp/basalt-short-links-source.tar, build context /var/tmp/basalt-release-307053da and marker /opt/basalt/release-source-sha. Recorded prior image: sha256:8e7d0ab276307af13ad71d71da78aded59f82d3f249b93f31fd678d17c399f3a.

Frontend deployment must use the same activated registry source. A Git push alone does not deploy. Build an isolated frozen source with production settings and skip-domain, verify hosted source/CI and Chrome, then promote that exact candidate. Verify owner baskets and legacy redemption after both releases; report truthful history readiness.


## Prepared activation draft, still gated

A patch based on `da7a9a0ed90dc687b8436fcd5d77eb3d7018bf34` is retained locally at `/private/tmp/basalt-owner-activation-after-proof-da7a9a0.patch`, SHA-256 `d3d7e2e99447a393d8b0b9773736f31e56a233277617bfece4cc40012d47dd34`. It covers the source-controlled owner-plus-legacy registry, exact six-program rollout verifier, explicit closed test fixtures and archival lifecycle execution guard. Its isolated draft validation passed 149 focused tests and app typecheck. It has not been applied, committed or deployed. Owner-signed setup and actual finalized lifecycle proof remain required; full release CI, builds and restore rehearsal follow application. The legacy-trio candidate recovery manifest remains separate from the six-program collection union.


## Final live follow-through, 2026-10-10

The separate activation release passed independent review, all six exact-source hosted CI jobs and coherent frontend/backend publication. New creation is owner-only with the approved treasury, while legacy reads and permissionless oracle-free redemption remain available. The initial failed hosted fixture revision was not shipped.

Website and VPS backend are live from `6cacb49f2b1a1fecd7398174c189c9bb65cec895`. [Create on devnet](https://basalt.markets/create/onchain) is the normal user entry point. [Final release, owner setup, completed lifecycle and hosted evidence](devnet-owner-live-activation-2026-10-10.md) supersede earlier pending/disabled checkpoints in this record without deleting their history. The live release uses project-issued mocks; historical financial projection remains guarded, USD values remain unavailable, and no mainnet or fresh human UI creation transaction is claimed.
