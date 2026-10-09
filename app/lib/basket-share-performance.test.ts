import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BasketCard } from "../components/cards/basket-card";
import type { BasketPerformanceResponse } from "./basket-performance";
import { parseBasketDataQuality } from "./basket-data-quality";
import { findBasketPerformanceSample, getBasketSharePerformance } from "./basket-share-performance";
import { getConceptAsset } from "./concept-assets";
import type { ConceptBasket } from "./concept-basket";
import { CONCEPT_BASKETS } from "./concept-samples";

const sample = CONCEPT_BASKETS[0];
const basket = (): ConceptBasket => structuredClone(sample);
function response(value = 4.56): BasketPerformanceResponse {
  return {
    status: "ready", source: "Yahoo Finance", fetchedAt: "2026-10-09T22:00:00.000Z",
    baseDate: "2026-09-01", baseValue: 100, asOf: "2026-10-09", windowStart: "2026-10-02",
    methodology: "Historical underlying buy-and-hold model; not deployed basket NAV.",
    items: [{ basketId: sample.id, status: "ready", modelPrice: 104.56, return7dPct: value,
      asOf: "2026-10-09", windowStart: "2026-10-02", series: [] }],
  };
}

function dates(asOf: string, windowStart: string, fetchedAt = "2026-10-09T22:00:00.000Z") {
  const result = response();
  Object.assign(result, { asOf, windowStart, fetchedAt });
  Object.assign(result.items[0], { asOf, windowStart });
  return result;
}

test("a reordered exact named mix retains its published model identity", () => {
  const draft = basket();
  draft.assets.reverse();
  assert.equal(findBasketPerformanceSample(draft)?.id, sample.id);
  assert.deepEqual(getBasketSharePerformance(draft, response()), {
    basketId: sample.id, return7dPct: 4.56, asOf: "2026-10-09", windowStart: "2026-10-02",
  });
});

test("editing a name, constituent or weight cannot borrow an existing model return", () => {
  const renamed = { ...basket(), name: "A different basket" };
  const changedStock = basket();
  changedStock.assets[0].symbol = "WMT";
  const changedWeights = basket();
  changedWeights.assets[0].weightBps += 1;
  changedWeights.assets[1].weightBps -= 1;
  const removed = basket();
  removed.assets.pop();
  const duplicate = basket();
  duplicate.assets[1] = { ...duplicate.assets[0] };
  for (const draft of [renamed, changedStock, changedWeights, removed, duplicate]) {
    assert.equal(findBasketPerformanceSample(draft), undefined);
    assert.equal(getBasketSharePerformance(draft, response()), null);
  }
});

test("amount, thesis and artwork do not change the immutable holdings model", () => {
  const draft = { ...basket(), amountUsd: 25_000, thesis: "Another explanation of the same mix.", coverId: "diamond-hands" as const };
  assert.equal(findBasketPerformanceSample(draft)?.id, sample.id);
  assert.equal(getBasketSharePerformance(draft, response())?.return7dPct, 4.56);
});

test("a known exact mint is accepted while unknown and spoofed mints fail closed", () => {
  const draft = basket();
  const asset = draft.assets[0];
  asset.mint = getConceptAsset(asset.symbol)!.mint!;
  assert.ok(asset.mint);
  assert.equal(findBasketPerformanceSample(draft)?.id, sample.id);
  asset.mint = "11111111111111111111111111111112";
  assert.equal(findBasketPerformanceSample(draft), undefined);
  asset.mint = getConceptAsset("WMT")!.mint!;
  assert.equal(findBasketPerformanceSample(draft), undefined);
});

test("only one complete ready item from an available response can supply the metric", () => {
  const unavailableResponse = response(); unavailableResponse.status = "unavailable";
  assert.equal(getBasketSharePerformance(basket(), unavailableResponse), null);
  const unavailable = response(); unavailable.items[0].status = "unavailable";
  const absent = response(); absent.items = [];
  const duplicate = response(); duplicate.items.push({ ...duplicate.items[0] });
  for (const result of [undefined, null, unavailable, absent, duplicate])
    assert.equal(getBasketSharePerformance(basket(), result), null);
});

test("an unrelated unavailable basket does not remove a complete selected model", () => {
  const partial = response();
  partial.status = "partial";
  partial.items.push({ basketId: "unrelated", status: "unavailable", modelPrice: null, return7dPct: null,
    asOf: null, windowStart: null, series: [] });
  assert.equal(getBasketSharePerformance(basket(), partial)?.return7dPct, 4.56);
  partial.items[0].status = "unavailable";
  assert.equal(getBasketSharePerformance(basket(), partial), null);
});

test("non-finite or missing figures remain unavailable rather than becoming zero", () => {
  for (const value of [NaN, Infinity, -Infinity, null]) {
    const result = response(); result.items[0].return7dPct = value;
    assert.equal(getBasketSharePerformance(basket(), result), null);
  }
  for (const modelPrice of [0, NaN, Infinity, null]) {
    const result = response(); result.items[0].modelPrice = modelPrice;
    assert.equal(getBasketSharePerformance(basket(), result), null);
  }
});

test("zero and negative seven-day returns retain their exact percentage-point units", () => {
  for (const value of [0, -4.56])
    assert.equal(getBasketSharePerformance(basket(), response(value))?.return7dPct, value);
});

test("an image metric preserves the source's exact comparison dates", () => {
  const mismatched = response(); mismatched.items[0].asOf = "2026-10-08";
  const mismatchedBaseline = response(); mismatchedBaseline.items[0].windowStart = "2026-10-01";
  for (const result of [mismatched, mismatchedBaseline,
    dates("2026-10-10", "2026-10-03"),
    dates("2026-10-09", "2026-10-03"),
    dates("2026-10-09", "2026-09-27"),
    dates("2026-02-30", "2026-02-23"),
    dates("2026-10-09", "not-a-date"),
    dates("2026-10-09", "2026-10-02", "invalid")])
    assert.equal(getBasketSharePerformance(basket(), result), null);
});

test("freshness uses the model fetch clock and allows completed-close weekend tolerance", () => {
  const weekend = dates("2026-10-09", "2026-10-02", "2026-10-11T18:00:00.000Z");
  assert.equal(getBasketSharePerformance(basket(), weekend)?.return7dPct, 4.56);
  const stale = dates("2026-10-09", "2026-10-02", "2026-10-14T18:00:00.000Z");
  assert.equal(getBasketSharePerformance(basket(), stale), null);
});

test("missing anchor provenance cannot establish a shareable model return", () => {
  for (const baseDate of ["2026-08-31", "2026-09-06", "invalid"]) {
    const result = response(); result.baseDate = baseDate;
    assert.equal(getBasketSharePerformance(basket(), result), null);
  }
  const shortHistory = dates("2026-09-08", "2026-08-28", "2026-09-08T22:00:00.000Z");
  assert.equal(getBasketSharePerformance(basket(), shortHistory), null);
});

const readyQuality = parseBasketDataQuality({
  status: "ready", reasons: [], valuation: { eligible: true, reason: null, missingPriceMints: [] },
  recovery: { required: false, pendingSignatures: 0, quarantinedSignatures: 0 },
});
function card(value: number | null, eligible = true) {
  return renderToStaticMarkup(createElement(BasketCard, {
    href: "/basket/example", headline: "Published basket", quality: eligible ? readyQuality : parseBasketDataQuality(undefined),
    price: 100, aum: 1_000, return7d: value,
  }));
}

test("indexed cards display only genuinely available, eligible seven-day figures", () => {
  for (const value of [4.56, -4.56, 0]) {
    const html = card(value);
    assert.match(html, />7D</);
    assert.match(html, value === 0 ? /0[.]00%/ : value < 0 ? /-4[.]56%/ : /\+4[.]56%/);
  }
  for (const value of [null, NaN, Infinity]) assert.doesNotMatch(card(value), />7D</);
  assert.doesNotMatch(card(4.56, false), />7D<|4[.]56%/);
});
