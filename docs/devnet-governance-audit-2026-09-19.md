# Devnet governance audit — 2026-09-19

Status: **read-only RPC evidence; single-key governance confirmed**

This record captures a finalized, read-only governance check against Solana
devnet. It does not attest that the deployed ELF bytes match this repository,
does not prove a multisig or time lock, and did not submit any transaction.

## Observation context

- Observed at: `2026-09-19T18:17:49Z`
- RPC cluster: Solana devnet
- RPC-reported cluster version: `4.3.0-rc.0`
- Finalized slot observed during the check: `500984563`
- Solana CLI used: `1.18.17`
- Repository commit: `99da89ed7828a050309618527381ac593a51c977`
- Commitment: `finalized`

The program checks used:

```bash
solana program show <PROGRAM_ID> \
  --url devnet \
  --commitment finalized \
  --output json
```

## Upgrade authorities

| Program | Program ID | ProgramData | Last deploy slot | Upgrade authority |
|---|---|---|---:|---|
| `whitelist` | `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS` | `DtNwP5QCJZXTVTs5BkA2GHY1Ys2j2xdERrvBJBdiW1Kz` | `493110585` | `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE` |
| `basket_factory` | `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF` | `C9g9HdnPpYy4HA9ivPhJKctTQ2YBNpran4fW5n3nPCmf` | `493110824` | `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE` |
| `basket` | `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k` | `wgr99UCBVZWm7h9jswno2p9owpD8RSYE5iiUTyNFhJA` | `493111012` | `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE` |

All three program accounts reported owner
`BPFLoaderUpgradeab1e11111111111111111111111`. The CLI successfully decoded
their ProgramData accounts and returned the same upgrade authority for each.
The evidence therefore confirms a single-key authority model, not the target
multisig model.

## Whitelist configuration authority

The `WhitelistConfig` PDA was derived from seed `b"config"` under the
`whitelist` program:

- PDA: `ESRwG8qoKaLM17dLEM6MJDRpKVYtkd9M2zUmbud2uXZd`
- Account owner: `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS`
- Authority: `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE`
- Pending authority: `null`

The account was read with:

```bash
solana account ESRwG8qoKaLM17dLEM6MJDRpKVYtkd9M2zUmbud2uXZd \
  --url devnet \
  --commitment finalized \
  --output json
```

The authority was decoded from the Anchor account layout defined in
`programs/whitelist/src/lib.rs`. The separate two-step whitelist-authority
transfer has not started because `pending_authority` is empty.

## Security conclusion

One key can currently upgrade all three deployed programs and controls
whitelist admission and mint pausing. This does not satisfy BAS-006 acceptance
and remains a mainnet blocker. The approved target is an autonomous,
hardware-wallet-backed 2-of-3 vault with the global 48-hour on-chain time lock
defined in `docs/upgrade-governance-policy.md`.

No part of this audit changes basket immutability or the redemption invariant.
`redeem_in_kind` remains permissionless, oracle-free, backend-independent,
whitelist-independent, and unpausable.

## Missing evidence

This check does not provide:

- deployed ELF-to-source reproducibility;
- a Squads multisig configuration or vault address;
- signer public keys or hardware-wallet custody evidence;
- a configured and verified 48-hour on-chain time lock;
- a successful 2-of-3 delayed authority-transfer rehearsal; or
- post-transfer RPC proof showing the governance vault as all four authorities.

Until those items exist, deployment manifests must describe the authority model
as `single-key`, not `multisig`, and BAS-006 remains in progress.
