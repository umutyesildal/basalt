# Existing devnet website/backend release — 2026-10-09

The data-repair application release is live on the existing [Basalt website](https://basalt-coral.vercel.app) and [backend](https://basalt.178.104.34.252.sslip.io/api/v1/ready). The backend cutover occurred at **14:36:20 UTC**. The hosted frontend completed its frozen workspace installation/build and its exact deployment was promoted. This supersedes rollout/hosted-build-pending statements in the [source preparation record](devnet-data-repair-2026-10-09.md).

Service readiness is verified. Historical position publication remains deliberately blocked: the later live sample reported **106 pending queue rows, two quarantine rows for one known truncated transaction, six rebuild-required baskets and zero current eligible USD valuations**. Collecting authentic later transaction facts is now progressing without clearing those guards or changing active position projections. This release is an application update; it performs no program upgrade, signing, authority change, new program-ID deployment or mainnet release.

## Exact release identities

| Item | Identity/evidence |
|---|---|
| Deployed source | `d2812bb255920bd54f05bd708dd4671f69d291c4` |
| Canonical merge | [PR #10](https://github.com/umutyesildal/basalt/pull/10), `f7c85f936a03036a8a7f03e7a3d39113e9e5375d`; deployed source tree is identical |
| PR source CI | [Run 37944832595](https://github.com/umutyesildal/basalt/actions/runs/37944832595), all six checks green; [post-merge main run37945376177](https://github.com/umutyesildal/basalt/actions/runs/37945376177) also passed all six checks |
| Backend image | `sha256:f655b848a50bb938cc7d9b18b2ab425416e0b52f724267b619b292cdf05deb06` |
| VPS source archive | `/var/tmp/basalt-release-d2812bb2` |
| Private backup/candidate identity | `20261009_d2812bb2`; database/config/review material retained privately on VPS |
| Final rollback database | `basalt_rollback_20261009_d2812bb2`, recreated immediately before migration |
| Promoted Vercel deployment | `dpl_462asZHWf4G8XfumMnZ5TabmVExe` |
| Exact frontend deployment URL | [basalt-k3x7qdj3v](https://basalt-k3x7qdj3v-yesildaladams-projects.vercel.app) |
| Production alias | [basalt-coral.vercel.app](https://basalt-coral.vercel.app) |

Vercel's actual hosted logs confirm the canonical root workspace installer used **npm 11.6.2, `npm ci`, 809 packages installed in 14 seconds**, and reached READY. Its `meta.gitCommitSha` and `sourceSha` both identify `d2812bb255920bd54f05bd708dd4671f69d291c4`. This is hosted install/build and exact promotion evidence, beyond the earlier local build. The repository is uploaded from its root because the app imports a canonical backend fee helper; no standalone app-only peer-tree installation is asserted.

## Backup, candidate replay and contained cutover

The private release backup was fully restored into an isolated PostgreSQL 16 candidate. Applying the new schema added three queue collection/blocking fields and the valuation missing-price-mint field. One bounded replay retained the known original-log truncation for signature `2NCetomsTGQdJMBESG2YaaNmzvaF6XeR6KwRZvmhLus81MqmszGHRj3v5gN2LSYFN74mEme453sqqhajiD3CQAD7`, producing two per-program queue quarantine rows. The original successful transaction's logs are truncated; replay does not invent missing events or runtime log offsets.

This candidate result was retained as a limitation. It did not activate a staged recovery or replace live position projections. Backend writers were frozen at **14:36:14 UTC** and the backend was recreated at **14:36:20 UTC**. The final rollback database was freshly restored before the live migration so it captures the later state rather than only the initial rehearsal snapshot. Its five retained table counts were:

| Table | Rows in frozen rollback database |
|---|---:|
| `baskets` | 10 |
| `events` | 55 |
| `user_positions` | 23 |
| `vault_holdings` | 41 |
| `nav_snapshots` | 40,068 |

The private `user_positions` row digest matched exactly after the new backend booted, confirming that this contained release did not replace the active position projection. Private backups/configuration remain outside Git and frontend uploads. The existing [release/rollback runbook](../deploy/DEPLOY.md) governs any future database switch; per-run balance backups are not a replacement for a complete rollback after later user/chain activity.

## First live observations

The new `/api/v1/ready` returned HTTP 200 with `ready: true`, verified devnet genesis and all three current real program roles:

| Role | Current devnet ID |
|---|---|
| Basket | `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k` |
| Factory | `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF` |
| Whitelist | `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS` |

The verified genesis is `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. `projectionReady` remains false. The public API exposes ten indexed baskets with the new explicit data-quality fields; zero current USD valuations remains consistent with unavailable eligible exact-mint market prices for the test-token data. Mock prices are not promoted to market values.

At **14:36:40 UTC**, the first health sample reported:

| Metric | Observed value |
|---|---:|
| Pending financial queue rows | 108 |
| Pending evidence rows | 102 |
| Collected rows with pending effects | 6 |
| Collector transactions completed | 5 |
| Rebuild-required baskets | 6 |
| Current eligible USD valuations | 0 |

Transaction and per-program queue-row counts have different units. These observations establish that bounded canonical evidence collection progressed while financial work remained pending. They do not establish complete historical recovery, current holder reconciliation, a valid cost basis or new USD prices. The optional secondary holder provider remains unconfigured; this release does not purchase/provision one or make public Token-2022 enumeration available.

At approximately **14:37:40 UTC**, evidence rows still awaiting collection fell to **95**, while **11** rows had collected facts/pending effects and the collector had completed **ten transactions**. Pending rows were **106**; **two** queue rows quarantined the **one** known truncated transaction. Six rebuild guards remained and no activation occurred. The position-row digest was unchanged. Position synchronization reported `canonical-history-pending`, zero scanned baskets and ten skipped baskets, demonstrating the preflight avoided unnecessary holder reads. The request budget had 168 started/completed requests, zero queue rejections and zero timeouts in that sample; those scheduler counters do not assert that upstream RPC returned no rate-limit/error responses.

## Public browser verification

Desktop and **390×844** checks at **14:37–14:38 UTC** passed. Explore displayed all ten indexed cards with identities visible; USD values/returns stayed `--` with fixed history/price explanations. The existing Redeem form loaded without a wallet, and Providers showed the service available with indexed data catching up. No console errors or horizontal overflow were observed. These checks establish the rendered paths, not extension-wallet signing or a redemption transaction.

The production alias was independently inspected and resolved to `dpl_462asZHWf4G8XfumMnZ5TabmVExe`, with the exact `d2812bb` source metadata. The frontend calls `NEXT_PUBLIC_API` directly on the separate backend origin; this release does not introduce or attest a same-origin `/api/v1` proxy route.

## Post-freeze SBF verification

After the release source was frozen, an isolated offline SBF build passed for **whitelist, basket and basket_factory**. The [new proof](security-evidence-2026-10-09/rust-parent-sbf-proof.json) records cargo-build-sbf 1.18.26, platform-tools 1.41 / target rustc 1.75.0, 225 identical source/config inputs and an unchanged dependency graph. Only the disposable copy's Cargo.lock format header was changed from version 4 to version 3 for that cached toolchain; the tracked lock and release source were not changed.

| Built artifact | SHA-256 |
|---|---|
| `whitelist.so` | `cabe2eb74177c13ec1d7c4eb1c0d51e5e3f148adc465598c586fd486c9bd3fda` |
| `basket.so` | `cb46438578621b9f5e086cf84cbc3c7769fa680dc9ba3e8382d47af8b4c8d257` |
| `basket_factory.so` | `f8d4ec4dfdfa081dce7e2d88572d0ec56ba3149b93de3581f524e5254e01652f` |

This supersedes the SBF-build-pending status in the earlier host dependency evidence. Those hash-bound records remain unchanged as point-in-time evidence. The new binaries were **not deployed or byte-attested against current onchain programs**. RustSec's remaining 13 scoped exceptions and their 2026-10-23 expiry are unchanged; successful compilation does not close the outstanding dependency/governance/mainnet gates.

## Verification scope and remaining work

The source record contains the full **1,352 backend tests, 49 security checks, 141 frontend Node tests, 54 frontend Vitest tests**, typechecks/builds,247Rust host tests (including four host regressions) and **48 Node 20 focused history/RPC/provider tests with actual disposable PostgreSQL**. The latest combined Rust security/provenance checks passed **19/19**, including ten provenance regressions. CI passed all six jobs, and the actual hosted frontend install/build and backend identity/readiness checks now supplement those source results.

Still open: authenticated historical reconstruction across the original truncated-log gap; an explicitly configured suitable holder RPC if enumeration is required; exact reviewed financial activation under a separately planned cutover; missing eligible market prices; retired-key/treasury and real governance remediation; external review and mainnet/legal approval. No owner extension-wallet transaction or new onchain proof is claimed for this release. Direct permissionless oracle-free withdrawal remains independent of the backend's indexed data status.
