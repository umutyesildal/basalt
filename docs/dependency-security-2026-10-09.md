# Dependency security remediation — 2026-10-09

BAS-AUD-10 production npm remediation is implemented in the root, app and backend
lockfiles. Recorded `npm audit --omit=dev` reports for those committed locks contain
zero advisories; raw metadata and lock hashes are in
[security evidence](security-evidence-2026-10-09/evidence-summary.json). These are
production audit results, not proof that every standalone installation is a supported
release build. The canonical frontend release uses the root workspace lock.
Development tooling advisories in Vitest/shadcn remain separately tracked.

## Exact dependency changes

| Dependency | Resolution | Reason and upstream source |
|---|---|---|
| `bigint-buffer` native addon | Local `@basalt/bigint-buffer@1.0.0`, exposed under the compatibility name | Upstream 1.1.5 has no fixed release for [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg). Independent bounded JavaScript implementation; no native addon or install hook. |
| `jayson` | 5.0.0 | [Maintained upstream release](https://github.com/tedeh/jayson/releases/tag/v5.0.0), Node >=20. Preserves web3's browser client entry point while removing stream-json and old uuid dependencies. |
| Old `uuid` resolutions | 11.1.1 | Fixes [buffer bounds advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq), retaining CommonJS exports. Already newer rpc-websockets uuid14.0.2 remains unchanged. |
| `stream-json` 1.9.1 | Removed from production trees | Removes [nested-filter DoS](https://github.com/advisories/GHSA-528h-pc64-c93x), [JSONC rescanning DoS](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x) and [assembler prototype pollution](https://github.com/advisories/GHSA-mjw6-4jj6-33hc), without forcing its incompatible major API into jayson4. |
| `source-map-js` | 1.2.2 | Fixes [indexed-section event-loop DoS](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). |
| `next` | 15.5.27 | Same-major patch for current [SSG/ISR cache poisoning](https://github.com/advisories/GHSA-4jqv-mc3x-m676) and [cross-user substitution](https://github.com/advisories/GHSA-mcj8-r9mp-w47p). |
| `sharp` / packaged binaries | 0.35.5 / libvips1.3.4 | Fixes current [librsvg dependency vulnerability](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). |

Root overrides and standalone overrides are deliberately both present. The local
codec is an explicit dependency plus `$bigint-buffer` override in root/backend,
so npm resolves the local tarball from the project root rather than a transitive
package's directory. All unrelated root resolutions were preserved. App explicitly
declares its existing bs58 runtime import and Vitest test types so standalone
installation/typechecking does not rely on hoisted backend dependencies.

The codec accepts unsigned 0–32-byte integers, rejects negative/out-of-range values,
invalid widths and oversized input before conversion, and preserves endian encoding.
`npm run test:security` tests boundaries and `node scripts/security/dependency-smoke.mjs`
tests actual installed Solana u64/u128/u192/u256 and Token-2022 layouts plus web3/Jayson
RPC compatibility. Source and deterministic tarball live under `vendor/`. Do not
replace it with an advisory suppression or downgrade spl-token to 0.1.8.

## Supported installation and audit paths

The canonical frontend release build starts at the repository root with Node20
and default peer dependency resolution. Preserve the root lock and build the app
through its workspace:

```sh
npm ci --ignore-scripts --legacy-peer-deps=false
npm run test:security
node scripts/security/dependency-smoke.mjs
npm --prefix backend run build
npm --prefix app run typecheck
npm --prefix app run build
npm audit --omit=dev --audit-level=high
npm --prefix backend audit --omit=dev --audit-level=high --workspaces=false
npm --prefix app audit --omit=dev --audit-level=high --workspaces=false
```

The standalone backend is separately supported and verified with Node20 and
npm11.6.2, empty user/global npm configurations, and explicit default peers.
Both builder and production installs passed; the production install uses
`--omit=dev`. The backend container uses the same install policy and copies only
the backend build plus its production Node dependencies. Preserve the local
`../vendor/` tarball path when reproducing the standalone layout:

```sh
npm --prefix backend ci --ignore-scripts --workspaces=false --legacy-peer-deps=false
npm --prefix backend run build
```

An app-only npm11/default-peer lock candidate introduced **13 high-severity
advisories**. It was not applied and is not a supported frontend release path.
The app lock audit above records its committed production dependency metadata;
it does not establish that an app-only `npm ci` can replace the canonical root
workspace install. Do not regenerate the app lock or use legacy-peer bypasses
to make a different release graph appear equivalent.

CI blocks high/critical production advisories for all three lockfiles, in addition
to the backend build/tests and app typecheck/build. These gates do not hide or
reinterpret advisories in the npm report. The Node CI job runs PostgreSQL15 in a
disposable `basalt_ci_test` database through `BASKET_RETURNS_TEST_DATABASE_URL`, so
SQL rollback/concurrency/history suites run rather than silently skipping. It never
uses the application's `DATABASE_URL` for those tests.

## RustSec reachability and temporary exceptions

`cargo-audit 0.22.0` with RustSec database commit
`7eebec69c352c7191b1f13eb95dd510eeca5d1de` reports two vulnerabilities and fourteen
unmaintained/unsound notices for the locked Anchor0.30.1/Solana1.18.26 workspace.
They are **not fixed** by this branch. The current release target is the existing
devnet web/backend. These Rust crates are absent from the deployed Node dependency
artifact; most flagged crypto, logging, collection and mmap paths are host-gated.
Bincode/Borsh compatibility dependencies must still be assessed for program builds.
This release does not upgrade the deployed SBF programs or claim that their Rust
graph is clean. A Solana/Anchor migration requires separate account/instruction
compatibility, SBF toolchain, ELF and regression review.

[Machine policy](../scripts/security/rust-audit-exceptions.json) records every exact
advisory, package, version, checksum, owner and reachability rationale. Exceptions
expire at **2026-10-23 00:00 UTC**, are bound to the entire Cargo.lock SHA-256, and do
not authorize mainnet or accept a different version. The gate fails new findings,
changed locks, expired entries, missing/current-db audit evidence and newly added
project Rust signing/mmap/logger/collection API usage. There is no blanket ignore.

| Affected crates | Project reachability assessment |
|---|---|
| curve25519-dalek3.2.1; ed25519-dalek1.0.1 | Crypto timing/[signing oracle](https://rustsec.org/advisories/RUSTSEC-2022-0093.html) paths are host SDK transitive dependencies. Basalt Rust programs have no secret scalar/keypair/signing API. Solana pubkey PDA code uses host curve decompression under `cfg(not(target_os="solana"))` and SBF syscalls on chain; zk-token-sdk crypto dependencies are also host-gated. The [timing advisory](https://rustsec.org/advisories/RUSTSEC-2024-0344.html) remains recorded. |
| borsh0.9.3 | Legacy Solana helper; no project non-Copy zero-sized deserialization types. Cannot globally substitute a different wire implementation. |
| atty0.2.14 | Host logging; affected Windows/custom-allocator condition is outside the deployed Linux/SBF path. |
| memmap2 0.5.10 | Host frozen-ABI/SDK; no project advise_range/flush_range API or untrusted mmap range service. |
| rand0.7.3 | No custom Rust logger that reenters thread_rng during reseed. |
| im15.1.0; sized-chunks0.6.5; bitmaps2.1.0 | Host frozen-ABI collections; no project OrdSet/sized_chunks or panicking-Drop element APIs. |
| bincode1.3.3; libsecp256k1 0.6.0 | Pinned SDK serialization/host crypto maintenance debt; no project Rust signer. |
| derivative2.2.0; paste1.0.15 | Build-time macros, maintenance notices. |

The complete current advisory IDs, titles and primary-source links are in
[rustsec-summary.json](security-evidence-2026-10-09/rustsec-summary.json). Reproduce:

```sh
cargo install cargo-audit --version 0.22.0 --locked
npm run audit:rust
```

For an isolated auditor/database installation, set `BASALT_CARGO_AUDIT` to the
absolute pinned `cargo-audit` binary and `BASALT_RUSTSEC_DB` to its RustSec Git
database directory before the same command. The recorded validation used
cargo-audit0.22.0 and the database commit above; no global installation is assumed.

A protocol maintainer must re-evaluate these scoped exceptions before their expiry,
when Cargo.lock changes, before adding any host signer/secret-scalar service, and
before a mainnet decision. The automated gate currently passes this exact devnet
source scope; it is not a declaration that the Rust dependency graph is clean.

## Verified Rust migration options and acceptance criteria

Read-only graph review found no lockfile-only compatible update that removes any
of these 16 findings under the current parent requirements. The
[Anchor 0.30.1 manifest](https://raw.githubusercontent.com/coral-xyz/anchor/v0.30.1/lang/Cargo.toml)
requires Solana 1.x and bincode 1. The
[Solana 1.18.26 program manifest](https://raw.githubusercontent.com/solana-labs/solana/v1.18.26/sdk/program/Cargo.toml)
retains a mandatory Borsh 0.9 compatibility dependency and host crypto/Ark dependencies.
Token2022 3.0.5 and spl-pod 0.2.5 require the zk SDK; its host
[SDK dependency](https://raw.githubusercontent.com/solana-labs/solana/v1.18.26/sdk/Cargo.toml)
enables the old signing, logger and mmap dependencies. Disabling the Token2022
`zk-ops` feature does not remove those mandatory parent edges.

Potential bounded reductions require maintained patches of upstream parent crates,
not an advisory rename or broad suppression:

| Candidate | Potential reduction | Required validation |
|---|---|---|
| solana-logger 1.18.26 using env_logger 0.10.2 | Both atty findings | Upstream [env_logger changelog](https://raw.githubusercontent.com/rust-cli/env_logger/main/CHANGELOG.md) confirms 0.10 replaces atty with is-terminal. Verify logger construction, filters and file logging, preserve parent source/license provenance, and run Rust gates. This changes host logging dependencies, not program financial logic. |
| SDK 1.18.26 and frozen-ABI 1.18.26 using memmap2 >=0.9.11 | One mmap finding | The [patched minimum](https://rustsec.org/advisories/RUSTSEC-2026-0186.html) is outside their 0.5 requirement. Review both parents' host map/map_anon calls, compile/test the replacement and preserve SBF cfg separation. |
| frozen-ABI replacing im and its collection family | Up to five collection findings | Review public trait bounds, serde and ABI examples. The maintained [imbl 7.0.2 manifest](https://raw.githubusercontent.com/jneem/imbl/main/Cargo.toml) uses imbl-sized-chunks 0.2.0 and MSRV 1.85. Earlier fork versions can introduce [RUSTSEC-2026-0292](https://rustsec.org/advisories/RUSTSEC-2026-0292.html); the fixed minimum is 0.2.0. |
| Ark parent patches or a coordinated Ark family upgrade | derivative/paste maintenance notices | Modern [ark-ff](https://raw.githubusercontent.com/arkworks-rs/algebra/master/ff/Cargo.toml) and [ark-ec](https://raw.githubusercontent.com/arkworks-rs/algebra/master/ec/Cargo.toml) use educe. Review generated traits and BN254/Poseidon behavior; a global 0.4-to-new-major override is not compatible. |

None of these candidate patches was applied. The existing exact exception policy
and **2026-10-23 00:00 UTC expiry remain unchanged**. Taking ownership of upstream
Solana forks solely to reduce a host dependency count is a separate maintenance
decision from releasing the existing devnet Node application.

The remaining crypto and serialization paths need coordinated parent migrations.
[Curve25519 requires >=4.1.3](https://rustsec.org/advisories/RUSTSEC-2024-0344.html),
[Ed25519 requires 2.x](https://rustsec.org/advisories/RUSTSEC-2022-0093.html), and
[Rand 0.7 has no patched release](https://rustsec.org/advisories/RUSTSEC-2026-0097.html).
Solana's affected Borsh 0.9 helpers cannot become 0.10/1.x by changing a root dependency
alone. A blind latest-Anchor upgrade is not a zero-exception plan: official
[0.30.2 notes](https://www.anchor-lang.com/docs/updates/release-notes/0-30-2)
describe a TypeScript-only patch, while the verified
[Anchor 1.2.1 manifest](https://raw.githubusercontent.com/otter-sec/anchor/v1.2.1/lang/Cargo.toml)
still requires bincode 1. The [official changelog](https://www.anchor-lang.com/docs/updates/changelog)
lists this release and links the current OtterSec-hosted repository; the former
[coral-xyz repository](https://github.com/coral-xyz/anchor) redirects there. This is
verified upstream provenance, not an assumed independent fork. For bincode,
[RustSec lists no patched version](https://rustsec.org/advisories/RUSTSEC-2025-0141.html).

A future Rust migration is accepted only after all of the following are demonstrated:

- Select a maintained, mutually compatible Anchor/Solana/SPL and SBF toolchain set.
  Follow the official [Anchor migration guidance](https://github.com/solana-foundation/solana-dev-skill/blob/main/skills/solana-dev/references/anchor/migrating-v0.32-to-v1.md);
  account for CPI/context, mutable-account and IDL changes before proposing deployment.
- Preserve program IDs, PDA seeds, instruction/account discriminators and serialized
  layouts. Prove loader/sysvar/system bytes remain compatible if replacing bincode;
  changing the serializer name alone is not sufficient.
- Preserve immutable basket fields, Token2022 owner/extension checks, raw transfer
  amounts, integer rounding, fee limits and permissionless oracle-free redemption.
  No redemption gate, custody authority or administrative withdrawal is introduced.
- Run formatting, workspace checks/tests and Clippy, all relevant TypeScript layout
  and transaction tests, a successful SBF build, and a deterministic local-validator
  create/mint/redeem/fee flow. Review ELF provenance and compute/size changes.
- Re-audit the exact resulting lock against a current RustSec database. Remove only
  findings actually eliminated; preserve source/license provenance for any maintained
  parent patches. Do not extend current exceptions or claim zero findings while
  bincode or another flagged package remains.
- Review a concrete program/IDL deployment plan separately. No chain upgrade,
  authority transfer or mainnet approval is implied by the Node devnet release.
