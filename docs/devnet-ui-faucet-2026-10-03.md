# Devnet wallet test-token faucet, 2026-10-03

Status: completed for the separate devnet faucet. The reviewed program is deployed and byte-attested; all four fixed mock pools are funded; a fresh wallet claim is finalized with exact raw credits/debits and repeat-claim rejection. 9 Rust checks, 3 focused client checks and standalone TypeScript checking pass. This is CLI proof of the faucet contract and builder; interactive connected-wallet UI verification is recorded separately by the integration task.

The separate faucet program is pinned at `2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf`. It transfers the four existing [project-issued devnet fixture mints](assets/xstocks-devnet-runtime-2026-10-03/fixture-state.json). These are test assets, not official xStocks or mainnet-backed equities. It does not change the V0 basket programs or any issuer authority.

The faucet authority PDA uses `["faucet"]`. Its four canonical Token-2022 associated token accounts were funded with 100,000 raw whole-token units each, enough for 100 initial wallet claims. The finalized proof consumed one claim; the observed remaining pool holds 99,000 raw whole-token units per mint, enough for 99 more claims. A wallet signs one transaction containing four idempotent wallet ATA instructions and one faucet claim. The wallet pays its own account rent and network fee. The unadorned legacy claim transaction is **771 bytes**, below Solana's 1,232-byte packet limit.

Each claim atomically transfers `100000000000` raw base units, which is 1,000 raw whole-token units at eight decimals, from each vault. Existing scaled display multipliers are A 1, B 1.25, C 2 and D 10. Therefore these raw balances display as 1,000 / 1,250 / 2,000 / 10,000 scaled units. Transfers always use raw amounts; scaled values never enter the transfer instruction.

Each wallet's marker PDA uses `["claim", wallet_public_key]`. It is created or allocated on the first successful claim and contains byte `1`; its program ownership prevents repeat claims. Dust sent to an unclaimed marker does not block allocation. Every mint, vault, wallet ATA, account owner, Token-2022 program identity, signer, writable financial account and initial raw vault balance is checked before allocation. The four `transfer_checked` CPIs and marker creation share the transaction's atomic rollback. There is no mint, withdrawal, authority-change or administration instruction.

The onchain program pins its own ID and all four devnet mint identities. Solana exposes no genesis-hash sysvar, so `app/lib/devnet-faucet.ts` and the setup script check the exact devnet genesis hash before wallet signing or payer loading. The browser library builds instructions and reads public account state; it has no signer or private-key access. The backend is not involved. Existing fixture issuer pause, freeze, hook and permanent-delegate powers remain unchanged, and the Token-2022 program can reject transfers if those settings change.

## Public client API

`app/lib/devnet-faucet.ts` exports `DEVNET_FAUCET_PROGRAM_ID`, `DEVNET_GENESIS_HASH`, `DEVNET_FAUCET_CLAIM_RAW`, `DEVNET_MOCK_TOKENS`, `deriveDevnetFaucetAuthority()`, `deriveDevnetFaucetVault(mint)`, `deriveDevnetFaucetClaim(wallet)`, `buildDevnetFaucetClaim(wallet)`, `assertDevnetFaucetReady(connection)` and `readDevnetFaucetClaimed(connection, wallet)`. Call the readiness and claim-state reads before asking the wallet to sign. A wallet rejection must leave the UI ready to retry; successful confirmation should refresh the real raw token balances and claim marker.

## Setup and proof

The standalone crate `programs/mock_faucet` has its own workspace and lockfile. It is intentionally absent from the root workspace, Anchor program table and current V0 IDs. Program signing material stays inside the ignored `.cache/devnet-xstocks/ui-faucet-20261003` directory with mode 0600. No existing payer key is copied or logged.

`node --import tsx scripts/setupDevnetUiFaucet.ts --proof` prints an offline plan and never loads a signer or connects to RPC. After reviewed deployment, `--execute --proof` funds only the four fixed vaults from existing payer ATAs using raw transfers. It preserves the eight-extension fixture mint authorities. Funding/proof spending is capped at 0.1 devnet SOL and preserves 0.3 SOL in the existing payer. The fresh proof actor receives 0.06 SOL for rent, claim fees and subsequent authorized wallet-flow verification. The deployment rent budget is separate and checked before upload.

Submitted signatures are persisted before confirmation. A previous unresolved submitted transaction blocks retries; the script does not reconstruct and send an uncertain economic action again. A confirmed funding record prevents accidental pool refills after public claims. The proof requires a fresh wallet, a rent-prefunded claim marker, rejection of destination/mint substitution and missing signature, exact raw credits and vault debits for all four tokens, rejection of a second claim with unchanged balances, and finalized successful claim evidence. It rechecks the issuer extension settings after funding and claim.

Commands for local verification:

```bash
cargo test --manifest-path programs/mock_faucet/Cargo.toml --offline
node --import tsx --test programs/mock_faucet/client.test.ts
./node_modules/.bin/tsc --noEmit --target ES2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck scripts/setupDevnetUiFaucet.ts app/lib/devnet-faucet.ts programs/mock_faucet/client.test.ts
```

LEGAL_REVIEW_REQUIRED remains a release gate. This faucet enables test-token access only; it does not establish mainnet availability, real issuer backing, public investment suitability or production security certification.

## Finalized runtime evidence

The official Agave 4.3.0 and platform-tools v1.56 archives were restored in temporary storage and matched the prior recorded SHA-256 hashes. The standalone program built as SBPF v0 with the same isolated compiler flags as the current V0 programs. Its ELF is **85,176 bytes**, machine 263, with a nonzero entrypoint, SHA-256 `e322d4884827833af244bbca4e33d3eb36e3ab8b1e6df8af5ff9c253760fc4b1`. [Preflight](assets/devnet-ui-faucet-2026-10-03/preflight.json) pins devnet genesis, current balance, rent, keyfile modes and feature observations. The v0-disable feature was absent before upload. The official CLI performed feature verification; no skip flags were used, and maximum program length was the exact ELF length.

Deployment succeeded in [the public deployment record](assets/devnet-ui-faucet-2026-10-03/deployment.json), signature `5HDuTMxjkxRY6rEbpWbid1XcjiSx4JgHFNPqwJ24dAznNnmxv6CWPjtT5uvSn4PNpyym6QD92hqNdxgMncfbyDVW`. [Finalized byte attestation](assets/devnet-ui-faucet-2026-10-03/deployed-byte-attestation.json) passed at slot **506940263**: executable/loader ownership, programdata PDA, unchanged existing payer as upgrade authority, exact uploaded executable prefix and zero-only spare capacity all match. Permanent programdata rent is 0.433572920 SOL; the program account holds 0.000833120 SOL. Existing basket IDs and all four issuer authority sets are unchanged.

[The complete finalized faucet proof](assets/devnet-ui-faucet-2026-10-03/faucet-proof.json) contains seven successful setup/claim transactions. Fresh wallet `7H6p7PNL7hFB6PPnCcQ7YeWzPuVJBChXGnhEA1xTxVjN` claimed in signature `5HcRACDfmY4khwQZbxRavxEKkwS89uRiVPYnLw75HzF3HgW3F3CQudyUV2qyBUWdiStS797vwszxgedhPmpkJaau`. Its transaction measured **811 bytes** with the compute-budget instruction. Each wallet ATA received exactly `100000000000` raw units and each matching vault lost exactly that amount. Destination substitution, mint substitution and missing signer simulations returned the expected program errors. A second claim returned `Custom(0)` and all eight token balances remained unchanged. Issuer settings were read and revalidated after the claim.

An initial one-lamport prefund was rejected during simulation by devnet's new-account rent enforcement; no transaction was submitted for that attempt. The corrected prefund used the zero-data rent minimum, and the program allocated/assigned that already funded PDA successfully. Confirmed funding transfers were preserved and were not replayed. The public finalized report reconstructs the original setup spending checkpoint from transaction metadata so total spending spans the resumed proof.

The existing payer started at **2.955199120 SOL**. Faucet deployment, funding and proof reduced it by **0.501769520 SOL**, leaving **2.453429600 SOL** at the finalized observation. The setup/proof portion debited 0.066918480 SOL, within its 0.1 SOL cap; this includes the 0.06 SOL proof-wallet funding. The remainder covers deployment rent and upload/network fees. No airdrop, mainnet operation, original payer-key copy, issuer-flag mutation or backend signing was used.
