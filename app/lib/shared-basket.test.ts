import assert from "node:assert/strict";
import test from "node:test";
import type { ConceptBasket } from "./concept-basket";
import { getConceptAsset } from "./concept-assets";
import { encodeConceptBasket } from "./concept-share";
import { loadSharedBasket } from "./shared-basket";
import { basketPreviewMetadata } from "./basket-preview-metadata";

const basket: ConceptBasket = {
  v: 1,
  name: "Full immutable shared basket",
  thesis: "Two ideas, exact token identities, custom fees and artwork. 🚀",
  coverId: "deep-value",
  amountUsd: 1945.67,
  assets: [
    { symbol: "NVDA", weightBps: 6750, mint: getConceptAsset("NVDA")!.mint! },
    { symbol: "MSFT", weightBps: 3250, mint: getConceptAsset("MSFT")!.mint! },
  ],
  fees: { entryBps: 115, exitBps: 55, managementBps: 225 },
};
const encoded = encodeConceptBasket(basket);
const id = (suffix: string) => "S".repeat(19) + suffix;

async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}

test("invalid shared IDs never reach the backend", { concurrency: false }, async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; throw new Error("Unexpected fetch"); }, async () => {
    for (const value of ["", "A".repeat(19), "A".repeat(21), "A".repeat(19) + "/", "A".repeat(19) + "é", "../basket", "https://foreign.example", "A".repeat(20) + "?q=1"]) {
      assert.equal(await loadSharedBasket(value), null, value);
    }
    assert.equal(calls, 0);
  });
});

test("a valid shared link restores the exact basket with a fixed backend path and no credentials", { concurrency: false }, async () => {
  const requestedId = id("A");
  let calls = 0;
  await withFetch(async (input, init) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.pathname, `/api/v1/basket-shares/${requestedId}`);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ data: { id: requestedId, encoded } });
  }, async () => {
    assert.deepEqual(await loadSharedBasket(requestedId), basket);
    assert.equal(calls, 1);
  });
});

for (const status of [400, 404]) {
  test(`shared link HTTP ${status} resolves to not found`, { concurrency: false }, async () => {
    await withFetch(async () => new Response("Not found", { status }), async () => {
      assert.equal(await loadSharedBasket(id(String(status).slice(-1))), null);
    });
  });
}

test("temporary backend errors throw instead of pretending the basket is missing", { concurrency: false }, async () => {
  await withFetch(async () => new Response("Unavailable", { status: 503 }), async () => {
    await assert.rejects(loadSharedBasket(id("B")), /temporarily unavailable/);
  });
});

test("a shared response for a different ID cannot replace the requested basket", { concurrency: false }, async () => {
  await withFetch(async () => Response.json({ data: { id: id("D"), encoded } }), async () => {
    await assert.rejects(loadSharedBasket(id("C")), /Invalid basket link response/);
  });
});

test("shared responses fail closed for missing, non-string or oversized encoded data", { concurrency: false }, async () => {
  for (const [index, malformed] of [undefined, null, 123, [], {}, "A".repeat(4097)].entries()) {
    const requestedId = id(String(index));
    await withFetch(async () => Response.json({ data: { id: requestedId, encoded: malformed } }), async () => {
      await assert.rejects(loadSharedBasket(requestedId), /Invalid basket link response/);
    });
  }
});

test("malformed or invalid basket payloads never render a shared basket", { concurrency: false }, async () => {
  const compact = [4, basket.name, basket.amountUsd,
    basket.assets.flatMap((asset) => [asset.symbol, asset.weightBps, asset.mint]),
    basket.thesis, [basket.fees.entryBps, basket.fees.exitBps, basket.fees.managementBps], basket.coverId];
  const invalidWeights = structuredClone(compact) as unknown[];
  (invalidWeights[3] as unknown[])[1] = 1;
  const invalidFees = structuredClone(compact) as unknown[];
  invalidFees[5] = [0, 0, 301];
  const invalidCover = structuredClone(compact) as unknown[];
  invalidCover[6] = "https://foreign.example/art.png";
  const encodeUnchecked = (value: unknown) => `4.${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
  for (const [index, value] of ["not-json", "4.invalid", encodeUnchecked(invalidWeights), encodeUnchecked(invalidFees), encodeUnchecked(invalidCover)].entries()) {
    const requestedId = id(String.fromCharCode(70 + index));
    await withFetch(async () => Response.json({ data: { id: requestedId, encoded: value } }), async () => {
      assert.equal(await loadSharedBasket(requestedId), null);
    });
  }
});

test("shared basket metadata keeps its canonical short URL and matching encoded OG/Twitter image", () => {
  const previousOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://temporary.vercel.app";
  try {
    const href = `/b/${id("M")}`;
    const metadata = basketPreviewMetadata(basket, href);
    const openGraph = metadata.openGraph as { url: string; title: string; description: string; images: { url: string; width: number; height: number; alt: string }[] };
    const twitter = metadata.twitter as { card: string; title: string; description: string; images: string[] };
    assert.equal(metadata.metadataBase?.href, "https://basalt.markets/");
    assert.deepEqual(metadata.alternates, { canonical: href });
    assert.equal(openGraph.url, href);
    assert.deepEqual(metadata.title, { absolute: `${basket.name} · Basalt` });
    assert.equal(metadata.description, basket.thesis);
    assert.equal(openGraph.title, twitter.title);
    assert.equal(openGraph.description, twitter.description);
    assert.equal(twitter.card, "summary_large_image");
    assert.equal(openGraph.images.length, 1);
    assert.equal(openGraph.images[0].width, 1200);
    assert.equal(openGraph.images[0].height, 630);
    assert.equal(openGraph.images[0].url, `/api/basket-image/social?d=${encoded}`);
    assert.deepEqual(twitter.images, [openGraph.images[0].url]);
  } finally {
    if (previousOrigin === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousOrigin;
  }
});

test("missing shared baskets use generic metadata without an invented canonical basket link", () => {
  const metadata = basketPreviewMetadata(null);
  assert.deepEqual(metadata.title, { absolute: "Stock basket · Basalt" });
  assert.equal(metadata.alternates, undefined);
  const openGraph = metadata.openGraph as { url?: string; images: { url: string }[] };
  const twitter = metadata.twitter as { images: string[] };
  assert.equal(openGraph.url, undefined);
  assert.equal(openGraph.images[0].url, "/opengraph-image");
  assert.deepEqual(twitter.images, ["/opengraph-image"]);
});
