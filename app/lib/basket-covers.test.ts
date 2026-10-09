import assert from "node:assert/strict";
import { test } from "node:test";
import { BASKET_COVERS, getBasketCover, isBasketCoverId, resolveLegacyBasketCover } from "./basket-covers";
import { validateConceptBasket, type ConceptBasket } from "./concept-basket";
import { conceptCopyHref, decodeConceptBasket, encodeConceptBasket } from "./concept-share";
import { BASKET_STORY_COVERS, CONCEPT_BASKETS } from "./concept-samples";

const idea: ConceptBasket = { v: 1, name: "My idea", thesis: "A long view.", assets: [{ symbol: "AAPL", weightBps: 6000 }, { symbol: "MSFT", weightBps: 4000 }], amountUsd: 1000, fees: { entryBps: 25, exitBps: 10, managementBps: 200 } };
function link(version: number, payload: unknown[]) { return `${version}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`; }

test("the cover gallery has 34 unique original local images", () => {
  assert.equal(BASKET_COVERS.length, 34);
  assert.equal(new Set(BASKET_COVERS.map((cover) => cover.id)).size, 34);
  assert.ok(BASKET_COVERS.every((cover) => new RegExp(`^/images/baskets/${cover.id}\\.(png|webp)$`).test(cover.src) && /^[a-z][a-z-]+$/.test(cover.id)));
});

test("v4 sharing and copying preserve every selected cover", () => {
  for (const cover of BASKET_COVERS) {
    const basket = { ...idea, coverId: cover.id };
    const encoded = encodeConceptBasket(basket);
    assert.ok(encoded.startsWith("4."));
    assert.deepEqual(decodeConceptBasket(encoded), basket);
    assert.deepEqual(decodeConceptBasket(new URL(conceptCopyHref(basket), "https://basalt.example").searchParams.get("copy")), basket);
  }
});

test("legacy object, v2 and v3 links get a deterministic original cover", () => {
  const expected = resolveLegacyBasketCover(idea.name, idea.assets);
  const validation = validateConceptBasket(idea);
  assert.ok(validation.ok);
  assert.equal(validation.value.coverId, expected);
  const oldObject = Buffer.from(JSON.stringify(idea)).toString("base64url");
  const v2 = link(2, [2, idea.name, idea.amountUsd, ["AAPL", 6000, "MSFT", 4000], idea.thesis, [25, 10, 200]]);
  const v3 = link(3, [3, idea.name, idea.amountUsd, ["AAPL", 6000, null, "MSFT", 4000, null], idea.thesis, [25, 10, 200]]);
  for (const encoded of [oldObject, v2, v3]) assert.deepEqual(decodeConceptBasket(encoded), { ...idea, coverId: expected });
  assert.equal(resolveLegacyBasketCover(idea.name, [...idea.assets].reverse()), expected, "legacy images do not depend on the holding order");
});

test("the ten sample links keep their original distinct images", () => {
  assert.equal(new Set(CONCEPT_BASKETS.map((basket) => basket.coverId)).size, 10);
  for (const basket of CONCEPT_BASKETS) {
    assert.equal(getBasketCover(basket.coverId).label, basket.name);
    assert.equal(BASKET_STORY_COVERS[basket.id], getBasketCover(basket.coverId).src);
    const { coverId: _cover, ...legacy } = basket;
    const result = validateConceptBasket(legacy);
    assert.ok(result.ok);
    assert.equal(result.value.coverId, basket.coverId);
  }
});

test("untrusted cover values never become image URLs", () => {
  for (const value of ["https://evil.example/image.png", "../../secret", "javascript:alert(1)", "moon-shot.png", "", null, 2, {}]) {
    assert.equal(isBasketCoverId(value), false);
    assert.equal(validateConceptBasket({ ...idea, coverId: value }).ok, false);
    assert.throws(() => encodeConceptBasket({ ...idea, coverId: value } as ConceptBasket));
    assert.equal(decodeConceptBasket(link(4, [4, idea.name, idea.amountUsd, ["AAPL", 6000, null, "MSFT", 4000, null], idea.thesis, [25, 10, 200], value])), null);
  }
});

test("v4 requires the complete cover-bearing shape and never silently loses the chosen image", () => {
  const valid = [4, idea.name, idea.amountUsd, ["AAPL", 6000, null, "MSFT", 4000, null], idea.thesis, [25, 10, 200], "orbit"];
  for (const invalid of [valid.slice(0, 6), [...valid, "extra"], [...valid.slice(0, 6), null], [3, ...valid.slice(1)]]) assert.equal(decodeConceptBasket(link(4, invalid)), null);
  assert.equal(decodeConceptBasket(link(4, valid))?.coverId, "orbit");
});

test("new links for legacy inputs also encode their normalized cover", () => {
  const normalized = decodeConceptBasket(encodeConceptBasket(idea));
  assert.equal(normalized?.coverId, resolveLegacyBasketCover(idea.name, idea.assets));
  assert.equal(getBasketCover("not-a-cover").src, BASKET_COVERS[0].src);
});
