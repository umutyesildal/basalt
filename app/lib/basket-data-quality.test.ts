import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BasketCard } from "../components/cards/basket-card";
import { BasketDataNote } from "../components/basket/basket-data-note";
import { basketDataMessage, indexedDataState, parseBasketDataQuality } from "./basket-data-quality";

const ready = {
  status: "ready", reasons: [], valuation: { eligible: true, reason: null, missingPriceMints: [] },
  recovery: { required: false, pendingSignatures: 0, quarantinedSignatures: 0 },
};
const oldReady = { eligible: true, complete: true, status: "complete", stale: false };

test("missing or malformed evidence never approves indexed USD figures", () => {
  for (const value of [undefined, null, {}, { ...ready, status: "okay" }, { ...ready, valuation: { eligible: "true" } },
    { ...ready, recovery: { ...ready.recovery, pendingSignatures: -1 } },
    { ...ready, recovery: { ...ready.recovery, pendingSignatures: "0" } }]) {
    assert.equal(parseBasketDataQuality(value).valuation.eligible, false);
  }
  assert.equal(parseBasketDataQuality({}, oldReady).valuation.eligible, false);
  assert.equal(parseBasketDataQuality(undefined, oldReady).valuation.eligible, true);
  for (const legacy of [{ ...oldReady, stale: true }, { ...oldReady, complete: false }, { eligible: true }])
    assert.equal(parseBasketDataQuality(undefined, legacy).valuation.eligible, false);
});

test("pending replay or recovery overrides contradictory eligible numbers", () => {
  for (const recovery of [{ ...ready.recovery, required: true }, { ...ready.recovery, pendingSignatures: 1 },
    { ...ready.recovery, quarantinedSignatures: 1 }])
    assert.equal(parseBasketDataQuality({ ...ready, recovery }).valuation.eligible, false);
  assert.equal(parseBasketDataQuality({ ...ready, status: "pending" }).valuation.eligible, false);
  assert.equal(parseBasketDataQuality(ready).valuation.eligible, true);
});

test("mock price provenance cannot become an eligible USD valuation", () => {
  for (const source of ["mock:bstesta", { mint: { source: "mock" } }, ["jupiter:v3", "mock:msft"]])
    assert.equal(parseBasketDataQuality(ready, oldReady, source).valuation.eligible, false);
  assert.equal(parseBasketDataQuality(ready, oldReady, { source: "jupiter-v3-token-price" }).valuation.eligible, true);
});

test("card retains indexed identity and reason while withholding supplied USD and comparisons", () => {
  const quality = parseBasketDataQuality({ ...ready, status: "unavailable", valuation: { ...ready.valuation, eligible: false },
    reasons: [{ code: "missing-price", message: "Prices are unavailable for two assets." }] });
  const html = renderToStaticMarkup(createElement(BasketCard, {
    href: "/basket/known", headline: "Existing basket", quality, price: 123, aum: 999, return24h: 54, return30d: 12,
    compare: { label: "vs SPY", value: 40, window: "24h" },
  }));
  assert.match(html, /Existing basket/);
  assert.match(html, /Prices are unavailable for two assets/);
  assert.doesNotMatch(html, /not indexed|\$123|\$999|54[.]00|vs SPY/);
  const priced = renderToStaticMarkup(createElement(BasketCard, {
    href: "/basket/known", headline: "Priced basket", quality: parseBasketDataQuality(ready), price: 123, aum: 999,
  }));
  assert.match(priced, /\$123[.]00/);
});

test("public explanation is plain escaped text with optional secondary reasons", () => {
  const quality = parseBasketDataQuality({ ...ready, status: "pending", reasons: [
    { code: "review", message: "Balances are being checked <again>." },
    { code: "prices", message: "Prices are unavailable." },
  ] });
  assert.equal(basketDataMessage(quality), "Balances are being checked <again>.");
  const html = renderToStaticMarkup(createElement(BasketDataNote, { quality, details: true }));
  assert.match(html, /&lt;again&gt;/);
  assert.match(html, /More about these values/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.equal(renderToStaticMarkup(createElement(BasketDataNote, { quality: parseBasketDataQuality(ready) })), "");
});

test("provider liveness and indexed readiness remain separate", () => {
  assert.equal(indexedDataState({ ready: true, projectionReady: false }).label, "Indexed data catching up");
  assert.equal(indexedDataState({ ready: true, projectionReady: true }).label, "Indexed balances ready");
  assert.match(indexedDataState({ ready: false, projectionReady: true }).label, /unavailable/);
  assert.equal(indexedDataState({ ready: true }).state, "unknown");
  assert.match(indexedDataState({ ready: true, projectionReady: true }).message ?? "", /verified prices for each basket/);
});
