import assert from "node:assert/strict";
import test from "node:test";
import { formatBps, formatBpsAsPercent, formatGroupedAmountInput, formatNumber, formatPercent, formatTokenAmount, formatUsd, NOT_A_NUMBER_LABEL, parseGroupedAmountInput } from "./format";

test("USD uses full en-US comma grouping without compact suffixes or scientific notation", () => {
  assert.equal(formatUsd(1_000), "$1,000.00");
  assert.equal(formatUsd(1_000_000), "$1,000,000.00");
  assert.equal(formatUsd(1.52e12), "$1,520,000,000,000.00");
  assert.equal(formatUsd(1_234.5, { maximumFractionDigits: 0 }), "$1,235");
  assert.equal(formatUsd(0.1234), "$0.1234");
});

test("plain counts and percentages group thousands while keeping their units", () => {
  assert.equal(formatNumber(1_234_567), "1,234,567");
  assert.equal(formatNumber(12_345.67, { maximumFractionDigits: 2 }), "12,345.67");
  assert.equal(formatPercent(1_234.5, { signed: true }), "+1,234.50%");
  assert.equal(formatBps(1_234), "1,234 bps");
});

test("missing and invalid numbers share one safe placeholder", () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(formatUsd(value), NOT_A_NUMBER_LABEL);
    assert.equal(formatPercent(value), NOT_A_NUMBER_LABEL);
    assert.equal(formatNumber(value), NOT_A_NUMBER_LABEL);
    assert.equal(formatTokenAmount(value), NOT_A_NUMBER_LABEL);
  }
});

test("exact and rounded zero never gain positive or negative signs", () => {
  assert.equal(formatUsd(-0), "$0.00");
  assert.equal(formatPercent(-0, { signed: true }), "0.00%");
  assert.equal(formatPercent(0, { signed: true }), "0.00%");
  assert.equal(formatNumber(-0.004, { maximumFractionDigits: 2, signed: true }), "0");
  assert.equal(formatBps(-0.004, { signed: true }), "0 bps");
  assert.equal(formatBpsAsPercent(-0.004), "0.00%");
  assert.equal(formatTokenAmount(-0), "0");
});

test("small nonzero changes preserve direction without fake signed-zero returns", () => {
  assert.equal(formatPercent(-0.004, { signed: true }), "-<0.01%");
  assert.equal(formatPercent(0.004, { signed: true }), "+<0.01%");
  assert.equal(formatUsd(-0.004, { maximumFractionDigits: 2 }), "-<$0.01");
  assert.equal(formatUsd(0.004, { maximumFractionDigits: 2 }), "<$0.01");
  assert.equal(formatUsd(-0.00001), "-<$0.0001");
  assert.equal(formatTokenAmount(-0.0000001), "-<0.000001");
});

test("rounding boundaries retain real negative and positive nonzero values", () => {
  assert.equal(formatUsd(0.005, { maximumFractionDigits: 2 }), "$0.01");
  assert.equal(formatUsd(-0.005, { maximumFractionDigits: 2 }), "-$0.01");
  assert.equal(formatPercent(-13.333333, { signed: true }), "-13.33%");
  assert.equal(formatPercent(12.345, { signed: true }), "+12.35%");
});

test("grouped amount input preserves decimal editing intent", () => {
  for (const [raw, formatted] of [["1000", "1,000"], ["1000.", "1,000."], ["1000.00", "1,000.00"], ["1000000.50", "1,000,000.50"], ["", ""], [".", "."], [".5", ".5"], ["0.50", "0.50"], ["1,000.00", "1,000.00"]]) {
    assert.equal(formatGroupedAmountInput(raw), formatted);
  }
  assert.equal(formatGroupedAmountInput(1_000), "1,000");
});

test("amount parsing accepts raw or correctly grouped digits without changing values", () => {
  assert.equal(parseGroupedAmountInput("1000"), 1_000);
  assert.equal(parseGroupedAmountInput("1,000.00"), 1_000);
  assert.equal(parseGroupedAmountInput("1,000."), 1_000);
  assert.equal(parseGroupedAmountInput("1,000,000.50"), 1_000_000.5);
  assert.equal(parseGroupedAmountInput(".5"), 0.5);
  assert.equal(parseGroupedAmountInput("0"), 0);
});

test("malformed grouping, exponent notation and incomplete drafts cannot become zero", () => {
  for (const value of ["", " ", ".", "1,00", "1,000,00", "1,00,000", "1e3", "1E3", "$1,000", "-10", "1 000", "1.2.3", "1.234", "10000000", "1,000,0000"]) {
    assert.equal(parseGroupedAmountInput(value), null, value);
  }
  for (const value of ["1,00", "1e3", "1.234", "10000000"]) assert.equal(formatGroupedAmountInput(value), "");
});

test("non-finite numeric amount drafts never render invalid text", () => {
  for (const value of [NaN, Infinity, -Infinity, -1]) assert.equal(formatGroupedAmountInput(value), "");
});
