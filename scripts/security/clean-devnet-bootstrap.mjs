#!/usr/bin/env node
/** Unsigned, public-only clean namespace planning. Never loads a signer or edits source. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PROGRAM_IDS, BPF_UPGRADEABLE_LOADER_ID } from '../deployment-verifier.mjs';
import { CURRENT_AUTHORITY, DEVNET_GENESIS, SQUADS_PROGRAM, ROLES, validateCeremonyRecord } from './governance-preflight.mjs';
import { assertNotRetiredPublicKey } from './retired-keys.mjs';

const { PublicKey } = createRequire(new URL('../../backend/package.json', import.meta.url))('@solana/web3.js');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ZERO = '11111111111111111111111111111111';
const RPC = 'https://api.devnet.solana.com';
const NAMES = ['whitelist', 'basket_factory', 'basket'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !fields.includes(key))) fail(`${label} must contain only the documented public fields`);
}
function publicKey(value, label) {
  try {
    if (typeof value !== 'string' || new PublicKey(value).toBase58() !== value || value === ZERO) throw new Error();
    assertNotRetiredPublicKey(value, label);
  } catch { fail(`${label} must be a nonzero, canonical, nonretired public key`); }
  return value;
}
function pda(seeds, program) { return PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58(); }

/** Nulls deliberately remain null until the actual owners supply PUBLIC addresses. */
export function publicInputTemplate(sourceCommit = null) {
  return {
    version: 1, cluster: 'devnet', sourceCommit, releaseTag: null,
    programIds: { whitelist: null, basket_factory: null, basket: null },
    bootstrapAuthority: null, treasury: null,
    governance: {
      programId: SQUADS_PROGRAM, sdkVersion: '2.1.4', multisig: null, vault: null, vaultIndex: 0,
      configAuthority: ZERO, threshold: 2, timeLockSeconds: 172800,
      signers: ROLES.map(role => ({ role, publicKey: null, hardwareWallet: true, permissions: 7 })),
    },
    approvals: { ownerTicket: null, signers: [] },
  };
}

export function validateCleanBootstrapRecord(record) {
  exactFields(record, ['version', 'cluster', 'sourceCommit', 'releaseTag', 'programIds', 'bootstrapAuthority', 'treasury', 'governance', 'approvals'], 'Record');
  exactFields(record.programIds, NAMES, 'programIds');
  exactFields(record.governance, ['programId', 'sdkVersion', 'multisig', 'vault', 'vaultIndex', 'configAuthority', 'threshold', 'timeLockSeconds', 'signers'], 'governance');
  if (!Array.isArray(record.governance.signers)) fail('Three public governance signers required');
  for (const signer of record.governance.signers) exactFields(signer, ['role', 'publicKey', 'hardwareWallet', 'permissions'], 'signer');
  exactFields(record.approvals, ['ownerTicket', 'signers'], 'approvals');
  if (!Array.isArray(record.approvals.signers)) fail('Public signer approval references required');
  for (const approval of record.approvals.signers) exactFields(approval, ['publicKey', 'ticket'], 'signer approval');
  // This reuses the existing reviewed public governance policy; it does not prove signatures or custody.
  const { approved } = validateCeremonyRecord({
    version: record.version, cluster: record.cluster, sourceCommit: record.sourceCommit,
    releaseTag: record.releaseTag, expectedCurrentAuthority: CURRENT_AUTHORITY,
    governance: record.governance, approvals: record.approvals,
  });
  publicKey(record.bootstrapAuthority, 'bootstrapAuthority');
  publicKey(record.treasury, 'treasury');
  for (const name of NAMES) {
    publicKey(record.programIds[name], `programIds.${name}`);
    if (!PublicKey.isOnCurve(new PublicKey(record.programIds[name]).toBytes())) fail('New deployable program IDs must be on-curve public identities');
  }
  const programs = NAMES.map(name => record.programIds[name]);
  const forbidden = [ZERO, SQUADS_PROGRAM, BPF_UPGRADEABLE_LOADER_ID, CURRENT_AUTHORITY,
    ...Object.values(PROGRAM_IDS), record.bootstrapAuthority, record.treasury,
    record.governance.multisig, record.governance.vault, ...record.governance.signers.map(s => s.publicKey)];
  if (new Set(programs).size !== 3 || programs.some(key => forbidden.includes(key))) fail('Three distinct new program identities separate from all existing/operational identities required');
  if (record.bootstrapAuthority === record.governance.multisig || record.treasury === record.governance.multisig ||
      [SQUADS_PROGRAM, BPF_UPGRADEABLE_LOADER_ID, ...Object.values(PROGRAM_IDS)].includes(record.bootstrapAuthority) ||
      [SQUADS_PROGRAM, BPF_UPGRADEABLE_LOADER_ID, CURRENT_AUTHORITY, ...Object.values(PROGRAM_IDS)].includes(record.treasury)) {
    fail('Bootstrap authority/treasury cannot be a program, the multisig config, or the legacy bootstrap authority');
  }
  return { approvedRecordPresent: approved };
}

// Remove inactive Rust comments/string contents before recognizing active init
// attributes. Nested block comments and raw strings must not spoof a guard.
function activeRustText(source) {
  let result = '', i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i + 2); i = end < 0 ? source.length : end;
      result += ' '; continue;
    }
    if (source.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth > 0) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth !== 0) fail('Unterminated Rust block comment');
      result += ' '; continue;
    }
    const raw = source.slice(i).match(/^(?:b)?r(#{0,255})"/);
    if (raw) {
      const endMarker = '"' + raw[1], end = source.indexOf(endMarker, i + raw[0].length);
      if (end < 0) fail('Unterminated Rust raw string');
      i = end + endMarker.length; result += ' '; continue;
    }
    if (source[i] === '"') {
      i++; let closed = false;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i++] === '"') { closed = true; break; }
      }
      if (!closed) fail('Unterminated Rust string');
      result += ' '; continue;
    }
    result += source[i++];
  }
  return result.replace(/\s+/g, ' ');
}

/** Verify each exact live binding before suggesting a human-reviewed patch location. No replacements are applied. */
export function inspectBootstrapSourceInputs({ root = ROOT, readFile = readFileSync } = {}) {
  const definitions = [
    { path: 'programs/whitelist/src/lib.rs', bindings: [
      ['whitelist-declare-id', 'whitelist', `declare_id!("${PROGRAM_IDS.whitelist}");`],
      ['whitelist-init-context', null, "pub struct InitConfig<'info> {"],
    ] },
    { path: 'programs/basket_factory/src/lib.rs', bindings: [
      ['factory-declare-id', 'basket_factory', `declare_id!("${PROGRAM_IDS.basket_factory}");`],
      ['factory-init-context', null, "pub struct InitFactory<'info> {"],
    ] },
    { path: 'programs/basket/src/lib.rs', bindings: [
      ['basket-declare-id', 'basket', `declare_id!("${PROGRAM_IDS.basket}");`],
      ['basket-trusted-whitelist', 'whitelist', `pub const WHITELIST_PROGRAM_ID: Pubkey = pubkey!("${PROGRAM_IDS.whitelist}");`],
      ['basket-trusted-factory', 'basket_factory', `pub const FACTORY_PROGRAM_ID: Pubkey = pubkey!("${PROGRAM_IDS.basket_factory}");`],
    ] },
    { path: 'Anchor.toml', bindings: [] },
    // Preserve legacy roots; clean registration requires a separately reviewed source change.
    { path: 'backend/src/config/programNamespaces.ts', bindings: [] },
    { path: 'app/lib/program-namespaces.ts', bindings: [] },
    { path: 'app/lib/basket-account-security.ts', bindings: [] },
    { path: 'app/lib/solana.ts', bindings: [] },
    { path: 'app/lib/devnet-baskets.ts', bindings: [] },
    { path: 'app/lib/create-basket-security.ts', bindings: [] },
    { path: 'scripts/lib.ts', bindings: [] },
    { path: 'scripts/deployment-verifier.mjs', bindings: [] },
    { path: 'backend/src/indexer/listener.ts', bindings: [] },
    { path: 'backend/src/api/readiness.ts', bindings: [] },
    { path: 'programs/tests/bootstrap_authority.rs', bindings: [] },
    { path: 'backend/tests/script-builders.test.ts', bindings: [] },
  ];
  return definitions.map(({ path, bindings }) => {
    const text = readFile(resolve(root, path), 'utf8');
    if (typeof text !== 'string') fail('Source input must be text');
    const lines = text.split('\n');
    const points = bindings.map(([id, replacementRole, exactLine]) => {
      const matches = lines.flatMap((line, index) => line.trim() === exactLine ? [index + 1] : []);
      if (matches.length !== 1) fail(`Source binding drift at ${path}; independently review the planner before continuing`);
      return { id, line: matches[0], exactLine, replacementRole };
    });
    if (path === 'Anchor.toml') {
      for (const cluster of ['localnet', 'devnet']) {
        const block = text.match(new RegExp(`\\[programs\\.${cluster}\\]\\n([\\s\\S]*?)(?=\\n\\[|$)`))?.[1];
        if (!block) fail('Anchor cluster mapping missing');
        for (const name of NAMES) {
          const exactLine = `${name} = "${PROGRAM_IDS[name]}"`;
          if (block.split('\n').filter(line => line.trim() === exactLine).length !== 1) fail('Anchor program mapping drift');
          const blockStart = text.indexOf(block);
          const occurrence = block.indexOf(exactLine);
          points.push({ id: `anchor-${cluster}-${name}`, line: text.slice(0, blockStart + occurrence).split('\n').length, exactLine, replacementRole: name });
        }
      }
    }
    let initializationAuthorityGuard = null;
    if (path === 'programs/whitelist/src/lib.rs' || path === 'programs/basket_factory/src/lib.rs') {
      const context = path.includes('/whitelist/') ? 'InitConfig' : 'InitFactory';
      const camel = context === 'InitConfig' ? 'Whitelist' : 'BasketFactory';
      const contextStart = text.indexOf(`pub struct ${context}<'info> {`);
      const contextText = activeRustText(text.slice(contextStart, text.indexOf('\n}', contextStart)));
      initializationAuthorityGuard = [
        `pub program: Program<'info, crate::program::${camel}>,`,
        "pub program_data: Account<'info, ProgramData>,",
        'constraint = program.programdata_address()? == Some(program_data.key())',
        'seeds = [crate::ID.as_ref()]',
        'seeds::program = anchor_lang::solana_program::bpf_loader_upgradeable::ID',
        'constraint = program_data.upgrade_authority_address == Some(authority.key())',
      ].every(binding => contextText.includes(binding.replace(/\s+/g, ' ')));
      if (!initializationAuthorityGuard) fail('Initialization authority guard source is absent or drifted; independently review before planning deployment');
    }
    return { path, sha256: sha256(text), patchPoints: points, initializationAuthorityGuard };
  });
}

function namespace(programIds) {
  return {
    programIds: Object.fromEntries(NAMES.map(name => [name, programIds[name]])),
    programData: Object.fromEntries(NAMES.map(name => [name, pda([new PublicKey(programIds[name]).toBuffer()], BPF_UPGRADEABLE_LOADER_ID)])),
    whitelistConfig: pda([Buffer.from('config')], programIds.whitelist),
    factoryConfig: pda([Buffer.from('factory')], programIds.basket_factory),
  };
}

export function createCleanBootstrapPlan(record = null, { sourceCommit, sourceInputs = inspectBootstrapSourceInputs() } = {}) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? '')) fail('Exact sourceCommit required');
  const validation = record ? validateCleanBootstrapRecord(record) : { approvedRecordPresent: false };
  if (record && record.sourceCommit !== sourceCommit) fail('Public record sourceCommit does not match inspected checkout HEAD');
  const plannedNamespace = record ? namespace(record.programIds) : null;
  const requiredInputs = record ? [] : [
    'Three independent hardware-wallet member PUBLIC keys and custody acknowledgments',
    'New clean treasury PUBLIC recipient and owner acceptance',
    'Three new deployable program PUBLIC IDs; corresponding signers remain with their owners',
    'Explicit bootstrap upgrade-authority PUBLIC identity and funding/operator assignment',
    'Approved autonomous 2-of-3/48h Squads multisig and derived vault PUBLIC identities',
    'Exact source releaseTag, owner review and all three signer approval references',
  ];
  return {
    version: 1, mode: 'unsigned-clean-devnet-bootstrap-plan', sourceCommit,
    cluster: 'devnet', genesisHash: DEVNET_GENESIS,
    executionAuthorized: false, deployable: false, creationReady: false,
    status: record ? 'requires-reviewed-implementation-and-ceremony' : 'awaiting-public-inputs',
    ...validation, requiredInputs,
    inputSha256: record ? sha256(JSON.stringify(record)) : null,
    legacyNamespace: { ...namespace(PROGRAM_IDS), creationAllowed: false, redemptionMustRemainAvailable: true, inPlaceUpgradeRequired: false },
    plannedNamespace,
    proposedPublicInputs: record ? {
      releaseTag: record.releaseTag, bootstrapAuthority: record.bootstrapAuthority, treasury: record.treasury,
      governance: record.governance, approvals: record.approvals,
    } : null,
    sourceInputs: sourceInputs.map(file => ({ ...file, patchPoints: file.patchPoints.map(point => ({
      ...point, proposedPublicKey: record && point.replacementRole ? record.programIds[point.replacementRole] : null,
    })) })),
    sourceInputsSha256: sha256(JSON.stringify(sourceInputs)),
    initializationGuard: {
      implemented: sourceInputs.filter(file => file.initializationAuthorityGuard !== null).length === 2 && sourceInputs.filter(file => file.initializationAuthorityGuard !== null).every(file => file.initializationAuthorityGuard),
      validationScope: 'actual-Anchor-account-constraints-with-public-host-fixtures; System creation is stubbed; validator rehearsal remains required',
      requiredFor: ['whitelist.init_config', 'basket_factory.init_factory'],
      design: 'canonical-upgradeable-loader-programdata-current-authority',
      checks: [
        'Program account is THIS compiled program ID, executable, and owned by the upgradeable loader',
        'Program points to the exact canonical ProgramData PDA derived from THIS program ID under the loader',
        'ProgramData is loader-owned, valid ProgramData state, with upgrade_authority_address == Some(authority signer)',
        'Authority really signed; None/finalized, wrong owner/PDA/program/state/authority all fail atomically',
        'Singleton init remains init-only; no treasury setter, close/re-init or legacy mutation is added',
      ],
      implication: 'Initialize only with the current loader authority; a Squads vault requires a reviewed CPI proposal and its full timelock. Direct ordinary transactions cannot sign for a vault PDA.',
    },
    blockers: [
      'Init authority guard source and host fixtures are present; exact-release compilation/tests and a real local-validator initialization/front-run rehearsal remain required before fresh deployment',
      'Source/IDL/build output must consistently bind all new cross-program identities and pass frozen SBF/Rust/TS/security gates',
      'Closed source registry and legacy-preserving routing are prepared; register only actual reviewed new identities, bind operator manifests, and verify new/legacy runtime flows before activation',
      'Fresh source-bound chain proof must verify empty new namespace, actual Squads membership/threshold/timelock, immutable treasury and deployed bytes',
      'Human owners must inspect and sign deployment, initialization and governance transactions; this plan contains no signed or serialized transactions',
      'Actual two-member/full-48h rehearsal and independent signer approvals remain required; placeholders are not completion evidence',
    ],
    signingSequence: [
      { step: 1, actor: 'approved hardware owners', action: 'Create/review the autonomous Squads account, exact three members, threshold 2, 172800-second timelock and derived vault; fund approved fee/rent payers' },
      { step: 2, actor: 'owners of the three new program identities and approved deployment/upgrade authority', action: 'Deploy only the reviewed clean trio at its new IDs; independently verify ELF/source/loader authority. Leave all legacy programs/accounts untouched' },
      { step: 3, actor: 'current new-program loader upgrade authority', action: 'Initialize the clean whitelist and singleton factory with reviewed clean treasury, split 9000 and fixed caps 300/100/300, under the implemented init guard. If the authority is the vault, use a 2-member proposal after the complete timelock' },
      { step: 4, actor: 'approved whitelist authority', action: 'Admit the existing devnet mock mints after verifying raw Token-2022 metadata; do not create issuer assets or assign USD prices to mocks' },
      { step: 5, actor: 'bootstrap authority then two independent governance members', action: 'Where bootstrap EOA was used, transfer all new loader authorities to the vault; transfer then claim whitelist authority through the timelocked vault. Verify former EOA rejection, threshold and full delay' },
      { step: 6, actor: 'release operator and independent reviewer', action: 'Verify new/legacy namespace routing, legacy oracle-free redemption, clean seed/mint/redeem behavior and public authority evidence before enabling Create for only the clean namespace' },
    ],
    observations: {
      treasuryFreshnessVerified: false, governanceOnChainVerified: false,
      newProgramAccountVacancyVerified: false, deployedBytesVerified: false,
      sourceHashesAreBuildAttestation: false,
    },
  };
}

/** Optional fixed-official-devnet vacancy proof; permits exactly two read methods. */
export async function verifyCleanNamespaceVacant(record, { fetchImpl = globalThis.fetch } = {}) {
  validateCleanBootstrapRecord(record);
  const next = namespace(record.programIds), addresses = [
    ...NAMES.map(name => next.programIds[name]), ...NAMES.map(name => next.programData[name]),
    next.whitelistConfig, next.factoryConfig,
  ];
  let id = 0;
  async function rpc(method, params) {
    if (!['getGenesisHash', 'getMultipleAccounts'].includes(method)) fail('Only public read methods permitted');
    const requestId = ++id;
    const response = await fetchImpl(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: AbortSignal.timeout(15_000),
    });
    if (!response?.ok || !response.body?.getReader) fail('Read-only devnet verification unavailable');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 128 * 1024) { await reader.cancel(); fail('Read-only devnet response exceeds limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { fail('Invalid read-only devnet JSON'); }
    if (payload?.jsonrpc !== '2.0' || payload.id !== requestId || payload.error) fail('Read-only devnet response mismatch');
    return payload.result;
  }
  if (await rpc('getGenesisHash', []) !== DEVNET_GENESIS) fail('Canonical devnet genesis required');
  const result = await rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized' }]);
  if (!Number.isSafeInteger(result?.context?.slot) || result.context.slot < 0 ||
      !Array.isArray(result.value) || result.value.length !== addresses.length || result.value.some(account => account !== null)) {
    fail('New program, loader and singleton accounts must all be absent at a valid finalized slot');
  }
  return { mode: 'public-read-only-new-namespace-vacancy', rpcOrigin: RPC, genesisHash: DEVNET_GENESIS,
    commitment: 'finalized', contextSlot: result.context.slot, addresses, allAbsent: true, executionAuthorized: false };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: {
    record: { type: 'string' }, template: { type: 'boolean' }, 'verify-empty': { type: 'boolean' },
  } });
  if (values.template && (values.record || values['verify-empty'])) fail('Template mode accepts no record or network verification');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (values.template) { console.log(JSON.stringify(publicInputTemplate(sourceCommit), null, 2)); return 0; }
  let record = null;
  if (values.record) {
    if (!statSync(values.record).isFile() || statSync(values.record).size > 32 * 1024) fail('Public record must be a regular JSON file of at most 32 KiB');
    record = JSON.parse(readFileSync(values.record, 'utf8'));
  }
  if (values['verify-empty'] && !record) fail('Explicit public record required for vacancy verification');
  const report = createCleanBootstrapPlan(record, { sourceCommit });
  if (values['verify-empty']) report.vacancyEvidence = await verifyCleanNamespaceVacant(record);
  console.log(JSON.stringify(report, null, 2));
  // Even a complete public record/vacancy check cannot satisfy the remaining release/rehearsal prerequisites or the actual ceremony.
  return 2;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().then(code => { process.exitCode = code; }, () => {
  console.error('clean-devnet-bootstrap: blocked; verify the documented public record and exact source inputs');
  process.exitCode = 1;
});
