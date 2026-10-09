import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRollout, readBoundedJson, verifyBackendRollout } from '../verify-backend-rollout.mjs';
const sha = 'a'.repeat(40);
const ids = ['FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS','3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF','6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k'];
const fixture = () => ({ ok: true, ready: true, ts: new Date().toISOString(), sourceSha: sha, network: { cluster: 'devnet', genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', programIds: ids }, discovery: { finalizedSlot: 12, completedAt: new Date(Date.now()-1000).toISOString(), fresh: true }, checks: Object.fromEntries(['network','database','schema','indexer','navEngine','userSnapshot','feeCrank'].map(key => [key, true])), projectionReady: true,
  data: { basketCount: 9, currentValuations: 0, history: { indexedPrograms: 3, programIds: ids, finalizedThroughSlot: "12", missingCoverage: 0, pendingSignatures: 0, quarantinedSignatures: 0, scansPending: 0, rebuildRequiredBaskets: 0, automaticActivationEnabled: false } } });
test('accepts exact release with honest incomplete valuation coverage', () => { const result = evaluateRollout(fixture(), sha); assert.equal(result.serviceReady, true); assert.equal(result.currentValuations, 0); assert.equal(result.containedDevnetRelease, false); });
test('rejects wrong release, failed/missing checks and unverified automatic activation', () => {
  for (const field of ['network','database','schema','indexer','navEngine','userSnapshot','feeCrank']) { const data = fixture(); data.checks[field] = false; assert.throws(() => evaluateRollout(data, sha)); }
  assert.throws(() => evaluateRollout(fixture(), 'b'.repeat(40)));
  const data = fixture(); data.data.history.automaticActivationEnabled = true; assert.throws(() => evaluateRollout(data, sha));
});
test('incomplete projections require explicit acknowledgement and cannot be relabelled complete', () => {
  const data = fixture(); data.data.history.rebuildRequiredBaskets = 9; data.projectionReady = false;
  assert.throws(() => evaluateRollout(data, sha), /incomplete/);
  assert.equal(evaluateRollout(data, sha, { allowIncompleteProjections: true }).containedDevnetRelease, true);
  data.projectionReady = true; assert.throws(() => evaluateRollout(data, sha, { allowIncompleteProjections: true }), /Inconsistent/);
});
test('rejects malformed counters, incomplete evidence and impossible valuation totals', () => {
  for (const field of ['pendingSignatures','missingCoverage']) for (const count of [undefined, -1, 1.1, '0', NaN, Infinity]) { const data = fixture(); data.data.history[field] = count; assert.throws(() => evaluateRollout(data, sha, { allowIncompleteProjections: true })); }
  const data = fixture(); data.data.currentValuations = 10; assert.throws(() => evaluateRollout(data, sha));
});
test('fetch is read-only, bounded and rejects redirects/non-success/oversize/malformed JSON', async () => {
  let calls = 0;
  const result = await verifyBackendRollout({ origin: 'https://api.example', sourceSha: sha }, async (url, options) => {
    calls++; assert.equal(url.pathname, '/api/v1/ready'); assert.equal(options.method, undefined); assert.equal(options.redirect, 'error'); assert.ok(options.signal); return new Response(JSON.stringify(fixture()));
  });
  assert.equal(calls, 1); assert.equal(result.sourceSha, sha);
  for (const origin of ['http://api.example', 'https://user:pass@api.example', 'https://api.example/path', 'https://api.example/?token=x']) await assert.rejects(verifyBackendRollout({ origin, sourceSha: sha }));
  await assert.rejects(readBoundedJson('https://api.example', async () => new Response('{}', { status: 503 })), /503/);
  await assert.rejects(readBoundedJson('https://api.example', async () => new Response('x'.repeat(1024 * 1024 + 1))), /1 MiB/);
  await assert.rejects(readBoundedJson('https://api.example', async () => new Response('bad')));
});

test('rejects stale/future or wrong-network evidence and requires fresh canonical coverage for complete projection', () => {
  for (const ts of [null, 'invalid', new Date(Date.now()-31_000).toISOString(), new Date(Date.now()+10_000).toISOString()]) { const data=fixture(); data.ts=ts; assert.throws(() => evaluateRollout(data, sha)); }
  const wrong=fixture(); wrong.network.genesisHash='wrong'; assert.throws(() => evaluateRollout(wrong, sha));
  for (const update of [{ finalizedSlot: null }, { completedAt: null }, { completedAt: new Date(Date.now()-301_000).toISOString() }]) {
    const data=fixture(); Object.assign(data.discovery, update); assert.throws(() => evaluateRollout(data, sha), /Inconsistent/);
    data.projectionReady=false; assert.equal(evaluateRollout(data, sha, { allowIncompleteProjections:true }).containedDevnetRelease, true);
  }
});
