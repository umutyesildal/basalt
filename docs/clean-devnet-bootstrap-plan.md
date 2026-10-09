# Clean devnet creation bootstrap — unsigned preparation

This prepares a separate, clean **devnet** creation namespace. It does not deploy programs, create a multisig, change authorities, load a signer, transfer tokens, or enable Create. Existing legacy basket accounts remain immutable and their oracle-free redemption must stay available.

## Why a clean namespace is necessary

The existing `FactoryConfig` is the singleton PDA `[b"factory"]` under the deployed factory program. `init_factory` uses Anchor `init`; there is no treasury setter, close, reset or re-init instruction. Its retired treasury therefore cannot be replaced by choosing a new payer, a different nonce or an arbitrary factory PDA. Every existing basket retains its original treasury.

A new factory alone cannot use the unchanged existing basket program: `basket::FACTORY_PROGRAM_ID`, its canonical factory signer, basket PDA derivation and `init_basket` checks pin the current factory ID. At least a new factory/basket pair is necessary. Reusing the existing whitelist is technically possible with an explicitly reviewed shared-governance policy. The preparation tool deliberately selects a fully separate **whitelist + factory + basket trio**, avoiding an in-place upgrade of any legacy binary.

A fresh singleton previously admitted any first signer. A competing caller could initialize the immutable treasury or whitelist authority before the legitimate operator. The source now adds an init-only loader authorization guard to both `InitConfig` and `InitFactory`:

- `Program<Whitelist/BasketFactory>` requires the exact compiled self program ID and an executable account.
- The self program must be owned by the upgradeable loader and point to the supplied ProgramData account.
- ProgramData must be loader-owned, deserialize as ProgramData, and be the canonical PDA `[program ID]` under that loader.
- `upgrade_authority_address` must equal `Some(authority signer)`; a finalized program with `None` cannot initialize.

The guard appends two readonly instruction accounts after the existing config, signer and System accounts. Instruction data and config layouts remain unchanged. Existing add/pause/transfer/create/mint/redeem operations do not acquire new accounts. No treasury mutation mechanism was added. This is **source preparation**: current live devnet binaries have not been upgraded and must not be described as having this guard.

## Public input still required

The repository currently contains an unfilled ceremony example, not a real signer record. The owner must supply:

| Input | Purpose |
|---|---|
| Three independent hardware-wallet **public** addresses, one for each role | Protocol maintainer, security/incident lead and operations/release lead; each acknowledges independent custody |
| A clean treasury **public** recipient and owner acceptance | Immutable recipient for newly created baskets; no retired identity may be reused |
| Three new deployable program **public** IDs | Their owners retain the corresponding signing material; the planner does not create or read it |
| Explicit bootstrap upgrade-authority **public** identity and payer/operator assignment | Authenticates guarded initialization; may be the approved vault, or an explicitly reviewed bootstrap signer |
| Proposed/created Squads multisig and vault **public** identities | Autonomous 2-of-3, permissions 7, vault index 0, full 172800-second timelock under pinned Squads V4 program/SDK |
| Exact source commit, release tag, owner and all signer review references | Binds the reviewed plan to a specific release; references are not cryptographic approvals |

Never send seed phrases, keypair files, secret arrays or private keys in the public record. A self-declared hardware field is not proof of custody; independent human confirmation and the actual ceremony remain necessary.

## Generate a reviewable plan now

```bash
node scripts/security/clean-devnet-bootstrap.mjs
node scripts/security/clean-devnet-bootstrap.mjs --template
```

The first command reports missing public inputs, actual source file SHA-256 values, verified one-based patch locations, cross-program bindings, legacy preservation obligations and the signing sequence. It exits 2 while required work remains. Template mode exits 0 and leaves every unknown public identity null. Neither command changes a file or contacts RPC.

After actual owners complete a **public-only** template for the checkout's exact HEAD:

```bash
node scripts/security/clean-devnet-bootstrap.mjs --record /absolute/path/public-clean-devnet.json
node scripts/security/clean-devnet-bootstrap.mjs --record /absolute/path/public-clean-devnet.json --verify-empty
```

The optional vacancy check contacts only the fixed official devnet RPC. It verifies the full canonical devnet genesis, then requires all three new program accounts, their canonical loader PDAs and the two new singleton configs to be absent at a valid finalized slot. It can call only `getGenesisHash` and `getMultipleAccounts`, with a 15-second deadline and 128KiB response cap. Occupied identities fail closed; this is a new-namespace planning check, not a resume/deployment operation. It does not prove future account vacancy, treasury custody, Squads state, deployed ELF bytes or transaction authorization.

All plan modes keep `executionAuthorized`, `deployable` and `creationReady` false, including when review references and vacancy evidence are present. Source hashes bind inspected text; they are not build/deployed-byte attestation. The tool never rewrites source or serializes/signs/submits transactions. Its allowed public fields reject accidental key-material fields and keypair-array records.

## Source and legacy integration work

The tool verifies exact current declarations before proposing patch locations in the three Rust programs and both Anchor cluster mappings. The future reviewed release must update **all** compiled cross-program bindings, regenerate IDLs/build artifacts, and repeat frozen dependency, Rust, SBF and TypeScript/security gates. Changing environment variables alone cannot change the compiled factory/whitelist trust rules.

The current app and backend each trust one fixed trio. A global replacement of `app/lib/solana.ts` would make legacy owner/PDA/share-mint/vault checks reject existing baskets and could hide their redemption path. Before reopening Create, introduce an explicit, audited namespace registry:

- Creation uses only the clean trio and checks its immutable clean treasury immediately before preparation/signing.
- Reads and redemption resolve the exact supported namespace from authenticated basket owner/factory/PDA evidence; they retain the current legacy trio.
- Backend discovery, canonical history, positions, holdings, readiness and rollout verification preserve both namespace identities and durable cursors without accepting arbitrary emitters or mixing their factory/whitelist roles.
- Legacy basket redemption remains permissionless and oracle-free. A retired treasury guard restricts **new creation**, never a holder's withdrawal.

This routing work is a prerequisite recorded by the planner, not implemented by the bootstrap tooling. Mainnet approval and program upgrades are separate scopes.

## Human signing sequence

1. Independently inspect the actual Squads account, three member addresses/permissions, autonomous config authority, 2-of-3 threshold, 48-hour delay and derived vault. Fund approved fee/rent payers without using retired identities.
2. Review the source/IDL/ELF manifest and deploy the clean trio at the three approved new IDs. Verify canonical loader metadata and actual deployed bytes. Leave legacy binaries/accounts untouched.
3. Initialize the clean whitelist and factory using their current loader upgrade authority. Review the immutable clean treasury, canonical 9000 split and 300/100/300 fee caps. If the vault is already upgrade authority, initialization must be executed by its approved CPI proposal after the complete timelock; an ordinary external transaction cannot sign for a vault PDA.
4. Admit existing verified devnet mock mints to the new whitelist. Preserve raw Token-2022 accounting and label all mocks as having no market value.
5. If an EOA bootstrapped the programs, move all new loader upgrade authorities to the approved vault and perform whitelist `transfer_authority` then vault `claim_authority`. A loader transfer into the vault is signed by the current authority; the destination's timelock begins governing only after that transfer. FactoryConfig.authority remains an immutable initialization record with no setter.
6. Complete independent two-member/full 48-hour governance rehearsal, former-EOA rejection, rollback/rotation checks, clean create/mint/redeem tests and legacy redemption tests. Reverify finalized public evidence and source/deployed hashes. Only then may the supported UI enable creation for the clean namespace.

See [governance ceremony runbook](governance-ceremony-runbook.md), [retired-key remediation](retired-key-remediation-2026-10-09.md) and [upgrade policy](upgrade-governance-policy.md) for the real signer/ceremony requirements. The earlier local placeholder-key rehearsal proves loader mechanics only; it does not prove Squads threshold or48-hour behavior.

## Verification scope

The focused Node tests cover missing public inputs, strict policy/retired-key rejection, derived canonical addresses, stale source bindings, safe CLI statuses and bounded read-only vacancy verification. Raw builder tests check the exact new readonly self/ProgramData accounts and unchanged instruction data.

The Rust host fixtures call each **production Anchor-generated `try_accounts`** and handler for a valid current authority plus nonsigner, wrong authority, wrong self program, nonexecutable program, wrong loader, wrong loader pointer, wrong ProgramData PDA/owner/state, matched noncanonical loader/ProgramData pair, truncation, immutable/no authority and missing ProgramData. Only System account creation is stubbed; the fixtures do not reproduce loader deployment, System account lifecycle, transaction rollback, competing validator transactions or Squads execution. Real local-validator/Squads rehearsal and exact-release SBF compilation remain explicitly required before any fresh devnet deployment.

A read-only official-devnet observation at 2026-10-09T15:40:22Z, finalized slot 509226985, still found the existing y72... upgrade/whitelist authority and the retired AAb2... immutable factory treasury with 10 baskets. This observation contains public metadata only and does not attest deployed ELF bytes or governance activation.
