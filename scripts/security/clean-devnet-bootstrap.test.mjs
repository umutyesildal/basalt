import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCleanBootstrapPlan, inspectBootstrapSourceInputs, publicInputTemplate, validateCleanBootstrapRecord, verifyCleanNamespaceVacant } from './clean-devnet-bootstrap.mjs';
import { DEVNET_GENESIS, SQUADS_PROGRAM } from './governance-preflight.mjs';
import { retiredKeys } from './retired-keys.mjs';
import { PROGRAM_IDS, BPF_UPGRADEABLE_LOADER_ID } from '../deployment-verifier.mjs';
const { PublicKey } = createRequire(new URL('../../backend/package.json', import.meta.url))('@solana/web3.js');
const commit = 'a'.repeat(40);
const fixtureKey = value => new PublicKey(Uint8Array.from({ length: 32 }, () => value)).toBase58();
// Public, deterministic TEST identities only. No key material is generated or loaded.
const onCurve = Array.from({ length: 100 }, (_, i) => fixtureKey(i + 1)).filter(key => PublicKey.isOnCurve(new PublicKey(key).toBytes()));
function fixture() {
  const r = publicInputTemplate(commit);
  r.releaseTag = 'devnet-clean-reviewed-test';
  r.programIds = { whitelist: onCurve[0], basket_factory: onCurve[1], basket: onCurve[2] };
  r.bootstrapAuthority = onCurve[3]; r.treasury = onCurve[4];
  r.governance.multisig = fixtureKey(201);
  r.governance.vault = PublicKey.findProgramAddressSync([
    Buffer.from('multisig'), new PublicKey(r.governance.multisig).toBuffer(), Buffer.from('vault'), Buffer.from([0]),
  ], new PublicKey(SQUADS_PROGRAM))[0].toBase58();
  r.governance.signers.forEach((s, i) => { s.publicKey = onCurve[i + 5]; });
  r.approvals.ownerTicket = 'TEST-review-only';
  r.approvals.signers = r.governance.signers.map(s => ({ publicKey: s.publicKey, ticket: 'TEST-signer-reference' }));
  return r;
}
const root = fileURLToPath(new URL('../../', import.meta.url));

test('no owner input produces concrete source-bound preparation without inventing identities or authority', () => {
  const template = publicInputTemplate();
  assert.equal(template.sourceCommit, null); assert.equal(template.treasury, null);
  assert(Object.values(template.programIds).every(key => key === null));
  assert(template.governance.signers.every(s => s.publicKey === null));
  assert.equal(template.governance.vault, null);
  const plan = createCleanBootstrapPlan(null, { sourceCommit: commit });
  assert.equal(plan.status, 'awaiting-public-inputs'); assert.equal(plan.plannedNamespace, null);
  assert.equal(plan.executionAuthorized, false); assert.equal(plan.deployable, false); assert.equal(plan.creationReady, false);
  assert(plan.requiredInputs.length >= 6); assert.equal(plan.initializationGuard.implemented, true);
  assert.equal(plan.legacyNamespace.creationAllowed, false); assert.equal(plan.legacyNamespace.redemptionMustRemainAvailable, true);
  assert.equal(plan.legacyNamespace.inPlaceUpgradeRequired, false);
  assert.equal(plan.sourceInputs.length, 13);
  for (const source of plan.sourceInputs) {
    const bytes = readFileSync(`${root}/${source.path}`);
    assert.equal(source.sha256, createHash('sha256').update(bytes).digest('hex'));
    for (const point of source.patchPoints) assert.equal(bytes.toString('utf8').split('\n')[point.line - 1].trim(), point.exactLine);
  }
});

test('complete explicit public input derives independent new PDAs but never authorizes deployment or ceremony', () => {
  const r = fixture(), plan = createCleanBootstrapPlan(r, { sourceCommit: commit });
  assert.equal(plan.approvedRecordPresent, true); assert.equal(plan.executionAuthorized, false);
  assert.equal(plan.creationReady, false); assert.equal(plan.deployable, false);
  assert.deepEqual(plan.plannedNamespace.programIds, r.programIds);
  assert.equal(plan.plannedNamespace.factoryConfig, PublicKey.findProgramAddressSync([Buffer.from('factory')], new PublicKey(r.programIds.basket_factory))[0].toBase58());
  assert.equal(plan.plannedNamespace.whitelistConfig, PublicKey.findProgramAddressSync([Buffer.from('config')], new PublicKey(r.programIds.whitelist))[0].toBase58());
  for (const [name, address] of Object.entries(r.programIds)) {
    assert.equal(plan.plannedNamespace.programData[name], PublicKey.findProgramAddressSync([new PublicKey(address).toBuffer()], new PublicKey(BPF_UPGRADEABLE_LOADER_ID))[0].toBase58());
    assert.notEqual(plan.plannedNamespace.programData[name], plan.legacyNamespace.programData[name]);
  }
  const points = plan.sourceInputs.flatMap(source => source.patchPoints);
  assert.equal(points.find(p => p.id === 'basket-trusted-factory').proposedPublicKey, r.programIds.basket_factory);
  assert.equal(points.find(p => p.id === 'basket-trusted-whitelist').proposedPublicKey, r.programIds.whitelist);
  assert.equal(plan.observations.governanceOnChainVerified, false);
  assert.equal(plan.observations.treasuryFreshnessVerified, false);
  assert(plan.blockers.some(blocker => blocker.includes('Separate creation namespace')));
});

test('unapproved references cannot become approved; a vault may explicitly be bootstrap authority and treasury', () => {
  const r = fixture(); r.approvals = { ownerTicket: null, signers: [] };
  assert.equal(validateCleanBootstrapRecord(r).approvedRecordPresent, false);
  r.bootstrapAuthority = r.governance.vault; r.treasury = r.governance.vault;
  const plan = createCleanBootstrapPlan(r, { sourceCommit: commit });
  assert.equal(plan.approvedRecordPresent, false);
  assert.match(plan.initializationGuard.implication, /CPI proposal/);
});

test('retired keys, existing namespaces, aliases, wrong governance and key material fail closed', () => {
  const mutations = [
    r => { r.cluster = 'mainnet'; },
    r => { r.sourceCommit = 'main'; },
    r => { r.treasury = '11111111111111111111111111111111'; },
    r => { r.treasury = r.governance.multisig; },
    r => { r.bootstrapAuthority = r.governance.multisig; },
    r => { r.programIds.basket = PROGRAM_IDS.basket; },
    r => { r.programIds.basket = r.programIds.whitelist; },
    r => { r.programIds.basket = r.governance.signers[0].publicKey; },
    r => { r.programIds.basket = r.governance.vault; },
    r => { r.programIds.basket = '1' + r.programIds.basket; },
    r => { r.governance.vault = fixtureKey(202); },
    r => { r.governance.threshold = 1; },
    r => { r.governance.timeLockSeconds = 60; },
    r => { r.governance.signers[1].publicKey = r.governance.signers[0].publicKey; },
    r => { r.governance.signers[0].hardwareWallet = false; },
    r => { r.secretKey = Array(64).fill(1); },
    r => { r.governance.signers[0].secretKey = 'never-output-this'; },
    r => { r.approvals.signers[0].privateKey = 'never-output-this'; },
  ];
  for (const { publicKey } of retiredKeys) {
    mutations.push(r => { r.treasury = publicKey; }, r => { r.bootstrapAuthority = publicKey; }, r => { r.programIds.basket = publicKey; });
  }
  for (const mutate of mutations) { const r = fixture(); mutate(r); assert.throws(() => validateCleanBootstrapRecord(r)); }
  assert.throws(() => validateCleanBootstrapRecord(Array(64).fill(1)), /documented public fields/);
  assert.throws(() => createCleanBootstrapPlan(fixture(), { sourceCommit: 'b'.repeat(40) }), /checkout HEAD/);
});

test('changed/duplicated compiled binding and changed Anchor mapping reject a stale patch plan', () => {
  for (const mutation of ['id', 'duplicate', 'anchor']) {
    assert.throws(() => inspectBootstrapSourceInputs({ root, readFile(path) {
      const original = readFileSync(path, 'utf8');
      if (mutation === 'id' && path.endsWith('/programs/basket/src/lib.rs')) return original.replace(`pubkey!("${PROGRAM_IDS.basket_factory}")`, `pubkey!("${fixtureKey(203)}")`);
      if (mutation === 'duplicate' && path.endsWith('/programs/whitelist/src/lib.rs')) return `${original}\ndeclare_id!("${PROGRAM_IDS.whitelist}");\n`;
      if (mutation === 'anchor' && path.endsWith('/Anchor.toml')) return original.replace(`basket = "${PROGRAM_IDS.basket}"`, `basket = "${fixtureKey(204)}"`);
      return original;
    } }), /drift/);
  }
});

test('inactive comments and strings cannot attest an init authority constraint', () => {
  const binding = 'constraint = program_data.upgrade_authority_address == Some(authority.key()) @ WhitelistError::UnauthorizedInitialization';
  for (const inactive of [
    '// ' + binding,
    '/* outer /* nested */ ' + binding + ' */',
    '#[doc = "' + binding + '"]',
    '#[doc = r#"' + binding + '"#]',
  ]) {
    assert.throws(() => inspectBootstrapSourceInputs({ root, readFile(path) {
      const original = readFileSync(path, 'utf8');
      return path.endsWith('/programs/whitelist/src/lib.rs') ? original.replace(binding, inactive) : original;
    } }), /guard source is absent or drifted/);
  }
});

function rpcFixture(mutation = null) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://api.devnet.solana.com'); assert.equal(init.method, 'POST'); assert(init.signal instanceof AbortSignal);
    const request = JSON.parse(init.body); calls.push(request);
    assert(['getGenesisHash', 'getMultipleAccounts'].includes(request.method));
    let result = DEVNET_GENESIS;
    if (request.method === 'getMultipleAccounts') {
      assert.deepEqual(request.params[1], { encoding: 'base64', commitment: 'finalized' });
      assert.equal(request.params[0].length, 8); assert.equal(new Set(request.params[0]).size, 8);
      result = { context: { slot: 123 }, value: request.params[0].map(() => null) };
      if (mutation === 'occupied') result.value[2] = { owner: 'anything' };
      if (mutation === 'count') result.value.pop();
      if (mutation === 'slot') result.context.slot = -1;
    } else if (mutation === 'genesis') result = 'mainnet';
    return Response.json({ jsonrpc: '2.0', id: mutation === 'id' ? request.id + 1 : request.id, result });
  };
  return { calls, fetchImpl };
}

test('vacancy preflight performs only fixed-official finalized public reads and scopes its proof', async () => {
  const f = rpcFixture(), proof = await verifyCleanNamespaceVacant(fixture(), { fetchImpl: f.fetchImpl });
  assert.equal(f.calls.length, 2); assert.equal(proof.contextSlot, 123);
  assert.equal(proof.allAbsent, true); assert.equal(proof.executionAuthorized, false);
  assert.equal(proof.addresses.length, 8);
});

test('occupied addresses, wrong genesis/identity/context/count, and oversized responses never pass vacancy', async () => {
  for (const mutation of ['occupied', 'genesis', 'id', 'slot', 'count']) {
    await assert.rejects(verifyCleanNamespaceVacant(fixture(), { fetchImpl: rpcFixture(mutation).fetchImpl }));
  }
  let cancelled = false;
  await assert.rejects(verifyCleanNamespaceVacant(fixture(), { fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(128 * 1024 + 1)); },
    cancel() { cancelled = true; },
  })) }), /exceeds limit/);
  assert.equal(cancelled, true);
});

test('CLI missing-input report is useful but nonzero, template has no made-up public keys', () => {
  const script = fileURLToPath(new URL('./clean-devnet-bootstrap.mjs', import.meta.url));
  const planned = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(planned.status, 2); assert.equal(JSON.parse(planned.stdout).creationReady, false);
  const template = spawnSync(process.execPath, [script, '--template'], { encoding: 'utf8' });
  assert.equal(template.status, 0); assert.equal(JSON.parse(template.stdout).programIds.basket, null);
  const invalid = spawnSync(process.execPath, [script, '--verify-empty'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1); assert.equal(invalid.stdout, '');
});
