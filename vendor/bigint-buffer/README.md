# Bounded Solana integer codecs

A project-owned replacement for the four `bigint-buffer` exports consumed by
`@solana/buffer-layout-utils`. This independently implemented module uses only
JavaScript BigInt and Buffer, has no native code or installation hook, and accepts
only unsigned values and widths of 0–32 bytes. Negative, overflowing, oversized,
and malformed inputs throw before allocation/conversion. The upper bound covers
all u64/u128/u192/u256 layouts used by the pinned Solana packages.

This is not an upstream fixed release of `bigint-buffer`. The dependency override
is deliberate, tested against the actual Token-2022 layouts, and must be revisited
when upgrading the Solana SDK. Source and a deterministic npm tarball are committed
together. Regenerate with `npm pack ./vendor/bigint-buffer --ignore-scripts
--pack-destination vendor` and update all three locks after any source change.
