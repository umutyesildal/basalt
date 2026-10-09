import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConceptBasket } from "@/lib/concept-basket";
import { CONCEPT_BASKET_LIMITS } from "@/lib/concept-basket";
import { initialCreateDraft, rememberCreatedPreview, consumeCreatedPreview, RECOMMENDED_MANAGEMENT_BPS } from "./create-feedback";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("new drafts start empty with the recommended management fee inside the existing cap", () => {
  const draft = initialCreateDraft(null);
  assert.deepEqual(draft.assets, []);
  assert.equal(draft.coverId, undefined, "a new basket still needs an explicit cover choice");
  assert.equal(draft.name, "My stock basket");
  assert.deepEqual(draft.fees, { entryBps: 0, exitBps: 0, managementBps: 200 });
  assert.equal(draft.fees.managementBps, RECOMMENDED_MANAGEMENT_BPS);
  assert.ok(RECOMMENDED_MANAGEMENT_BPS <= CONCEPT_BASKET_LIMITS.managementFeeBps);
  assert.equal(draft.amountUsd, 1000);
});

test("copying a basket preserves zero or custom fees, its mix and original amount precision", () => {
  for (const managementBps of [0, 125, 300]) {
    const source: ConceptBasket = { v: 1, name: "My existing idea", coverId: "orbit", thesis: "Keep my choices.", assets: [{ symbol: "AAPL", weightBps: 6000 }, { symbol: "MSFT", weightBps: 4000 }], amountUsd: 1234.56789, fees: { managementBps, entryBps: 75, exitBps: 20 } };
    const draft = initialCreateDraft(source);
    assert.deepEqual(draft, source);
    draft.fees.managementBps = 200;
    draft.assets[0].weightBps = 5000;
    assert.equal(source.fees.managementBps, managementBps);
    assert.equal(source.assets[0].weightBps, 6000);
  }
});

test("independent fresh drafts do not share mutable arrays or fee objects", () => {
  const first = initialCreateDraft(null);
  first.assets.push({ symbol: "AAPL", weightBps: 10000 });
  first.fees.managementBps = 0;
  const second = initialCreateDraft(null);
  assert.deepEqual(second.assets, []);
  assert.equal(second.fees.managementBps, 200);
});

test("a completed share celebrates once, ordinary links and refreshes do not", () => {
  const session = storage();
  const href = "/preview?d=created-draft";
  assert.equal(consumeCreatedPreview(href, session), false);
  rememberCreatedPreview(href, session);
  assert.equal(consumeCreatedPreview("/preview?d=another-draft", session), false);
  assert.equal(consumeCreatedPreview(href, session), true);
  assert.equal(consumeCreatedPreview(href, session), false);
  rememberCreatedPreview(href, session);
  assert.equal(consumeCreatedPreview(href, session), true, "a later completed Share action may celebrate again");
  assert.equal(consumeCreatedPreview(href, session), false);
});

test("storage-restricted browsers still get one-time feedback for the current action", () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  const href = "/preview?d=private-browser";
  rememberCreatedPreview(href, blocked);
  assert.equal(consumeCreatedPreview(href, blocked), true);
  assert.equal(consumeCreatedPreview(href, blocked), false);
});
