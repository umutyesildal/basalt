import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { inspectCurrentDevnetState } from './current-devnet-state.mjs';
import { CURRENT_AUTHORITY, DEVNET_GENESIS } from './governance-preflight.mjs';
import { retiredKeys } from './retired-keys.mjs';
import { PROGRAM_IDS, WHITELIST_CONFIG_PDA, BPF_UPGRADEABLE_LOADER_ID } from '../deployment-verifier.mjs';
const { PublicKey } = createRequire(new URL('../../backend/package.json', import.meta.url))('@solana/web3.js');
const key = value => new PublicKey(Uint8Array.from({ length: 32 }, () => value)).toBase58();
const account = (owner, executable, data) => ({ owner, executable, data: [data.toString('base64'), 'base64'] });

function fixture(treasury = retiredKeys[0].publicKey) {
  const map = new Map(), calls = [];
  for (const program of Object.values(PROGRAM_IDS)) {
    const pd = PublicKey.findProgramAddressSync([new PublicKey(program).toBuffer()], new PublicKey(BPF_UPGRADEABLE_LOADER_ID))[0];
    const programData = Buffer.alloc(36); programData.writeUInt32LE(2); pd.toBuffer().copy(programData, 4);
    map.set(program, account(BPF_UPGRADEABLE_LOADER_ID, true, programData));
    const data = Buffer.alloc(46); data.writeUInt32LE(3); data.writeBigUInt64LE(5n, 4); data[12] = 1;
    new PublicKey(CURRENT_AUTHORITY).toBuffer().copy(data, 13);
    map.set(pd.toBase58(), account(BPF_UPGRADEABLE_LOADER_ID, false, data));
  }
  const whitelist = Buffer.alloc(41); createHash('sha256').update('account:WhitelistConfig').digest().copy(whitelist, 0, 0, 8);
  new PublicKey(CURRENT_AUTHORITY).toBuffer().copy(whitelist, 8);
  map.set(WHITELIST_CONFIG_PDA, account(PROGRAM_IDS.whitelist, false, whitelist));
  const [factory, bump] = PublicKey.findProgramAddressSync([Buffer.from('factory')], new PublicKey(PROGRAM_IDS.basket_factory));
  const data = Buffer.alloc(89); createHash('sha256').update('account:FactoryConfig').digest().copy(data, 0, 0, 8);
  new PublicKey(CURRENT_AUTHORITY).toBuffer().copy(data, 8); new PublicKey(treasury).toBuffer().copy(data, 40);
  data.writeUInt16LE(9000, 72); data.writeUInt16LE(300, 74); data.writeUInt16LE(100, 76); data.writeUInt16LE(300, 78);
  data.writeBigUInt64LE((1n << 63n) + 1n, 80); data[88] = bump;
  map.set(factory.toBase58(), account(PROGRAM_IDS.basket_factory, false, data));
  const fetchImpl = async (url, init) => {
    const call = JSON.parse(init.body); calls.push(call);
    assert.equal(init.method, 'POST'); assert(init.signal instanceof AbortSignal);
    assert(['getGenesisHash', 'getMultipleAccounts'].includes(call.method));
    if (call.method === 'getMultipleAccounts') {
      assert.equal(call.params[1].commitment, 'finalized'); assert.equal(call.params[1].encoding, 'base64');
      if (calls.length === 3) assert.equal(call.params[1].minContextSlot, 100);
    }
    return Response.json({ jsonrpc: '2.0', id: call.id, result: call.method === 'getGenesisHash' ? DEVNET_GENESIS : { context: { slot: 100 }, value: call.params[0].map(address => map.get(address) ?? null) } });
  };
  return { map, calls, fetchImpl, factory: factory.toBase58(), data };
}

test('current devnet inventory observes retired factory containment using public finalized reads only', async () => {
  const f = fixture();
  const report = await inspectCurrentDevnetState({ fetchImpl: f.fetchImpl, rpcUrl: 'https://example.invalid/path?api-key=do-not-print', sourceCommit: 'a'.repeat(40), now: () => new Date('2026-10-09T13:00:00Z') });
  assert.equal(report.factory.treasuryRetired, true); assert.equal(report.factory.basketCount, '9223372036854775809');
  assert.equal(report.containment.newBasketCreationBlocked, true); assert.equal(report.containment.currentAuthoritiesMatchBaseline, true);
  assert.equal(report.containment.creationPolicyEnforcedBy, 'supported-client-guards'); assert.equal(report.containment.onChainCreationDisabled, false);
  assert.equal(report.containment.legacyRedemptionMustRemainAvailable, true); assert.equal(report.scope.executionAuthorized, false);
  assert.equal(report.scope.governanceActivationVerified, false); assert.equal(report.scope.deployedProgramBytesVerified, false);
  assert.equal(report.rpcOrigin, 'https://example.invalid'); assert(!JSON.stringify(report).includes('do-not-print'));
  assert.equal(f.calls.length, 3); assert.equal(report.contextSlots.programData, 100);
});

test('clean nonretired factory observation never authorizes signing or claims governance completion', async () => {
  const f = fixture(key(12)); const report = await inspectCurrentDevnetState({ fetchImpl: f.fetchImpl });
  assert.equal(report.factory.treasuryRetired, false); assert.equal(report.containment.newBasketCreationBlocked, false);
  assert.equal(report.scope.executionAuthorized, false); assert.equal(report.scope.mainnetReadinessVerified, false);
});

test('each retired treasury is contained and invalid factory identity/policy/layout fails closed', async () => {
  for (const { publicKey } of retiredKeys) {
    const f = fixture(publicKey); assert.equal((await inspectCurrentDevnetState({ fetchImpl: f.fetchImpl })).containment.newBasketCreationBlocked, true);
  }
  for (const mutate of [
    f => f.map.delete(f.factory),
    f => { f.map.get(f.factory).owner = PROGRAM_IDS.basket; },
    f => { f.map.get(f.factory).executable = true; },
    f => { f.data[0] ^= 1; },
    f => { f.data[88] ^= 1; },
    f => { f.data.writeUInt16LE(8000, 72); },
    f => { f.data.fill(0, 40, 72); },
    f => { f.data = f.data.subarray(0, 88); },
  ]) {
    const f = fixture(); mutate(f);
    if (f.map.has(f.factory) && f.map.get(f.factory).owner === PROGRAM_IDS.basket_factory && !f.map.get(f.factory).executable) {
      f.map.get(f.factory).data = [f.data.toString('base64'), 'base64'];
    }
    await assert.rejects(inspectCurrentDevnetState({ fetchImpl: f.fetchImpl }));
  }
});

test('unknown authority is reported without inventing a multisig; malformed loader evidence fails closed', async () => {
  const f = fixture(), pd = [...f.map.values()].find(value => value.owner === BPF_UPGRADEABLE_LOADER_ID && !value.executable);
  const data = Buffer.from(pd.data[0], 'base64'); new PublicKey(key(42)).toBuffer().copy(data, 13); pd.data[0] = data.toString('base64');
  const report = await inspectCurrentDevnetState({ fetchImpl: f.fetchImpl });
  assert.equal(report.containment.currentAuthoritiesMatchBaseline, false); assert.equal(report.scope.governanceActivationVerified, false);
  for (const mutate of [
    state => { state.map.get(PROGRAM_IDS.basket).owner = PROGRAM_IDS.basket; },
    state => { const p = Buffer.from(state.map.get(PROGRAM_IDS.basket).data[0], 'base64'); new PublicKey(key(50)).toBuffer().copy(p, 4); state.map.get(PROGRAM_IDS.basket).data[0] = p.toString('base64'); },
    state => { state.map.get(WHITELIST_CONFIG_PDA).data = ['not base64', 'base64']; },
  ]) {
    const state = fixture(); mutate(state); await assert.rejects(inspectCurrentDevnetState({ fetchImpl: state.fetchImpl }));
  }
});

test('wrong cluster, stale context, missing account/count and oversized responses cannot become evidence', async () => {
  for (const mutation of ['genesis', 'stale', 'count', 'missing', 'id']) {
    const f = fixture(); const fetchImpl = async (...args) => {
      const response = await f.fetchImpl(...args), payload = await response.json();
      if (mutation === 'genesis' && f.calls.length === 1) payload.result = 'mainnet-genesis';
      if (mutation === 'stale' && f.calls.length === 3) payload.result.context.slot = 99;
      if (mutation === 'count' && f.calls.length === 2) payload.result.value.pop();
      if (mutation === 'missing' && f.calls.length === 3) payload.result.value[0] = null;
      if (mutation === 'id') payload.id += 1;
      return Response.json(payload);
    };
    await assert.rejects(inspectCurrentDevnetState({ fetchImpl }));
  }
  let cancelled = false;
  const oversized = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024)); controller.enqueue(Uint8Array.of(1)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(inspectCurrentDevnetState({ fetchImpl: oversized }), /response exceeds limit/);
  assert.equal(cancelled, true);
});
