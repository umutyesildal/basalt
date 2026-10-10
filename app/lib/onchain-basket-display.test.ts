import assert from "node:assert/strict";
import test from "node:test";
import { BASKET_COVERS } from "./basket-covers";
import { onchainBasketDisplay } from "./onchain-basket-display";

const address = "38VG85nUbemsfKzozHtnr3oaf4VKFdAk1ySPCt4LDM4S";
const fallback = { name: "Basket 38VG…DM4S", thesis: null, coverId: null };

test("indexed metadata strings and objects preserve the selected artwork and description", () => {
  const metadata = { name: " My strategy ", description: " Picked with care. ", thesis: "Older thesis", coverId: "orbit" };
  const expected = { name: "My strategy", thesis: "Picked with care.", coverId: "orbit" };
  assert.deepEqual(onchainBasketDisplay(metadata, address), expected);
  assert.deepEqual(onchainBasketDisplay(JSON.stringify(metadata), address), expected);
  for (const cover of BASKET_COVERS) assert.equal(onchainBasketDisplay({ coverId: cover.id }, address).coverId, cover.id);
});

test("missing, malformed and non-record metadata immediately resolves to the address and no artwork", () => {
  for (const metadata of [undefined, null, "", "broken JSON", "null", "[]", "42", [], 42, false, JSON.stringify({ name: "x".repeat(16_384) })]) {
    const actual = onchainBasketDisplay(metadata, address);
    assert.equal(actual.name, "Basket 38VG…DM4S");
    assert.equal(actual.thesis, null);
    assert.equal(actual.coverId, null);
  }
});

test("invalid field types stay unavailable and an empty description falls back to the actual thesis", () => {
  assert.deepEqual(onchainBasketDisplay({ name: {}, description: [], thesis: 42 }, address), fallback);
  assert.equal(onchainBasketDisplay({ description: " \n\t", thesis: "  One idea.  " }, address).thesis, "One idea.");
  assert.equal(onchainBasketDisplay({ name: "\u0000\u202e", thesis: "\u007f" }, address).name, "Basket 38VG…DM4S");
});

test("arbitrary image URLs and paths never become artwork sources or fabricated fallback covers", () => {
  for (const coverId of ["https://foreign.example/art.png", "//foreign.example/art.png", "../../secret", "/images/baskets/orbit.webp", "unknown", "", null, {}, 42]) {
    assert.equal(onchainBasketDisplay({ name: "My basket", coverId }, address).coverId, null);
  }
});

test("display text removes controls, bounds length without splitting Unicode, and leaves HTML literal", () => {
  const metadata = { name: "  My\u202e basket\n today ", description: "<b>A & B</b>\tstrategy\u0000" };
  const original = structuredClone(metadata);
  assert.deepEqual(onchainBasketDisplay(metadata, address), { name: "My basket today", thesis: "<b>A & B</b> strategy", coverId: null });
  assert.deepEqual(metadata, original);
  const bounded = onchainBasketDisplay({ name: "🚀".repeat(65), description: "🌍".repeat(401) }, address);
  assert.equal(Array.from(bounded.name).length, 64);
  assert.equal(Array.from(bounded.thesis!).length, 400);
  assert.equal(bounded.name, "🚀".repeat(64));
});


test("ten existing devnet baskets have stable, varied decorative identities only when opted in", () => {
  const identities = [
    [address, "First Move", "fresh-start"],
    ["4tkoyCsktgfkNpN1ovAnvuLHLcfXiFcdAUQskQUBA65z", "Four Corners", "world-tour"],
    ["6CUXMFNehD7DU1Njbxu7cg8B5Fesmn64tJUDQ6EoqGMv", "Threefold", "orbit"],
    ["78jbGZHDiH1jSdctS9bxVkKQgNzuzt1nCX9DiimyYLir", "Mainframe", "deep-focus"],
    ["9PoTEPsCjew9NtYA9MLTjDapMsW1ZdW4dgokdGzmPimB", "Open Circuit", "robot-shift"],
    ["9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg", "Core Three", "cloud-nine"],
    ["CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo", "Wide Lens", "signal-noise"],
    ["E8mBqH3xp74z5HZ52nDyex14XyDk3aDLz6oMmy8FfodR", "New Chapter", "moon-shot"],
    ["HYq16UQLv8HnBnzZDgjEJWnYS1mrUs5rzzbycQEGduSW", "Triple Play", "side-quest"],
    ["YZuBJ6PmVZXvaGHmNC8g84j1H61zDWpZ1mkENjGcrd8", "Even Steven", "bull-case"],
  ];
  const seen = new Set<string>();
  for (const [pubkey, name, coverId] of identities) {
    const display = onchainBasketDisplay(null, pubkey, { devnet: true, assetCount: 4 });
    assert.equal(display.name, name);
    assert.equal(display.coverId, coverId);
    assert.equal(display.thesis, "Four tokens, one simple mix.");
    assert.deepEqual(onchainBasketDisplay(null, pubkey, { devnet: true, assetCount: 4 }), display);
    assert.equal(onchainBasketDisplay(null, pubkey, { devnet: false }).coverId, null);
    seen.add(display.coverId!);
  }
  assert.equal(seen.size, 10);
});

test("actual normalized creator metadata wins over every decorative field without mutation", () => {
  const metadata = { name: "  My choice  ", description: "  My actual thesis. ", coverId: "diamond-hands" };
  const original = structuredClone(metadata);
  assert.deepEqual(onchainBasketDisplay(metadata, address, { devnet: true, assetCount: 3, weightsBps: [4000, 3200, 2800] }), { name: "My choice", thesis: "My actual thesis.", coverId: "diamond-hands" });
  assert.deepEqual(metadata, original);
  assert.equal(onchainBasketDisplay({ name: "My choice", coverId: "https://foreign.example/art.png" }, address, { devnet: true }).coverId, "fresh-start");
});

test("unknown future devnet addresses resolve deterministically without named stock or return claims", () => {
  const unknown = ["11111111111111111111111111111111", "So11111111111111111111111111111111111111112"];
  const displays = unknown.map((pubkey) => onchainBasketDisplay(null, pubkey, { devnet: true }));
  assert.notEqual(displays[0].coverId, displays[1].coverId);
  for (let index = 0; index < unknown.length; index += 1) {
    assert.deepEqual(onchainBasketDisplay(null, unknown[index], { devnet: true }), displays[index]);
    assert.ok(BASKET_COVERS.some((cover) => cover.id === displays[index].coverId));
    assert.equal(displays[index].thesis, "A basket from the community.");
  }
});

test("composition descriptions use only valid actual counts and weights", () => {
  const describe = (options: Parameters<typeof onchainBasketDisplay>[2]) => onchainBasketDisplay(null, address, { ...options, devnet: true }).thesis;
  assert.equal(describe({ assetCount: 4, weightsBps: [2500, 2500, 2500, 2500] }), "Four tokens, evenly split.");
  assert.equal(describe({ assetCount: 3, weightsBps: [4000, 3200, 2800] }), "Three tokens, one simple mix.");
  assert.equal(describe({ assetCount: 6, weightsBps: [2500, 2000, 1500, 1500, 1250, 1250] }), "Six tokens in one basket.");
  assert.equal(describe({ assetCount: 4, weightsBps: [4000, 3200, 2800] }), "Four tokens, one simple mix.");
  assert.equal(describe({ assetCount: 3, weightsBps: [4000, 3200, 2799] }), "Three tokens, one simple mix.");
  assert.equal(describe({ assetCount: -1, weightsBps: [NaN, Infinity, -1] }), "Three tokens, one simple mix.");
  assert.equal(describe({ assetCount: 4, weightsBps: [1000, 1000, 1000, 1000] }), "Four tokens, one simple mix.");
  assert.equal(describe({ assetCount: 20 }), "Twenty tokens in one basket.");
  assert.equal(describe({ assetCount: NaN }), "A basket from the community.");
  assert.deepEqual(onchainBasketDisplay(null, address, { assetCount: 4, weightsBps: [2500, 2500, 2500, 2500] }), fallback);
});
