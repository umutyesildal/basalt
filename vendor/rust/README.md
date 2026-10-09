# Bounded Solana 1.18.26 host dependency patches

Basalt protocol maintainers own these three local parent patches. The package names
and versions remain upstream identities, and **all upstream Rust sources are
unchanged**. The changes are limited to normalized `Cargo.toml` dependencies:

| Parent | Reviewed change | Finding removed |
|---|---|---|
| solana-logger 1.18.26 | env_logger 0.9.3 → exactly 0.10.2 | atty RUSTSEC-2021-0145 and RUSTSEC-2024-0375 |
| solana-sdk 1.18.26 | optional memmap2 0.5.10 → exactly 0.9.11 | memmap2 RUSTSEC-2026-0186 |
| solana-frozen-abi 1.18.26 | host-only memmap2 0.5.10 → exactly 0.9.11 | Same memmap2 finding; both parent edges must change |

Each modified manifest carries a prominent modification notice. Original
`Cargo.toml.orig` files remain historical upstream bytes; Cargo builds with the
normalized, patched `Cargo.toml`. No feature, cfg boundary, API, crypto,
serialization, program ID, account layout or financial formula is changed.

`upstream/*.crate` contains the original crates.io archives, whose SHA-256 values
were independently matched against the preceding reviewed Cargo.lock. The complete
upstream file sets, commit identities and permitted replacements are recorded in
`manifest.json`. `LICENSE-APACHE` is the unchanged license from the upstream
v1.18.26 repository; its primary URL and checksum are recorded in that manifest.
Retain those archives, notices, original sources and license when distributing
these patches.

Path dependencies do not receive a Cargo.lock package checksum. Therefore the
Rust audit gate runs the offline provenance verifier **before** invoking Cargo
Audit. It checks all 187 upstream files against the checksum-verified archives,
permits only the three declared manifest replacements, and rejects changed
sources, unexpected files, symlinks, license changes and missing root patch binds. Active patch bindings are parsed by
Python 3.11+ `tomllib`; commented/out-of-section declarations and duplicate keys
cannot satisfy the guard. The audit environment requires Python 3.11+ as well as
Node and the pinned Cargo auditor:

```sh
node scripts/security/verify-rust-parents.mjs
node --test scripts/security/rust-parent-provenance.test.mjs
cargo test -p basalt-rust-parent-verification --locked
npm run audit:rust
```

The publish=false verification workspace member tests logger defaults, explicit
and environment filters, append/file output, SDK genesis mmap round-trip and
malformed-file failure, plus anonymous mapping and invalid-range rejection. It
performs no signing, RPC or deployed-state writes. Existing workspace tests remain
required. SBF output and any future program deployment require separate proof;
this patch does not attest or upgrade deployed binaries.

The exact remaining RustSec findings retain their existing 2026-10-23 expiry and
never authorize mainnet. See
[the security record](../../docs/dependency-security-2026-10-09.md).
