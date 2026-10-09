import assert from "node:assert/strict";
import test from "node:test";
import type { ConceptBasket } from "./concept-basket";
import { decodeConceptBasket } from "./concept-share";
import { basketPublicLink, basketSocialText, basketXIntent } from "./basket-social-share";

const basket: ConceptBasket = {
  v: 1,
  name: "Chip & Build / #1",
  thesis: "Infrastructure, useful products and patient conviction.",
  coverId: "diamond-hands",
  assets: [{ symbol: "NVDA", weightBps: 6250 }, { symbol: "MSFT", weightBps: 3750 }],
  amountUsd: 1000,
  fees: { entryBps: 0, exitBps: 0, managementBps: 200 },
};

/** Deliberately conservative text budget: ASCII costs 1, other code points 2. */
const postWeight = (text: string) => Array.from(text).reduce((sum, char) => sum + (char.codePointAt(0)! <= 0x7f ? 1 : 2), 0);
const graphemes = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ segment }) => segment);

test("social text uses only the basket name and thesis, without invented financial claims", () => {
  assert.equal(basketSocialText(basket), `My stock basket: ${basket.name}\n\n${basket.thesis}`);
  assert.doesNotMatch(basketSocialText({ name: "My mix", thesis: "" }), /return|profit|APY|performance|\$|\d%/i);
});

test("short social text normalizes pasted thesis controls and whitespace", () => {
  assert.equal(basketSocialText({ name: "  My mix  ", thesis: "  AI\u0000\tand\n  energy\u007f " }), "My stock basket: My mix\n\nAI and energy");
});

test("ASCII post text includes its ellipsis within the conservative 230-unit budget", () => {
  const text = basketSocialText({ name: "My mix", thesis: "a".repeat(240) });
  assert.ok(text.endsWith("…"));
  assert.ok(postWeight(text) <= 230, `weighted length ${postWeight(text)}`);
});

test("non-Latin post text fits the conservative weighted budget", () => {
  for (const thesis of ["界".repeat(240), "İçgörü".repeat(40), "🚀".repeat(120)]) {
    const text = basketSocialText({ name: "My mix", thesis });
    assert.ok(text.endsWith("…"));
    assert.ok(postWeight(text) <= 230, `weighted length ${postWeight(text)}`);
  }
});

test("truncation keeps family emoji, flags and combining sequences intact", () => {
  for (const unit of ["👨‍👩‍👧‍👦", "👩🏽‍💻", "🇹🇷", "e\u0301"]) {
    const source = `My stock basket: Mix\n\n${unit.repeat(80)}`;
    const text = basketSocialText({ name: "Mix", thesis: unit.repeat(80) });
    assert.ok(text.endsWith("…"));
    assert.ok(postWeight(text) <= 230);
    const content = text.slice(0, -1);
    const sourceSegments = graphemes(source);
    assert.equal(sourceSegments.slice(0, graphemes(content).length).join(""), content);
  }
});

test("public links retain the selected cover and complete validated v4 basket", () => {
  const link = new URL(basketPublicLink(basket, "https://basalt.example"));
  assert.equal(link.origin, "https://basalt.example");
  assert.equal(link.pathname, "/preview");
  assert.match(link.searchParams.get("d")!, /^4\./);
  assert.deepEqual(decodeConceptBasket(link.searchParams.get("d")), basket);
});

test("public links use the origin and support local development without retaining unrelated paths", () => {
  const link = new URL(basketPublicLink(basket, "http://127.0.0.1:3000/unrelated?q=1#fragment"));
  assert.equal(link.origin, "http://127.0.0.1:3000");
  assert.equal(link.pathname, "/preview");
  assert.equal(link.hash, "");
  assert.deepEqual([...link.searchParams.keys()], ["d"]);
});

test("public links reject executable, file and credential-bearing site origins", () => {
  for (const origin of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "blob:https://basalt.example/id", "ftp://basalt.example", "https://user:password@basalt.example", "https://user@basalt.example", "not a URL"]) {
    assert.throws(() => basketPublicLink(basket, origin), Error, origin);
  }
});

test("X intent safely encodes editable text and a separate basket URL", () => {
  const special = { ...basket, thesis: "A & B? #conviction + patient picks / <idea> 🚀" };
  const intent = new URL(basketXIntent(special, "https://basalt.example"));
  assert.equal(intent.origin, "https://twitter.com");
  assert.equal(intent.pathname, "/intent/tweet");
  assert.deepEqual([...intent.searchParams.keys()].sort(), ["text", "url"]);
  assert.equal(intent.searchParams.get("text"), basketSocialText(special));
  assert.equal(intent.searchParams.get("url"), basketPublicLink(special, "https://basalt.example"));
  assert.deepEqual(decodeConceptBasket(new URL(intent.searchParams.get("url")!).searchParams.get("d")), special);
});

test("X intent contains no pretend media attachment, performance or wallet permission", () => {
  const intent = new URL(basketXIntent(basket, "https://basalt.example"));
  assert.equal(intent.searchParams.has("media"), false);
  assert.equal(intent.searchParams.has("media_ids"), false);
  assert.equal(intent.searchParams.has("wallet"), false);
  assert.equal(intent.searchParams.has("transaction"), false);
  assert.doesNotMatch(intent.searchParams.get("text")!, /\+\d+(?:\.\d+)?%|APY|guaranteed/i);
});
