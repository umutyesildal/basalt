import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { onchainTokenDisplay } from "./onchain-token-display";
import { avatarArt } from "./avatar-art";

const fixture = "CrjoC7fq5XAbdej5zjinKNGXVqo8E8qCmh8XSiu2QViQ";
test("decorative token aliases require an exact mock mint and devnet context", () => {
  assert.equal(onchainTokenDisplay("A", fixture, true).label, "Core");
  assert.match(onchainTokenDisplay("A", fixture, true).sourceLabel, /BSTESTA/);
  assert.equal(onchainTokenDisplay("A", undefined, true).label, "A");
  assert.equal(onchainTokenDisplay("A", "other-mint", true).label, "A");
  assert.equal(onchainTokenDisplay("A", fixture, false).label, "A");
});
test("mock stock symbols retain their identity and use decorative local art", () => {
  const display = onchainTokenDisplay("NVDA", "mock-mint", true);
  assert.equal(display.label, "NVDA");
  assert.equal(display.src, "/images/devnet-tokens/chip.svg");
  assert.match(display.sourceLabel, /devnet test token/);
  assert.equal(onchainTokenDisplay("unknown", undefined, true).src, "/images/devnet-tokens/core.svg");
});
test("all decorative token sources exist locally and cannot come from supplied URLs", () => {
  for (const symbol of ["NVDA", "AAPL", "MSFT", "META", "TSLA", "AMZN", "GOOGL", "https://example.com/image", ""]) {
    const src = onchainTokenDisplay(symbol, undefined, true).src;
    assert.ok(src.startsWith("/images/devnet-tokens/"));
    assert.ok(existsSync(resolve("public", src.slice(1))));
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
