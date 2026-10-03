# Basalt Token-2022 policy

An allocation-free, `no_std`, dependency-free parser for basket admission and deposit validation. It is intentionally separate from Anchor instruction construction. See [the policy decision](../../docs/xstocks-token-policy-decision-2026-10-03.md) for the explicit issuer trust model.

## Source of the wire layouts

This is not a inferred-prefix or best-effort parser. Base state, extension IDs, field order, exact lengths and Borsh metadata encoding follow the published official `spl-token-2022-interface` **1.0.0**, commit `690985e54d84b428ea4a37b6735192cf2f89d601`, with `spl-token-metadata-interface` **0.7.0**. [Layout provenance](tests/fixtures/upstream-layouts.json) pins crate checksums and individual source hashes. [Official source at that commit](https://github.com/solana-program/token-2022/tree/690985e54d84b428ea4a37b6735192cf2f89d601/interface/src).

The parser deliberately tightens some permissive upstream iteration behavior: duplicate extension types are rejected; every admitted entry's full payload is decoded; a zero TLV terminator must be followed only by zero allocation padding; unsupported types and incomplete privileged profiles are rejected. It preserves canonical COption behavior: unused payload bytes behind a `None` tag need not be zero. The 355-byte multisig ambiguity is rejected, matching upstream base-state unpacking.

Modern dependency probes could not be used safely alongside the current Anchor 0.30.1/Solana 1.18.26 tree. Interface 1.0.0 requires an incompatible `zeroize` range via the modern ZK SDK. Interface 3.1.2 cannot resolve against the exact legacy SDK pins; relaxing pins causes older SPL packages to drift and fail type checking. The shared crate adds **no external packages** and no Solana types cross its API boundary. Future replacement with official typed interfaces requires a coordinated dependency upgrade and the same acceptance tests.

## API boundary

- `validate_mint(data, mint_key)` returns `MintPolicyInfo` with actual decimals, `Plain`/`DisplayOnly`/`IssuerControlled` profile and risk flags.
- `validate_token_account(data)` returns exact mint bytes, owner bytes and raw amount after account-state/extension validation.
- Both return local `PolicyError` variants. Neither trusts a ticker or claims an issuer identity.
- The caller must verify actual Token-2022 account ownership, authority-controlled whitelist membership and the expected mint/owner/canonical ATA. The function's `owner` result is the token account's owner field, not its owning Solana program.
- Use on whitelist admission, seed/create and mint deposits. Do not add either policy validator as a new redemption gate.

The full eight-extension issuer profile accepts an inactive TransferHook, unpaused Pausable config, PermanentDelegate and ConfidentialTransferMint configuration. It does not support an active hook, confidential token accounts or fees. Issuer powers can still prevent transfers or affect backing. A share represents a pro-rata claim on actual raw holdings; an underlying issuer can impose transfer restrictions. Raw amount arithmetic never uses a display multiplier.

## Evidence and tests

[Fresh mainnet fixture manifest](tests/fixtures/mainnet-mints.json) records public AAPLx and SPYx account bytes at finalized slot 452768962, their mint identities, Token-2022 owner, observation time and data SHA-256. Binary fixtures contain public account data only. They are parser fixtures, not private keys, devnet assets or deployment authorization.

`cargo test -p basalt-token-policy` exercises real profile parsing, wrong identities, every display subset, missing privileged entries, exact payload lengths, metadata Borsh/UTF-8 boundaries, both multiplier fields, malformed booleans, paused/frozen/active-hook states, unknown/forbidden types, duplicate/truncated TLVs, hidden trailing data, token-account extensions and deterministic mutation fuzzing. Mint/account program ownership remains an instruction-level caller test. Local/devnet current-SBF transfer tests and deployed-byte attestation are separate requirements; a parser unit test cannot prove actual CPI success.
