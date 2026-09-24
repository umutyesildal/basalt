import assert from "node:assert/strict";

import { CONCEPT_ASSETS, DISCOVERY_ASSETS } from "../lib/concept-assets";
import { validateConceptBasket, type ConceptBasket } from "../lib/concept-basket";
import { decodeConceptBasket, encodeConceptBasket, conceptCopyHref, conceptPreviewHref } from "../lib/concept-share";
import { CONCEPT_ACTIVITY, CONCEPT_BASKETS, CONCEPT_CREATORS } from "../lib/concept-samples";

const basket: ConceptBasket = {
  v: 1,
  name: "Maya’s $10 idea",
  thesis: "A small start with two companies.",
  assets: [
    { symbol: "AAPL", weightBps: 6_000 },
    { symbol: "MSFT", weightBps: 4_000 },
  ],
  amountUsd: 10,
  fees: { entryBps: 0, exitBps: 0, managementBps: 0 },
};

assert.deepEqual(decodeConceptBasket(encodeConceptBasket(basket)), basket, "UTF-8 basket URL round-trips");
assert.deepEqual(decodeConceptBasket(encodeConceptBasket({ ...basket, thesis: "AI & chips", fees: { entryBps: 50, exitBps: 25, managementBps: 100 } })), {
  ...basket, thesis: "AI & chips", fees: { entryBps: 50, exitBps: 25, managementBps: 100 },
}, "Optional thesis and fees round-trip");
assert.equal(encodeConceptBasket(basket).startsWith("2."), true);
assert.equal(conceptPreviewHref(basket).startsWith("/preview?d="), true);
assert.equal(conceptCopyHref(basket).startsWith("/create?copy="), true);
assert.deepEqual(DISCOVERY_ASSETS.slice(0, 8).map((asset) => asset.symbol), ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "SPY"]);
const oldBytes = new TextEncoder().encode(JSON.stringify(basket));
assert.deepEqual(decodeConceptBasket(Buffer.from(oldBytes).toString("base64url")), basket, "Previously shared links still open");
assert.ok(encodeConceptBasket(basket).length < Buffer.from(oldBytes).toString("base64url").length, "New links are shorter");
assert.equal(decodeConceptBasket("not+base64"), null);
assert.equal(decodeConceptBasket("x".repeat(4_097)), null);
assert.equal(decodeConceptBasket(`2.${Buffer.from(JSON.stringify([2, "Bad", 10, ["AAPL", 5000, "MSFT", 5000], "", [999, 0, 0]])).toString("base64url")}`), null);
assert.equal(validateConceptBasket({ ...basket, amountUsd: 1_000 }).ok, true);
assert.equal(validateConceptBasket({ ...basket, assets: [{ symbol: "AAPL", weightBps: 5_000 }, { symbol: "AAPL", weightBps: 5_000 }] }).ok, false);
assert.equal(validateConceptBasket({ ...basket, assets: [{ symbol: "AAPL", weightBps: 5_000 }, { symbol: "MSFT", weightBps: 4_999 }] }).ok, false);
assert.equal(validateConceptBasket({ ...basket, assets: [{ symbol: "AAPL", weightBps: 10_000 }, { symbol: "UNKNOWN", weightBps: 0 }] }).ok, false);
assert.equal(validateConceptBasket({ ...basket, fees: { ...basket.fees, exitBps: 101 } }).ok, false);

const assetSymbols = new Set(CONCEPT_ASSETS.map((asset) => asset.symbol));
const creatorIds = new Set(CONCEPT_CREATORS.map((creator) => creator.id));
const basketIds = new Set(CONCEPT_BASKETS.map((sample) => sample.id));
for (const sample of CONCEPT_BASKETS) {
  assert.equal(creatorIds.has(sample.creatorId), true, `${sample.id} creator resolves`);
  assert.equal(validateConceptBasket(sample).ok, true, `${sample.id} is a valid preview`);
  assert.deepEqual(decodeConceptBasket(encodeConceptBasket(sample)), {
    v: 1,
    name: sample.name,
    thesis: sample.thesis,
    assets: sample.assets,
    amountUsd: sample.amountUsd,
    fees: sample.fees,
  }, `${sample.id} share link resolves`);
  for (const asset of sample.assets) assert.equal(assetSymbols.has(asset.symbol), true, `${sample.id} asset ${asset.symbol} is in the catalog`);
}
for (const activity of CONCEPT_ACTIVITY) {
  assert.equal(creatorIds.has(activity.creatorId), true, `${activity.id} creator resolves`);
  assert.equal(basketIds.has(activity.basketId), true, `${activity.id} basket resolves`);
  assert.equal("sig" in activity, false, `${activity.id} is not represented as an onchain transaction`);
}

process.stdout.write("Concept preview and sample integrity checks passed.\n");
