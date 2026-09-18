# Dependency audit — 2026-09-18

> Dated npm production-dependency audit after the BAS-014 lock repair and initial BAS-015 dependency pruning. This is evidence, not a permanent allowlist.

## Changes made

- Removed the unused `@solana/wallet-adapter-wallets` umbrella package. The app imports only Phantom and Solflare adapters directly.
- This removed unused Trezor, Torus, Particle, WalletConnect, and related dependency trees from the app.
- Pinned reviewed transitive fixes: `lodash 4.18.1` and `postcss 8.5.28`.
- Regenerated root and standalone app lockfiles from clean manifests.

## Result

| Scope | Critical | High | Moderate | CI threshold |
|---|---:|---:|---:|---|
| Root workspace production graph | 0 | 3 | 6 | Block critical |
| Standalone app production graph | 0 | 0 | 6 | Block high |
| Standalone backend production graph | 0 | 3 | 4 | Block critical |

The root/backend high findings are one dependency chain reported under three package nodes:

- `@solana/spl-token`
- `@solana/buffer-layout-utils`
- `bigint-buffer`

npm proposes downgrading `@solana/spl-token` to `0.1.8`. That is not an acceptable automatic fix for this Token-2022 application. Basalt currently uses `0.4.x`, and a downgrade would remove required behavior and create a larger compatibility risk.

## Policy

- Critical production advisories block root and backend CI.
- High production advisories block app CI.
- The known SPL Token chain remains an explicit, reviewed backend exception until the upstream Solana dependency path provides a compatible fix or Basalt migrates safely.
- Never use `npm audit fix --force` without reviewing API, lockfile, bundle, transaction-builder, and Token-2022 behavior.
- Re-run and replace this dated evidence after every dependency upgrade.

## Required follow-up

1. Track the upstream SPL Token/bigint-buffer advisory and compatible releases.
2. Test any candidate upgrade against raw Token-2022 transfers, Scaled UI Amount decoding, mint/redeem builders, and backend holding sync.
3. Keep wallet support limited to adapters actually used by the application.
4. Add SBOM and dependency-lock hashes to release evidence.
