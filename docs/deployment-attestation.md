# Deployment attestation

Basalt keeps the manifest shape in `deploy/deployment-manifest.schema.json` and
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
deployment `not-attested` and records both values as `null`. Optional container
digests can be supplied through `BASALT_IMAGE_DIGESTS`, for example:

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
