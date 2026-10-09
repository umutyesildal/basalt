# Vercel Web Analytics, 2026-10-10

Status: implementation and source checks passed; publication and dashboard verification in progress.

The owner requested the Vercel Analytics setup shown in their dashboard. The existing `basalt` project on `yesildaladams-projects` already has Web Analytics enabled: Chrome's Analytics actions menu offers **Disable Web Analytics**. The dashboard initially showed zero visitors/page views and the package setup checklist.

## Implementation

- Add the pinned official `@vercel/analytics@2.0.1` package to the app workspace and canonical root lock.
- Mount one `SiteAnalytics` client wrapper in the server root layout. It uses `Analytics` from `@vercel/analytics/next`, retaining the SDK's App Router tracking and deployment-configured collection routes.
- The `beforeSend` filter removes URL query strings and fragments, which prevents sending the encoded `/preview?d=` basket payload or wallet query parameters. Creator profile addresses become `/creator/[pubkey]` in the analytics URL. Public basket and stock paths remain useful.
- No custom events, wallet identifiers, transaction amounts or user properties are deliberately sent. No paid plan upgrade, separate analytics provider, hardcoded intake endpoint, backend deployment, contract or financial-state change is part of this task.

Official integration references: [Next.js quickstart](https://vercel.com/docs/analytics/quickstart), [URL redaction](https://vercel.com/docs/analytics/redacting-sensitive-data), [CLI metrics](https://vercel.com/docs/analytics/accessing-metrics-with-vercel-cli).

## Checks and publication

Source checks: five focused URL-redaction tests, 318 Node tests, 57 Vitest tests and concept integrity checks passed. App typecheck and production build passed. Production dependency audit reports zero advisories. Final source, production deployment and observed dashboard data will be recorded here after publication. Previous frontend rollback deployment: `dpl_76CyNAWxa6rwndGqmeGCPK5h8xjX`. The VPS remains at source `307053da1310331c658c0401d0107f8405912199`.
