#!/usr/bin/env node
/** Public-only inventory of the existing devnet deployment; no signing/submission API. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  PROGRAM_IDS, WHITELIST_CONFIG_PDA, BPF_UPGRADEABLE_LOADER_ID,
  assertRpcUrl, sanitizeRpcOrigin, decodeProgramAccount,
  decodeProgramDataAccount, decodeWhitelistConfig,
} from '../deployment-verifier.mjs';
import { CURRENT_AUTHORITY, DEVNET_GENESIS } from './governance-preflight.mjs';
import { retiredKeys } from './retired-keys.mjs';

const { PublicKey } = createRequire(new URL('../../backend/package.json', import.meta.url))('@solana/web3.js');
const DEFAULT_RPC = 'https://api.devnet.solana.com';
const DEFAULT_KEY = '11111111111111111111111111111111';
const FACTORY_DISCRIMINATOR = createHash('sha256').update('account:FactoryConfig').digest().subarray(0, 8);
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const fail = message => { throw new Error(message); };

function accountBytes(account, owner, executable) {
  if (!account || account.owner !== owner || account.executable !== executable ||
      !Array.isArray(account.data) || account.data.length !== 2 || account.data[1] !== 'base64' ||
      typeof account.data[0] !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(account.data[0])) {
    fail('Account is missing or has an invalid owner, executable flag or encoding');
  }
  return Buffer.from(account.data[0], 'base64');
}

/** Pinned V0 layout; an unknown future layout must be independently reviewed. */
export function decodeCurrentFactory(account) {
  const [address, bump] = PublicKey.findProgramAddressSync([Buffer.from('factory')], new PublicKey(PROGRAM_IDS.basket_factory));
  const data = accountBytes(account, PROGRAM_IDS.basket_factory, false);
  if (data.length !== 89 || !data.subarray(0, 8).equals(FACTORY_DISCRIMINATOR) || data[88] !== bump) {
    fail('FactoryConfig layout, discriminator or canonical bump mismatch');
  }
  const authority = new PublicKey(data.subarray(8, 40)).toBase58();
  const treasury = new PublicKey(data.subarray(40, 72)).toBase58();
  if (authority === DEFAULT_KEY || treasury === DEFAULT_KEY) fail('FactoryConfig has a zero authority or treasury');
  const creatorFeeSplitBps = data.readUInt16LE(72);
  const entryFeeCapBps = data.readUInt16LE(74);
  const exitFeeCapBps = data.readUInt16LE(76);
  const managementFeeCapBps = data.readUInt16LE(78);
  if (creatorFeeSplitBps !== 9000 || entryFeeCapBps !== 300 || exitFeeCapBps !== 100 || managementFeeCapBps !== 300) {
    fail('FactoryConfig differs from the immutable V0 fee policy');
  }
  return {
    address: address.toBase58(), authority, treasury,
    treasuryRetired: retiredKeys.some(key => key.publicKey === treasury),
    creatorFeeSplitBps, entryFeeCapBps, exitFeeCapBps, managementFeeCapBps,
    basketCount: data.readBigUInt64LE(80).toString(),
  };
}

/** All network calls are restricted to two public read methods and finalized accounts. */
export async function inspectCurrentDevnetState({ rpcUrl = DEFAULT_RPC, fetchImpl = globalThis.fetch, sourceCommit = null, now = () => new Date() } = {}) {
  assertRpcUrl(rpcUrl);
  if (sourceCommit !== null && !/^[0-9a-f]{40}$/.test(sourceCommit)) fail('sourceCommit must be an exact 40-character Git commit');
  if (typeof fetchImpl !== 'function') fail('A fetch implementation is required');
  let requestId = 0;
  async function rpc(method, params) {
    if (!['getGenesisHash', 'getMultipleAccounts'].includes(method)) fail('RPC method is not read-only');
    const id = ++requestId;
    const response = await fetchImpl(rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response?.ok) fail('Devnet inventory RPC unavailable');
    const reader = response.body?.getReader();
    if (!reader) fail('Devnet inventory RPC body missing');
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); fail('Devnet inventory RPC response exceeds limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
    catch { fail('Devnet inventory RPC returned invalid JSON'); }
    if (!payload || payload.jsonrpc !== '2.0' || payload.id !== id || payload.error) fail('Devnet inventory RPC returned an invalid response');
    return payload.result;
  }
  async function accounts(addresses, minContextSlot) {
    const config = { encoding: 'base64', commitment: 'finalized', ...(minContextSlot === undefined ? {} : { minContextSlot }) };
    const result = await rpc('getMultipleAccounts', [addresses, config]);
    if (!result || !Number.isSafeInteger(result.context?.slot) || result.context.slot < (minContextSlot ?? 0) ||
        !Array.isArray(result.value) || result.value.length !== addresses.length) fail('Devnet inventory account context or count is invalid');
    return result;
  }
  const genesisHash = await rpc('getGenesisHash', []);
  if (genesisHash !== DEVNET_GENESIS) fail('Inventory requires the verified devnet genesis');
  const names = Object.keys(PROGRAM_IDS);
  const loader = new PublicKey(BPF_UPGRADEABLE_LOADER_ID);
  const factoryAddress = PublicKey.findProgramAddressSync([Buffer.from('factory')], new PublicKey(PROGRAM_IDS.basket_factory))[0].toBase58();
  const first = await accounts([...names.map(name => PROGRAM_IDS[name]), WHITELIST_CONFIG_PDA, factoryAddress]);
  const programDataAddresses = names.map((name, index) => {
    const { programDataAddress } = decodeProgramAccount(accountBytes(first.value[index], BPF_UPGRADEABLE_LOADER_ID, true));
    const canonical = PublicKey.findProgramAddressSync([new PublicKey(PROGRAM_IDS[name]).toBuffer()], loader)[0].toBase58();
    if (programDataAddress !== canonical) fail('ProgramData address is not its canonical loader PDA');
    return programDataAddress;
  });
  const whitelist = { address: WHITELIST_CONFIG_PDA, ...decodeWhitelistConfig(accountBytes(first.value[3], PROGRAM_IDS.whitelist, false)) };
  const factory = decodeCurrentFactory(first.value[4]);
  const second = await accounts(programDataAddresses, first.context.slot);
  const programs = names.map((name, index) => ({
    name, programId: PROGRAM_IDS[name], programData: programDataAddresses[index],
    ...decodeProgramDataAccount(accountBytes(second.value[index], BPF_UPGRADEABLE_LOADER_ID, false)),
  }));
  const currentAuthoritiesMatchBaseline = programs.every(program => program.upgradeAuthority === CURRENT_AUTHORITY) &&
    whitelist.authority === CURRENT_AUTHORITY && whitelist.pendingAuthority === null;
  return {
    version: 1, observedAt: now().toISOString(), sourceCommit, cluster: 'devnet',
    rpcOrigin: sanitizeRpcOrigin(rpcUrl), genesisHash, commitment: 'finalized',
    contextSlots: { programsWhitelistFactory: first.context.slot, programData: second.context.slot },
    programs, whitelist, factory,
    containment: {
      newBasketCreationBlocked: factory.treasuryRetired,
      creationPolicyEnforcedBy: 'supported-client-guards',
      onChainCreationDisabled: false,
      reason: factory.treasuryRetired ? 'retired-immutable-factory-treasury' : null,
      legacyRedemptionMustRemainAvailable: true,
      expectedCurrentAuthority: CURRENT_AUTHORITY, currentAuthoritiesMatchBaseline,
    },
    scope: {
      mode: 'unsigned-current-devnet-inventory', readOnly: true, executionAuthorized: false,
      programUpgrades: false, authorityTransfers: false, governanceActivationVerified: false,
      mainnetReadinessVerified: false, deployedProgramBytesVerified: false,
    },
  };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: { 'rpc-url': { type: 'string' }, 'source-commit': { type: 'string' } } });
  const report = await inspectCurrentDevnetState({ rpcUrl: values['rpc-url'] ?? DEFAULT_RPC, sourceCommit: values['source-commit'] ?? null });
  console.log(JSON.stringify(report, null, 2));
  return 0;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(code => { process.exitCode = code; }, () => {
    // Never echo a provider URL, RPC body or potentially sensitive error text.
    console.error('current-devnet-state: blocked; public devnet account evidence could not be verified');
    process.exitCode = 1;
  });
}
