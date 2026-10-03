# Devnet wallet flow, 2026-10-03

Status: implemented locally. `/create/onchain` and `/devnet` provide wallet-signed test-token claim, basket creation, in-kind mint and in-kind redemption against the byte-attested V0 devnet programs. The shipped UI transaction builders completed seven finalized devnet transactions and 20 assertions. The final production build and desktop/mobile browser checks passed; results are recorded below.

The owner selected **the same four mock tokens for every basket, with a separate share token for each basket**. This implementation follows that choice. It does not require official xStocks, a USD price, a PostgreSQL indexer or a backend signing key. Public `/create` still builds and shares stock-basket ideas; its **Try on devnet** link opens this test workspace. A shared preview also exposes **Create on devnet**. The link carries only the name, thesis and management rate, never an implied stock purchase or equity-backed vault.

## Try it

Open [the local workspace](http://127.0.0.1:3000/create/onchain) in a browser with Phantom or Solflare installed. Connect the wallet and keep devnet SOL in it for account rent and transaction fees. **Get test tokens** opens a review and requests a wallet signature. Set the name, thesis, four positive weights totaling 100%, starting tokens and management fee, then select **Review basket** and approve the reviewed transactions. Creation automatically selects the new basket. Use **Mint shares** to deposit more of the four tokens, or **Redeem shares** to burn shares and receive proportional underlying tokens.

First use can require additional wallet approvals to create and extend an address lookup table. These transactions are shown as setup progress. All network broadcasts go through the app's checked devnet RPC; the wallet signs locally. The app never asks for a private key or seed phrase.

The management fee defaults to 2% annually, capped at 3%; creation sets entry and exit fees to zero. The reviewed legal acknowledgment explains immutable weights, fees and thesis, and fee-share dilution. Genesis issues 1,000,000 raw shares at six decimals, displayed as **one basket share**. Test tokens have no monetary value. LEGAL_REVIEW_REQUIRED remains a release gate.

## Fixed assets and funding

| Token | Devnet mint | Decimals | Observed display multiplier |
| --- | --- | --- | --- |
| BSTESTA | `CrjoC7fq5XAbdej5zjinKNGXVqo8E8qCmh8XSiu2QViQ` | 8 | 1 |
| BSTESTB | `EpH2swtxW2rCuFg2o2ukD5Qw5Xv3toaug1M3mbcB4hab` | 8 | 1.25 |
| BSTESTC | `5G1hMSqs2nWKaFQt737FTxwnruPgeQqQWZ2FRoqxvehA` | 8 | 2 |
| BSTESTD | `8W2hrfJPPrXEBjs5gDgpVZcs8HsELeHkBaqSjnUvgJUq` | 8 | 10 |

The separate faucet program is `2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf`. A wallet can claim once, atomically receiving 1,000 unscaled whole tokens of each mint. This means 100,000,000,000 raw base units per mint. Their scaled balance displays are 1,000 / 1,250 / 2,000 / 10,000. Input and transfer quantities are unscaled, parsed exactly into raw integers; display balances also show the unscaled amount. Commas are accepted only in valid en-US grouping, and formatting preserves decimal precision and trailing zeros.

Four pools were funded with 100,000 unscaled whole tokens each. After the finalized fresh-wallet proof they held 99,000 each, enough for 99 further initial claims at that observation. Funding does not mint tokens or change issuer authorities. The separate faucet has no withdrawal, mint or authority-change instruction. See [the finalized faucet record](devnet-ui-faucet-2026-10-03.md) for source review, byte attestation, substitution checks and repeat-claim rejection.

The existing payer had enough SOL. The finalized faucet setup left **2.453429600 devnet SOL** in that payer. No extra SOL, airdrop or owner-wallet funding was requested. The isolated proof wallet was funded with 0.06 SOL, and had 0.02889628 SOL after claim and the create/mint/redeem proof. This is an observed test cost, not a guaranteed budget for future transactions.

## Data and transaction behavior

`app/lib/devnet-baskets.ts` validates the devnet genesis, program-owned account discriminators, current basket layout, share mint, vault PDAs, Token-2022 owners and fixed mint identities. Basket state, share supply, vaults, token mints and optional wallet accounts are read in a batch so the preview uses a consistent checkpoint. Reads are paced, cached for five seconds and invalidated after transaction completion. Discovery is bounded. Public basket addresses and Explorer links work without a connected wallet.

Token balances, supply and instructions retain exact BigInt raw values. Scaled display amounts read current issuer multipliers. NAV is null because these mocks have no claimed USD price. Existing canonical management-fee and basket math helpers are reused. Frozen accounts remain readable; malformed or uninitialized accounts fail validation. A paused whitelist blocks new deposits, while reads and oracle-free redemption remain available.

`app/components/devnet/devnet-workspace.tsx` uses the existing transaction review modal and state machine. It reads balances again, prepares any required lookup table, simulates, checks the reviewed wallet and app connection, requests the signature and broadcasts only to the checked devnet RPC. A wallet or connection change rejects the stale review, including a change while the wallet prompt is open. Mint retains the exact per-token debit vector the user reviewed; changed vault ratios must still pass canonical tolerance or require a new review. Final share and redemption output calculations run onchain. If a raw broadcast response is lost, retries retain the same signed bytes; after an uncertain send, the locally derived transaction signature enters confirmation/submitted reconciliation. A later wallet guard failure cannot turn that uncertain send into a fresh mint/redeem retry. Signing rejection, unsigned wallet responses, pre-send guard failures and first-attempt deterministic RPC errors remain failures.

The immutable metadata hash is stored onchain. Human-readable name/thesis JSON is hash-verified and saved in browser storage with an in-memory fallback. It is not globally hosted metadata: another browser can open the basket address and its account state, but may display a shortened address instead of a saved name.

No V0 math, account ABI, current program ID, redemption gate or issuer authority was changed by this UI task. The faucet is a standalone workspace at `programs/mock_faucet`, outside the three-program Anchor workspace. Existing unrelated working-tree changes are preserved.

## Finalized UI-builder proof

[The public proof report](assets/devnet-ui-2026-10-03/ui-builders-proof.json) records the same create/mint/redeem and address-lookup builders shipped in the UI, used with an isolated devnet actor. It completed seven transactions, all finalized and below the 1,232-byte packet limit, and 20 assertions. Checks covered exact genesis, immutable metadata hash, canonical accrued supply, exact raw wallet/vault debits and credits, share mint/burn and creator-fee accounting.

- Basket: `9PoTEPsCjew9NtYA9MLTjDapMsW1ZdW4dgokdGzmPimB`
- Share mint: `9UPqD8gfePPEMpEy67pCitvwqr4V58jTcFzSkPB2P3A9`
- Create signature: `6SYBn4koYgzYuvo2bNaaHP8GiPowe6uDSPLxrE79yByX6pZSwVP1WtdzaJMJ7V7j3sHJt2ZivKhwZREtUCYGHVD`
- Mint signature: `64hBPks7JZZs2bwrihxgfvPjTDwoFFo2GTLMQXKWWab9KnRgozxET4HZwvhpyheYGS3CkGNbvT5SfxU7w3UZzykV`
- Redeem signature: `3rsAcebtD8fKTX4boTK5y9vgyLUchnaeCajV4Kq6rw4Ww38wLt5AttTinJJrYkSWqdE257d5yzmj83xUrsU4iQdi`

Creation seeded 25 unscaled whole tokens per mint. Mint deposited 20 more per mint, then redemption burned 0.1 shares and returned 2.5 per mint. Final vaults held 42.5 unscaled units each; scaled displays were 42.5 / 53.125 / 85 / 425. Global supply and the proof actor balance were 1.7 shares. [Direct RPC read evidence](assets/devnet-ui-2026-10-03/direct-rpc-read.json) independently validates existing three- and four-token test baskets.

The proof script defaults to an offline plan. Re-executing its live proof creates further test transactions; it is not needed to use the UI:

```bash
./node_modules/.bin/tsx --tsconfig app/tsconfig.json scripts/proveDevnetUiTransactions.ts
```

## Local verification

- 15 direct-RPC data/metadata/scaling tests passed.
- 5 exact amount and grouped-input tests passed.
- 9 signing/broadcast tests passed, including rejection when the wallet guard fails after signing and reconciliation of a lost RPC response without rebuilding the economic action.
- Separate faucet: 9 Rust tests, 3 client checks, TypeScript checking and SBF build passed.
- Final production build and component TypeScript checking passed. Both devnet routes are present in the build, with 26 static pages generated. [Build log](assets/devnet-ui-2026-10-03/production-build.log), [14 amount/signing checks](assets/devnet-ui-2026-10-03/amount-signing-tests.log), [15 data checks](assets/devnet-ui-2026-10-03/data-tests.log).

```bash
node --import tsx --test app/tests/devnet-baskets.test.ts
./node_modules/.bin/vitest run app/components/devnet/amounts.test.ts app/tests/sign-and-send-local.test.ts --cache=false
npm --prefix app run build
npm --prefix app run start -- --hostname 127.0.0.1 --port 3000
```

The public devnet RPC occasionally throttled the proof with HTTP 429 and SDK backoff; all recorded proof signatures finalized successfully. Browser checks cover rendering, actual public account reads and disconnected form validation. The owner's Phantom/Solflare extension signing has not been performed by the agent. This distinguishes the successful shipped-builder runtime proof from an unperformed interactive owner-wallet test.

This source remains local and unpushed. The previous landing push is `7a16c18`. Test-token UI availability does not change public mainnet investing availability or official xStocks funding.

## Final browser evidence

Production browser checks passed at the normal 775px viewport, desktop 1,280 × 900 and phone 375 × 812, with document width equal to viewport width. The actual finalized proof basket loaded from RPC with supply 1.7 and scaled vault balances 42.5 / 53.125 / 85 / 425. Mint and redemption previews showed the corresponding exact raw quantities. Disconnected claim/create/trade actions are disabled and do not show false insufficient-balance messages.

A 105% weight total, 4% management rate and malformed `1,00` input prevented valid creation. Equal weights restored 100%. Input `1234.00000001` formatted as `1,234.00000001` on blur without precision loss. The phone layout kept all forms within the viewport and the redemption action reachable. The public Create link opened the devnet workspace with the saved name and 200-bps management rate. No captured browser errors or warnings were present. Temporary viewport overrides were reset.

[Final production view](assets/devnet-ui-2026-10-03/final-workspace.png), [recorded checks](assets/devnet-ui-2026-10-03/browser-checks.json), [desktop](assets/devnet-ui-2026-10-03/desktop.png), [phone](assets/devnet-ui-2026-10-03/mobile.png), [phone redemption](assets/devnet-ui-2026-10-03/mobile-redemption.png). The final production server is running at `http://127.0.0.1:3000`. The owner's connected extension-wallet approvals remain their next interactive test; no such test is claimed here.
