# Basket artwork frontend release, 2026-10-09

Status: integrated source checks passed. Hosted build, production promotion and live evidence are still pending.

## Scope and preserved baseline

The owner authorized publishing the accepted stock-logo colors, basket artwork library and share-image flow to the existing https://basalt.markets Vercel project. The canonical UI checkout was based on `387ff5c`, while GitHub main had advanced to `4fd7d59eb8266472b70e7dfc460dfc1caab1e22d`. A managed release worktree was created from that newer main, and only the artwork/share/domain patch was integrated. The original dirty checkout is preserved.

The latest namespace routing, factory-availability guard, wallet intent validation, owner setup, current-balance data quality and frozen workspace dependencies must be retained. The devnet workspace merge adds the required cover to fresh draft metadata without changing old metadata bytes or transaction semantics. No backend deployment, program upgrade, authority transfer, wallet signature or financial recovery activation is part of this frontend release.

The release includes 34 cover identities, 24 new WebP artworks, 34 serverless social thumbnails, actual-logo allocation colors for all 1,271 issuer assets, portable v4 basket links, Canvas PNG preview/export, X drafts, native image-sharing capability and canonical basalt.markets metadata/links. Unrelated pitch decks, bounty drafts, videos, output folders and the separate local README rewrite are excluded.

## Verification

The earlier local UI checkout passed 93 combined Node checks, 30 devnet pipeline/draft Vitest checks and its production build. Those results do not validate the newer integration baseline by themselves. Integrated-source tests/build, exact Git source, hosted build/promotion and live browser/API evidence will be recorded below when complete.

## Existing rollback target

Before this release, `https://basalt.markets` resolved through Vercel to Ready deployment `dpl_Hh5GFqbNvwCY2SCSaNEwjsbuCGt2`, immutable URL `https://basalt-a6a0y75x5-yesildaladams-projects.vercel.app`. The previous deployment remains available for an explicit rollback promotion. Existing Vercel production configuration and custom domains will be preserved.

## Integrated release verification

The frozen canonical install completed with npm 11.6.2 and 805 packages. `npm --prefix app test` passed **272 Node tests and 57 Vitest tests**, zero failures or skips, plus the concept-preview/sample-integrity script. `NEXT_TELEMETRY_DISABLED=1 npm --prefix app run build` passed Next.js 15.5.27 compilation, lint/type validation and generation of **29 static pages**, including preserved `/devnet/setup`.

Independent merge review verified that factory readiness, exact namespace fingerprinting, wallet-intent, trade execution and confirmation paths remain the latest main baseline. Only the cover guard and cover-aware immutable metadata helper differ in fresh creation.

The initial dry upload check found an unrelated tracked pitch-deck backup among the otherwise expected upload inputs. `.vercelignore` now excludes every root pitch-deck variant and the unnecessary vendored Rust source tree. Root documentation/brand exclusions are anchored so they do not discard the public app docs route or product brand assets. Private env files, key material, caches, node_modules and build output remain excluded. The final upload report must be checked before publication.
