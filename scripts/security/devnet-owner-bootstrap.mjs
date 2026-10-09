#!/usr/bin/env node
/** Public-only, unsigned planning for a contained devnet single-owner namespace. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { BPF_UPGRADEABLE_LOADER_ID, PROGRAM_IDS } from '../deployment-verifier.mjs';
import { CURRENT_AUTHORITY, DEVNET_GENESIS, SQUADS_PROGRAM } from './governance-preflight.mjs';
import { assertNotRetiredPublicKey } from './retired-keys.mjs';

const { PublicKey } = createRequire(new URL('../../backend/package.json', import.meta.url))('@solana/web3.js');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RPC = 'https://api.devnet.solana.com';
const MODE = 'devnet-owner-bootstrap-preparation';
const POLICY_PATH = new URL('../../backend/src/config/devnetOwnerPolicy.json', import.meta.url);
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
export const DEVNET_OWNER_POLICY = freeze(JSON.parse(readFileSync(POLICY_PATH, 'utf8')));
const NAMES = ['whitelist', 'basket_factory', 'basket'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
function exactFields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) fail(`${label} must contain only documented public fields`);
}
function key(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  try {
    const parsed = new PublicKey(value);
    if (typeof value !== 'string' || parsed.toBase58() !== value || parsed.equals(PublicKey.default) ||
        !PublicKey.isOnCurve(parsed.toBytes())) throw new Error();
    assertNotRetiredPublicKey(value, label);
  } catch { fail(`${label} must be a canonical, nonzero, on-curve, nonretired public key`); }
  return value;
}
function reference(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,159}$/.test(value)) fail(`${label} must be a short public review reference without credentials or query parameters`);
  if (value.includes('@') || value.includes('://') && !value.startsWith('https://')) fail(`${label} must not contain credentials or a private URL`);
  return value;
}
function namespace(programIds) {
  const pda = (seed, program) => PublicKey.findProgramAddressSync([seed], new PublicKey(program))[0].toBase58();
  return {
    programIds: Object.fromEntries(NAMES.map(name => [name, programIds[name]])),
    programData: Object.fromEntries(NAMES.map(name => [name, pda(new PublicKey(programIds[name]).toBuffer(), BPF_UPGRADEABLE_LOADER_ID)])),
    whitelistConfig: pda(Buffer.from('config'), programIds.whitelist),
    factoryConfig: pda(Buffer.from('factory'), programIds.basket_factory),
  };
}

/** Unknown identities and human acceptances stay unknown. No wallets are generated. */
export function publicOwnerInputTemplate(sourceCommit = null) {
  return {
    ...JSON.parse(JSON.stringify(DEVNET_OWNER_POLICY)),
    sourceCommit, releaseTag: null,
    ownerRoleAcceptance: 'pending', treasuryAcceptance: 'pending', ownerAcceptanceReference: null,
    governance: { kind: 'single-owner-devnet-only', multisig: false, productionApproval: false },
    deploymentExecuted: false,
  };
}

/** Valid input is a declaration, never proof of custody, signature, deployment or approval. */
export function validateDevnetOwnerBootstrapRecord(record, {policy = DEVNET_OWNER_POLICY} = {}) {
  exactFields(record, ['version', 'mode', 'cluster', 'genesisHash', 'sourceCommit', 'releaseTag', 'owner', 'treasury', 'bootstrapAuthority', 'programIds', 'ownerRoleAcceptance', 'treasuryAcceptance', 'ownerAcceptanceReference', 'governance', 'deploymentExecuted'], 'Record');
  if (record.version !== 1 || record.mode !== MODE || record.cluster !== 'devnet' || record.genesisHash !== DEVNET_GENESIS) fail('Explicit version-1 contained devnet preparation and full canonical genesis required');
  exactFields(record.governance, ['kind', 'multisig', 'productionApproval'], 'governance');
  if (record.governance.kind !== 'single-owner-devnet-only' || record.governance.multisig !== false || record.governance.productionApproval !== false || record.deploymentExecuted !== false) fail('Single-owner devnet preparation cannot claim multisig, production approval or execution');
  if (record.sourceCommit != null && !/^[0-9a-f]{40}$/.test(record.sourceCommit)) fail('sourceCommit must be an exact lowercase commit or null');
  const releaseTag = reference(record.releaseTag, 'releaseTag');
  const ownerAcceptanceReference = reference(record.ownerAcceptanceReference, 'ownerAcceptanceReference');
  for (const field of ['ownerRoleAcceptance', 'treasuryAcceptance']) if (!['pending', 'accepted'].includes(record[field] ?? 'pending')) fail(`${field} must explicitly be pending or accepted`);
  const owner = key(record.owner, 'owner', true), treasury = key(record.treasury, 'treasury', true);
  const bootstrapAuthority = key(record.bootstrapAuthority, 'bootstrapAuthority', true);
  exactFields(record.programIds, NAMES, 'programIds');
  const programs = NAMES.map(name => key(record.programIds[name], `programIds.${name}`, true));
  const protectedIds = [PublicKey.default.toBase58(), BPF_UPGRADEABLE_LOADER_ID, SQUADS_PROGRAM, CURRENT_AUTHORITY, ...Object.values(PROGRAM_IDS)];
  for (const operational of [owner, treasury, bootstrapAuthority]) if (operational && protectedIds.includes(operational)) fail('Operational identities must be separate from legacy authority and program identities');
  if (owner && bootstrapAuthority && owner === bootstrapAuthority) fail('Temporary software bootstrap and final owner must be independent identities');
  if (treasury && bootstrapAuthority && treasury === bootstrapAuthority) fail('Immutable treasury cannot retain the temporary software bootstrap identity');
  for (const [name, value, expected] of [['owner', owner, policy.owner], ['bootstrapAuthority', bootstrapAuthority, policy.bootstrapAuthority], ...NAMES.map((name, i) => [`programIds.${name}`, programs[i], policy.programIds[name]])]) {
    if (value && value !== expected) fail(`${name} differs from the source-controlled devnet owner policy`);
  }
  const populated = programs.filter(Boolean);
  if (new Set(populated).size !== populated.length || populated.some(program => [...protectedIds, owner, treasury, bootstrapAuthority].includes(program))) fail('New program identities must be distinct from one another and all operational/legacy identities');
  if (record.ownerRoleAcceptance === 'accepted' && (!owner || !ownerAcceptanceReference)) fail('Declared owner acceptance requires its public key and public review reference');
  if (record.treasuryAcceptance === 'accepted' && (!treasury || !ownerAcceptanceReference)) fail('Declared treasury acceptance requires its public recipient and public review reference');
  const missing = [];
  for (const [label, value] of [['owner', owner], ['treasury', treasury], ['bootstrapAuthority', bootstrapAuthority], ...NAMES.map((name, i) => [`programIds.${name}`, programs[i]]), ['sourceCommit', record.sourceCommit], ['releaseTag', releaseTag]]) if (!value) missing.push(label);
  if (record.ownerRoleAcceptance !== 'accepted') missing.push('ownerRoleAcceptance');
  if (record.treasuryAcceptance !== 'accepted') missing.push('treasuryAcceptance');
  return { missingInputs: missing, declaredOwnerAcceptance: record.ownerRoleAcceptance === 'accepted', declaredTreasuryAcceptance: record.treasuryAcceptance === 'accepted' };
}

// Tokenize strings/comments before examining active Rust declarations. Inactive
// comments, doc strings and raw strings cannot masquerade as feature bindings.
function rustTokens(source) {
  let code = '', i = 0; const strings = new Map();
  const token = value => { const name = `__str${strings.size}__`; strings.set(name, value); return name; };
  while (i < source.length) {
    if (source.startsWith('//', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue; }
    if (source.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth) { if (source.startsWith('/*', i)) { depth++; i += 2; } else if (source.startsWith('*/', i)) { depth--; i += 2; } else i++; }
      if (depth) fail('Unterminated Rust comment in source inputs');
      continue;
    }
    const raw = source.slice(i).match(/^(?:b)?r(#{0,255})"/);
    if (raw) {
      const start = i + raw[0].length, marker = '"' + raw[1], end = source.indexOf(marker, start);
      if (end < 0) fail('Unterminated Rust raw string in source inputs');
      code += token(source.slice(start, end)); i = end + marker.length; continue;
    }
    if (source[i] === '"') {
      const start = ++i;
      while (i < source.length && source[i] !== '"') { if (source[i] === '\\') i++; i++; }
      if (i >= source.length) fail('Unterminated Rust string in source inputs');
      code += token(source.slice(start, i)); i++; continue;
    }
    code += source[i++];
  }
  return {code: code.replace(/\s+/g, ''), strings};
}
function tomlValue(text, section, name) {
  let active = false, sectionCount = 0; const values = [];
  for (const line of text.split('\n')) {
    // Relevant reviewed values use simple JSON-compatible TOML strings/arrays.
    let quote = false, escaped = false, cut = line.length;
    for (let i = 0; i < line.length; i++) {
      if (escaped) { escaped = false; continue; }
      if (line[i] === '\\' && quote) { escaped = true; continue; }
      if (line[i] === '"') quote = !quote;
      if (line[i] === '#' && !quote) { cut = i; break; }
    }
    const entry = line.slice(0, cut).trim();
    if (entry.startsWith('[')) { active = entry === `[${section}]`; if (active) sectionCount++; continue; }
    const match = entry.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (active && match?.[1] === name) { try { values.push(JSON.parse(match[2])); } catch { fail('Unsupported or malformed reviewed TOML binding'); } }
  }
  if (sectionCount !== 1 || values.length !== 1) fail(`Missing or duplicate active TOML binding ${section}.${name}`);
  return values[0];
}
function assertOwnerSourceBindings(sources) {
  function identityPair(path, body, legacy, clean) {
    const {code, strings} = rustTokens(sources.get(path));
    for (const [condition, expected] of [['not\\(feature=(__str\\d+__)\\)', legacy], ['feature=(__str\\d+__)', clean]]) {
      const expression = new RegExp(`#\\[cfg\\(${condition}\\)\\]${body}\\((__str\\d+__)\\);`, 'g');
      const matches = [...code.matchAll(expression)].filter(match => strings.get(match[1]) === 'owner-devnet' && strings.get(match[2]) === expected);
      if (matches.length !== 1) fail(`Active owner-devnet/legacy source binding drift at ${path}`);
    }
    if ([...code.matchAll(new RegExp(`${body}\\((__str\\d+__)\\);`, 'g'))].length !== 2) fail(`Unexpected duplicate/unguarded source identity at ${path}`);
  }
  for (const name of NAMES) {
    const path = `programs/${name}/src/lib.rs`;
    identityPair(path, 'declare_id!', PROGRAM_IDS[name], DEVNET_OWNER_POLICY.programIds[name]);
    const manifest = sources.get(`programs/${name}/Cargo.toml`), feature = tomlValue(manifest, 'features', 'owner-devnet');
    const expected = name === 'basket_factory' ? ['basket/owner-devnet', 'whitelist/owner-devnet'] : [];
    if (!Array.isArray(feature) || JSON.stringify([...feature].sort()) !== JSON.stringify(expected) || JSON.stringify(tomlValue(manifest, 'features', 'default')) !== '[]') fail('Owner feature propagation/default feature drift');
  }
  for (const [constant, name] of [['WHITELIST_PROGRAM_ID', 'whitelist'], ['FACTORY_PROGRAM_ID', 'basket_factory']]) identityPair('programs/basket/src/lib.rs', `pubconst${constant}:Pubkey=pubkey!`, PROGRAM_IDS[name], DEVNET_OWNER_POLICY.programIds[name]);
  for (const cluster of ['localnet', 'devnet']) for (const name of NAMES) {
    if (tomlValue(sources.get('Anchor.toml'), `programs.${cluster}`, name) !== PROGRAM_IDS[name] || tomlValue(sources.get('Anchor.owner-devnet.toml'), `programs.${cluster}`, name) !== DEVNET_OWNER_POLICY.programIds[name]) fail('Separate clean/legacy Anchor identity mapping drift');
  }
  for (const [name, context, program] of [['whitelist', 'InitConfig', 'Whitelist'], ['basket_factory', 'InitFactory', 'BasketFactory']]) {
    const {code} = rustTokens(sources.get(`programs/${name}/src/lib.rs`)), start = code.indexOf(`pubstruct${context}<'info>{`), end = code.indexOf('}', start), body = code.slice(start, end);
    if (start < 0 || end < start || ![
      `pubprogram:Program<'info,crate::program::${program}>`, "pubprogram_data:Account<'info,ProgramData>", "pubauthority:Signer<'info>",
      'constraint=program.programdata_address()?==Some(program_data.key())', 'seeds=[crate::ID.as_ref()]',
      'seeds::program=anchor_lang::solana_program::bpf_loader_upgradeable::ID', 'constraint=program_data.upgrade_authority_address==Some(authority.key())',
    ].every(binding => body.includes(binding))) fail('Active canonical loader initialization guard source drift');
  }
}

/** Check reviewed text bindings and hash exact inputs; these are not compiler/ELF proofs. */
export function inspectDevnetOwnerSourceInputs({ root = ROOT, readFile = readFileSync } = {}) {
  const paths = [
    'programs/whitelist/src/lib.rs', 'programs/basket_factory/src/lib.rs', 'programs/basket/src/lib.rs',
    'programs/whitelist/Cargo.toml', 'programs/basket_factory/Cargo.toml', 'programs/basket/Cargo.toml',
    'Anchor.toml', 'Anchor.owner-devnet.toml', 'Cargo.toml', 'Cargo.lock', 'backend/src/config/programNamespaces.ts', 'backend/src/config/devnetOwnerPolicy.json',
    'app/lib/program-namespaces.ts', 'app/lib/create-basket-security.ts', 'scripts/lib.ts',
    'scripts/security/devnet-owner-bootstrap.mjs', 'scripts/security/retired-keys.json',
  ];
  const sources = new Map(paths.map(path => [path, readFile(resolve(root, path), 'utf8')]));
  assertOwnerSourceBindings(sources);
  return paths.map(path => ({path, sha256:sha256(sources.get(path))}));
}

export function createDevnetOwnerBootstrapPlan(record = null, { sourceCommit, sourceInputs = inspectDevnetOwnerSourceInputs() } = {}) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? '')) fail('Exact inspected checkout sourceCommit required');
  const validation = record ? validateDevnetOwnerBootstrapRecord(record) : { missingInputs: Object.keys(publicOwnerInputTemplate()).filter(name => ['owner', 'treasury', 'bootstrapAuthority', 'programIds', 'sourceCommit', 'releaseTag', 'ownerRoleAcceptance', 'treasuryAcceptance'].includes(name)), declaredOwnerAcceptance: false, declaredTreasuryAcceptance: false };
  if (record?.sourceCommit && record.sourceCommit !== sourceCommit) fail('Record sourceCommit does not match inspected checkout HEAD');
  const planned = record && NAMES.every(name => record.programIds[name]) ? namespace(record.programIds) : null;
  return {
    version: 1, mode: 'unsigned-devnet-owner-bootstrap-plan', cluster: 'devnet', genesisHash: DEVNET_GENESIS,
    sourceCommit, executionAuthorized: false, deployable: false, creationReady: false,
    mainnetApproved: false, multisigApproved: false, ownerControlVerified: false,
    status: validation.missingInputs.length ? 'awaiting-public-inputs-and-owner-role-acceptance' : 'requires-source-build-runtime-proof-and-owner-signatures',
    ...validation, inputSha256: record ? sha256(JSON.stringify(record)) : null,
    proposedPublicInputs: record, plannedNamespace: planned,
    governance: { kind: 'single-owner-devnet-only', upgradeAuthorityModel: 'single-key', whitelistAuthorityModel: 'single-key', multisig: false, timelock: false, productionApproval: false, mainnetPolicyUnchanged: 'independent-hardware-2-of-3-and-48-hour-on-chain-timelock' },
    legacyNamespace: { ...namespace(PROGRAM_IDS), writesAllowed: false, inPlaceUpgradeAllowed: false, creationAllowed: false, redemptionMustRemainAvailable: true, historicalRecoveryActivationAllowed: false },
    allowedScope: { network: 'devnet', programWrites: 'only-reviewed-new-trio-and-its-canonical-accounts', assets: 'verified-project-issued-mocks-only', mockUsdValue: null, softwareBootstrap: 'isolated-temporary-private-storage-no-backend-custody', permanentTreasuryRequiresAcceptance: true },
    sourceInputs, sourceInputsSha256: sha256(JSON.stringify(sourceInputs)),
    sourceFeature: 'owner-devnet', separateAnchorConfig: 'Anchor.owner-devnet.toml',
    sourceHashesAreBuildAttestation: false,
    signingBoundaries: [
      { action: 'deploy-new-trio', required: ['funded-fee-payer', 'new-program-account-key', 'buffer-and-current-upgrade-authority'], note: 'Public program IDs alone cannot sign deployment.' },
      { action: 'initialize-new-singletons', required: ['current-loader-upgrade-authority-also-rent-payer'], note: 'Canonical self Program/ProgramData init guards remain required. To record the owner in immutable FactoryConfig.authority, transfer factory loader authority first, then have the owner initialize.' },
      { action: 'checked-loader-handoff', required: ['current-bootstrap-authority', 'proposed-owner-wallet'], note: 'SetAuthorityChecked requires both signatures; verify the owner on all three finalized ProgramData accounts. Do not finalize programs or infer owner acceptance from an unchecked transfer.' },
      { action: 'whitelist-handoff', required: ['bootstrap-transfer-authority', 'owner-claim-authority'], note: 'Proposal alone does not change current authority; owner must sign claim_authority. FactoryConfig.authority has no setter and is an inactive initialization record.' },
      { action: 'treasury-selection', required: ['initializer-signature-and-owner-approved-public-recipient'], note: 'Receiving treasury fees does not require its signature. The recipient becomes immutable for new baskets; no custody is inferred from its address.' },
    ],
    remainingProof: [
      'Exact owner role/treasury acceptance and reviewed new identities/source release; a review reference alone proves no signature or custody',
      'Feature-gated new compiled declare_id/cross-program bindings and source-controlled closed registry preserve the legacy deployment',
      'Frozen dependencies, full source tests, all three exact-feature SBF ELFs, matching IDLs and deployed-byte/loader attestation',
      'Real validator initialization/front-run/incorrect-authority rejection and checked handoff rehearsal; never claim Squads or hardware proof',
      'Bounded finalized official-devnet proof of vacancy before deployment, then exact canonical loader/authority/config/treasury readback after each signed action',
      'Verified mock mint identities/raw Token-2022 metadata, clean create/mint/redeem and legacy redemption proofs before separate creation enablement',
    ],
  };
}

/** Only fixed official-devnet public reads; one overall deadline and bounded response bytes. */
export async function verifyDevnetOwnerNamespaceVacant(record, { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  validateDevnetOwnerBootstrapRecord(record);
  if (!NAMES.every(name => record.programIds[name])) fail('All three explicit new program identities required for vacancy proof');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) fail('Read-only verification deadline must be bounded to at most 15 seconds');
  const next = namespace(record.programIds), addresses = [...NAMES.map(name => next.programIds[name]), ...NAMES.map(name => next.programData[name]), next.whitelistConfig, next.factoryConfig];
  const controller = new AbortController(); let id = 0, timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Read-only devnet verification deadline exceeded')); }, timeoutMs); });
  const bounded = work => Promise.race([work, deadline]);
  async function rpc(method, params) {
    if (!['getGenesisHash', 'getMultipleAccounts'].includes(method)) fail('Only public read methods permitted');
    const requestId = ++id;
    const response = await bounded(fetchImpl(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: controller.signal }));
    if (!response?.ok || !response.body?.getReader) fail('Read-only devnet verification unavailable');
    const reader = response.body.getReader(), chunks = []; let size = 0, completed = false;
    try {
      for (;;) {
        const {value, done} = await bounded(reader.read());
        if (done) { completed = true; break; }
        size += value.byteLength;
        if (size > 128 * 1024) fail('Read-only devnet response exceeds limit');
        chunks.push(value);
      }
    } finally {
      if (!completed) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { fail('Invalid read-only devnet JSON'); }
    if (payload?.jsonrpc !== '2.0' || payload.id !== requestId || payload.error) fail('Read-only devnet response mismatch');
    return payload.result;
  }
  try {
    if (await rpc('getGenesisHash', []) !== DEVNET_GENESIS) fail('Canonical devnet genesis required');
    const result = await rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized' }]);
    if (!Number.isSafeInteger(result?.context?.slot) || result.context.slot < 0 || !Array.isArray(result.value) || result.value.length !== 8 || result.value.some(account => account !== null)) fail('All new program, loader and singleton accounts must be absent at a valid finalized slot');
    return { mode: 'public-read-only-devnet-owner-vacancy', rpcOrigin: RPC, genesisHash: DEVNET_GENESIS, commitment: 'finalized', contextSlot: result.context.slot, addresses, allAbsent: true, executionAuthorized: false, mainnetApproved: false, ownerControlVerified: false };
  } finally { clearTimeout(timer); controller.abort(); }
}

export async function main(args = process.argv.slice(2)) {
  const {values} = parseArgs({ args, strict: true, options: { record: {type:'string'}, template: {type:'boolean'}, 'verify-empty': {type:'boolean'} } });
  if (values.template && (values.record || values['verify-empty'])) fail('Template mode cannot read a record or contact RPC');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:ROOT, encoding:'utf8'}).trim();
  if (values.template) { console.log(JSON.stringify(publicOwnerInputTemplate(sourceCommit), null, 2)); return 0; }
  let record = null;
  if (values.record) {
    const stat = lstatSync(values.record);
    if (!stat.isFile() || stat.size > 32 * 1024) fail('Public record must be a regular, nonsymlink JSON file of at most 32 KiB');
    record = JSON.parse(readFileSync(values.record, 'utf8'));
  }
  if (values['verify-empty'] && !record) fail('Explicit public record required for read-only verification');
  const report = createDevnetOwnerBootstrapPlan(record, {sourceCommit});
  if (values['verify-empty']) report.vacancyEvidence = await verifyDevnetOwnerNamespaceVacant(record);
  console.log(JSON.stringify(report, null, 2));
  return 2; // Preparation/evidence is never deployment approval, even with every public field filled.
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().then(code => {process.exitCode = code;}, () => {
  console.error('devnet-owner-bootstrap: blocked; verify public inputs, source and contained devnet policy');
  process.exitCode = 1;
});
