# Upgrade-governance ceremony runbook

Status: **reviewable runbook; not authorized for execution**

This runbook defines the evidence and stop conditions for moving Basalt from
the verified single-key devnet state to the approved autonomous 2-of-3 Squads
V4 vault with a global 48-hour on-chain time lock. It is not an authorization
to create a multisig, submit a proposal, transfer an authority, or upgrade a
program.

No operator or agent may execute a state-changing step until the owner and the
three human signers approve the exact values in the authorization record below.
Mainnet is out of scope unless a separate, explicit mainnet authorization names
the cluster, addresses, release, and signers.

## Non-negotiable protocol boundary

- Basket constituents, weights, fee schedule, creator, and metadata hash remain
  immutable.
- `redeem_in_kind` remains permissionless, oracle-free, backend-independent,
  whitelist-independent, and unpausable.
- No step may use `solana program set-upgrade-authority --final`.
- The Squads **vault address**, never the multisig configuration address, must
  become each authority.
- The multisig must be autonomous: its configuration authority is the default
  public key, so member, threshold, and time-lock changes also require the
  normal proposal process.
- The threshold is exactly 2-of-3 and the global time lock is exactly `172800`
  seconds.

## 1. Authorization record

Copy this block into the private ceremony ticket and replace every placeholder.
The ticket must be approved before any write transaction is built. Public keys
and transaction signatures may later be published; seed phrases, private keys,
hardware-wallet recovery material, RPC API keys, and session tokens must never
be recorded.

```text
CEREMONY_ID=<PUBLIC_INCIDENT_OR_RELEASE_ID>
CLUSTER=devnet
RPC_ORIGIN=<SCHEME_AND_HOST_ONLY; NO API KEY>
SOURCE_COMMIT=<40_HEX>
RELEASE_TAG=<TAG>

WHITELIST_PROGRAM=FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS
FACTORY_PROGRAM=3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF
BASKET_PROGRAM=6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k
WHITELIST_CONFIG=ESRwG8qoKaLM17dLEM6MJDRpKVYtkd9M2zUmbud2uXZd
EXPECTED_CURRENT_AUTHORITY=y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE

SQUADS_PROGRAM_ID=<EXACT_PROGRAM_ID>
SQUADS_VERSION=<PINNED_VERSION>
MULTISIG_CONFIG_ADDRESS=<EXACT_ADDRESS>
VAULT_INDEX=0
VAULT_ADDRESS=<EXACT_ADDRESS; MUST_DIFFER_FROM_MULTISIG_CONFIG_ADDRESS>
CONFIG_AUTHORITY=11111111111111111111111111111111
THRESHOLD=2
SIGNER_COUNT=3
TIME_LOCK_SECONDS=172800

PROTOCOL_MAINTAINER_PUBKEY=<HARDWARE_WALLET_PUBKEY>
SECURITY_INCIDENT_LEAD_PUBKEY=<HARDWARE_WALLET_PUBKEY>
OPERATIONS_RELEASE_LEAD_PUBKEY=<HARDWARE_WALLET_PUBKEY>
PROTOCOL_MAINTAINER_PERMISSIONS=<APPROVED_SQUADS_PERMISSIONS>
SECURITY_INCIDENT_LEAD_PERMISSIONS=<APPROVED_SQUADS_PERMISSIONS>
OPERATIONS_RELEASE_LEAD_PERMISSIONS=<APPROVED_SQUADS_PERMISSIONS>

ANNOUNCEMENT_URL=<PUBLIC_URL>
GOVERNANCE_POLICY_URL=<PUBLIC_URL>
AUDIT_REPORT_URL=<PUBLIC_URL_OR_EXPLICIT_PENDING_BLOCKER>
ROLLBACK_RELEASE=<AUDITED_RELEASE_TAG_AND_HASH>
```

Required approvals:

- [ ] Owner approves the exact cluster and every address above.
- [ ] Each signer confirms their own public key on the hardware-wallet screen.
- [ ] Two independent reviewers derive the vault from the multisig config and
      vault index and obtain the same address.
- [ ] Security reviewer confirms the vault and multisig config addresses differ.
- [ ] Release reviewer confirms source, local ELF hashes, and buffer/deployed
      bytes through the reproducible-attestation process.
- [ ] Counsel/release owner confirms the public announcement wording.

## 2. Read-only preflight

1. Start from a clean, pushed commit with green hosted CI.
2. Pin the Squads CLI or SDK version and record its integrity hash.
3. Generate the offline deployment manifest. Do not claim RPC verification from
   operator-declared inputs.
4. Run the read-only deployment verifier at `finalized` commitment with the
   expected current authority. It must confirm all three Program/ProgramData
   pairs and the separate `WhitelistConfig` authority.
5. Independently inspect every address in a second interface. Do not trust one
   browser session, one RPC response, or one pasted address.
6. Confirm there is no pending whitelist authority and no unaccounted program
   buffer controlled by the current release key.

Abort if any observed authority, ProgramData address, program owner,
executable flag, deployed slot, whitelist owner, or source/artifact hash differs
from the reviewed record.

## 3. Create and verify the autonomous multisig

This is a state-changing operation and requires the approved signer set.

1. Create the Squads V4 multisig with exactly the three approved members and
   threshold 2. Every member must have the Voter permission; proposer/executor
   permissions must match the approved matrix rather than being assumed.
2. Set no unilateral configuration authority. Squads documents the default
   public key as the autonomous configuration.
3. If the creation path starts with a zero time lock, use the autonomous config
   proposal flow to set `time_lock = 172800` before the vault receives any
   Basalt authority.
4. Read the multisig account directly from chain and verify:
   - config authority is the default public key;
   - threshold is 2;
   - exactly the three approved member public keys are present;
   - permissions match the approved matrix;
   - `time_lock` is `172800`; and
   - the independently derived vault index 0 address matches the approved vault.

The Squads multisig account stores threshold, members, config authority, and one
global `time_lock`. The vault is a different PDA. Squads explicitly warns that
setting the multisig config address as an asset or program authority can cause
irreversible loss.

## 4. Full isolated rehearsal

The existing repository rehearsal proves Upgradeable Loader transfer mechanics
with a placeholder key. It does not satisfy this stage.

Use an isolated deployment and the real approved signer public keys to prove:

1. The current test authority can transfer a disposable program authority to
   the approved vault.
2. The former authority is rejected after transfer.
3. One signer cannot make a proposal ready or execute it.
4. Two distinct voters can make the proposal ready.
5. Execution is rejected before 48 hours have elapsed from readiness.
6. Execution succeeds only after the full on-chain delay.
7. A harmless upgrade or authority rotation through the vault preserves the
   ProgramData relationship and expected executable state.
8. A signer-rotation/config-change rehearsal also requires normal approval and
   the global delay.
9. The reviewed rollback release can be proposed and executed through the same
   controls; there is no unilateral emergency bypass.

Publish proposal, approval, readiness, rejected-early-execution, delayed
execution, former-authority rejection, and post-state signatures. A screenshot
alone is not evidence. The 48-hour condition cannot be replaced with a shorter
local wait while claiming production-policy coverage.

## 5. Devnet migration

1. Publish the announcement and freeze unrelated deploy/config operations.
2. Repeat the finalized read-only preflight immediately before signing.
3. The verified current authority transfers each of the three Upgradeable
   Loader authorities directly to the exact Squads vault. Record and confirm
   each signature before proceeding. This bootstrap transfer is signed by the
   current authority; the vault time lock governs transactions after the vault
   owns the authority.
4. The verified current whitelist authority calls `transfer_authority` with the
   exact vault, creating a pending authority. It does not make the vault current
   authority yet.
5. Build `claim_authority` as a Squads vault transaction. Obtain two distinct
   approvals, wait the full 48-hour on-chain delay, then execute from the vault.
6. Stop immediately on partial failure. Do not improvise a new address, lower
   the threshold, disable the time lock, use the multisig config address, or
   make programs immutable. Any recovery after a program authority reaches the
   vault must use the approved vault process.

## 6. Post-migration verification

At finalized commitment, verify and publish:

- all three Program accounts are owned by the Upgradeable Loader and executable;
- every Program account points to the expected ProgramData account;
- every ProgramData account reports the exact vault as upgrade authority;
- `WhitelistConfig.authority` is the exact vault and pending authority is null;
- the multisig is autonomous, 2-of-3, has the approved members/permissions, and
  reports a global 172800-second time lock;
- the vault derives from the multisig config at the approved index;
- deployed program bytes match the reviewed artifact/source attestation; and
- the app, agent surfaces, manifest, release notes, and governance evidence all
  describe the same state.

## 7. Required evidence package

- [ ] Completed authorization record and reviewer approvals.
- [ ] Multisig creation and time-lock configuration signatures.
- [ ] Direct chain read of multisig config, members, permissions, threshold,
      config authority, time lock, vault derivation, and Squads program owner.
- [ ] Full isolated 2-of-3 delayed rehearsal transcript.
- [ ] Three program-authority transfer signatures.
- [ ] Whitelist `transfer_authority` and delayed vault `claim_authority`
      signatures.
- [ ] Finalized post-transfer verifier output.
- [ ] Source commit, release tag, local ELF hashes, buffer hashes, and deployed
      byte attestation.
- [ ] Public announcement, policy, audit, and rollback references.
- [ ] Independent reviewer sign-off that no secret material was published.

BAS-006 remains open until this package is complete. The current verified state
is single-key governance, not an unverified state and not the target multisig
state.

## Official references

- [Solana program deployment and authority management](https://solana.com/docs/programs/deploying)
- [Solana CLI reference](https://solana.com/docs/references/solana-cli)
- [Squads V4 accounts and autonomous config authority](https://docs.squads.so/main/development/reference/accounts)
- [Squads V4 time locks](https://docs.squads.so/main/development/reference/time-locks)
- [Squads settings: vault versus multisig address](https://docs.squads.so/main/navigating-your-squad/settings)
- [Squads security practices](https://docs.squads.so/main/additional-resources/advanced-security-best-practices)
- [Squads V4 CLI commands](https://docs.squads.so/main/development/cli/commands)
