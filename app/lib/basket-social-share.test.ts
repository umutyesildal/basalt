import assert from "node:assert/strict";
import test from "node:test";
import type { ConceptBasket } from "./concept-basket";
import { decodeConceptBasket, encodeConceptBasket } from "./concept-share";
import { getConceptAsset } from "./concept-assets";
import { CONCEPT_BASKETS } from "./concept-samples";
import type { BasketPerformanceResponse } from "./basket-performance";
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

const cta = "Check out more at @basalt_sol";
const shortLink = `https://basalt.markets/b/${"X".repeat(20)}`;
const sample = CONCEPT_BASKETS.find((item) => item.name === "Main Character")!;
const performanceBasket = (): ConceptBasket => structuredClone(sample);

/** Fixture evidence uses the same source clock and exact named mix as performance tests. */
function performance(value = 2.78): BasketPerformanceResponse {
  return {
    status: "ready", source: "Yahoo Finance", fetchedAt: "2026-10-09T22:00:00.000Z",
    baseDate: "2026-09-01", baseValue: 100, asOf: "2026-10-09", windowStart: "2026-10-02",
    methodology: "Historical underlying buy-and-hold model; not deployed basket NAV.",
    items: [{ basketId: sample.id, status: "ready", modelPrice: 102.78, return7dPct: value,
      asOf: "2026-10-09", windowStart: "2026-10-02", series: [] }],
  };
}

/** Conservative non-URL weight: ASCII costs 1, other code points 2. */
const postWeight = (text: string) => Array.from(text).reduce((sum, char) => sum + (char.codePointAt(0)! <= 0x7f ? 1 : 2), 0);
const weightedPost = (text: string, url?: string) => url ? postWeight(text.replace(url, "")) + 23 : postWeight(text);
const graphemes = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ segment }) => segment);

test("a basket without eligible performance shares its name, thesis and final Basalt CTA without invented gains", () => {
  assert.equal(basketSocialText(basket), `${basket.name} stock basket\n\n${basket.thesis}\n\n${cta}`);
  const empty = basketSocialText({ ...basket, name: "My mix", thesis: "" });
  assert.equal(empty, `My mix stock basket\n\n${cta}`);
  assert.doesNotMatch(empty, /return|profit|APY|performance|\$|\d%/i);
});

test("short social text normalizes pasted name/thesis controls and whitespace", () => {
  assert.equal(basketSocialText({ ...basket, name: "  My\u0000 mix  ", thesis: "  AI\u0000\tand\n  energy\u007f " }), `My mix stock basket\n\nAI and energy\n\n${cta}`);
});

test("verified seven-day performance leads the complete tweet with the inline link before the final CTA", () => {
  const input = performanceBasket();
  const expected = `Main Character stock basket has gained 2.78% this week!\n\n${input.thesis} ${shortLink}\n\n${cta}`;
  assert.equal(basketSocialText(input, performance(), shortLink), expected);
  const intent = new URL(basketXIntent(input, "https://basalt.markets", shortLink, performance()));
  assert.equal(intent.searchParams.get("text"), expected);
  assert.deepEqual([...intent.searchParams.keys()], ["text"]);
  assert.ok(expected.endsWith(cta));
  assert.equal(expected.indexOf(shortLink) < expected.indexOf(cta), true);
});

test("negative and zero weekly figures use correct grammar without a negative gained claim", () => {
  for (const [value, headline] of [
    [-2.78, "Main Character stock basket is down 2.78% this week."],
    [0, "Main Character stock basket is flat this week."],
    [-0, "Main Character stock basket is flat this week."],
  ] as const) {
    const text = basketSocialText(performanceBasket(), performance(value), shortLink);
    assert.equal(text.split("\n\n")[0], headline);
    assert.doesNotMatch(text, /gained -|down -|gained 0|down 0/);
    assert.ok(text.endsWith(cta));
  }
});

test("missing, mismatched, stale, invalid and unverified model evidence never becomes a tweeted return", () => {
  const bad: (BasketPerformanceResponse | null | undefined)[] = [undefined, null];
  const mutations: ((value: BasketPerformanceResponse) => void)[] = [
    (value) => { value.status = "unavailable"; },
    (value) => { value.items = []; },
    (value) => { value.items[0].status = "unavailable"; },
    (value) => { value.items[0].basketId = "another-basket"; },
    (value) => { value.items.push(structuredClone(value.items[0])); },
    (value) => { value.items[0].return7dPct = NaN; },
    (value) => { value.items[0].return7dPct = Infinity; },
    (value) => { value.items[0].return7dPct = null; },
    (value) => { value.items[0].modelPrice = 0; },
    (value) => { value.items[0].asOf = "2026-10-08"; },
    (value) => { value.items[0].windowStart = "2026-10-01"; },
    (value) => { value.fetchedAt = "2026-10-14T22:00:00.000Z"; },
    (value) => { value.fetchedAt = "invalid"; },
    (value) => { value.baseDate = "invalid"; },
    (value) => { value.source = "Unverified" as BasketPerformanceResponse["source"]; },
  ];
  for (const mutate of mutations) { const result = performance(); mutate(result); bad.push(result); }
  for (const result of bad) {
    const text = basketSocialText(performanceBasket(), result, shortLink);
    assert.equal(text.split("\n\n")[0], "Main Character stock basket");
    assert.doesNotMatch(text, /2[.]78%|has gained|is down|is flat/);
    assert.ok(text.endsWith(`${shortLink}\n\n${cta}`));
  }
});

test("an edited name, allocation or mint cannot borrow the return of a published basket", () => {
  const renamed = { ...performanceBasket(), name: "My own mix" };
  const reweighted = performanceBasket();
  reweighted.assets[0].weightBps += 1;
  reweighted.assets[1].weightBps -= 1;
  const spoofed = performanceBasket();
  spoofed.assets[0].mint = "11111111111111111111111111111112";
  for (const input of [basket, renamed, reweighted, spoofed]) {
    const text = basketSocialText(input, performance(), shortLink);
    assert.equal(text.split("\n\n")[0], `${input.name} stock basket`);
    assert.doesNotMatch(text, /has gained|is down|is flat|2[.]78%/);
  }
});

test("an unrelated unavailable model in a partial response does not hide a verified selected return", () => {
  const data = performance();
  data.status = "partial";
  data.items.push({ basketId: "unrelated", status: "unavailable", modelPrice: null, return7dPct: null,
    asOf: null, windowStart: null, series: [] });
  assert.ok(basketSocialText(performanceBasket(), data, shortLink).startsWith("Main Character stock basket has gained 2.78% this week!"));
});

test("ASCII truncation preserves its inline URL and final CTA within X's 280-unit budget", () => {
  const input = { ...basket, name: "My mix", thesis: "a".repeat(240) };
  const text = basketSocialText(input, null, shortLink);
  assert.ok(text.includes("…"));
  assert.ok(text.endsWith(`${shortLink}\n\n${cta}`));
  assert.equal(text.split(shortLink).length - 1, 1);
  assert.ok(weightedPost(text, shortLink) <= 280, `weighted length ${weightedPost(text, shortLink)}`);
});

test("non-Latin truncation preserves the URL and final CTA within X's weighted budget", () => {
  for (const thesis of ["界".repeat(240), "İçgörü".repeat(40), "🚀".repeat(120)]) {
    const text = basketSocialText({ ...basket, name: "My mix", thesis }, null, shortLink);
    assert.ok(text.includes("…"));
    assert.ok(text.endsWith(`${shortLink}\n\n${cta}`));
    assert.ok(weightedPost(text, shortLink) <= 280, `weighted length ${weightedPost(text, shortLink)}`);
  }
});

test("truncation keeps emoji families, flags and combining sequences intact before the fixed URL/CTA suffix", () => {
  for (const unit of ["👨‍👩‍👧‍👦", "👩🏽‍💻", "🇹🇷", "e\u0301"]) {
    const thesis = unit.repeat(Math.floor(240 / unit.length));
    const source = `Mix stock basket\n\n${thesis}`;
    const text = basketSocialText({ ...basket, name: "Mix", thesis }, null, shortLink);
    const suffix = ` ${shortLink}\n\n${cta}`;
    assert.ok(text.endsWith(suffix));
    const body = text.slice(0, -suffix.length);
    assert.ok(body.endsWith("…"));
    assert.ok(weightedPost(text, shortLink) <= 280);
    const content = body.slice(0, -1);
    assert.equal(graphemes(source).slice(0, graphemes(content).length).join(""), content);
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

test("X intent safely encodes the whole editable post and its inline self-contained basket URL", () => {
  const special = { ...basket, thesis: "A & B? #conviction + patient picks / <idea> 🚀" };
  const intent = new URL(basketXIntent(special, "https://basalt.example"));
  const link = basketPublicLink(special, "https://basalt.example");
  assert.equal(intent.origin, "https://twitter.com");
  assert.equal(intent.pathname, "/intent/tweet");
  assert.deepEqual([...intent.searchParams.keys()], ["text"]);
  assert.equal(intent.searchParams.get("text"), basketSocialText(special, undefined, link));
  assert.ok(intent.searchParams.get("text")!.endsWith(`${link}\n\n${cta}`));
  assert.ok(weightedPost(intent.searchParams.get("text")!, link) <= 280);
  assert.deepEqual(decodeConceptBasket(new URL(link).searchParams.get("d")), special);
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

test("X intent puts one validated short URL before the final CTA without a separate URL parameter", () => {
  const intent = new URL(basketXIntent(basket, "https://basalt.markets", shortLink));
  const text = intent.searchParams.get("text")!;
  assert.equal(text, basketSocialText(basket, undefined, shortLink));
  assert.deepEqual([...intent.searchParams.keys()], ["text"]);
  assert.equal(intent.searchParams.has("url"), false);
  assert.equal(text.includes("?d="), false);
  assert.equal(text.split(shortLink).length - 1, 1);
  assert.ok(text.endsWith(`${shortLink}\n\n${cta}`));
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
