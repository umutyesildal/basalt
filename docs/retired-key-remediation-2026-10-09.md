# Retired key and governance preparation — 2026-10-09

BAS-AUD-01 and BAS-AUD-04 have local guards, regression tests and a concrete
read-only preflight. Live treasury retirement and authority migration remain open
operational actions requiring the exact owner/signer approvals in the existing
[governance ceremony runbook](governance-ceremony-runbook.md). No live key material,
authority changes, program deployments or transactions were used for this patch.

## Permanently retired public identities

[The inventory](../scripts/security/retired-keys.json) contains only historical
paths, Git blob hashes and four exposed public identities:

| Historical role | Public key |
|---|---|
| devnet treasury | `AAb2TXLQCPFvnUoJFSBe9PFs28w5kvAukH4Gaiia3eiJ` |
| devnet user2 | `48CUGMWkw49EDkVQBq5TEb3M43oej9bJf7z8aF3zA3bg` |
| localnet payer | `6N9Pf5PGLYp45vrDfK6wTkHP6HeFqHB65akvXaXukbLA` |
| localnet user2 | `3UAR6aEz4GxVuCwrbUM938BNYg6dSrUTeJb6d7V6GJkT` |

Shared E2E loaders, devnet loaders, factory initialization, transaction send helpers,
managed localnet actor loading and the faucet recipient guard reject these identities.
New basket setup reads the immutable factory treasury and rejects retired treasury
reuse before signer loading/funding; the xStocks devnet basket harness rejects it
before account creation or signing. Fresh test key files use private permissions.
Browser transaction construction and create-ALT setup also read the canonical finalized FactoryConfig and reject a retired treasury before wallet callbacks. The browser imports the same public JSON inventory, with no Node filesystem code. All four retired identities, missing/wrong-owner/layout/bump/RPC failures and clean creation continuation are covered. Current devnet new creation is therefore blocked pending the clean release.
No bypass flag exists. The on-chain redeem instruction and public holder redemption
remain unchanged and permissionless.

`npm run check:secrets` scans every reachable Git-history/index blob, detects raw
Solana 64-byte JSON key arrays and private-key headers, refuses shallow history,
and prints only paths/blob IDs/public retirement metadata. Known compromised
historical blobs are recognized by immutable hash and never read; reuse in the
current index fails. Unexpected large text blobs fail closed. Large historical
compiler outputs are recognized by narrow ELF/Mach-O/ar/Rust metadata/RSIC headers,
not by skipping build directories or trusting compiled-looking filenames; a text
file named `.rlib` still fails. Recognized MP3 frames cover vendored media. The full
6,113-object scan reports zero new findings in [public evidence](security-evidence-2026-10-09/secret-history.json).
Gitleaks separately
covers general credentials. Deleting current files alone is not retirement; the
old public exposure remains acknowledged. This patch does not rewrite shared Git
history or claim the historical secrets have disappeared.

## Treasury containment and clean namespace

The V0 FactoryConfig is a singleton PDA and its treasury is immutable; new baskets
inherit it. Existing baskets also embed their immutable treasury. Changing a local
state file or selecting a new payer cannot replace the current devnet treasury.
Do not add a mutable treasury setter, admin withdrawal, or redemption restriction.

Before further public new-basket deployment, the operator must inventory/fence the
four exposed identities, choose owner-approved fresh hardware/governance public
identities, and deploy a clean program/factory namespace with a fresh treasury.
That separate release must update every cross-program compiled ID, Anchor config,
client program map and public deployment evidence consistently. The current branch
does not invent replacement IDs or migrate assets. Legacy basket holders retain
oracle-free pro-rata redemption on their original immutable deployment. Any rescue
or residual treasury-fee handling is a separate human-controlled incident action;
never load compromised private keys in agent tools.

## Unsigned governance preflight

Start with [the public JSON template](../scripts/security/governance-ceremony.example.json).
Its absent source/release/multisig/vault/signers/approvals are intentional blockers.
Fill real values only after three independent hardware-wallet owners and the owner
approve the exact runbook record. Signers each need publicKey, one required role,
hardwareWallet=true and permission mask7 (Initiate/Vote/Execute). Approval records
contain ticket references and public keys only; they are not signed transactions.

```sh
node scripts/security/governance-preflight.mjs --record /absolute/path/public-ceremony.json
node scripts/security/governance-preflight.mjs --record /absolute/path/public-ceremony.json --rpc-url https://api.devnet.solana.com
```

The preflight strictly checks canonical program/current-authority IDs, the pinned
Squads V4 program/SDK2.1.4 layout, three independent signer roles, autonomous config,
2-of-3 threshold,172800-second timelock, and independently derives vault index0.
Optional finalized RPC reads verify devnet genesis, all three current upgrade
authorities, current/pending whitelist authority, Squads owner/discriminator/PDA,
member public keys/permissions, threshold, autonomy and on-chain timelock. It only
allows getGenesisHash/getMultipleAccounts and has no signer or submission API.
Even a passing report says executionAuthorized=false; exact human ceremony approval
and transaction review remain separate. Missing approvals/RPC evidence exit nonzero.

Squads decoding/PDA inputs were checked against the
[official source](https://github.com/Squads-Protocol/v4/blob/af94153ff77a28b6effe46b9c94baaa93742b48c/programs/squads_multisig_program/src/state/multisig.rs)
and [official vault derivation](https://github.com/Squads-Protocol/v4/blob/af94153ff77a28b6effe46b9c94baaa93742b48c/sdk/multisig/src/pda.ts).
Mocked read-only account tests prove success plus fail-closed policy/member/authority
checks without creating fake operational signer identities. Existing runbook
approvals, transfer/claim ordering,48-hour timelock proof, rollback and final evidence
remain the authoritative execution requirements; never use --final.
