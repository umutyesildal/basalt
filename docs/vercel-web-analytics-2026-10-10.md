# Vercel Web Analytics, 2026-10-10

Status: live at https://basalt.markets; collection was verified in the authenticated dashboard.

The owner requested the Vercel Analytics setup shown in their dashboard. The existing `basalt` project on `yesildaladams-projects` already has Web Analytics enabled: Chrome's Analytics actions menu offers **Disable Web Analytics**. The dashboard initially showed zero visitors/page views and the package setup checklist.

## Implementation

- Add the pinned official `@vercel/analytics@2.0.1` package to the app workspace and canonical root lock.
- Mount one `SiteAnalytics` client wrapper in the server root layout. It uses `Analytics` from `@vercel/analytics/next`, retaining the SDK's App Router tracking and deployment-configured collection routes.
- The `beforeSend` filter removes URL query strings and fragments, which prevents sending the encoded `/preview?d=` basket payload or wallet query parameters. Creator profile addresses become `/creator/[pubkey]` in the analytics URL. Public basket and stock paths remain useful.
- No custom events, wallet identifiers, transaction amounts or user properties are deliberately sent. No paid plan upgrade, separate analytics provider, hardcoded intake endpoint, backend deployment, contract or financial-state change is part of this task.

Official integration references: [Next.js quickstart](https://vercel.com/docs/analytics/quickstart), [URL redaction](https://vercel.com/docs/analytics/redacting-sensitive-data), [CLI metrics](https://vercel.com/docs/analytics/accessing-metrics-with-vercel-cli).

## Checks and publication

Source checks: five focused URL-redaction tests, 318 Node tests, 57 Vitest tests and concept integrity checks passed. App typecheck and production build passed. Production dependency audit reports zero advisories. Final source, production deployment and observed dashboard data will be recorded here after publication. Previous frontend rollback deployment: `dpl_76CyNAWxa6rwndGqmeGCPK5h8xjX`. The VPS remains at source `307053da1310331c658c0401d0107f8405912199`.


## Completed publication

- Application source: `b3e835c2aeeb1336fea6d610f3f6e79508a40952`, pushed to public `origin/main`.
- All six exact-source CI jobs passed: https://github.com/umutyesildal/basalt/actions/runs/38002297532 . The frozen hosted npm 11.6.2 workspace install, Next 15.5.27 build and hosted root-document check passed.
- Vercel deployment: `dpl_DQxGPWM5wjzCN4uujDVUdvTwjdr7`, immutable URL https://basalt-fovyfz8yr-yesildaladams-projects.vercel.app . Deployment metadata confirms `READY` and matching `sourceSha`/`gitCommitSha` above. After CI succeeded this exact deployment was explicitly promoted; inspecting https://basalt.markets resolved to it.
- Chrome confirmed one official `@vercel/analytics/next` version `2.0.1` script on the production website. Client navigation retained one SDK script. Intake routes are deployment-configured, not hardcoded in source.
- Actual root-page and internal-page visits were verified through the authenticated Analytics dashboard and production metrics. No private dashboard screenshot, visitor statistics, country/device data or metrics response is included in this public repository. Automatic approval review rejected adding that private evidence to the public repository; it was excluded from publication.
- The dashboard remains open in Chrome and the temporary site-test tab was closed. The owner can inspect live data at https://vercel.com/yesildaladams-projects/basalt/analytics .
- No paid plan upgrade, backend deployment, contract-state change or financial projection change occurred. The VPS remains at `307053da1310331c658c0401d0107f8405912199`. Later documentation-only commits do not change deployed application bytes.
