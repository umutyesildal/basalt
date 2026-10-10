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
