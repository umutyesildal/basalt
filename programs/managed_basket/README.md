# Managed Basket V2 prototype

This is an isolated Anchor prototype. It does not change the immutable V0 basket program. It creates one shared two-token vault, a fungible Token-2022 share mint, and a separate one-of-one identity mint. The identity token identifies a basket; only the fungible shares represent pro-rata vault claims.

## Implemented

- `create_managed_basket`: atomic fixed-pair seed, genesis share mint, identity mint and mint-authority revocation.
- `mint_in_kind`: checked raw deposits against live vault ratios; the lower implied share amount is minted with floor rounding and 1% ratio tolerance.
- `redeem_in_kind`: permissionless, oracle-free pro-rata raw redemption with floor rounding. No manager, guardian, proposal, pause, backend or extension-policy check gates the instruction.
- `propose_rebalance`: manager commits the allocation version, pair, exact full-fill input amount, target weights and timing.
- `approve_price_bound`: separate guardian commits an immutable raw minimum output; the public notice starts at approval.
- `fill_rebalance`: one atomic Token-2022 pair fill, requiring the exact proposed input, approved minimum output, exact transfer deltas and positive post-fill balance in both vaults.
- cancellation by manager or guardian; permissionless expiry.

The approval deadline and execution window use slots. Default builds bound the notice to 216,000–10,000,000 slots. 216,000 slots is about 24 hours at a nominal 400ms per slot; it is **not a wall-clock guarantee**. Production policy should use a reviewed timestamp-based deadline or a deliberately conservative slot conversion.

`localnet-fast-notice` is a test-only Cargo feature that lowers the minimum notice to 10 slots so local validator tests can exercise delayed approval and fill without a long warp. It is disabled by default, is asserted by a cfg-specific unit test, and must never be enabled for a deployment or release artifact. Build and store this localnet artifact separately from the default program artifact.

## Prototype limits

- This program admits any two distinct Token-2022 mints with no extensions and no base freeze authority. It has **no project allowlist or xStocks provenance check**, so it is not suitable for public devnet or mainnet with real assets.
- Extension-free admission excludes Scaled UI Amount and other Token-2022 extensions. Real xStocks need an explicit extension compatibility design before integration.
- The identity mint has zero decimals and supply one, and its mint authority is revoked. Token metadata/name/symbol/URI extensions are not initialized, so wallet display metadata remains work to do.
- Fees are fixed at zero. There is no manager or guardian rotation, protocol pause, oracle, DEX CPI, or automated keeper.
- Guardian `min_output_raw` is a raw-token bound, not a cross-asset price oracle. The program cannot prove that a pair fill produces the proposed economic target weights. `target_weights_bps` are versioned manager intent; confirmed raw vault balances are the actual holdings.
- The RFQ input field is named `max_input_raw`, but this prototype allows only a full fill where `input_raw == max_input_raw`.
- The program and host proof are unaudited. Unit tests are not instruction-level, fuzz, or external security tests.

## Build checks

```sh
cargo check -p managed_basket --offline
cargo test -p managed_basket --offline
```

The SBF artifact was built in a scratch workspace with a private v3 lockfile copy to work around the installed `cargo build-sbf` lockfile-version incompatibility. No root lockfile edits are part of this prototype. Keep any `localnet-fast-notice` SBF artifact separate from the default build.
