# Contained devnet owner bootstrap

This is a separate **devnet/mock-only single-owner preparation policy**. It does not satisfy the production governance policy, authorize deployment, attest an owner's custody, or enable basket creation. Mainnet still requires independently controlled hardware-wallet 2-of-3 governance and the full 48-hour on-chain timelock in [upgrade-governance-policy.md](upgrade-governance-policy.md). The existing Squads ceremony validator and [clean multisig bootstrap plan](clean-devnet-bootstrap-plan.md) retain their original requirements.

The owner authorized fresh isolated software bootstrap/program identities. Their public record is [devnetOwnerPolicy.json](../backend/src/config/devnetOwnerPolicy.json); no private key is part of that file. The proposed owner is `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea`. **The treasury is the owner-selected `TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea`; owner role acceptance remains pending until the genuine wallet signs.** Supplying a public address, a review reference or a destination in an authority-transfer instruction is not proof that its owner approved or signed anything.

## Boundaries

- Use only the full canonical devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` and the exact new trio in the source-controlled public policy. There is no mainnet or arbitrary-program override.
- Software bootstrap and program identity keys stay in isolated private storage outside the repository. They are never backend/application secrets or custody keys. Never print private arrays, paths containing credentials, seed phrases or RPC tokens in evidence.
- Admit only verified project-issued devnet mocks. Raw Token-2022 transfers, immutable baskets and oracle-free permissionless redemption remain unchanged. Mocks have no asserted USD value or official xStocks backing.
- Do not write to, upgrade or reset legacy programs/accounts, change old immutable treasuries, erase financial claims, or activate historical recovery. Legacy redemption remains available.
- Disclose the resulting single-owner upgrade and whitelist control, the temporary bootstrap interval, and the absence of multisig/timelock. Do not describe independent hardware custody or production governance as verified.

## Public plan

```bash
node scripts/security/devnet-owner-bootstrap.mjs --template
node scripts/security/devnet-owner-bootstrap.mjs
node scripts/security/devnet-owner-bootstrap.mjs --record /absolute/path/public-owner-plan.json
node scripts/security/devnet-owner-bootstrap.mjs --record /absolute/path/public-owner-plan.json --verify-empty
```

Template mode prints known source-controlled public identities and pins the selected public treasury and leaves human acceptance and release references pending. It exits 0. Every plan/evidence mode exits 2: `executionAuthorized`, `deployable`, `creationReady`, `mainnetApproved`, `multisigApproved` and `ownerControlVerified` remain false, even with filled review declarations or successful vacancy evidence. Invalid inputs exit 1 without echoing their contents. No command generates or loads keys, serializes/signs/submits transactions, edits source or changes chain state.

A public record may add the inspected checkout's exact `sourceCommit`, a public `releaseTag`, a nonretired `treasury`, `ownerRoleAcceptance`/`treasuryAcceptance` set to `accepted`, and an `ownerAcceptanceReference` after the corresponding human decision. These fields record declarations only. The owner, bootstrap and program identities must match the source policy. The parser rejects unknown/private fields, key arrays, role collisions, legacy/retired identities and false execution, multisig or production claims.

The optional vacancy proof uses only `getGenesisHash` and `getMultipleAccounts` against the fixed official devnet RPC. It requires all three Program accounts, their canonical ProgramData PDAs and both singleton configs to be absent at one valid finalized context. A single 15-second overall deadline and 128KiB per-response limit also cover stalled fetch/body reads. This proves vacancy at that observation only; it proves no future vacancy, owner custody, balances, deployed bytes, transaction approval or resumability.

## Exact source and artifact binding

The clean build requires explicit `owner-devnet` features and the separate [Anchor.owner-devnet.toml](../Anchor.owner-devnet.toml). The default declarations and [Anchor.toml](../Anchor.toml) retain the existing legacy IDs. The factory feature propagates the corresponding whitelist and basket features, including the basket's compiled factory/whitelist trust constants. An environment variable cannot change these bindings.

The planner checks active source declarations, Cargo feature propagation/defaults, both Anchor identity maps and the current canonical loader initialization guards, then hashes the inspected source/lock/policy files. Comments, documentation strings and inactive TOML declarations cannot supply these bindings. Text inspection and source hashes are **not** compiler or deployed-byte attestation. The exact release still needs frozen dependency/test gates, all three feature-specific SBF ELFs, corresponding IDLs and independently verified loader-owned Program/ProgramData bytes. The prepared namespace must stay outside the active registry and creation disabled until its separate reviewed deployment/activation conditions hold.

## Real signing sequence

| Action | Required control and evidence |
|---|---|
| Deploy the fresh trio | Approved fee payer, each new Program-account signer, and buffer/current upgrade-authority signer. Verify exact source/ELF hashes, canonical loader relationship and current authority. |
| Initialize whitelist/factory | The **current loader authority** must sign and pay initialization rent. Canonical self-program and ProgramData guards reject arbitrary first callers, wrong loader/PDA and immutable/no-authority programs. |
| Record owner in factory | If `FactoryConfig.authority` must equal the owner, first transfer the factory loader authority, then have the owner initialize. There is no setter; initialization by bootstrap permanently records bootstrap as an inactive authority field. |
| Hand off loader control | Prefer `SetAuthorityChecked`: bootstrap and owner both sign, then read all three finalized ProgramData authorities. Ordinary unchecked transfer requires only bootstrap and cannot prove owner acceptance. Never use `--final`. |
| Hand off whitelist control | Bootstrap signs `transfer_authority(owner)`; the owner signs `claim_authority`. Pending authority alone is not completion. Read back owner authority and no pending successor. |
| Select immutable treasury | Initializer signs the factory instruction using the accepted public recipient. Recipient signing is not required to receive fees; its public address does not establish custody or acceptance. |

Do not ask the owner to reveal a private key. Owner-dependent steps require their own reviewed wallet signature. Once authority is handed off, a software bootstrap cannot perform owner-only initialization or whitelist actions. Retain rollback/evidence material and verify former-authority rejection rather than treating deletion of a local key as revocation.

Before enabling creation, complete a real isolated validator initialization/front-run/rollback rehearsal; a host-account fixture alone does not prove validator/System rollback. After each separately authorized devnet action, verify exact finalized authority/config/treasury and deployed-byte evidence. Then prove clean create/mint/redeem and legacy redemption with the reviewed mocks. Human authorization of those concrete transactions is separate from this unsigned planner.

## Focused verification

The planner's eleven Node regression cases cover pending shared policy, explicit declarations without authority claims, derived canonical PDAs, strict mainnet/retired/private-field rejection, source hashes and inactive source-binding spoofing, fixed finalized public reads, oversized/stalled transport bounds, and safe CLI statuses. They do not perform live RPC, sign transactions, initialize a validator, deploy programs or prove owner wallet control.


The [2026-10-09 isolated-validator receipt](assets/devnet-owner-bootstrap-2026-10-09/local-validator-init.json) records **12 actual runtime initialization cases**, six each for whitelist and factory, using all three compiled `owner-devnet` ELF artifacts. Funded wrong authority, nonsigner authority, wrong self program and wrong canonical ProgramData attempts all landed as failed transactions; the canonical singleton remained absent after each rollback. The current local authority initialized the expected owner/config/fee/bump bytes successfully, and repeated initialization failed without changing those bytes.

Solana-test-validator 1.18.26's `--upgradeable-program` genesis path marked ProgramData executable in this environment. The successful rehearsal instead loaded canonical public Program/ProgramData genesis fixtures with the exact ELF bytes and proper `executable=false` ProgramData flag, loader owner/tag/pointer and a freshly generated disposable **local** authority. This is real SBF initialization/System rollback execution, **not** a loader-deployment rehearsal or devnet byte attestation. The receipt binds artifact hashes and both compiled-copy/reviewed-working-tree source hashes; its base commit is explicitly marked dirty, not claimed as a committed release. The validator was stopped and its disposable ledgers removed. Actual bootstrap/program private keys were not read, no remote transactions were sent, and owner control, hardware custody, multisig and mainnet approval remain unproven.

## Funded completion on October 10

The owner supplied devnet funding and authorized finishing the isolated setup. The remaining factory and basket programs were deployed and all three canonical loader relationships, exact executable prefixes, zero padding, deployment slots and current bootstrap authority passed finalized verification. See [the funded completion record](devnet-owner-completion-2026-10-10.md) and [the strict deployment proof](evidence/owner-deployed-programs-public-proof-2026-10-10.json).

The completion path is owner-first: one durable-nonce transaction transfers all three loaders with `SetAuthorityChecked`, requiring bootstrap and owner signatures. A second owner-signed setup transaction initializes the two singletons and admits the four fixed project mock mints. The factory records the actual owner as initializer, the explicitly selected treasury, the 90/10 fee split and canonical caps. The old bootstrap-first operator remains separate and must not substitute for this path.

`scripts/devnet-owner-handoff.ts` prepares a public partially signed import package from an already reviewed nonce. It never creates nonce accounts or submits anything. The reviewed browser setup pins exact deployed ELF hashes and slots as well as public roles, nonce state, instruction bytes, account privileges and signatures. Package preparation is not owner acceptance or completed handoff. Namespace activation and new-basket tests remain separate gates.
