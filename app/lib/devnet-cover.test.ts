import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { BASKET_COVERS, isBasketCoverId, type BasketCoverId } from "./basket-covers";
import { devnetBasketCover, devnetBasketMetadata } from "./devnet-cover";
import { devnetCreateHref } from "./devnet-links";
import { DEVNET_MOCKS, hashDevnetBasketMetadata } from "./devnet-baskets";

const draft = { name: " My test basket ", thesis: " Four mock tokens. ", coverId: "orbit" as BasketCoverId, managementBps: 200, constituents: DEVNET_MOCKS.map((mock) => ({ ticker: mock.symbol, mint: mock.mint, weightBps: 2500 })) };

test("concept-to-devnet links preserve every allowlisted cover and never carry investment amounts", () => {
  for (const cover of BASKET_COVERS) {
    const url = new URL(devnetCreateHref({ name: "My stock basket", thesis: "My idea", managementFeeBps: 200, coverId: cover.id }), "https://basalt.example");
    assert.equal(url.pathname, "/create/onchain");
    assert.equal(url.searchParams.get("coverId"), cover.id);
    assert.equal(url.searchParams.get("name"), "My stock basket");
    assert.equal(url.searchParams.get("managementBps"), "200");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["coverId", "managementBps", "name", "thesis"]);
  }
  assert.equal(devnetCreateHref(), "/create/onchain");
});

test("devnet bridge links discard invalid images rather than propagating external sources", () => {
  for (const coverId of ["https://evil.example/logo.png", "../../secret", "", "orbit.png"]) assert.equal(new URL(devnetCreateHref({ coverId }), "https://basalt.example").searchParams.has("coverId"), false);
});

test("new devnet metadata commits the selected artwork and actual mock-token identities", async () => {
  const text = devnetBasketMetadata(draft), metadata = JSON.parse(text);
  assert.equal(metadata.coverId, "orbit");
  assert.equal(metadata.name, "My test basket");
  assert.equal(metadata.description, "Four mock tokens.");
  assert.equal(metadata.network, "devnet");
  assert.deepEqual(metadata.constituents, draft.constituents);
  assert.deepEqual(metadata.feesBps, { entry: 0, exit: 0, management: 200 });
  assert.equal(await hashDevnetBasketMetadata(text), createHash("sha256").update(text).digest("hex"));
  assert.notEqual(await hashDevnetBasketMetadata(text), await hashDevnetBasketMetadata(devnetBasketMetadata({ ...draft, coverId: "moon-shot" })));
});

test("new devnet creation refuses missing or invalid cover IDs before hashing", () => {
  for (const coverId of [undefined, null, "unknown", "https://evil.example/logo.png"]) assert.throws(() => devnetBasketMetadata({ ...draft, coverId } as typeof draft), /Choose a basket image/);
});

test("legacy display fallback leaves the exact metadata bytes and old hash untouched", async () => {
  const legacy = { name: "Old test basket", description: "Created before cover selection", version: "basalt-devnet-v0" };
  const text = JSON.stringify(legacy), oldHash = createHash("sha256").update(text).digest("hex");
  const before = structuredClone(legacy);
  const cover = devnetBasketCover(legacy, "old-basket-address");
  assert.ok(isBasketCoverId(cover.id));
  assert.equal(devnetBasketCover(legacy, "old-basket-address").id, cover.id);
  assert.deepEqual(legacy, before);
  assert.equal(JSON.stringify(legacy), text);
  assert.equal(await hashDevnetBasketMetadata(text), oldHash);
  assert.ok(isBasketCoverId(devnetBasketCover(null, "another-basket-address").id));
});

test("verified new metadata displays its chosen image while unknown cover references use a safe local fallback", () => {
  assert.equal(devnetBasketCover(JSON.parse(devnetBasketMetadata(draft)), "basket-address").id, "orbit");
  for (const coverId of [null, "../../secret", "https://evil.example/image.png", {}, 42]) {
    const cover = devnetBasketCover({ name: "Old basket", coverId }, "basket-address");
    assert.ok(isBasketCoverId(cover.id));
    assert.ok(cover.src.startsWith("/images/baskets/"));
  }
});
