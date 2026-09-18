# Basalt documentation map

This directory contains Basalt's product, protocol, security, and operations documentation. The files serve different purposes; when they conflict, use the precedence below.

## Source precedence

1. `docs/basalt-v0-spec.md` — normative protocol and product constraints.
2. `docs/current-state-2026-09-18.md` — latest verified implementation and deployment snapshot.
3. `docs/implementation-backlog.md` — canonical operational work queue.
4. Topic plans — security, data integrity, product/UX, and testing/release.
5. Dated smoke/evidence files — evidence for their capture date, not current-state declarations.
6. `plan.md`, older UI plans, and hackathon submissions — historical context.

Basket counts, test counts, API versions, and deployment claims in older files are not automatically current. Check the current-state snapshot, then verify the running system and CI.

## Current document set

| Document | Purpose |
|---|---|
| `current-state-2026-09-18.md` | Verified capabilities, deployment reality, tests, and blockers |
| `architecture-current.md` | Implemented architecture, money flows, trust boundaries, and invariants |
| `implementation-backlog.md` | P0–P3 tasks, dependencies, and acceptance criteria |
| `mainnet-readiness-roadmap.md` | Ordered gates from devnet beta to controlled mainnet |
| `security-hardening-plan.md` | On-chain, Token-2022, Zap, and governance hardening |
| `data-integrity-and-demo-policy.md` | Live/demo/mock/simulated data rules and provenance |
| `product-ux-improvement-plan.md` | Onboarding, create, trading, charts, and accessibility |
| `testing-and-release-plan.md` | CI, test layers, release evidence, and rollback |
| `dependency-audit-2026-09-18.md` | Dated npm audit evidence, remediation, and accepted upstream risk |
| `deployment-attestation.md` | Deployment manifest generation, artifact hashes, and verification limits |

## Update discipline

- Close a backlog item only after code, tests, documentation, and evidence are complete.
- Record an explicit spec erratum or decision before changing a protocol constraint.
- Treat test totals as dated snapshots generated from CI, never as permanent facts.
- Verify devnet/mainnet claims through a deployment manifest.
- Never present mock or simulated data as live backing, real AUM, or on-chain proof.
