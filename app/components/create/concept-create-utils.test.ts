import assert from "node:assert/strict";
import { test } from "node:test";

import { canScrollDown, distributeWeights, equalWeights, formatAmountEdit, initialAmountDraft, parseCreateAmount } from "./concept-create-utils";
import { parseGroupedAmountInput } from "@/lib/format";

test("removing assets keeps every remaining allocation positive and the total exact", () => {
  let weights = equalWeights(20);
  while (weights.length > 1) {
    weights = distributeWeights(weights.slice(1));
    assert.equal(weights.reduce((sum, value) => sum + value, 0), 10_000);
    assert.ok(weights.every((value) => Number.isInteger(value) && value > 0));
  }
  assert.deepEqual(weights, [10_000]);
  assert.deepEqual(distributeWeights([]), []);
});

test("redistribution retains relative allocations and handles tiny remaining weights", () => {
  const proportional = distributeWeights([3_000, 2_000]);
  assert.ok(Math.abs(proportional[0] - 6_000) <= 1);
  assert.ok(Math.abs(proportional[1] - 4_000) <= 1);
  assert.deepEqual(distributeWeights([1, 1]), [5_000, 5_000]);
  assert.deepEqual(distributeWeights([1, 1, 1], 3), [1, 1, 1]);
});

test("slider extremes leave at least one basis point for each other asset", () => {
  for (let count = 2; count <= 20; count += 1) {
    const maximum = 10_000 - (count - 1);
    const otherWeights = distributeWeights(equalWeights(count).slice(1), 10_000 - maximum);
    assert.equal(maximum + otherWeights.reduce((sum, value) => sum + value, 0), 10_000);
    assert.ok(otherWeights.every((value) => value === 1));
  }
});

test("scroll affordance stops at the end, including fractional browser dimensions", () => {
  assert.equal(canScrollDown({ scrollHeight: 800, clientHeight: 320, scrollTop: 0 }), true);
  assert.equal(canScrollDown({ scrollHeight: 800, clientHeight: 320, scrollTop: 476 }), true);
  assert.equal(canScrollDown({ scrollHeight: 800, clientHeight: 320, scrollTop: 479.25 }), false);
  assert.equal(canScrollDown({ scrollHeight: 800, clientHeight: 320, scrollTop: 480 }), false);
  assert.equal(canScrollDown({ scrollHeight: 120, clientHeight: 120, scrollTop: 0 }), false);
});

test("live grouping preserves decimals and caret positions during middle edits", () => {
  assert.deepEqual(formatAmountEdit("12345.67", 8), { value: "12,345.67", caret: 9 });
  assert.deepEqual(formatAmountEdit("12,45.67", 3), { value: "1,245.67", caret: 3 });
  assert.deepEqual(formatAmountEdit("12345.67", 2), { value: "12,345.67", caret: 2 });
  assert.deepEqual(formatAmountEdit("1,345.67", 1), { value: "1,345.67", caret: 1 });
  assert.deepEqual(formatAmountEdit("1000.", 5), { value: "1,000.", caret: 6 });
  assert.deepEqual(formatAmountEdit("1000.00", 7), { value: "1,000.00", caret: 8 });
  assert.deepEqual(formatAmountEdit(".5", 2), { value: ".5", caret: 2 });
});

test("clear and boundary amounts retain existing validation, without rounding drafts", () => {
  assert.deepEqual(formatAmountEdit("", 0), { value: "", caret: 0 });
  assert.equal(parseGroupedAmountInput(""), null);
  assert.equal(parseGroupedAmountInput("0"), 0);
  const cap = formatAmountEdit("1000000.00", 10);
  assert.equal(cap?.value, "1,000,000.00");
  assert.equal(parseGroupedAmountInput(cap!.value), 1_000_000);
  const overCap = formatAmountEdit("1000000.01", 10);
  assert.equal(parseGroupedAmountInput(overCap!.value), 1_000_000.01);
  for (const invalid of ["1e6", "-1", "0.001", "10000000", "NaN", "$1,000"]) {
    assert.equal(formatAmountEdit(invalid, invalid.length), null);
  }
  assert.equal(parseGroupedAmountInput("1,00"), null, "malformed pasted groups are rejected");
});

test("existing copied amounts keep their precision without widening new input rules", () => {
  for (const original of [0.001, 0.0000001, 1234.56789]) {
    const draft = initialAmountDraft(original);
    assert.equal(/[eE]/.test(draft), false);
    assert.equal(parseCreateAmount(draft, original), original);
  }
  assert.equal(parseCreateAmount("0.001", 1000), null);
  assert.equal(parseCreateAmount("1e3", 1000), null);
  assert.equal(parseCreateAmount("", 1000), null);
});
