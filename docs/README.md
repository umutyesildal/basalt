# Basalt documentation

Start with the evergreen documents below. Dated files are release evidence and session records, kept for audit, and are not current documentation.

If two documents disagree, the newest dated release record wins. Update the evergreen document to match it instead of adding another status note.

## Start here

| Document | What it covers |
|---|---|
| [Architecture](architecture-current.md) | Current system shape: programs, backend, app, data flow |
| [V0 protocol spec](basalt-v0-spec.md) | Basket lifecycle, accounts, fees, mint and redeem rules |
| [Providers](providers.md) | RPC, price, indexer and data providers |
| [Deployment attestation](deployment-attestation.md) | What is deployed, where, and how it was verified |

## Status and planning

| Document | What it covers |
|---|---|
| [Implementation backlog](implementation-backlog.md) | Ordered work queue |
| [Mainnet readiness roadmap](mainnet-readiness-roadmap.md) | What remains before mainnet |
| [Testing and release plan](testing-and-release-plan.md) | Test layers and release gates |
| [Data integrity and demo policy](data-integrity-and-demo-policy.md) | What may be shown as live data |

## Protocol and governance

| Document | What it covers |
|---|---|
| [Token-2022 extension policy](bas-002-token2022-extension-policy.md) | Which issuer extensions V0 admits |
| [Rebalance V1 draft](basalt-rebalance-v1-draft.md) | Design draft for active rebalancing |
| [Upgrade governance policy](upgrade-governance-policy.md) | Upgrade authority and approval rules |
| [Governance ceremony runbook](governance-ceremony-runbook.md) | Step-by-step ceremony procedure |
| [Security hardening plan](security-hardening-plan.md) | Open security work |

## Operations

| Document | What it covers |
|---|---|
| [Devnet bootstrap plan](clean-devnet-bootstrap-plan.md) | Clean environment from zero |
| [Owner bootstrap](devnet-owner-bootstrap.md) | Owner namespace initialization |
| [Namespace routing](devnet-namespace-routing.md) | How program IDs resolve per basket |

## Managed Basket V2 (localnet prototype)

| Document | What it covers |
|---|---|
| [Plan](managed-basket-v2-plan.md) | Scope and phases |
| [Threat model](managed-basket-v2-threat-model.md) | Assets, actors and risks |
| [Product flow](managed-basket-v2-product-flow.md) | User journey |
| [Prototype status](managed-basket-v2-prototype-status.md) | What is implemented, what is simulated |

## Design

| Document | What it covers |
|---|---|
| [Basalt visual design](design-basalt-v1.md) | Brand and interface direction |
| [UI primitives](ui-primitives.md) | Shared components |
| [UI plan](ui-plan.md) | Screen inventory and layout rules |

## Historical records

Everything matching `*-YYYY-MM-DD.md`, `*-YYYY-MM-DD.json` and the `journal/` folder is a historical record, not a guide. They document releases, incidents, audits and agent sessions. Keep them for traceability, but do not treat them as current behavior.

- [`journal/plan-2026-09.md`](journal/plan-2026-09.md) (historical plan)
- [`journal/handoff-2026-10.md`](journal/handoff-2026-10.md) (historical handoff)
- [`journal/context-2026-09.md`](journal/context-2026-09.md) (historical agent context)
- [`journal/foliox-build-prompt-2026-09.md`](journal/foliox-build-prompt-2026-09.md) (original brief, product was called FolioX then)
- [`journal/folioX-pitch-deck-2026-09.pdf`](journal/folioX-pitch-deck-2026-09.pdf) (2026-09 deck)
