#!/usr/bin/env node
/** Bounded read-only release verification. Incomplete projections require an explicit acknowledgement. */
import { pathToFileURL } from 'node:url';

const COUNT_FIELDS = ['pendingSignatures', 'quarantinedSignatures', 'scansPending', 'indexedPrograms', 'missingCoverage', 'rebuildRequiredBaskets'];
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
// Exact activated source trust roots; never inferred from the remote response or environment.
const PROGRAMS = [
  'FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS','3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF','6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k',
  '37UVmx2uysqkKibBcSP5EZMycUeKnWRmnXVpr967juKF','2xvJKG8DTmSZFu1zXpNVP3wvaCCCgGC2ufGGhYjzr4DH','8XPKfAYPaDSvUH95CeyjkgujTXAE5nFBJyFSqZvFvX7T',
].sort();
const samePrograms = ids => Array.isArray(ids) && JSON.stringify([...ids].sort()) === JSON.stringify(PROGRAMS);
const CHECKS = ['network', 'database', 'schema', 'indexer', 'navEngine', 'userSnapshot', 'feeCrank'];
export function evaluateRollout(ready, expectedSha, { allowIncompleteProjections = false } = {}) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha)) throw new Error('Exact source SHA required');
  if (!ready || ready.ok !== true || ready.ready !== true || ready.sourceSha !== expectedSha || CHECKS.some(key => ready.checks?.[key] !== true)) throw new Error('Backend release identity or service readiness failed');
  const timestamp = new Date(ready.ts).getTime(), age = Date.now() - timestamp;
  if (!Number.isFinite(age) || age < -5000 || age > 30_000) throw new Error('Stale or invalid readiness timestamp');
  if (ready.network?.cluster !== 'devnet' || ready.network.genesisHash !== GENESIS || !samePrograms(ready.network.programIds)) throw new Error('Verified current devnet network/program identity required');
  const data = ready.data, history = data?.history;
  if (!history || COUNT_FIELDS.some(key => !Number.isSafeInteger(history[key]) || history[key] < 0) || history.automaticActivationEnabled !== false ||
      !Number.isSafeInteger(data.basketCount) || data.basketCount < 0 || !Number.isSafeInteger(data.currentValuations) || data.currentValuations < 0 || data.currentValuations > data.basketCount) throw new Error('Missing or invalid recovery/valuation evidence');
  const slot = ready.discovery?.finalizedSlot, completedAt = new Date(ready.discovery?.completedAt).getTime();
  const discoveryAge = timestamp - completedAt;
  const coverage = history.finalizedThroughSlot;
  const freshDiscovery = Number.isSafeInteger(slot) && slot >= 0 && Number.isFinite(discoveryAge) && discoveryAge >= 0 && discoveryAge <= 300_000;
  const covered = typeof coverage === 'string' && /^(0|[1-9]\d*)$/.test(coverage) && freshDiscovery && BigInt(coverage) >= BigInt(slot);
  const complete = history.indexedPrograms === PROGRAMS.length && samePrograms(history.programIds) && history.missingCoverage === 0 && covered && history.pendingSignatures === 0 && history.quarantinedSignatures === 0 && history.scansPending === 0 && history.rebuildRequiredBaskets === 0;
  if (ready.projectionReady !== complete) throw new Error('Inconsistent projection readiness');
  if (!complete && !allowIncompleteProjections) throw new Error('Indexed projections remain incomplete; explicit --allow-incomplete-projections is required for a contained devnet release');
  return { sourceSha: expectedSha, serviceReady: true, projectionReady: complete, containedDevnetRelease: !complete,
    network: ready.network, discovery: ready.discovery, basketCount: data.basketCount, currentValuations: data.currentValuations, history };
}

export async function readBoundedJson(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json', 'cache-control': 'no-cache' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Readiness HTTP ${response.status}`);
    if (!response.body) throw new Error('Missing readiness body');
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) { controller.abort(); throw new Error('Readiness response exceeds 1 MiB'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { clearTimeout(timer); }
}

export async function verifyBackendRollout({ origin, sourceSha, allowIncompleteProjections = false }, fetchImpl = fetch) {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('An HTTPS origin without credentials/path is required');
  const ready = await readBoundedJson(new URL('/api/v1/ready', parsed), fetchImpl);
  return { checkedAt: new Date().toISOString(), origin: parsed.origin, ...evaluateRollout(ready, sourceSha, { allowIncompleteProjections }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/verify-backend-rollout.mjs --origin=https://api.example --source-sha=<40hex> [--allow-incomplete-projections]\nGET only; no activation, signing, probes or configuration changes.');
  } else {
    try {
      if (args.some(arg => !/^--(?:origin=https:\/\/\S+|source-sha=[a-f0-9]{40}|allow-incomplete-projections)$/.test(arg)) || args.filter(a => a.startsWith('--origin=')).length !== 1 || args.filter(a => a.startsWith('--source-sha=')).length !== 1) throw new Error('Expected one origin, one exact source SHA and optional incomplete-projection acknowledgement');
      const result = await verifyBackendRollout({ origin: args.find(a => a.startsWith('--origin=')).slice(9), sourceSha: args.find(a => a.startsWith('--source-sha=')).slice(13), allowIncompleteProjections: args.includes('--allow-incomplete-projections') });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
