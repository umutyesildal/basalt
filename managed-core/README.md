# Managed Core Host Proof

This standalone, standard-library-only Rust crate is a host-side model for the
first Managed Basket V2 accounting slice. It is not an Anchor/Solana program,
does not execute Token-2022 instructions, and has not been audited.

It models two mock raw token balances, share supply split between holders,
fee-free in-kind minting using the live pre-deposit vault ratio, floor-based
redemption, a manager proposal, guardian-approved immutable fill limits,
approval deadline, post-approval notice period, execution expiry, and one
atomic pair exchange. Mint ratio validation allows at most a 1% spread between
the two implied share amounts, using integer comparison. The share token is the
economic claim; a basket identity NFT is outside this proof. Targets are stored
as basis points but this model does not value assets or prove market-price
fairness. Tests use equal-scale mock raw units only.

Run with:

```sh
cargo test --manifest-path managed-core/Cargo.toml
```

This proof is a precursor to instruction-level local validator tests. It does
not establish Solana account validation, signer checks, CPI safety, Token-2022
extension compatibility, oracle correctness, or production execution safety.
