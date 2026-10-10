import assert from "node:assert/strict";
import test from "node:test";
import { fetchMintPriceSources, fetchMintTickers } from "../components/basket/basket-api";
import { TEST_NAMESPACE, TEST_ROUTING } from "../tests/namespace-fixture";

const legacy = TEST_ROUTING.registry[0];
function response(namespace: typeof legacy, rows: unknown[]) {
  return new Response(JSON.stringify({ data: rows, namespace: { id: namespace.id, factory: namespace.factoryConfig, whitelistProgram: namespace.programs.whitelist } }), { status: 200 });
}

test("basket price-source lookup explicitly targets owner namespace rather than first legacy admission", async () => {
  const previous = globalThis.fetch; const urls: URL[] = [];
  globalThis.fetch = async input => { const url = new URL(String(input)); urls.push(url); return response(TEST_NAMESPACE, [{ mint: "same-mint", price_source: "mock:BSTESTA" }]); };
  try {
    assert.deepEqual(await fetchMintPriceSources(new AbortController().signal, TEST_NAMESPACE.factoryConfig, TEST_ROUTING), new Map([["same-mint", "mock:BSTESTA"]]));
    assert.equal(urls.length, 1); assert.equal(urls[0].searchParams.get("namespace"), TEST_NAMESPACE.id);
  } finally { globalThis.fetch = previous; }
});

test("legacy basket stays scoped to its own namespace after an owner namespace exists", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async input => { const url = new URL(String(input)); assert.equal(url.searchParams.get("namespace"), legacy.id); return response(legacy, [{ mint: "legacy-mint", price_source: "mock:NVDA" }]); };
  try { assert.equal((await fetchMintTickers(new AbortController().signal, legacy.factoryConfig, TEST_ROUTING)).get("legacy-mint"), "NVDA"); }
  finally { globalThis.fetch = previous; }
});

test("unknown factories fail before API access and mismatched backend namespace cannot supply context", async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return response(legacy, [{ mint: "same-mint", price_source: "jupiter:TSLAx" }]); };
  try {
    await assert.rejects(fetchMintPriceSources(new AbortController().signal, "unknown-factory", TEST_ROUTING), /not registered/);
    assert.equal(calls, 0);
    await assert.rejects(fetchMintPriceSources(new AbortController().signal, TEST_NAMESPACE.factoryConfig, TEST_ROUTING), /does not match/);
  } finally { globalThis.fetch = previous; }
});

test("mixed discovery labels read every registered namespace and retain healthy context if one fails", async () => {
  const previous = globalThis.fetch; const ids: string[] = [];
  globalThis.fetch = async input => { const id = new URL(String(input)).searchParams.get("namespace")!; ids.push(id); if (id === legacy.id) throw new Error("legacy read unavailable"); return response(TEST_NAMESPACE, [{ mint: "owner-mint", ticker: "BSTESTA" }]); };
  try {
    const labels = await fetchMintTickers(new AbortController().signal, undefined, TEST_ROUTING);
    assert.deepEqual(new Set(ids), new Set(TEST_ROUTING.registry.map(namespace => namespace.id)));
    assert.equal(labels.get("owner-mint"), "BSTESTA");
  } finally { globalThis.fetch = previous; }
});
