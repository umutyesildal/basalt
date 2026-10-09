import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../app/api/basket-image/logo/route';
import { getConceptAsset, registerConceptAssets } from './concept-assets';

const originalFetch = globalThis.fetch;
const request = (query: string) => new Request(`https://basalt.test/api/basket-image/logo?${query}`);
const png = () => new Response(new Uint8Array([137,80,78,71]), { headers: {'content-type':'image/png'} });

test('logo route rejects invalid or arbitrary identities before fetching', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return png(); }) as typeof fetch;
  try {
    for (const query of ['', 'symbol=UNKNOWN_NOT_IN_CATALOG', 'symbol=NVDA&url=https://evil.test/x.png', 'symbol=NVDA&thesis=private', 'symbol=NVDA&mint=invalid', 'symbol=NVDA&symbol=QQQ']) {
      assert.equal((await GET(request(query))).status, 404, query);
    }
    const mint = getConceptAsset('NVDA')!.mint!;
    assert.equal((await GET(request(`symbol=QQQ&mint=${mint}`))).status,404);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('logo route returns public cached bytes and constrains the upstream fetch', async () => {
  const calls: {input: unknown; options: RequestInit}[] = [];
  globalThis.fetch = (async (input, options) => { calls.push({ input, options: options as RequestInit }); return png(); }) as typeof fetch;
  try {
    const response = await GET(request('symbol=nvda'));
    assert.equal(response.status,200);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[137,80,78,71]);
    assert.equal(response.headers.get('content-type'),'image/png');
    assert.match(response.headers.get('cache-control')!,/public.*max-age=86400/);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.match(response.headers.get('content-security-policy')!,/sandbox/);
    const call = calls[0];
    const url = new URL(String(call.input));
    assert.equal(url.protocol, 'https:');
    assert.ok(['xstocks-metadata.backed.fi','assets.parqet.com'].includes(url.hostname));
    assert.equal(call.options.credentials,'omit');
    assert.equal(call.options.redirect,'error');
    assert.ok(call.options.signal instanceof AbortSignal);
    assert.equal(call.options.next?.revalidate,86400);
  } finally { globalThis.fetch = originalFetch; }
});

test('logo route admits only supported image types', async () => {
  try {
    for (const type of ['image/png','image/jpeg','image/webp','image/gif','image/svg+xml; charset=utf-8']) {
      globalThis.fetch = (async () => new Response('image', {headers:{'content-type':type}})) as typeof fetch;
      assert.equal((await GET(request('symbol=NVDA'))).status,200,type);
    }
    globalThis.fetch = (async () => new Response('<html>error</html>', {headers:{'content-type':'text/html'}})) as typeof fetch;
    assert.equal((await GET(request('symbol=NVDA'))).status,404);
  } finally { globalThis.fetch = originalFetch; }
});

test('logo route caps advertised and streamed bodies', async () => {
  try {
    globalThis.fetch = (async () => new Response('small', {headers:{'content-type':'image/png','content-length':'2000001'}})) as typeof fetch;
    assert.equal((await GET(request('symbol=NVDA'))).status,404);
    globalThis.fetch = (async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_500_000)); controller.enqueue(new Uint8Array(500_001)); controller.close(); } }), {headers:{'content-type':'image/png'}})) as typeof fetch;
    assert.equal((await GET(request('symbol=NVDA'))).status,404);
    globalThis.fetch = (async () => new Response('', {headers:{'content-type':'image/png'}})) as typeof fetch;
    assert.equal((await GET(request('symbol=NVDA'))).status,404);
  } finally { globalThis.fetch = originalFetch; }
});

test('logo route degrades safely on timeouts, redirects and issuer errors', async () => {
  try {
    globalThis.fetch = (async () => { throw new DOMException('expired','TimeoutError'); }) as typeof fetch;
    assert.equal((await GET(request('symbol=NVDA'))).status,404);
    globalThis.fetch = (async () => new Response(null,{status:302,headers:{location:'https://evil.test/logo.png'}})) as typeof fetch;
    assert.equal((await GET(request('symbol=NVDA'))).status,404);
    globalThis.fetch = (async () => new Response(null,{status:500})) as typeof fetch;
    assert.equal((await GET(request('symbol=NVDA'))).status,404);
  } finally { globalThis.fetch = originalFetch; }
});

test('logo route rejects unsafe catalog URLs before network access', async () => {
  let calls=0;
  const base = {mint:'11111111111111111111111111111111',symbol:'BADHOSTx',ticker:'BADHOSTx',underlyingSymbol:'BADHOST',name:'Unsafe',assetClass:'stock' as const,decimals:6,network:'solana' as const,provider:'backed' as const,status:'active',sourceUrl:'https://xstocks.fi'};
  globalThis.fetch = (async () => { calls++; return png(); }) as typeof fetch;
  try {
    for (const logoUrl of ['http://assets.parqet.com/x.png','https://evil.test/x.png','https://assets.parqet.com.evil.test/x.png','https://user:pass@assets.parqet.com/x.png','https://assets.parqet.com:8443/x.png']) {
      registerConceptAssets([{...base,logoUrl}]);
      assert.equal((await GET(request('symbol=BADHOST'))).status,404,logoUrl);
    }
    assert.equal(calls,0);
  } finally { globalThis.fetch=originalFetch; }
});
