import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { onchainTokenDisplay } from "./onchain-token-display";
import { avatarArt } from "./avatar-art";
import { getConceptAsset } from "./concept-assets";
import { allocationColor, NEUTRAL_ALLOCATION_COLOR } from "./allocation-colors";

const fixture = "CrjoC7fq5XAbdej5zjinKNGXVqo8E8qCmh8XSiu2QViQ";
test("stock-themed demo branding requires an exact mock mint and devnet context", () => {
  const display = onchainTokenDisplay("A", fixture, true);
  assert.equal(display.label, "Tesla");
  assert.equal(display.symbol, "TSLA");
  assert.equal(display.secondaryLabel, "TSLA · test token");
  assert.match(display.sourceLabel, /BSTESTA/);
  assert.match(display.sourceLabel, /not issuer-backed/);
  assert.equal(display.isTestToken, true);
  assert.equal(onchainTokenDisplay("A", undefined, true).label, "A");
  assert.equal(onchainTokenDisplay("A", "other-mint", true).label, "A");
  assert.equal(onchainTokenDisplay("A", fixture, false).label, "A");
});
test("all four demo themes reuse preview logos and logo-derived colors", () => {
  for (const [mint, symbol] of [
    [fixture, "TSLA"],
    ["EpH2swtxW2rCuFg2o2ukD5Qw5Xv3toaug1M3mbcB4hab", "NVDA"],
    ["5G1hMSqs2nWKaFQt737FTxwnruPgeQqQWZ2FRoqxvehA", "PLTR"],
    ["8W2hrfJPPrXEBjs5gDgpVZcs8HsELeHkBaqSjnUvgJUq", "COIN"],
  ]) {
    const display = onchainTokenDisplay("untrusted ticker", mint, true);
    assert.equal(display.symbol, symbol);
    assert.equal(display.src, getConceptAsset(symbol)?.logoUrl);
    assert.equal(display.color, allocationColor(symbol));
  }
});
test("other devnet stock-symbol fixtures keep their ticker and remain visibly test tokens", () => {
  const display = onchainTokenDisplay("NVDA", "mock-mint", true);
  assert.equal(display.label, "NVIDIA");
  assert.equal(display.symbol, "NVDA");
  assert.equal(display.src, getConceptAsset("NVDA")?.logoUrl);
  assert.equal(display.color, allocationColor("NVDA"));
  assert.match(display.secondaryLabel, /test token/);
});
test("unknown mainnet mint cannot inherit stock issuer identity from a supplied ticker", () => {
  const display = onchainTokenDisplay("NVDA", "unknown-mainnet-mint", false);
  assert.equal(display.label, "NVDA");
  assert.equal(display.src, "/images/devnet-tokens/core.svg");
  assert.equal(display.color, NEUTRAL_ALLOCATION_COLOR);
  assert.equal(display.isTestToken, false);
  const known = getConceptAsset("NVDA");
  assert.ok(known?.mint);
  assert.equal(onchainTokenDisplay("wrong-symbol", known.mint, false).label, "NVIDIA");
});
test("caller-supplied URLs cannot choose token artwork", () => {
  for (const symbol of ["unknown", "https://example.com/image", ""]) {
    const display = onchainTokenDisplay(symbol, "unknown-mint", true);
    assert.equal(display.src, "/images/devnet-tokens/core.svg");
    assert.ok(existsSync(resolve("public", display.src.slice(1))));
  }
});
test("avatars stay stable, local and independent of any public wallet API", () => {
  const a = avatarArt("first-wallet");
  assert.equal(a, avatarArt("first-wallet"));
  assert.notEqual(a, avatarArt("second-wallet"));
  for (let i = 0; i < 200; i++) {
    const src = avatarArt(`wallet-${i}`);
    assert.match(src, /^\/images\/avatars\/notionist-\d{2}\.svg$/);
    assert.ok(existsSync(resolve("public", src.slice(1))));
  }
});
