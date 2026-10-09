#!/usr/bin/env node
/** Public metadata and read-only RPC only. No Keypair, signing or submission API. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertPublicKey, assertRpcUrl, JsonRpcClient, PROGRAM_IDS, WHITELIST_CONFIG_PDA, BPF_UPGRADEABLE_LOADER_ID, decodeProgramAccount, decodeProgramDataAccount, decodeWhitelistConfig, encodeBase58 } from '../deployment-verifier.mjs';
import { assertNotRetiredPublicKey } from './retired-keys.mjs';
const { PublicKey } = createRequire(new URL('../../backend/package.json', import.meta.url))('@solana/web3.js');
export const CURRENT_AUTHORITY = 'y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE';
export const SQUADS_PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aM6uEgTu8meYaNbYQYY5';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const ROLES = ['protocol-maintainer', 'security-incident-lead', 'operations-release-lead'];
const DEFAULT_KEY = '11111111111111111111111111111111';
const fail = message => { throw new Error(message); };
function publicKey(value, label) { assertPublicKey(value, label); assertNotRetiredPublicKey(value, label); return value; }
export function validateCeremonyRecord(record) {
  if (!record || record.version !== 1 || record.cluster !== 'devnet') fail('Record version 1 and explicit devnet cluster required');
  if (!/^[0-9a-f]{40}$/.test(record.sourceCommit ?? '') || typeof record.releaseTag !== 'string' || !record.releaseTag.trim()) fail('Exact sourceCommit and releaseTag required');
  if (record.expectedCurrentAuthority !== CURRENT_AUTHORITY) fail('Unexpected current authority');
  const g = record.governance;
  if (!g || g.programId !== SQUADS_PROGRAM || g.sdkVersion !== '2.1.4') fail('Pinned Squads V4 program and SDK layout 2.1.4 required');
  if (g.threshold !== 2 || g.timeLockSeconds !== 172800 || g.configAuthority !== DEFAULT_KEY || g.vaultIndex !== 0) fail('Autonomous 2-of-3, 48-hour timelock and vault index 0 required');
  publicKey(g.multisig, 'multisig'); publicKey(g.vault, 'vault');
  const derived = PublicKey.findProgramAddressSync([Buffer.from('multisig'), new PublicKey(g.multisig).toBuffer(), Buffer.from('vault'), Buffer.from([0])], new PublicKey(SQUADS_PROGRAM))[0].toBase58();
  if (g.vault !== derived || g.vault === g.multisig) fail('Vault must be the independently derived Squads vault PDA');
  if (!Array.isArray(g.signers) || g.signers.length !== 3 || new Set(g.signers.map(s => s.role)).size !== 3) fail('Three distinct hardware-wallet roles required');
  for (const signer of g.signers) {
    if (!ROLES.includes(signer.role) || signer.hardwareWallet !== true || signer.permissions !== 7) fail('Each required role must acknowledge independent hardware custody and Initiate/Vote/Execute permissions');
    publicKey(signer.publicKey, 'governance signer');
  }
  if (new Set([g.multisig, g.vault, CURRENT_AUTHORITY, ...Object.values(PROGRAM_IDS), ...g.signers.map(s => s.publicKey)]).size !== 9) fail('Signers, current authority, programs, multisig and vault must be independent addresses');
  const approvals = record.approvals;
  const ownerApproved = typeof approvals?.ownerTicket === 'string' && approvals.ownerTicket.trim().length > 0;
  const signerApprovals = approvals?.signers ?? [];
  const signersApproved = Array.isArray(signerApprovals) && signerApprovals.length === 3 && g.signers.every(signer => signerApprovals.filter(a => a.publicKey === signer.publicKey && typeof a.ticket === 'string' && a.ticket.trim()).length === 1);
  return { record, approved: ownerApproved && signersApproved };
}
/** Borsh layout pinned to Squads V4 SDK 2.1.4; checks all bounds before reads. */
export function decodeSquadsMultisig(data) {
  const bytes = Buffer.from(data); const discriminator = createHash('sha256').update('account:Multisig').digest().subarray(0, 8);
  if (bytes.length < 96 || !bytes.subarray(0, 8).equals(discriminator)) fail('Invalid Squads Multisig discriminator or length');
  const createKey = encodeBase58(bytes.subarray(8, 40)), configAuthority = encodeBase58(bytes.subarray(40, 72));
  const threshold = bytes.readUInt16LE(72), timeLockSeconds = bytes.readUInt32LE(74);
  const rentOption = bytes[94]; if (rentOption !== 0 && rentOption !== 1) fail('Invalid Squads rent collector option');
  const bumpOffset = 95 + (rentOption ? 32 : 0), countOffset = bumpOffset + 1;
  if (bytes.length < countOffset + 4) fail('Truncated Squads members');
  const count = bytes.readUInt32LE(countOffset); if (count !== 3 || bytes.length < countOffset + 4 + 33 * count) fail('Squads must contain exactly three complete members');
  const members = Array.from({ length: count }, (_, i) => { const start = countOffset + 4 + 33 * i; return { publicKey: encodeBase58(bytes.subarray(start, start + 32)), permissions: bytes[start + 32] }; });
  return { createKey, configAuthority, threshold, timeLockSeconds, members };
}
export async function verifyCeremonyAccounts(record, { rpcUrl, fetchImpl = globalThis.fetch } = {}) {
  validateCeremonyRecord(record); assertRpcUrl(rpcUrl);
  // Cap time and response size; only these read methods can leave this module.
  const boundedFetch = async (url, init) => {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) });
    if (!response.ok) fail('Preflight RPC unavailable');
    const reader = response.body?.getReader(); if (!reader) fail('Preflight RPC response body missing');
    const chunks = []; let total = 0;
    try {
      for (;;) {
        const {value,done} = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > 16 * 1024 * 1024) { await reader.cancel(); fail('Preflight RPC response exceeds limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return new Response(Buffer.concat(chunks,total), { status: response.status, headers: response.headers });
  };
  const genesisResponse = await boundedFetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'getGenesisHash', params: [] }) });
  const genesis = await genesisResponse.json(); if (genesis.result !== DEVNET_GENESIS || genesis.error) fail('RPC must be devnet');
  const rpc = new JsonRpcClient({ rpcUrl, fetchImpl: boundedFetch });
  const names = Object.keys(PROGRAM_IDS), addresses = [...Object.values(PROGRAM_IDS), WHITELIST_CONFIG_PDA, record.governance.multisig];
  const first = await rpc.getMultipleAccounts(addresses);
  function account(value, owner, executable) {
    if (!value || value.owner !== owner || value.executable !== executable || !Array.isArray(value.data) || value.data[1] !== 'base64') fail('RPC account owner, executable flag or encoding mismatch');
    return Buffer.from(value.data[0], 'base64');
  }
  const programData = names.map((_, i) => decodeProgramAccount(account(first.accounts[i], BPF_UPGRADEABLE_LOADER_ID, true)).programDataAddress);
  const whitelist = decodeWhitelistConfig(account(first.accounts[3], PROGRAM_IDS.whitelist, false));
  if (whitelist.authority !== CURRENT_AUTHORITY || whitelist.pendingAuthority !== null) fail('Whitelist current or pending authority mismatch');
  const second = await rpc.getMultipleAccounts(programData);
  for (const value of second.accounts) if (decodeProgramDataAccount(account(value, BPF_UPGRADEABLE_LOADER_ID, false)).upgradeAuthority !== CURRENT_AUTHORITY) fail('Program upgrade authority mismatch');
  const squads = decodeSquadsMultisig(account(first.accounts[4], SQUADS_PROGRAM, false)), g = record.governance;
  const derivedMultisig = PublicKey.findProgramAddressSync([Buffer.from('multisig'), Buffer.from('multisig'), new PublicKey(squads.createKey).toBuffer()], new PublicKey(SQUADS_PROGRAM))[0].toBase58();
  if (derivedMultisig !== g.multisig || squads.threshold !== g.threshold || squads.timeLockSeconds !== g.timeLockSeconds || squads.configAuthority !== g.configAuthority) fail('On-chain Squads identity, threshold, autonomy or timelock mismatch');
  if (!g.signers.every(s => squads.members.filter(m => m.publicKey === s.publicKey && m.permissions === s.permissions).length === 1)) fail('On-chain Squads members or permissions mismatch');
  return { cluster: 'devnet', commitment: 'finalized', contextSlots: [first.contextSlot, second.contextSlot], currentAuthoritiesVerified: names, whitelistAuthorityVerified: true, proposedMultisigVerified: true, vaultPdaVerified: true };
}
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { record: { type: 'string' }, 'rpc-url': { type: 'string' } }, strict: true });
  if (!values.record) fail('--record <public ceremony JSON> is required');
  const parsed = JSON.parse(readFileSync(values.record, 'utf8'));
  const { record, approved } = validateCeremonyRecord(parsed);
  const evidence = values['rpc-url'] ? await verifyCeremonyAccounts(record, { rpcUrl: values['rpc-url'] }) : null;
  console.log(JSON.stringify({ mode: 'unsigned-read-only-preflight', approvedRecordPresent: approved, rpcVerified: Boolean(evidence), executionAuthorized: false, stopConditions: [...(!approved ? ['Exact owner and all three signer approvals are missing'] : []), ...(!evidence ? ['Live current authority and proposed Squads state verification required'] : []), 'Human ceremony authorization and transaction review required; this tool never authorizes execution'], evidence }, null, 2));
  return approved && evidence ? 0 : 2;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().then(code => { process.exitCode = code; }, () => { console.error('governance-preflight: blocked; validate exact public ceremony inputs and read-only devnet evidence'); process.exitCode = 1; });
