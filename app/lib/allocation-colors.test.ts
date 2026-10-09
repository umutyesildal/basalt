import assert from "node:assert/strict";
import { test } from "node:test";

import { allocationColor, NEUTRAL_ALLOCATION_COLOR } from "./allocation-colors";
import { getConceptAsset, registerConceptAssets } from "./concept-assets";
import logoColors from "./data/asset-logo-colors.json";
import { XSTOCK_SNAPSHOT } from "./xstock-catalog";

const byLogo: Readonly<Record<string, string>> = logoColors;
const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
function hue(hex: string) {
  const [r, g, b] = rgb(hex), max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (!delta) return 0;
  const sector = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (sector * 60 + 360) % 360;
}
function luminance(hex: string) {
  const channels = rgb(hex).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test("the four reference holdings use colors derived from their actual logos", () => {
  for (const symbol of ["NVDA", "QQQ", "WMT", "GLD"]) {
    const asset = getConceptAsset(symbol);
    assert.ok(asset?.mint && asset.logoUrl, `${symbol} must resolve to the issuer catalog`);
    const expected = byLogo[asset.logoUrl];
    assert.match(expected, /^#[0-9A-F]{6}$/i);
    assert.equal(allocationColor(symbol), expected);
    assert.equal(allocationColor(symbol, asset.mint), expected);
    assert.equal(allocationColor(`  ${symbol.toLowerCase()}  `, asset.mint), expected);
  }
  assert.ok(hue(allocationColor("NVDA")) >= 70 && hue(allocationColor("NVDA")) <= 150, "NVIDIA remains green");
  assert.ok(hue(allocationColor("GLD")) >= 35 && hue(allocationColor("GLD")) <= 70, "Gold remains gold/yellow");
  for (const symbol of ["QQQ", "WMT"]) assert.ok(hue(allocationColor(symbol)) >= 195 && hue(allocationColor(symbol)) <= 265, `${symbol} remains blue`);
});

test("reordering or removing holdings cannot recolor the remaining assets", () => {
  const symbols = ["NVDA", "QQQ", "WMT", "GLD"];
  const original = new Map(symbols.map((symbol) => [symbol, allocationColor(symbol)]));
  for (const order of [symbols.slice().reverse(), ["GLD", "NVDA"], ["WMT", "QQQ", "NVDA"]]) {
    for (const symbol of order) assert.equal(allocationColor(symbol), original.get(symbol));
  }
});

test("unknown identities remain neutral and cannot borrow a known logo color", () => {
  const unknownMint = "1111111111111111111111111111111Aaa";
  assert.equal(allocationColor("NVDA", unknownMint), NEUTRAL_ALLOCATION_COLOR);
  assert.equal(allocationColor("RENAMED", unknownMint), NEUTRAL_ALLOCATION_COLOR);
  assert.equal(allocationColor("FUTURE"), NEUTRAL_ALLOCATION_COLOR);
  assert.notEqual(allocationColor("NVDA", unknownMint), allocationColor("NVDA"));
});

test("known mint metadata is authoritative for the displayed logo color", () => {
  const nvidia = getConceptAsset("NVDA");
  assert.ok(nvidia?.mint);
  assert.equal(allocationColor("NVDAx", nvidia.mint), allocationColor("NVDA"));
  assert.equal(allocationColor("WMT", nvidia.mint), allocationColor("NVDA"));
});

test("runtime metadata looks up its current logo URL rather than a stale ticker color", () => {
  const original = XSTOCK_SNAPSHOT.data[0];
  const gold = getConceptAsset("GLD")!, nvidia = getConceptAsset("NVDA")!;
  const future = { ...original, mint: "11111111111111111111111111111112", underlyingSymbol: "LOGOCOLORTEST", symbol: "LOGOCOLORTESTx", name: "Logo color test", logoUrl: gold.logoUrl };
  registerConceptAssets([future]);
  assert.equal(allocationColor("LOGOCOLORTEST", future.mint), byLogo[gold.logoUrl]);
  registerConceptAssets([{ ...future, logoUrl: nvidia.logoUrl }]);
  assert.equal(allocationColor("LOGOCOLORTEST", future.mint), byLogo[nvidia.logoUrl]);
  registerConceptAssets([{ ...future, logoUrl: "https://xstocks-metadata.backed.fi/logos/unseen-logo.png" }]);
  assert.equal(allocationColor("LOGOCOLORTEST", future.mint), NEUTRAL_ALLOCATION_COLOR);
});

test("cached colors are valid hex values and remain visible on the dark card", () => {
  for (const [url, color] of Object.entries(byLogo)) {
    assert.match(color, /^#[0-9A-F]{6}$/i, url);
    assert.ok((luminance(color) + 0.05) / (luminance("#111111") + 0.05) >= 3, `${url} marker contrast`);
  }
});


test("every official catalog logo has an extracted allocation color", () => {
  for (const asset of XSTOCK_SNAPSHOT.data) {
    assert.ok(asset.logoUrl && byLogo[asset.logoUrl], `${asset.symbol} must have a cached logo color`);
  }
});
