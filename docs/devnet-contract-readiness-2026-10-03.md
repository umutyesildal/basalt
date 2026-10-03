# Devnet contract test readiness, October 3, 2026

This preparation submitted no transaction, deployment, airdrop, or authority change. It preserved `scripts/.e2e-devnet` and used the existing wallet only through public-key CLI output. A new setup command and unsigned fixture tests are ready for the authorized devnet test phase. Project program implementation and final SBF verification are separate work in progress.

## Public wallet and cluster evidence

[Machine-readable evidence](assets/devnet-contract-readiness-2026-10-03/readiness.json) records finalized devnet slot **506,810,075**. The endpoint was explicitly `https://api.devnet.solana.com`; its genesis hash was `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` and its reported version was `4.4.0-beta.0`.

The default wallet, historical deploy-authority keyfile, and historical payer keyfile each produced the same public key through `solana-keygen pubkey`: `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE`. The observed spendable balance was **3.117839360 SOL**, rather than the approximately 6 SOL expected before the check. No private key contents were printed, copied, or stored in an evidence artifact.

| Program | Existing ID | ProgramData capacity | Last deployment slot |
|---|---|---:|---:|
| Whitelist | `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS` | 261,816 bytes | 493,110,585 |
| Factory | `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF` | 537,736 bytes | 493,110,824 |
| Basket | `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k` | 593,416 bytes | 493,111,012 |

All three remained executable under the upgradeable loader. Each ProgramData upgrade authority matched the wallet above. The whitelist configuration authority also matched, with no pending authority. Existing program public IDs are sufficient for an authorized upgrade signed by the matching upgrade authority; missing original program-keypair files do not block an upgrade to existing addresses. They would matter for a fresh deployment at those exact addresses. Do not run `anchor keys sync` against newly generated build keypairs.

Rent observations were 0.0032512 SOL for 512 bytes, 0.00585216 SOL for 1,024 bytes, 1.27065024 SOL for 250,000 bytes, 2.03265024 SOL for 400,000 bytes, and 3.04865024 SOL for 600,000 bytes. Actual upgrade requirements depend on the final ELF size, loader buffer overhead, transaction fees, and any necessary ProgramData extension. Sequential upgrades can reuse reclaimed buffer funding, but the largest temporary buffer must fit the available balance plus reserve. This is a sizing observation, not a claim that all new binaries already fit.

## SBF build route

Initially installed tools were Solana CLI 1.18.17, Anchor 0.30.1, host Rust/Cargo 1.98.0, and cached platform-tools v1.41 with Rust/Cargo 1.75. The directory named `.cache/solana/v2.3.2` contained Criterion, not a modern Rust SBF toolchain. Current `Cargo.lock` uses version 4. Running old Cargo metadata against an isolated copy failed with `lock file version 4 requires -Znext-lockfile-bump`; the old `scripts/e2e.sh` comment about a version-3 lockfile is historical.

Official tools were downloaded into `/private/tmp/basalt-sbf-toolchain`:

- [Agave 4.3.0 macOS arm64 release](https://github.com/anza-xyz/agave/releases/tag/v4.3.0), including Solana CLI and cargo-build-sbf 4.3.0.
- [Platform tools v1.56](https://github.com/anza-xyz/platform-tools/releases/tag/v1.56), including Rust 1.89.0-dev and Cargo 1.89.0. Archive URLs and observed SHA-256 hashes are in the evidence JSON.

The compiler requires its versioned cache location. A new `~/.cache/solana/v1.56/platform-tools` symlink points to the temporary installation; the existing v1.41 installation and rustup default were preserved. A disposable `no_std` SBF probe compiled successfully using:

```sh
env RUSTC=/private/tmp/basalt-sbf-toolchain/platform-tools-v1.56/rust/bin/rustc \
  PATH=/private/tmp/basalt-sbf-toolchain/platform-tools-v1.56/rust/bin:$PATH \
  /private/tmp/basalt-sbf-toolchain/solana-release/bin/cargo-build-sbf \
  --tools-version v1.56 --skip-tools-install --no-rustup-override \
  --offline --arch v0 --manifest-path programs/whitelist/Cargo.toml \
  --sbf-out-dir target/deploy
```

The command above shows the project invocation for the build owner; the successful readiness probe used a disposable manifest under `/private/tmp`, not the project manifest. The compiler is temporary and must be reinstalled if that directory is removed.

[Anza's build documentation](https://github.com/anza-xyz/cargo-build-sbf#sbfpv3-migration) describes SIMD-0500 disabling new SBPF v0/v1/v2 deployments after activation. Fresh devnet reads at slot **506,813,625** found the disabling feature `B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g` absent; the SBPFv3 enable feature existed and was activated. Thus v0 was still an available deployment path at this observation. Recheck immediately before deployment. The current old Anchor/Solana syscall definitions are not evidence of SBPFv3 compatibility; changing only `--arch v3` is insufficient if unresolved dynamic syscall symbols remain.

## Isolated modern fixture setup

[setupXStockDevnet.ts](../scripts/setupXStockDevnet.ts) defaults to an offline plan. It loads no signer, performs no RPC request, creates no state, and submits no transaction unless `--execute` is supplied. Preparation was verified with:

```sh
node --import tsx scripts/setupXStockDevnet.ts --run-id issuer-profile-2026-10-03
```

The isolated runtime state is `.cache/devnet-xstocks/<run-id>/state.json`, with generated fixture signing keys stored only in that directory at mode 0600. The payer stays in its existing explicitly selected file and is never copied into test state. Execution checks the exact devnet genesis, expected payer public key, executable existing programs, whitelist ownership/authority, and a bounded 0.15 SOL setup budget with a 0.25 SOL reserve. It does not deploy or reset programs, initialize a new factory, alter historical baskets, or request a faucet airdrop.

Four transparent test mints are labelled `BSTESTA`, `BSTESTB`, `BSTESTC`, and `BSTESTD`, named “Basalt devnet fixture A” through D. They have eight decimals and initial display multipliers 1, 1.25, 2, and 10. They are project-issued mocks, not official issuer devnet assets. Their extension types match the observed modern profile:

| ID | Extension | Test configuration |
|---:|---|---|
| 18 | MetadataPointer | Self-referential pointer, payer authority |
| 12 | PermanentDelegate | Payer delegate |
| 6 | DefaultAccountState | Initialized |
| 25 | ScaledUiAmountConfig | Positive multiplier, payer authority |
| 26 | PausableConfig | Initially unpaused, payer authority |
| 4 | ConfidentialTransferMint | Payer authority, auto-approval false, no auditor key; no confidential token-account balances |
| 14 | TransferHook | Mutable payer authority, no active program |
| 19 | TokenMetadata | Explicit test name/symbol/URI |

`ConfidentialTransferMint` is extension ID **4**; MintCloseAuthority is ID **3** and is not substituted. The installed JS 0.4.15 SDK lacks a confidential-mint initializer. [profile.ts](../scripts/xstocks-devnet/profile.ts) constructs its documented 67-byte instruction from the [official SPL schema](https://github.com/solana-program/token-2022/blob/main/interface/src/extension/confidential_transfer/instruction.rs): outer tag 27, inner tag 0, 32-byte optional authority, one-byte approval boolean, and 32-byte optional auditor key. A fixed [byte fixture](../backend/tests/fixtures/confidential-mint-initialize.json) and tests verify that encoding.

The initial fixed-extension account is **509 bytes**; basic test metadata grows it to **675 bytes**. Initialization reserves rent for the final size and follows [Solana's variable metadata rules](https://solana.com/docs/tokens/extensions/metadata). Allocation, all fixed-extension initialization, mint initialization, and metadata initialization fit one **910-byte** transaction with two signatures and a compute-budget instruction. This is unsigned construction evidence; successful modern mint creation on devnet still requires the later execution phase.

The state records `{version, cluster, genesisHash, profile, payer, createdAt, updatedAt, mocks}`. Each mock records `{letter, symbol, name, mint, decimals, multiplier, signatures}`. Existing pure instruction builders and ALT support can be reused by the separate three/four-constituent flow; the old hard-coded `createWhitelist.ts` remains an extension-free six-decimal fixture script and should not be reused for this profile.

## Execution acceptance checks

The planned three/four-constituent flow must prove atomic create and exact raw vault credits, proportional in-kind minting, fee split, oracle-free pro-rata redemption, multiplier changes leaving raw quantities unchanged, and redemption while the whitelist's new-mint pause is active. Negative cases must cover changed/active hooks, issuer pause, frozen default state/new admission, malformed or unsupported mint profiles, and atomic rollback without partial credits. Issuer pause or freeze may prevent Token-2022 transfers; this is distinct from adding a basket or whitelist redemption gate.

Mutation constructors for issuer pause/resume, hook activation/removal, multiplier updates, and default-state changes are exported as `fixtureMutations`. They only construct unsigned instructions. The separate flow must restore any mutable test state it changes and use independent creator/investor accounts with the existing immutable factory treasury.

Verification completed: **11 focused fixture tests passed**, including exact confidential bytes, initialization order, packet size, mock labelling, full SDK extension readback, mutation bytes, state-path containment, and the offline default. Script TypeScript checking was run separately. No new onchain test success is claimed by this readiness document.

## RPC pacing for the isolated test run

The setup and basket-proof scripts now use `createDevnetConnection()` from [runtime.ts](../scripts/xstocks-devnet/runtime.ts). Its FIFO HTTP queue starts requests at least 400 ms apart and consumes the entire response body before releasing the next request. That includes HTTP 429 bodies, preventing abandoned response streams from accumulating open HTTP connections. It uses only the fixed public devnet endpoint. The transport adds no retries or transaction submissions; web3's existing rate-limit handling remains enabled. Both scripts close the queue in `finally`, aborting active/queued HTTP work. Individual requests have a 30-second timeout.

Six focused transport tests passed: full-body serialization/start spacing, unchanged 429 response metadata, queue recovery after network failure, shutdown, queued-caller cancellation, and preservation of web3's own 429 retry semantics. The existing 11 fixture tests and script TypeScript checks also passed. This change affects only the explicit devnet test harnesses, not production quote scheduling or transaction semantics.

## Executable byte verification

[verifyXStocksDeployment.ts](../scripts/verifyXStocksDeployment.ts) is a read-only check of the three fixed devnet program IDs. It rejects missing or out-of-bounds ELF entrypoints before RPC, then verifies the devnet genesis and all program/ProgramData accounts in one finalized batch. ProgramData executable bytes at offset 45 must match the complete local ELF file, and any remaining capacity must contain only zero bytes. Program ownership, executable flags, ProgramData derivation, upgrade authority and whitelist authority are checked. Source-file hashes and the dirty checkout state are recorded separately, without claiming a reproducible source-to-binary build.

Eleven verifier regression tests and TypeScript checking passed, including the observed CPI-only build failure, mismatching executable bytes, nonzero padding, wrong cluster/authority/PDA, and concurrent local artifact replacement. The verifier has no signing-key or transaction-submission path.

The [finalized deployed-byte attestation](assets/devnet-contract-readiness-2026-10-03/deployed-byte-attestation.json) passed at **2026-10-03 00:56:32 UTC**, finalized observation slot **506,820,772**. All three deployed executable prefixes exactly matched the local validated ELF files; all remaining account capacity was zero-filled. Upgrade authority and whitelist configuration authority matched the expected wallet, with no pending whitelist authority.

| Program | Deployment slot | Matched ELF bytes | ELF SHA-256 |
|---|---:|---:|---|
| Whitelist | 506,817,308 | 244,624 | `707073ff1f866d3955932ab96d10977b8ccfedf72fa40205258326461133956f` |
| Factory | 506,817,882 | 319,128 | `e591e9b647cd106ea6a7336c09172f4241774b79ebbcd9a23aa3f52ab7df8fb8` |
| Basket | 506,817,619 | 357,248 | `556f046dd37e52d47f39858a7a82f3ecba9be9cb4d2eb8af841de2c01d509ab5` |

This observation used only `getGenesisHash` and one `getMultipleAccounts` request at finalized commitment. It accessed no signer file and sent no transaction. It proves the observed binary match and identities; the separate basket execution report is required for behavioral test results.
