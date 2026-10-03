import assert from "node:assert/strict";
import test from "node:test";
import snapshot from "../lib/data/xstocks.snapshot.json";
import { filterXStocks, findXStock, matchesAssetSearch, assetSearchRank, isSolanaMint, normalizeXStockAssets, parseXStockQuote, currentXStockChange, mergeXStockQuotes, unavailableXStockQuote, type XStockAsset } from "../lib/xstock-types";
import { XSTOCK_SNAPSHOT, fetchXStockPrices, fetchXStockPricePage } from "../lib/xstock-catalog";
import { DISCOVERY_ASSETS, LEGACY_CONCEPT_ASSETS, getConceptAsset, getConceptAssetName, getConceptAssetLogo } from "../lib/concept-assets";
import { validateConceptBasket, type ConceptBasket } from "../lib/concept-basket";
import { decodeConceptBasket, encodeConceptBasket } from "../lib/concept-share";

const assets = normalizeXStockAssets(snapshot.data);
const first = assets[0];
const second = assets[1];
const futureMint = "11111111111111111111111111111111";
const sample: ConceptBasket = { v: 1, name: "New issuer assets", thesis: "A stock basket idea", amountUsd: 1_000, assets: [{ symbol: first.underlyingSymbol.toUpperCase(), weightBps: 5000, mint: first.mint }, { symbol: second.underlyingSymbol.toUpperCase(), weightBps: 5000, mint: second.mint }], fees: { entryBps: 0, exitBps: 0, managementBps: 100 } };

test("all snapshot assets survive validation without mock prices or wrong-chain rows", () => {
  assert.equal(assets.length, snapshot.data.length);
  assert.ok(assets.length > 1000);
  assert.equal(new Set(assets.map((asset) => asset.mint)).size, assets.length);
  assert.equal(DISCOVERY_ASSETS.length, assets.length);
  for (const asset of assets) {
    assert.ok(isSolanaMint(asset.mint));
    assert.equal(asset.network, "solana");
    assert.equal("priceUsd" in asset, false);
  }
  assert.deepEqual(normalizeXStockAssets([{ ...first, network: "ethereum" }, { ...first, mint: "not-a-mint" }]), []);
  assert.equal(normalizeXStockAssets([first, first]).length, 1);
  assert.equal(XSTOCK_SNAPSHOT.meta.source, "snapshot");
  assert.equal(XSTOCK_SNAPSHOT.meta.stale, true);
});

test("search covers the complete catalog by token, underlying, name and mint", () => {
  for (const asset of assets) {
    assert.ok(filterXStocks(assets, asset.mint).some((row) => row.mint === asset.mint));
    assert.equal(findXStock(assets, asset.symbol)?.mint, asset.mint);
    assert.equal(findXStock(assets, asset.underlyingSymbol)?.mint, asset.mint);
  }
  const apple = findXStock(assets, "AAPLx")!;
  assert.ok(filterXStocks(assets, "apple").some((row) => row.mint === apple.mint));
  assert.ok(filterXStocks(assets, "aaplx").some((row) => row.mint === apple.mint));
  assert.deepEqual(filterXStocks(assets, "there-is-no-such-asset-xyz"), []);
});

test("short ticker searches ignore incidental mint substrings but full mint searches still work", () => {
  const coupang = findXStock(assets, "CPNGx")!;
  const vti = findXStock(assets, "VTIx")!;
  assert.ok(coupang.mint.toLowerCase().includes("vti"), "fixture reproduces the random mint substring");
  const results = filterXStocks(assets, "VTI");
  assert.equal(results[0]?.mint, vti.mint);
  assert.ok(!results.some((asset) => asset.mint === coupang.mint));
  assert.equal(filterXStocks(assets, coupang.mint)[0]?.mint, coupang.mint);
  assert.ok(filterXStocks(assets, coupang.mint.slice(0, 8)).some((asset) => asset.mint === coupang.mint));
  const createCoupang = DISCOVERY_ASSETS.find((asset) => asset.mint === coupang.mint)!;
  const createVti = DISCOVERY_ASSETS.find((asset) => asset.mint === vti.mint)!;
  assert.equal(matchesAssetSearch(createCoupang, "VTI"), false);
  assert.equal(matchesAssetSearch(createCoupang, coupang.mint), true);
  assert.equal(matchesAssetSearch(createVti, "vti"), true);
  assert.equal(assetSearchRank(createVti, "VTI"), 0);
});

test("verified ETFs include more than SPY and unknown classification stays discoverable", () => {
  const etfs = filterXStocks(assets, "", "etf");
  assert.ok(etfs.length > 1);
  for (const ticker of ["SPYx", "QQQx"]) assert.ok(etfs.some((asset) => asset.symbol === ticker));
  assert.ok(etfs.every((asset) => asset.assetClass === "etf"));
  const unknown = assets.find((asset) => asset.assetClass === "unknown")!;
  assert.ok(filterXStocks(assets, unknown.mint).length === 1);
  assert.deepEqual(filterXStocks(assets, unknown.mint, "etf"), []);
});

test("mint validation checks decoded32bytes, rejecting malformed or oversized addresses", () => {
  assert.ok(isSolanaMint(first.mint));
  assert.ok(isSolanaMint("11111111111111111111111111111111"));
  for (const mint of ["1111111111111111111111111111111", "111111111111111111111111111111111", "O".repeat(44), "z".repeat(44), "", null]) assert.equal(isSolanaMint(mint), false);
});

test("v3 links preserve new asset mint identities and legacy v2 stays unchanged", () => {
  const encoded = encodeConceptBasket(sample);
  assert.ok(encoded.startsWith("3."));
  assert.deepEqual(decodeConceptBasket(encoded), sample);
  const legacy = { ...sample, assets: [{ symbol: "AAPL", weightBps: 5000 }, { symbol: "MSFT", weightBps: 5000 }] };
  assert.ok(encodeConceptBasket(legacy).startsWith("2."));
  assert.deepEqual(decodeConceptBasket(encodeConceptBasket(legacy)), legacy);
  assert.equal(LEGACY_CONCEPT_ASSETS.length, 41);
});

test("future issuer assets and exchange-qualified or numeric symbols round-trip independently of bundled metadata", () => {
  for (const symbol of ["NEWISSUER", "XETR:SHLD", "MTAA:GM", "625"]) {
    const officialMint = assets.find((asset) => asset.underlyingSymbol.toUpperCase() === symbol)?.mint;
    const basket = { ...sample, assets: [{ symbol, weightBps: 5000, mint: officialMint ?? futureMint }, sample.assets[1]] };
    assert.equal(validateConceptBasket(basket).ok, true);
    assert.deepEqual(decodeConceptBasket(encodeConceptBasket(basket)), basket);
  }
  const bareUnknown = { ...sample, assets: [{ symbol: "UNKNOWN", weightBps: 5000 }, sample.assets[1]] };
  assert.equal(validateConceptBasket(bareUnknown).ok, false);
  assert.equal(validateConceptBasket({ ...sample, assets: [{ ...sample.assets[0], mint: "bad" }, sample.assets[1]] }).ok, false);
  assert.equal(validateConceptBasket({ ...sample, assets: [{ ...sample.assets[0], symbol: "<script>" }, sample.assets[1]] }).ok, false);
  assert.equal(validateConceptBasket({ ...sample, assets: [{ ...sample.assets[0] }, { ...sample.assets[1], mint: first.mint }] }).ok, false);
});

test("known symbol and mint identities cannot be mixed in v3 links", () => {
  const apple = findXStock(assets, "AAPLx")!;
  const microsoft = findXStock(assets, "MSFTx")!;
  const pair = { ...sample, assets: [{ symbol: "AAPL", weightBps: 5000, mint: apple.mint }, { symbol: "MSFT", weightBps: 5000, mint: microsoft.mint }] };
  assert.equal(validateConceptBasket(pair).ok, true);
  assert.deepEqual(decodeConceptBasket(encodeConceptBasket(pair)), pair);
  const wrong = { ...pair, assets: [{ symbol: "AAPL", weightBps: 5000, mint: microsoft.mint }, { symbol: "MSFT", weightBps: 5000, mint: apple.mint }] };
  assert.equal(validateConceptBasket(wrong).ok, false);
  const unsafeLink = `3.${Buffer.from(JSON.stringify([3, "Mixed identity", 1000, ["AAPL", 5000, microsoft.mint, "MSFT", 5000, apple.mint]])).toString("base64url")}`;
  assert.equal(decodeConceptBasket(unsafeLink), null);
  assert.equal(validateConceptBasket({ ...pair, assets: [{ symbol: "NEWISSUER", weightBps: 5000, mint: apple.mint }, pair.assets[1]] }).ok, false);
  assert.equal(getConceptAsset("AAPL", microsoft.mint)?.symbol, "MSFT", "metadata uses the mint identity rather than the claimed text");
});

test("unknown future mint metadata never borrows a known company name or logo", () => {
  const future = { ...sample, assets: [{ symbol: "FUTUREISSUER", weightBps: 5000, mint: futureMint }, sample.assets[1]] };
  assert.equal(validateConceptBasket(future).ok, true);
  assert.deepEqual(decodeConceptBasket(encodeConceptBasket(future)), future);
  assert.equal(getConceptAsset("FUTUREISSUER", futureMint), undefined);
  assert.equal(getConceptAssetName("FUTUREISSUER", futureMint), "FUTUREISSUER");
  assert.equal(getConceptAssetLogo("FUTUREISSUER", futureMint), null);
  assert.equal(getConceptAssetName("AAPL", futureMint), "AAPL", "no Apple metadata is borrowed for an unknown mint");
  assert.equal(getConceptAssetLogo("AAPL", futureMint), null);
});

test("every official symbol can form a shared draft without network lookup", () => {
  for (const asset of assets) {
    const other = asset.mint === first.mint ? second : first;
    const basket = { ...sample, assets: [{ symbol: asset.underlyingSymbol.toUpperCase(), weightBps: 5000, mint: asset.mint }, { symbol: other.underlyingSymbol.toUpperCase(), weightBps: 5000, mint: other.mint }] };
    assert.equal(validateConceptBasket(basket).ok, true, asset.symbol);
    assert.deepEqual(decodeConceptBasket(encodeConceptBasket(basket)), basket, asset.symbol);
  }
});

test("token quotes fail closed for wrong identity, underlying sources and invalid numbers", () => {
  const valid = { mint: first.mint, priceUsd: 123.45, source: "jupiter", fetchedAt: "2026-10-02T22:30:00Z", observedAt: "2026-09-27T22:30:00Z", blockId: 123, unit: "scaled-ui", change24hPct: 1.23, status: "available" };
  assert.equal(parseXStockQuote(valid, first.mint).priceUsd, 123.45);
  assert.equal(parseXStockQuote(valid, first.mint).observedAt, "2026-09-27T22:30:00Z");
  for (const override of [{ mint: second.mint }, { priceUsd: 0 }, { priceUsd: NaN }, { priceUsd: null }, { source: "yahoo" }, { unit: "raw" }, { status: "unavailable" }]) assert.equal(parseXStockQuote({ ...valid, ...override }, first.mint).priceUsd, null);
  assert.equal(parseXStockQuote({ ...valid, observedAt: null }, first.mint).observedAt, null, "retrieval time must not replace unknown source time");
});

test("quote requests contain only the visible page and missing quotes remain null", async () => {
  const originalFetch = globalThis.fetch;
  const visible = assets.slice(0, 24);
  try {
    globalThis.fetch = async (url) => {
      const requested = new URL(String(url)).searchParams.get("mints")!.split(",");
      assert.deepEqual(requested, visible.map((asset) => asset.mint));
      return Response.json({ data: [{ mint: visible[0].mint, priceUsd: 99, source: "jupiter", unit: "scaled-ui", status: "available", observedAt: null }] });
    };
    const prices = await fetchXStockPrices(visible.map((asset) => asset.mint));
    assert.equal(prices.length, 24);
    assert.equal(prices[0].priceUsd, 99);
    assert.ok(prices.slice(1).every((quote) => quote.priceUsd === null));
  } finally { globalThis.fetch = originalFetch; }
});

test("cached refresh failures preserve same-token prices and their source dates", () => {
  const known = parseXStockQuote({ mint: first.mint, priceUsd: 99, source: "jupiter", status: "available", unit: "scaled-ui",
    fetchedAt: "2026-10-02T22:30:00Z", observedAt: "2026-10-02T22:29:00Z", change24hPct: 2 }, first.mint);
  const previous = new Map([[first.mint, known]]);
  for (const reason of ["outage", "omitted"] as const) {
    const result = mergeXStockQuotes(previous, [unavailableXStockQuote(first.mint, reason)]).get(first.mint)!;
    assert.equal(result.priceUsd, 99); assert.equal(result.stale, true);
    assert.equal(result.observedAt, known.observedAt); assert.equal(result.fetchedAt, known.fetchedAt);
  }
  assert.equal(mergeXStockQuotes(previous, [unavailableXStockQuote(second.mint, "outage")]).get(second.mint)?.priceUsd, null);
  assert.equal(mergeXStockQuotes(previous, [unavailableXStockQuote(first.mint)]).get(first.mint)?.priceUsd, null);
});
test("server cache freshness is parsed independently of source price age", () => {
  const quote = parseXStockQuote({ mint: first.mint, priceUsd: 99, source: "jupiter", status: "available", unit: "scaled-ui",
    fetchedAt: "2026-10-02T22:30:00Z", observedAt: "2026-09-27T22:29:00Z", stale: true, freshness: "stale",
    refreshedAt: "2026-10-03T00:00:00Z", refreshReason: "outage" }, first.mint);
  assert.equal(quote.stale, true); assert.equal(quote.refreshReason, "outage");
  assert.equal(quote.observedAt, "2026-09-27T22:29:00Z");
  assert.equal(quote.refreshedAt, "2026-10-03T00:00:00Z");
});


test("provider omission and malformed refresh payloads retain the prior quote through fetch and merge", async () => {
  const originalFetch = globalThis.fetch;
  const known = parseXStockQuote({ mint: first.mint, priceUsd: 123, source: "jupiter", status: "available", unit: "scaled-ui", fetchedAt: "2026-10-02T22:30:00Z", observedAt: "2026-10-02T22:29:00Z" }, first.mint);
  try {
    for (const [payload, reason] of [[{ data: [] }, "omitted"], [{ data: {} }, "outage"]] as const) {
      globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
      const quotes = await fetchXStockPrices([first.mint]);
      assert.equal(quotes[0].refreshReason, reason);
      const merged = mergeXStockQuotes(new Map([[first.mint, known]]), quotes).get(first.mint)!;
      assert.equal(merged.priceUsd, known.priceUsd);
      assert.equal(merged.observedAt, known.observedAt);
      assert.equal(merged.fetchedAt, known.fetchedAt);
      assert.equal(merged.stale, true);
    }
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ mint: first.mint, source: "yahoo", priceUsd: 999, status: "available", unit: "scaled-ui" }] }), { status: 200 })) as typeof fetch;
    const invalid = await fetchXStockPrices([first.mint]);
    assert.equal(mergeXStockQuotes(new Map([[first.mint, known]]), invalid).get(first.mint)?.priceUsd, null);
  } finally { globalThis.fetch = originalFetch; }
});


test("24h movement requires a recent traceable source price even when the cache just refreshed", () => {
  const now = Date.parse("2026-10-03T00:00:00Z");
  const quote = parseXStockQuote({ mint: first.mint, priceUsd: 99, source: "jupiter", status: "available", unit: "scaled-ui", fetchedAt: "2026-10-03T00:00:00Z", observedAt: "2026-10-02T23:59:00Z", change24hPct: 2 }, first.mint);
  assert.equal(currentXStockChange(quote, now), 2);
  assert.equal(currentXStockChange({ ...quote, observedAt: "2026-09-27T00:00:00Z" }, now), null);
  assert.equal(currentXStockChange({ ...quote, observedAt: null }, now), null);
  assert.equal(currentXStockChange({ ...quote, stale: true }, now), null);
});


test("closed-market metadata accompanies cached reads without changing quote source dates", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ mint: first.mint, priceUsd: 99, source: "jupiter", status: "available", unit: "scaled-ui", stale: true, observedAt: "2026-10-02T19:59:00Z", fetchedAt: "2026-10-02T20:00:00Z" }], meta: { marketSession: { status: "closed", isOpen: false, nextOpenAt: "2026-10-05T13:30:00Z" } } }), { status: 200 })) as typeof fetch;
    const result = await fetchXStockPricePage([first.mint]);
    assert.equal(result.marketSession?.status, "closed");
    assert.equal(result.marketSession?.nextOpenAt, "2026-10-05T13:30:00Z");
    assert.equal(result.data[0].observedAt, "2026-10-02T19:59:00Z");
  } finally { globalThis.fetch = originalFetch; }
});
