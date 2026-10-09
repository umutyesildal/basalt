import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { retiredKeys, assertNotRetiredPublicKey } from './retired-keys.mjs';
import { hasSolanaKeypair, scanSecretHistory, isRecognizedCompiledBinary } from './check-secret-history.mjs';
import { evaluateRustAudit } from './audit-rust.mjs';
import { validateCeremonyRecord, decodeSquadsMultisig, verifyCeremonyAccounts, CURRENT_AUTHORITY, SQUADS_PROGRAM, DEVNET_GENESIS, ROLES } from './governance-preflight.mjs';
import { PROGRAM_IDS, WHITELIST_CONFIG_PDA, BPF_UPGRADEABLE_LOADER_ID } from '../deployment-verifier.mjs';
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { PublicKey } = require('@solana/web3.js');
const codec = createRequire(import.meta.url)('../../vendor/bigint-buffer/index.cjs');
const key = value => new PublicKey(Uint8Array.from({ length: 32 }, () => value));
const zero = '11111111111111111111111111111111';
function recordFixture() {
  const createKey = key(20), program = new PublicKey(SQUADS_PROGRAM);
  const multisig = PublicKey.findProgramAddressSync([Buffer.from('multisig'), Buffer.from('multisig'), createKey.toBuffer()], program)[0];
  const vault = PublicKey.findProgramAddressSync([Buffer.from('multisig'), multisig.toBuffer(), Buffer.from('vault'), Buffer.from([0])], program)[0];
  return { createKey, record: { version: 1, cluster: 'devnet', sourceCommit: 'a'.repeat(40), releaseTag: 'test-only', expectedCurrentAuthority: CURRENT_AUTHORITY,
    governance: { programId: SQUADS_PROGRAM, sdkVersion: '2.1.4', multisig: multisig.toBase58(), vault: vault.toBase58(), vaultIndex: 0, configAuthority: zero, threshold: 2, timeLockSeconds: 172800, signers: ROLES.map((role, i) => ({ role, publicKey: key(21 + i).toBase58(), hardwareWallet: true, permissions: 7 })) }, approvals: { ownerTicket: null, signers: [] } } };
}
function squadsBytes(createKey, g, rent = false) {
  const bytes = Buffer.alloc(100 + (rent ? 32 : 0) + 99);
  createHash('sha256').update('account:Multisig').digest().copy(bytes, 0, 0, 8);
  createKey.toBuffer().copy(bytes, 8); new PublicKey(g.configAuthority).toBuffer().copy(bytes, 40);
  bytes.writeUInt16LE(g.threshold, 72); bytes.writeUInt32LE(g.timeLockSeconds, 74); bytes[94] = rent ? 1 : 0;
  const count = rent ? 128 : 96; bytes.writeUInt32LE(3, count);
  g.signers.forEach((s, i) => { new PublicKey(s.publicKey).toBuffer().copy(bytes, count + 4 + i * 33); bytes[count + 4 + i * 33 + 32] = s.permissions; }); return bytes;
}
test('bounded unsigned codec round trips full-width layouts and endian vectors', () => {
  for (const width of [0, 1, 8, 16, 24, 32]) {
    const values = width ? [0n, 1n, (1n << BigInt(width * 8)) - 1n] : [0n];
    for (const value of values) {
      const le = codec.toBufferLE(value, width), be = codec.toBufferBE(value, width);
      assert.equal(codec.toBigIntLE(le), value); assert.equal(codec.toBigIntBE(be), value); assert.deepEqual(Buffer.from(le).reverse(), be);
    }
  }
  assert.equal(codec.toBigIntLE(Buffer.from([0x12, 0x34])), 0x3412n);
  assert.equal(codec.toBigIntBE(Buffer.from([0x12, 0x34])), 0x1234n);
});
test('codec rejects overflow, negative, malformed and large work before conversion', () => {
  for (const length of [-1, 1.1, NaN, Infinity, 33, Number.MAX_SAFE_INTEGER]) assert.throws(() => codec.toBufferLE(0n, length));
  assert.throws(() => codec.toBufferBE(-1n, 8)); assert.throws(() => codec.toBufferLE(256n, 1)); assert.throws(() => codec.toBufferBE(1, 8)); assert.throws(() => codec.toBigIntLE(Buffer.alloc(33))); assert.throws(() => codec.toBigIntLE([1, 2]));
});
test('all exposed public identities are permanently rejected for every role', () => {
  for (const { publicKey } of retiredKeys) for (const role of ['payer', 'treasury', 'test actor', 'governance signer']) assert.throws(() => assertNotRetiredPublicKey(publicKey, role), /BAS-AUD-01/);
  assert.equal(assertNotRetiredPublicKey(CURRENT_AUTHORITY), CURRENT_AUTHORITY);
});
test('history scanner detects committed and staged key arrays and reveals only metadata', () => {
  assert.equal(hasSolanaKeypair(JSON.stringify(Array(64).fill(0))), true); assert.equal(hasSolanaKeypair(JSON.stringify(Array(64).fill(256))), false);
  const dir = mkdtempSync(join(tmpdir(), 'basalt-secret-gate-'));
  const git = args => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  try {
    git(['init', '-q']); git(['config', 'user.email', 'test@invalid']); git(['config', 'user.name', 'local-test']);
    writeFileSync(join(dir, 'innocent-name.json'), JSON.stringify(Array(64).fill(0))); git(['add', '.']); git(['commit', '-qm', 'synthetic secret test']);
    git(['rm', 'innocent-name.json']); git(['commit', '-qm', 'remove synthetic test']);
    writeFileSync(join(dir, 'new.json'), JSON.stringify(Array(64).fill(1))); git(['add', 'new.json']);
    const report = scanSecretHistory(dir); assert.equal(report.findings.length, 2); assert(report.findings.some(f => f.path === 'innocent-name.json')); assert(report.findings.some(f => f.path === 'new.json'));
    assert(!JSON.stringify(report).includes(JSON.stringify(Array(64).fill(0))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('oversized text stays blocked while real compiler binary headers are recognized', () => {
  for (const [hex,path] of [['7f454c4602010100','executable'],['cffaedfe0c000001','build-script-build'],['213c617263683e0a','lib.rlib'],['727573740000000a','crate.rmeta'],['5253494300001d31','dep-graph.part.bin'],['fffbb40000000000','song.mp3']]) assert.equal(isRecognizedCompiledBinary(Buffer.from(hex,'hex'),path),true);
  for (const path of ['lib.rlib','fake.o','build-script-build','dep-graph.bin','file.rmeta']) assert.equal(isRecognizedCompiledBinary(Buffer.from('ordinary text data'),path),false);
  const dir=mkdtempSync(join(tmpdir(),'basalt-large-blob-'));
  const git=args=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
  try {
    git(['init','-q']); git(['config','user.email','test@invalid']); git(['config','user.name','local-test']);
    const size=2*1024*1024+1, binary=Buffer.alloc(size); Buffer.from('7f454c4602010100','hex').copy(binary);
    writeFileSync(join(dir,'compiler-output'),binary); writeFileSync(join(dir,'fake.rlib'),'x'.repeat(size)); git(['add','.']); git(['commit','-qm','synthetic large data']);
    const report=scanSecretHistory(dir); assert.deepEqual(report.findings.map(f=>[f.kind,f.path]),[['oversized-unscanned-text','fake.rlib']]);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('ceremony preflight rejects missing/invalid policy, spoofed vaults, retired or duplicate signers', () => {
  const { record } = recordFixture(); assert.equal(validateCeremonyRecord(record).approved, false);
  for (const mutate of [r => { r.cluster = 'mainnet-beta'; }, r => { r.governance.threshold = 1; }, r => { r.governance.timeLockSeconds = 0; }, r => { r.governance.vault = r.governance.multisig; }, r => { r.governance.configAuthority = CURRENT_AUTHORITY; }, r => { r.governance.signers[0].publicKey = retiredKeys[0].publicKey; }, r => { r.governance.signers[0].hardwareWallet = false; }, r => { r.governance.signers[1].publicKey = r.governance.signers[0].publicKey; }]) { const changed = structuredClone(record); mutate(changed); assert.throws(() => validateCeremonyRecord(changed)); }
  record.approvals = { ownerTicket: 'test-owner', signers: record.governance.signers.map(s => ({ publicKey: s.publicKey, ticket: 'test-signer' })) }; assert.equal(validateCeremonyRecord(record).approved, true);
});
test('Squads decoder supports both Borsh option lengths and rejects truncation', () => {
  const { createKey, record } = recordFixture(); for (const rent of [false, true]) assert.deepEqual(decodeSquadsMultisig(squadsBytes(createKey, record.governance, rent)).members, record.governance.signers.map(({ publicKey, permissions }) => ({ publicKey, permissions })));
  assert.throws(() => decodeSquadsMultisig(Buffer.alloc(20))); assert.throws(() => decodeSquadsMultisig(squadsBytes(createKey, record.governance).subarray(0, 150)));
});
test('RPC preflight proves all authorities and Squads state with read methods only', async () => {
  const { createKey, record } = recordFixture(), methods = [], map = new Map();
  assert.equal(DEVNET_GENESIS,'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  const account = (owner, executable, bytes) => ({ owner, executable, data: [bytes.toString('base64'), 'base64'] });
  Object.values(PROGRAM_IDS).forEach((id, i) => {
    const pd = key(30 + i), program = Buffer.alloc(36); program.writeUInt32LE(2); pd.toBuffer().copy(program, 4); map.set(id, account(BPF_UPGRADEABLE_LOADER_ID, true, program));
    const data = Buffer.alloc(46); data.writeUInt32LE(3); data[12] = 1; new PublicKey(CURRENT_AUTHORITY).toBuffer().copy(data, 13); map.set(pd.toBase58(), account(BPF_UPGRADEABLE_LOADER_ID, false, data));
  });
  const whitelist = Buffer.alloc(41); createHash('sha256').update('account:WhitelistConfig').digest().copy(whitelist, 0, 0, 8); new PublicKey(CURRENT_AUTHORITY).toBuffer().copy(whitelist, 8);
  map.set(WHITELIST_CONFIG_PDA, account(PROGRAM_IDS.whitelist, false, whitelist)); map.set(record.governance.multisig, account(SQUADS_PROGRAM, false, squadsBytes(createKey, record.governance)));
  const fetchImpl = async (_, init) => { const call = JSON.parse(init.body); methods.push(call.method); assert(['getGenesisHash', 'getMultipleAccounts'].includes(call.method)); return Response.json({ jsonrpc: '2.0', id: call.id, result: call.method === 'getGenesisHash' ? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' : { context: { slot: 100 }, value: call.params[0].map(id => map.get(id) ?? null) } }); };
  const result = await verifyCeremonyAccounts(record, { rpcUrl: 'https://api.devnet.solana.com', fetchImpl }); assert.equal(result.vaultPdaVerified, true); assert.equal(methods.length, 3);
  map.set(record.governance.multisig, account(SQUADS_PROGRAM, false, squadsBytes(createKey, { ...record.governance, timeLockSeconds: 0 }))); await assert.rejects(verifyCeremonyAccounts(record, { rpcUrl: 'https://api.devnet.solana.com', fetchImpl }), /timelock/);
  const oversizedFetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16*1024*1024));controller.enqueue(Uint8Array.of(1));controller.close();}}));
  await assert.rejects(verifyCeremonyAccounts(record,{rpcUrl:'https://api.devnet.solana.com',fetchImpl:oversizedFetch}),/response exceeds limit/);
});
test('Rust gate fails unknown advisories, changed locks, secret API reachability and expired exceptions', () => {
  const bytes = Buffer.from('lock'), item = { advisory: { id: 'RUSTSEC-TEST' }, package: { name: 'crate', version: '1.0.0', checksum: 'test' } };
  const report = { database: { 'last-commit': 'test' }, vulnerabilities: { list: [item] }, warnings: {} }, policy = { version: 1, lockfileSha256: createHash('sha256').update(bytes).digest('hex'), exceptions: [{ advisory: 'RUSTSEC-TEST', package: 'crate', version: '1.0.0', checksum: 'test', owner: 'test', justification: 'test-only', reviewedAt: '2026-10-09', expiresAt: '2026-10-23' }] };
  const options = { now: new Date('2026-10-09T12:00:00Z'), lockfileBytes: bytes }; assert.equal(evaluateRustAudit(report, policy, options).blockers.length, 0);
  assert(evaluateRustAudit(report, policy, { ...options, now: new Date('2026-10-23') }).blockers.length); assert(evaluateRustAudit(report, { ...policy, exceptions: [] }, options).blockers.length); assert(evaluateRustAudit(report, policy, { ...options, lockfileBytes: Buffer.from('changed') }).blockers.length); assert(evaluateRustAudit(report, policy, { ...options, sourceText: 'ed25519_dalek::Keypair' }).blockers.length);
});
