# Local governance rehearsal — 2026-09-19

Status: **loader authority-transfer mechanics passed on private localnet**

This evidence records a disposable, loopback-only rehearsal of Solana
Upgradeable Loader authority transfers. It did not connect to devnet or
mainnet, did not use a production signer, and is not proof of a Squads
threshold or time lock.

## Environment

- Date: `2026-09-19`
- Source state: commit `792ec9444fe245478c4946910e21b33a6cac0be2`
  plus the two rehearsal-script corrections committed with this record
- Anchor CLI: `0.30.1`
- Solana CLI: `1.18.17`
- Host Rust: `1.98.0`
- SBF platform tools: `v1.41` / Rust `1.75`
- Network: private `solana-test-validator` instances bound only to
  `127.0.0.1`

## SBF build

The prior `edition2024` build blocker no longer reproduces. With the current
version-3 `Cargo.lock`, all three artifacts built offline into a disposable
directory:

```bash
SBF_OUT_PATH="$PROBE/out" cargo build-sbf \
  --manifest-path "$PWD/Cargo.toml" \
  --sbf-out-dir "$PROBE/out" \
  -- --target-dir "$PROBE/target" --offline
```

Disposable artifact hashes from this run:

| Artifact | SHA-256 |
|---|---|
| `whitelist.so` | `3d255814a49b88c719019b2177e78333a39cc82bc4e0d64bbdf1b53fe6ef131c` |
| `basket_factory.so` | `b8f4bbceeae0cca9ee0038489b87b85f79bb8af4fc57a1a0c54cabad9475412c` |
| `basket.so` | `aabbfe5d35bbc68a1997d092c87cc597b65fa4ecc9a5758b8648422d170e92d5` |

These are local build artifacts, not hashes of the currently deployed devnet
programs. The SBF linker emitted its normal undefined-syscall warnings; the
rehearsal deploys the artifacts but does not execute protocol instructions.

## Script corrections

Two macOS/local-validator issues were found and fixed:

1. `COPYFILE_DISABLE=1` prevents AppleDouble `._genesis.bin` entries from
   invalidating the validator genesis archive.
2. Both disposable authorities receive local-validator SOL, because the
   governance placeholder pays for the rollback transaction.

Focused Vitest coverage passed: `15/15` tests in
`backend/tests/governance-rehearsal.test.ts`.

## Results

The script was run once per artifact on separate loopback ports. Each run
deployed under a disposable operator, transferred to a distinct disposable
governance placeholder, proved the former operator could not transfer again,
verified that the program stayed executable and the ProgramData address stayed
stable, then rolled authority back to the operator.

| Artifact | Disposable program ID | Result |
|---|---|---|
| `whitelist.so` | `JC91K57H2JsHJGwVwuxrZ27wFxfEX4eXsXiWE8bQwkB4` | PASS |
| `basket_factory.so` | `E9mFqhyfEmhHLWfLVV9UngK5QN4RFFb49Nakriw7LQcJ` | PASS |
| `basket.so` | `3DbX93z4PjCZiBnPxX4xoG7avhx4wkA6RwihPkbZ3QVn` | PASS |

The temporary directory, generated program keypairs, authorities, ledgers, and
artifacts were deleted immediately after the successful runs. They are not
recoverable and must never be treated as release assets.

## What this proves

- the current workspace can produce all three SBF artifacts offline;
- the guarded script starts and owns its private validator;
- Upgradeable Loader authority transfer and rollback mechanics work for each
  artifact;
- the former authority is rejected after transfer; and
- executable state and ProgramData identity survive the transfer.

## What this does not prove

- that the disposable program IDs match the canonical `declare_id!` values;
- that protocol instructions or CPI paths execute correctly on localnet;
- that local artifacts match deployed devnet bytes;
- that a Squads 2-of-3 threshold exists;
- that a 48-hour on-chain time lock exists; or
- that any devnet authority has moved.

The canonical deploy keypairs are intentionally absent from the repository, so
a fresh local deployment at the canonical `declare_id!` addresses cannot be
created from repository contents alone. A full functional localnet E2E needs a
disposable source copy compiled with matching temporary IDs, or an explicitly
authorized secure release ceremony using the canonical keys. BAS-006 therefore
remains open until the real 2-of-3 delayed ceremony and post-transfer RPC proof
exist.
