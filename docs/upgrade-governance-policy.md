# Upgrade governance policy

Status: **target policy approved; authority migration not executed**

Owner area: governance / security / release engineering

Mainnet gate: **blocked until the verification evidence in this document exists**

This document defines Basalt's V0 upgrade-governance target and the evidence
required to claim that target is active. It does not claim that a multisig or
timelock currently controls the deployed programs.

## Current verified boundary

The latest repository evidence was captured on 2026-09-04 and recorded one
single-key upgrade authority for all three devnet programs. That evidence is
dated, not a fresh RPC attestation. No multisig address, vault address,
threshold, signer public keys, timelock configuration, or successful authority
transfer has been independently verified for the current deployment.

Until fresh RPC evidence is published:

- treat the programs as upgradeable under a single-key authority;
- treat the whitelist authority as a separate privileged single-key role;
- treat program IDs shown by the app as declared addresses, not proof of the
  current program bytes or governance configuration; and
- do not describe BAS-006 as complete or Basalt as mainnet-ready.

Basket state remains immutable after creation. This upgradeability disclosure
does not change the V0 redemption invariant: `redeem_in_kind` is permissionless,
oracle-free, backend-independent, whitelist-independent, and never pausable.

## Target authority model

Basalt will use a dedicated, autonomous, hardware-wallet-backed **2-of-3
multisig** for V0 production governance.

The three signer roles are:

1. Protocol Maintainer — prepares releases and verifies build artifacts.
2. Security and Incident Lead — reviews invariants, incidents, and audit impact.
3. Operations and Release Lead — verifies deployment and public communication.

Each role must be controlled by a different person on an independently secured
hardware wallet. Browser hot wallets, shared seed phrases, cloud-hosted seeds,
and multiple keys controlled by one person do not satisfy this policy. The
2-of-3 threshold prevents unilateral upgrades without making one unavailable
signer a permanent lockout.

The multisig must be autonomous: no separate configuration authority may
unilaterally change members, threshold, or time-lock settings. The BPF upgrade
authority must be the multisig's **vault address**, not its multisig
configuration address. Actual signer and vault public keys are recorded only
after the governance ceremony; this document intentionally invents none.

The target vault controls:

- the upgrade authority for `whitelist`;
- the upgrade authority for `basket_factory`;
- the upgrade authority for `basket`; and
- `WhitelistConfig.authority`, transferred through the existing two-step
  `transfer_authority` / `claim_authority` flow.

`FactoryConfig.authority` is retained state, not an active V0 update path.
Basket constituents, weights, fees, creator, and metadata hash remain
immutable; governance receives no basket-update or vault-withdraw power.

## Time lock and announcement policy

Normal program upgrades require:

- 2-of-3 approval;
- a minimum **48-hour on-chain time lock** between the proposal reaching its
  approval threshold and execution; and
- a public announcement when the proposal enters the time lock.

The announcement must identify the affected program IDs, source commit and
release tag, current and proposed ELF SHA-256 hashes, interface or account
compatibility impact, migrations, test and audit status, known risks, rollback
plan, and affected user flows.

Emergency upgrades still require 2-of-3 approval and the same **48-hour
on-chain time lock**. Squads V4 stores one time-lock value on the multisig
account, so this policy does not claim a shorter per-proposal emergency delay.
An emergency proposal requires a public incident identifier and scope statement
when queued and a public postmortem within 24 hours after execution. There is
no single-signer or zero-delay bypass. During the delay, incident response may
pause admission or new mints through the whitelist where the existing program
permits it; it must never add a pause, oracle, backend, or governance gate to
redemption.

Signer, threshold, configuration-authority, and time-lock changes follow the
same approval and announcement rules. Making a program immutable with
`solana program set-upgrade-authority --final` is a separate, irreversible
decision and is forbidden by this migration policy.

## Rehearsal and migration sequence

Repository tooling may rehearse upgrade-authority mechanics only against an
ephemeral loopback validator with disposable keys. A placeholder authority in
that rehearsal is not evidence of a real 2-of-3 multisig or time lock.

The production sequence is:

1. Create the autonomous 2-of-3 multisig from the approved hardware-wallet
   signer set and record both the multisig address and vault address.
2. Verify the configured threshold, members, autonomy, and time locks from
   chain state.
3. Rehearse proposal, approval, delayed execution, rejected one-signer action,
   signer rotation, and rollback on localnet or an isolated test deployment.
4. Re-query every current devnet Program and ProgramData account immediately
   before migration.
5. Queue the three upgrade-authority transfers to the vault and transfer the
   whitelist authority through its two-step instruction.
6. Execute only after required approvals and delay; never use `--final`.
7. Verify the loader owner, executable flag, ProgramData address, upgrade
   authority, deployed slot, program bytes, and whitelist authority from RPC.
8. Publish the transaction signatures, configuration evidence, announcement,
   manifest, and source/artifact hashes with the release.

Mainnet authority migration requires an independently reviewed ceremony
runbook and explicit approval of the exact cluster, program IDs, signer public
keys, multisig address, and vault address. Local tooling must fail closed for
non-loopback RPC URLs.

## Completion evidence

BAS-006 is complete only when one evidence package contains:

- multisig and vault addresses plus all three signer public keys and roles;
- on-chain 2-of-3 threshold and autonomous-configuration proof;
- the verified global 48-hour time-lock configuration;
- a rehearsal transcript proving one signer and the former EOA cannot upgrade;
- delayed 2-of-3 proposal execution evidence;
- fresh RPC reads showing the vault as upgrade authority for all three programs;
- fresh readback showing the vault as `WhitelistConfig.authority`;
- deployed slots, program-data addresses, ELF hashes, source commit, and release;
- announcement and incident-policy URLs; and
- UI and deployment-manifest disclosure matching those verified facts.

Without that package, the honest status is “target policy defined; current
deployment governance not independently attested.”

## Operator references

- [Solana program deployment and upgrade authority](https://solana.com/docs/programs/deploying)
- [Solana CLI reference](https://solana.com/docs/references/solana-cli)
- [Squads multisig basics](https://docs.squads.so/main/basics/what-is-a-multisig)
- [Squads time locks](https://docs.squads.so/main/development/reference/time-locks)
- [Squads account model](https://docs.squads.so/main/development/reference/accounts)
- [Squads settings and vault-address warning](https://docs.squads.so/main/navigating-your-squad/settings)
- [Squads security practices](https://docs.squads.so/main/additional-resources/advanced-security-best-practices)
