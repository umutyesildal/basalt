import assert from "node:assert/strict";
import test from "node:test";
import type { ConceptBasket } from "./concept-basket";
import { decodeConceptBasket, encodeConceptBasket } from "./concept-share";
import { getConceptAsset } from "./concept-assets";
import { basketPublicLink, basketSocialText, basketXIntent, ensureBasketPublicLink } from "./basket-social-share";

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


const snapshotBasket = (name: string): ConceptBasket => ({
  ...basket,
  name,
  thesis: "A complete thesis with its own fees, token identities and selected artwork.",
  amountUsd: 1234.56,
  coverId: "moon-shot",
  assets: [
    { symbol: "NVDA", weightBps: 6150, mint: getConceptAsset("NVDA")!.mint! },
    { symbol: "MSFT", weightBps: 3850, mint: getConceptAsset("MSFT")!.mint! },
  ],
  fees: { entryBps: 125, exitBps: 35, managementBps: 175 },
});

async function withShareFetch(mock: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}

test("short links deduplicate pending equivalent snapshots and keep the captured full v4 basket immutable", { concurrency: false }, async () => {
  const input = snapshotBasket("Immutable concurrent snapshot");
  const original = structuredClone(input);
  const bodies: string[] = [];
  let resolveFirst!: (response: Response) => void;
  const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
  await withShareFetch(async (url, init) => {
    assert.equal(new URL(String(url)).pathname, "/api/v1/basket-shares");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    bodies.push(String(init?.body));
    return bodies.length === 1 ? firstResponse : Response.json({ data: { id: "B".repeat(20) } });
  }, async () => {
    const first = ensureBasketPublicLink(input, "https://basalt.markets");
    const second = ensureBasketPublicLink(structuredClone(input), "http://127.0.0.1:3000");
    assert.equal(bodies.length, 1);
    input.assets[0].weightBps = 6000;
    input.assets[1].weightBps = 4000;
    input.thesis = "A later edit creates a separate immutable snapshot.";
    input.fees.managementBps = 250;
    input.coverId = "diamond-hands";
    const payload = JSON.parse(bodies[0]);
    assert.deepEqual(Object.keys(payload), ["encoded"]);
    assert.equal(payload.encoded, encodeConceptBasket(original));
    assert.match(payload.encoded, /^4\./);
    assert.deepEqual(decodeConceptBasket(payload.encoded), original);
    resolveFirst(Response.json({ data: { id: "A".repeat(20) } }));
    assert.deepEqual(await Promise.all([first, second]), [
      `https://basalt.markets/b/${"A".repeat(20)}`,
      `http://127.0.0.1:3000/b/${"A".repeat(20)}`,
    ]);
    assert.equal(await ensureBasketPublicLink(original, "https://basalt.markets"), `https://basalt.markets/b/${"A".repeat(20)}`);
    assert.equal(bodies.length, 1, "resolved snapshots reuse their stored ID");
    assert.equal(await ensureBasketPublicLink(input, "https://basalt.markets"), `https://basalt.markets/b/${"B".repeat(20)}`);
    assert.equal(bodies.length, 2, "a changed immutable snapshot must receive a separate link");
    assert.deepEqual(decodeConceptBasket(JSON.parse(bodies[1]).encoded), input);
  });
});

for (const failure of ["network", "status", "json"] as const) {
  test(`short-link ${failure} failures are removed from the pending cache so retry can succeed`, { concurrency: false }, async () => {
    let calls = 0;
    const input = snapshotBasket(`Retry after ${failure}`);
    await withShareFetch(async () => {
      calls += 1;
      if (calls === 1) {
        if (failure === "network") throw new Error("Network unavailable");
        if (failure === "status") return new Response("Unavailable", { status: 503 });
        return new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return Response.json({ data: { id: "R".repeat(20) } });
    }, async () => {
      await assert.rejects(ensureBasketPublicLink(input, "https://basalt.markets"));
      assert.equal(await ensureBasketPublicLink(input, "https://basalt.markets"), `https://basalt.markets/b/${"R".repeat(20)}`);
      assert.equal(calls, 2);
    });
  });
}

test("short links reject missing, malformed and non-string response IDs without caching them", { concurrency: false }, async () => {
  const invalidIds: unknown[] = [undefined, null, 123, 12345678901234567890, {}, [], ["A".repeat(20)], "", "A".repeat(19), "A".repeat(21), "A".repeat(19) + "/", "A".repeat(19) + "é"];
  for (const [index, id] of invalidIds.entries()) {
    let calls = 0;
    const input = snapshotBasket(`Invalid link response ${index}`);
    await withShareFetch(async () => {
      calls += 1;
      return Response.json({ data: { id: calls === 1 ? id : "V".repeat(20) } });
    }, async () => {
      await assert.rejects(ensureBasketPublicLink(input, "https://basalt.markets"), /Invalid basket link response/);
      assert.equal(await ensureBasketPublicLink(input, "https://basalt.markets"), `https://basalt.markets/b/${"V".repeat(20)}`);
      assert.equal(calls, 2);
    });
  }
});

test("invalid site origins and invalid baskets fail before any short-link POST", { concurrency: false }, async () => {
  let calls = 0;
  await withShareFetch(async () => { calls += 1; throw new Error("Unexpected network request"); }, async () => {
    for (const origin of ["javascript:alert(1)", "file:///tmp/test", "ftp://basalt.markets", "https://user:password@basalt.markets", "not a URL"]) {
      await assert.rejects(ensureBasketPublicLink(snapshotBasket("Invalid origin"), origin));
    }
    const invalid = snapshotBasket("Invalid allocation");
    invalid.assets[0].weightBps = 1;
    await assert.rejects(ensureBasketPublicLink(invalid, "https://basalt.markets"));
    assert.equal(calls, 0);
  });
});

test("X intent uses an explicit validated short URL without a duplicated long payload", () => {
  const shortLink = `https://basalt.markets/b/${"X".repeat(20)}`;
  const intent = new URL(basketXIntent(basket, "https://basalt.markets", shortLink));
  assert.equal(intent.searchParams.get("url"), shortLink);
  assert.equal(intent.searchParams.get("text"), basketSocialText(basket));
  assert.deepEqual([...intent.searchParams.keys()].sort(), ["text", "url"]);
  assert.equal(intent.searchParams.get("url")!.includes("?d="), false);
});

test("X intent rejects foreign hosts, credentials, query/hash and malformed short paths", () => {
  const path = `/b/${"X".repeat(20)}`;
  for (const shortLink of [
    `https://foreign.example${path}`, `http://basalt.markets${path}`, `https://basalt.markets.foreign.example${path}`,
    `https://user@basalt.markets${path}`, `https://user:password@basalt.markets${path}`,
    `https://basalt.markets${path}?anything=1`, `https://basalt.markets${path}#fragment`,
    `https://basalt.markets${path}/`, `https://basalt.markets${path}/extra`,
    `https://basalt.markets/b/${"X".repeat(19)}`, `https://basalt.markets/b/${"X".repeat(21)}`,
    "https://basalt.markets/b/AAAAAAAAAAAAAAAAAAA%2f", `https://basalt.markets/preview?d=${"X".repeat(20)}`,
    "javascript:alert(1)", path, "not a URL",
  ]) assert.throws(() => basketXIntent(basket, "https://basalt.markets", shortLink), Error, shortLink);
});
