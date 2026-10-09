import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioPositionCard } from "../components/portfolio/position-card";
import { parsePortfolioData, portfolioCoverageMessage, portfolioEmptyState, portfolioShareAmount } from "./portfolio-data";

const basket = "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k";
const otherBasket = "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF";
const observedAt = "2026-10-09T15:12:13.456Z";
const complete = { indexedBaskets: 2, verifiedBaskets: 2, complete: true };
const partial = { indexedBaskets: 2, verifiedBaskets: 1, complete: false };
const quality = { eligible: true, complete: true, status: "complete", stale: false };
const snapshot = (overrides: Record<string, unknown> = {}) => ({ basket, share_balance: "1000001", cost_basis: null,
  nav: null, estimatedValue: null, source: "finalized-balance-snapshot", projectionStatus: "snapshot-verified",
  balanceEvidence: { slot: 123456789, observedAt, historyComplete: false, costBasisKnown: false }, ...overrides });
const indexed = (overrides: Record<string, unknown> = {}) => ({ basket: otherBasket, share_balance: "2000000",
  source: "onchain-indexed", projectionStatus: "indexed", quality, estimatedValue: "12.3456", asOf: observedAt, ...overrides });

test("finalized current balances retain exact raw shares without manufacturing history or USD", () => {
  const data = parsePortfolioData({ data: [snapshot({ share_balance: "18446744073709551615", estimatedValue: "9999",
    cost_basis: "5000", quality, nav: { value: "100" }, projection_pending: true })], coverage: complete });
  assert.equal(data.positions.length, 1);
  assert.equal(data.positions[0].share_balance, "18446744073709551615");
  assert.deepEqual(data.positions[0].balanceEvidence, snapshot().balanceEvidence);
  assert.equal(data.positions[0].estimatedValue, null);
  assert.equal(data.totalValue, null);
  assert.equal(data.positions[0].kind, "snapshot");
});

test("rendered snapshot shows exact units/raw, finalized slot and unknown acquisition cost", () => {
  const data = parsePortfolioData({ data: [snapshot({ share_balance: "18446744073709551615", estimatedValue: "9999", quality })], coverage: partial });
  const html = renderToStaticMarkup(createElement(PortfolioPositionCard, { position: data.positions[0], headline: "Existing basket", composition: "AAA 50 · BBB 50" }));
  assert.match(html, /Existing basket/);
  assert.match(html, /AAA 50/);
  assert.match(html, /18,446,744,073,709\.551615/);
  assert.match(html, /18446744073709551615/);
  assert.match(html, /Finalized slot/);
  assert.match(html, /123,456,789/);
  assert.match(html, /2026-10-09 15:12 UTC/);
  assert.match(html, /History incomplete; cost basis unknown/);
  assert.match(html, /USD value unavailable/);
  assert.doesNotMatch(html, /\$9,999|24h|return|yield/i);
});

test("pending/rebuild legacy rows never become verified positions even with prices and eligibility", () => {
  for (const row of [indexed({ projectionStatus: "history-pending" }), indexed({ projectionStatus: "rebuild-required" }),
    indexed({ projection_pending: true }), indexed({ legacy_projection_pending: true }), indexed({ projectionStatus: undefined })]) {
    const data = parsePortfolioData({ data: [row], coverage: complete, share_price: "9999" });
    assert.equal(data.positions.length, 0);
    assert.equal(data.withheldPositions, 1);
    assert.equal(data.totalValue, null);
    assert.equal(portfolioEmptyState(data).chip, "INCOMPLETE");
  }
});

test("snapshot source, projection marker and every evidence field are required", () => {
  const evidence = snapshot().balanceEvidence;
  for (const row of [snapshot({ source: "onchain-indexed" }), snapshot({ projectionStatus: "indexed" }),
    snapshot({ balanceEvidence: null }), ...[
      { ...evidence, historyComplete: true }, { ...evidence, costBasisKnown: true },
      { ...evidence, slot: "123" }, { ...evidence, slot: -1 }, { ...evidence, slot: 1.5 },
      { ...evidence, slot: Number.MAX_SAFE_INTEGER + 1 }, { ...evidence, observedAt: "2026-02-30T00:00:00.000Z" },
      { ...evidence, observedAt: "2026-10-09" }, { ...evidence, observedAt: undefined },
    ].map(balanceEvidence => snapshot({ balanceEvidence }))]) {
    const data = parsePortfolioData({ data: [row], coverage: complete });
    assert.equal(data.positions.length, 0);
    assert.equal(portfolioEmptyState(data).chip, "INCOMPLETE");
  }
});

test("raw shares require canonical u64 strings; exact zero never creates a position", () => {
  for (const share_balance of [1, "-1", "+1", "01", "1e6", " 1", "1.0", "18446744073709551616", "9".repeat(100)]) {
    assert.equal(parsePortfolioData({ data: [snapshot({ share_balance })], coverage: complete }).withheldPositions, 1);
  }
  const zero = parsePortfolioData({ data: [snapshot({ share_balance: "0" })], coverage: complete });
  assert.equal(zero.positions.length, 0);
  assert.equal(zero.withheldPositions, 0);
  assert.equal(portfolioEmptyState(zero).chip, "CHECKED BASKETS");
});

test("share display preserves tiny amounts and every digit above Number precision", () => {
  assert.equal(portfolioShareAmount("1"), "0.000001");
  assert.equal(portfolioShareAmount("1000000"), "1");
  assert.equal(portfolioShareAmount("9007199254740993"), "9,007,199,254.740993");
  assert.equal(portfolioShareAmount("18446744073709551615"), "18,446,744,073,709.551615");
  for (const raw of ["-1", "01", "1e6", "18446744073709551616"]) assert.equal(portfolioShareAmount(raw), "—");
});

test("missing, contradictory or zero-catalog coverage cannot establish an empty wallet", () => {
  for (const coverage of [undefined, null, {}, partial, { indexedBaskets: 0, verifiedBaskets: 0, complete: false },
    { ...complete, verifiedBaskets: 3 }, { ...complete, indexedBaskets: "2" }, { ...complete, complete: "true" },
    { ...complete, verifiedBaskets: -1 }, { ...partial, complete: true }, { ...complete, complete: false }]) {
    const data = parsePortfolioData({ data: [], coverage });
    const state = portfolioEmptyState(data);
    assert.equal(state.chip, "INCOMPLETE");
    assert.match(state.description, /does not establish that your wallet has no holdings/);
  }
});

test("complete empty snapshot scope is limited explicitly to checked indexed baskets", () => {
  const data = parsePortfolioData({ data: [], coverage: complete });
  const state = portfolioEmptyState(data);
  assert.equal(state.title, "No shares in checked baskets");
  assert.match(state.description, /2 indexed baskets/);
  assert.match(state.description, /indexed baskets only/);
  assert.doesNotMatch(state.title, /empty wallet|no holdings/i);
});

test("partial coverage keeps verified holdings visible without implying a wallet total", () => {
  const data = parsePortfolioData({ data: [snapshot(), indexed()], coverage: partial });
  assert.equal(data.positions.length, 2);
  assert.equal(data.source, "finalized balances + indexed history");
  assert.equal(data.positions[1].estimatedValue, 12.3456);
  assert.equal(data.totalValue, null);
  assert.match(portfolioCoverageMessage(data), /1 of 2 indexed baskets checked/);
  assert.match(portfolioCoverageMessage(data), /incomplete/);
});

test("indexed value is supplied by that row and requires complete current eligibility", () => {
  for (const patch of [{ estimatedValue: null, share_price: "999" }, { quality: null }, { quality: { eligible: true } },
    { quality: { ...quality, stale: true } }, { quality: { ...quality, complete: false } }, { price_source: "mock:AAA" },
    { estimatedValue: "Infinity" }, { estimatedValue: "1e6" }, { estimatedValue: "-10" }, { estimatedValue: "01" },
    { estimatedValue: "0" }, { estimatedValue: 10 }, { dataQuality: {} }]) {
    const data = parsePortfolioData({ data: [indexed(patch)], coverage: complete });
    assert.equal(data.positions.length, 1);
    assert.equal(data.positions[0].estimatedValue, null);
    assert.equal(data.totalValue, null);
  }
  const position = parsePortfolioData({ data: [indexed()], coverage: partial }).positions[0];
  const html = renderToStaticMarkup(createElement(PortfolioPositionCard, { position, headline: "Indexed basket" }));
  assert.match(html, /\$12\.35/);
  assert.match(html, /value \(reference\)/);
  assert.doesNotMatch(html, /finalized|Finalized slot/);
});

test("duplicates and malformed basket identities are withheld rather than summed", () => {
  for (const data of [[snapshot(), snapshot()], [snapshot(), indexed({ basket })], [snapshot({ basket: "../wallet" })],
    [snapshot({ basket: "1".repeat(33) })], [snapshot(), null]]) {
    const result = parsePortfolioData({ data, coverage: complete });
    assert.equal(result.totalValue, null);
    assert.ok(result.withheldPositions > 0);
    assert.match(portfolioCoverageMessage(result), /incomplete/);
  }
});

test("malformed or unbounded row lists fail closed instead of proving no holdings", () => {
  for (const value of [null, {}, { data: null, coverage: complete }, { data: Array(1001).fill(snapshot()), coverage: complete }]) {
    const data = parsePortfolioData(value);
    assert.equal(data.positions.length, 0);
    assert.equal(data.coverage, null);
    assert.equal(portfolioEmptyState(data).chip, "INCOMPLETE");
  }
});
