# Dependency security remediation — 2026-10-09

BAS-AUD-10 production npm remediation is implemented in the root, app and backend
lockfiles. All three current `npm audit --omit=dev` reports contain zero advisories;
raw metadata and lock hashes are in [security evidence](security-evidence-2026-10-09/evidence-summary.json).
This statement covers production dependencies only. Existing development tooling
advisories in Vitest/shadcn remain separately tracked; no broad tooling major upgrade
is included in this backend/devnet patch.

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

## Reproduce all three locks

Run from the repository root using Node20 or newer. The standalone installs must
explicitly disable npm workspace selection:

```sh
npm ci --ignore-scripts
npm --prefix backend ci --ignore-scripts --workspaces=false
npm --prefix app ci --ignore-scripts --workspaces=false
npm run test:security
node scripts/security/dependency-smoke.mjs
npm audit --omit=dev --audit-level=high
npm --prefix backend audit --omit=dev --audit-level=high --workspaces=false
npm --prefix app audit --omit=dev --audit-level=high --workspaces=false
```

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
They are **not fixed** by this branch. A major Solana/Anchor migration changes the
program build/ABI and requires its own deployed-ELF and regression review.

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
