# Deployment attestation

Basalt keeps the v2 manifest shape in `deploy/deployment-manifest.schema.json` and
the human-editable starting point in `deploy/deployment-manifest.template.json`.
The generator reads the selected cluster from `Anchor.toml`, captures the git
commit, toolchain versions, all three npm lock hashes, and any SBF ELF files
present in `target/deploy/`. It does not contact an RPC endpoint or upload
artifacts.

Generate a reviewable manifest to stdout:

```bash
npm run manifest -- --environment devnet --cluster devnet
```

For a byte-for-byte reproducible output, pin the timestamp and write to a file:

```bash
SOURCE_DATE_EPOCH=1726617600 npm run manifest -- \
  --environment devnet \
  --cluster devnet \
  --generated-at 2024-09-18T00:00:00.000Z \
  --output /tmp/basalt-deployment-manifest.json
```

`--upgrade-authority` and `--deployed-slot` are intentionally explicit inputs.
Until a post-deploy RPC verifier supplies them, the generated manifest marks the
deployment `not-attested` and records both values as `null`. Manifest v2 also
records an authority model and evidence source, per-program authority state,
multisig address/threshold/signers, time lock, announcement period, and transfer
rehearsal. Its safe defaults are `unknown` and `not-run`.

The offline generator may record a declaration, for example a complete
multisig configuration:

```bash
npm run manifest -- \
  --authority-model multisig \
  --upgrade-authority <SQUADS_VAULT_ADDRESS> \
  --multisig-address <SQUADS_MULTISIG_CONFIG_ADDRESS> \
  --threshold 2 \
  --signer-count 3 \
  --signer 'Protocol Maintainer=<PUBKEY>' \
  --signer 'Security and Incident Lead=<PUBKEY>' \
  --signer 'Operations and Release Lead=<PUBKEY>' \
  --timelock-status configured \
  --timelock-delay-seconds 172800 \
  --announcement-seconds 172800 \
  --governance-policy-url https://example.com/governance
```

Those values are labeled `operator-declaration` and deployment status
`attested-inputs`; the generator refuses `authoritySource=rpc`, a verified time
lock, unsafe multisig thresholds, incomplete signer disclosure, and use of the
multisig configuration address as the vault authority. Only a separate verifier
that actually reads Program and ProgramData accounts may emit `verified`/`rpc`
evidence. The vault and multisig configuration addresses are different; setting
the configuration address as program authority can make authority unusable.

Optional container digests can be supplied through `BASALT_IMAGE_DIGESTS`, for example:

```bash
BASALT_IMAGE_DIGESTS='{"backend":"sha256:..."}' \
  npm run manifest -- --cluster devnet --output /tmp/basalt-manifest.json
```

The manifest is evidence, not a signature. ELF hashes prove only which local
files were present at generation time; program IDs read from `Anchor.toml` do
not prove that matching binaries are deployed on-chain. Before a devnet or
mainnet release, an operator must verify program data, upgrade authorities, and
the deployed slot against the selected RPC, then publish the generated JSON
with the release artifacts.

The finalized read-only audit in
`docs/devnet-governance-audit-2026-09-19.md` records the current devnet
ProgramData addresses, deploy slots, program upgrade authorities, and separate
whitelist configuration authority. It confirms the current single-key
governance risk, but it is not an ELF-to-source attestation and does not turn
operator-declared manifest fields into verifier-produced evidence.

For the policy, ceremony sequence, and evidence required to close the
single-key upgrade risk, see `docs/upgrade-governance-policy.md`. The
loopback-only `scripts/rehearse-governance-localnet.sh` proves transfer,
former-authority rejection, executable state, ProgramData stability, and
rollback with disposable keys. The three-artifact 2026-09-19 result is recorded
in `docs/local-governance-rehearsal-2026-09-19.md`. It is not proof of a real
multisig threshold or time lock and must never be published as production
governance evidence.
