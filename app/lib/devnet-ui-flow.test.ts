import assert from "node:assert/strict";
import test from "node:test";
import { DEVNET_MOCK_TOKENS } from "./devnet-faucet";
import { devnetCloneDraft, supportsDevnetWorkspace } from "./devnet-ui-flow";

const mints = DEVNET_MOCK_TOKENS.map(token => token.mint.toBase58());
const base = { pubkey: "fixed-devnet-basket", metadata_json: { name: "My mix", description: "A thesis", coverId: "moon-shot" }, constituents: mints,
  weights_bps: [4000, 3000, 2000, 1000], entry_fee_bps: 0, exit_fee_bps: 0, management_fee_bps: 175 };

test("direct RPC workspace applies to the fixed mock pack and its genuine subsets only on devnet", () => {
  for (const count of [2, 3, 4]) assert.equal(supportsDevnetWorkspace({ constituents: mints.slice(0, count) }, "devnet"), true);
  for (const constituents of [[], [mints[0]], [mints[0], mints[0]], [...mints, "other"], [mints[0], "other"]]) {
    assert.equal(supportsDevnetWorkspace({ constituents }, "devnet"), false);
  }
  assert.equal(supportsDevnetWorkspace(base, "mainnet-beta"), false);
  assert.equal(supportsDevnetWorkspace(base, "localnet"), false);
});

test("copying a full fixed pack preserves actual mint-aligned weights and management fee", () => {
  const draft = devnetCloneDraft({ ...base, constituents: [mints[2], mints[0], mints[3], mints[1]], weights_bps: [1200, 3100, 1900, 3800] });
  assert.deepEqual(draft.weights, ["31", "38", "12", "19"]);
  assert.equal(draft.management, "1.75");
  assert.equal(draft.name, "My mix"); assert.equal(draft.thesis, "A thesis"); assert.equal(draft.coverId, "moon-shot");
});

test("unsupported copies never silently replace assets, fee schedule or weights with defaults", () => {
  for (const patch of [
    { constituents: mints.slice(0, 3), weights_bps: [4000, 3000, 3000] },
    { constituents: [mints[0], mints[1], mints[2], "other"] },
    { constituents: [mints[0], mints[1], mints[2], mints[2]] },
    { weights_bps: [2500, 2500, 2500, 2499] }, { weights_bps: [0, 3000, 3000, 4000] },
    { entry_fee_bps: 1 }, { exit_fee_bps: 1 }, { management_fee_bps: 301 }, { management_fee_bps: -1 },
  ]) assert.throws(() => devnetCloneDraft({ ...base, ...patch }), /cannot be copied/);
});
