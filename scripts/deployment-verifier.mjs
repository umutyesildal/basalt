#!/usr/bin/env node

/**
 * Read-only deployment evidence helpers.
 *
 * This module deliberately has no Solana SDK dependency. It talks to the
 * JSON-RPC account methods directly so that verification cannot accidentally
 * acquire a signer or a transaction submission path.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const FINALIZED_COMMITMENT = "finalized";
export const BPF_UPGRADEABLE_LOADER_ID = "BPFLoaderUpgradeab1e11111111111111111111111";
export const PROGRAM_IDS = Object.freeze({
  basket: "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k",
  basket_factory: "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF",
  whitelist: "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS",
});
export const WHITELIST_PROGRAM_ID = PROGRAM_IDS.whitelist;
// Derived from [b"config"] under WHITELIST_PROGRAM_ID. Keep this fixed and
// verify the program id before using it; accepting a caller-supplied PDA would
// allow a manifest to redirect the authority read to an unrelated account.
export const WHITELIST_CONFIG_PDA = "ESRwG8qoKaLM17dLEM6MJDRpKVYtkd9M2zUmbud2uXZd";
export const PROGRAM_NAMES = ["basket", "basket_factory", "whitelist"];

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const ACCOUNT_DISCRIMINATOR = createHash("sha256")
  .update("account:WhitelistConfig")
  .digest()
  .subarray(0, 8);

function asBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  throw new TypeError(`${label} must be a byte array`);
}

export function decodeBase58(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("public key must be a non-empty base58 string");
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) throw new Error(`invalid base58 character in public key: ${character}`);
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 0xffn));
    number >>= 8n;
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes.push(0);
  }
  bytes.reverse();
  return Uint8Array.from(bytes);
}

export function encodeBase58(bytes) {
  const input = asBytes(bytes, "bytes");
  let number = 0n;
  for (const byte of input) number = (number << 8n) | BigInt(byte);
  let encoded = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    encoded = BASE58_ALPHABET[remainder] + encoded;
    number /= 58n;
  }
  for (const byte of input) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}

export function assertPublicKey(value, label = "public key") {
  let decoded;
  try {
    decoded = decodeBase58(value);
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`);
  }
  if (decoded.length !== 32 || encodeBase58(decoded) !== value) {
    throw new Error(`${label} must be a canonical 32-byte base58 public key`);
  }
  return value;
}

function readU32LE(bytes, offset, label) {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error(`${label} is truncated`);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readU64LE(bytes, offset, label) {
  if (offset < 0 || offset + 8 > bytes.length) throw new Error(`${label} is truncated`);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true);
}

function readPubkey(bytes, offset, label) {
  if (offset < 0 || offset + 32 > bytes.length) throw new Error(`${label} is truncated`);
  return encodeBase58(bytes.subarray(offset, offset + 32));
}

export function decodeProgramAccount(data) {
  const bytes = asBytes(data, "program account data");
  if (bytes.length !== 36) throw new Error(`Program account must be exactly 36 bytes; got ${bytes.length}`);
  const stateTag = readU32LE(bytes, 0, "Program state tag");
  if (stateTag !== 2) throw new Error(`expected UpgradeableLoaderState::Program tag 2; got ${stateTag}`);
  const programDataAddress = readPubkey(bytes, 4, "ProgramData address");
  return { stateTag, programDataAddress };
}

export function decodeProgramDataAccount(data) {
  const bytes = asBytes(data, "ProgramData account data");
  // UpgradeableLoaderState::size_of_programdata_metadata() is always 45
  // bytes. Bincode's None option occupies one byte, but the loader keeps the
  // same 45-byte code offset and pads the remaining authority bytes.
  if (bytes.length < 45) throw new Error(`ProgramData account is shorter than its 45-byte metadata region (${bytes.length})`);
  const stateTag = readU32LE(bytes, 0, "ProgramData state tag");
  if (stateTag !== 3) throw new Error(`expected UpgradeableLoaderState::ProgramData tag 3; got ${stateTag}`);
  const slot = readU64LE(bytes, 4, "ProgramData slot");
  const authorityOption = bytes[12];
  let upgradeAuthority = null;
  const metadataLength = 45;
  if (authorityOption === 1) {
    upgradeAuthority = readPubkey(bytes, 13, "ProgramData upgrade authority");
  } else if (authorityOption !== 0) {
    throw new Error(`ProgramData authority option must be 0 or 1; got ${authorityOption}`);
  }
  return {
    stateTag,
    slot: slot.toString(10),
    upgradeAuthority,
    authorityOption,
    metadataLength,
    programDataLength: bytes.length - metadataLength,
  };
}

export function decodeWhitelistConfig(data) {
  const bytes = asBytes(data, "WhitelistConfig account data");
  if (bytes.length < 41) throw new Error(`WhitelistConfig account is truncated (${bytes.length} bytes)`);
  if (!Buffer.from(bytes.subarray(0, 8)).equals(ACCOUNT_DISCRIMINATOR)) {
    throw new Error("WhitelistConfig account discriminator mismatch");
  }
  const authority = readPubkey(bytes, 8, "WhitelistConfig authority");
  const pendingOption = bytes[40];
  let pendingAuthority = null;
  if (pendingOption === 1) {
    pendingAuthority = readPubkey(bytes, 41, "WhitelistConfig pending authority");
  } else if (pendingOption !== 0) {
    throw new Error(`WhitelistConfig pending authority option must be 0 or 1; got ${pendingOption}`);
  }
  return { authority, pendingAuthority, pendingOption };
}

export function assertRpcUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RPC URL must be an absolute http(s) URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("RPC URL protocol must be http or https");
  }
  if (url.username || url.password) throw new Error("RPC URL credentials are forbidden");
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(url.hostname);
  if (url.protocol === "http:" && !loopback) {
    throw new Error("non-loopback RPC URLs must use https");
  }
  return url;
}

export function sanitizeRpcOrigin(value) {
  const url = assertRpcUrl(value);
  return `${url.protocol}//${url.host}`;
}

function decodeRpcAccount(account, label) {
  if (!account || typeof account !== "object") throw new Error(`${label} is missing from RPC response`);
  if (typeof account.owner !== "string") throw new Error(`${label} owner is missing from RPC response`);
  if (typeof account.executable !== "boolean") throw new Error(`${label} executable flag is missing from RPC response`);
  if (!Array.isArray(account.data) || account.data[1] !== "base64" || typeof account.data[0] !== "string") {
    throw new Error(`${label} must use base64 account encoding`);
  }
  const encoded = account.data[0];
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`${label} contains invalid base64 data`);
  }
  let data;
  try {
    data = Uint8Array.from(Buffer.from(encoded, "base64"));
  } catch {
    throw new Error(`${label} contains invalid base64 data`);
  }
  return { owner: account.owner, executable: account.executable, data, dataLength: data.length };
}

function assertContextSlot(context, label) {
  if (!context || !Number.isSafeInteger(context.slot) || context.slot < 0) {
    throw new Error(`${label} RPC context slot is missing or unsafe`);
  }
  return context.slot.toString(10);
}

export class JsonRpcClient {
  constructor({ rpcUrl, fetchImpl = globalThis.fetch }) {
    this.url = assertRpcUrl(rpcUrl).toString();
    if (typeof fetchImpl !== "function") throw new Error("a fetch implementation is required");
    this.fetchImpl = fetchImpl;
    this.requestId = 0;
  }

  async call(method, params) {
    if (method !== "getMultipleAccounts" && method !== "getAccountInfo") {
      throw new Error(`RPC method is not allowed: ${method}`);
    }
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.requestId, method, params }),
    });
    if (!response || response.ok !== true) {
      throw new Error(`RPC request failed with HTTP status ${response?.status ?? "unknown"}`);
    }
    const payload = await response.json();
    if (!payload || payload.jsonrpc !== "2.0") throw new Error("RPC response is not JSON-RPC 2.0");
    if (payload.error) throw new Error(`RPC ${method} failed: ${payload.error.message ?? "unknown error"}`);
    return payload.result;
  }

  async getMultipleAccounts(addresses) {
    if (!Array.isArray(addresses) || addresses.length === 0) throw new Error("getMultipleAccounts requires addresses");
    const result = await this.call("getMultipleAccounts", [addresses, { encoding: "base64", commitment: FINALIZED_COMMITMENT }]);
    if (!result || !Array.isArray(result.value)) throw new Error("getMultipleAccounts result is malformed");
    if (result.value.length !== addresses.length) throw new Error("getMultipleAccounts returned the wrong account count");
    return { contextSlot: assertContextSlot(result.context, "getMultipleAccounts"), accounts: result.value };
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest must be a JSON object");
  if (manifest.project !== "basalt") throw new Error("manifest project must be basalt");
  if (manifest.schemaVersion !== 2) throw new Error("manifest schemaVersion must be 2");
  if (!manifest.deployment || typeof manifest.deployment !== "object" || Array.isArray(manifest.deployment)) {
    throw new Error("manifest deployment is missing");
  }
  if (typeof manifest.deployment.environment !== "string" || manifest.deployment.environment.length === 0) {
    throw new Error("manifest deployment environment is missing");
  }
  if (typeof manifest.deployment.cluster !== "string" || manifest.deployment.cluster.length === 0) {
    throw new Error("manifest deployment cluster is missing");
  }
  if (!manifest.programs || typeof manifest.programs !== "object" || Array.isArray(manifest.programs)) {
    throw new Error("manifest programs are missing");
  }
  for (const name of PROGRAM_NAMES) {
    const program = manifest.programs[name];
    if (!program || typeof program !== "object") throw new Error(`manifest program ${name} is missing`);
    assertPublicKey(program.programId, `${name} programId`);
    if (program.programId !== PROGRAM_IDS[name]) {
      throw new Error(`${name} programId must be canonical Basalt address ${PROGRAM_IDS[name]}`);
    }
  }
  const ids = PROGRAM_NAMES.map((name) => manifest.programs[name].programId);
  if (new Set(ids).size !== ids.length) throw new Error("manifest program IDs must be unique");
  return manifest;
}

function assertAccountOwner(account, expectedOwner, label) {
  if (account.owner !== expectedOwner) throw new Error(`${label} owner mismatch: expected ${expectedOwner}, got ${account.owner}`);
}

export async function verifyManifestAccounts({
  manifest,
  sourceManifestSha256,
  rpcUrl,
  expectedAuthority,
  fetchImpl = globalThis.fetch,
  observedAt = new Date().toISOString(),
}) {
  validateManifest(manifest);
  if (typeof sourceManifestSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sourceManifestSha256)) {
    throw new Error("source manifest SHA-256 is required");
  }
  assertPublicKey(expectedAuthority, "expected authority");
  const rpcOrigin = sanitizeRpcOrigin(rpcUrl);
  const declaredRpcOrigin = manifest.deployment.rpcUrl === null || manifest.deployment.rpcUrl === undefined
    ? null
    : sanitizeRpcOrigin(manifest.deployment.rpcUrl);
  if (declaredRpcOrigin !== null && declaredRpcOrigin !== rpcOrigin) {
    throw new Error(`manifest RPC origin ${declaredRpcOrigin} does not match verifier RPC origin ${rpcOrigin}`);
  }
  const declaredAuthorities = PROGRAM_NAMES
    .map((name) => manifest.programs[name].upgradeAuthority)
    .filter((authority) => authority !== null && authority !== undefined);
  if (manifest.deployment?.upgradeAuthority) declaredAuthorities.push(manifest.deployment.upgradeAuthority);
  for (const declaredAuthority of declaredAuthorities) {
    assertPublicKey(declaredAuthority, "manifest upgrade authority");
    if (declaredAuthority !== expectedAuthority) {
      throw new Error(`manifest upgrade authority declaration ${declaredAuthority} does not match expected authority ${expectedAuthority}`);
    }
  }
  const observedDate = new Date(observedAt);
  if (Number.isNaN(observedDate.valueOf())) throw new Error("observedAt must be a valid ISO timestamp");

  const client = new JsonRpcClient({ rpcUrl, fetchImpl });
  const programAddresses = PROGRAM_NAMES.map((name) => manifest.programs[name].programId);
  const programsRead = await client.getMultipleAccounts(programAddresses);
  const programRecords = new Map();
  const programDataAddresses = [];
  for (let index = 0; index < PROGRAM_NAMES.length; index += 1) {
    const name = PROGRAM_NAMES[index];
    const account = decodeRpcAccount(programsRead.accounts[index], `${name} Program account`);
    assertAccountOwner(account, BPF_UPGRADEABLE_LOADER_ID, `${name} Program account`);
    if (account.executable !== true) throw new Error(`${name} Program account is not executable`);
    const decoded = decodeProgramAccount(account.data);
    programRecords.set(name, {
      name,
      programId: manifest.programs[name].programId,
      programDataAddress: decoded.programDataAddress,
      programReadContextSlot: programsRead.contextSlot,
      programAccountOwner: account.owner,
      programAccountExecutable: account.executable,
      programAccountDataLength: account.dataLength,
    });
    programDataAddresses.push(decoded.programDataAddress);
  }
  if (new Set(programDataAddresses).size !== programDataAddresses.length) {
    throw new Error("manifest programs resolve to duplicate ProgramData accounts");
  }

  // Re-read the Program accounts in the same finalized snapshot as their
  // ProgramData accounts and WhitelistConfig. The first read discovers the
  // ProgramData pointers; this second read is the evidence snapshot and
  // rejects a pointer or executable/owner change between reads.
  const evidenceAddresses = [...programAddresses, ...programDataAddresses, WHITELIST_CONFIG_PDA];
  const dataRead = await client.getMultipleAccounts(evidenceAddresses);
  if (BigInt(dataRead.contextSlot) < BigInt(programsRead.contextSlot)) {
    throw new Error("RPC context slot regressed between account reads");
  }
  const whitelistAccount = decodeRpcAccount(dataRead.accounts[dataRead.accounts.length - 1], "WhitelistConfig account");
  assertAccountOwner(whitelistAccount, WHITELIST_PROGRAM_ID, "WhitelistConfig account");
  if (whitelistAccount.executable !== false) throw new Error("WhitelistConfig account must not be executable");
  const whitelist = decodeWhitelistConfig(whitelistAccount.data);
  if (whitelist.authority !== expectedAuthority) {
    throw new Error(`WhitelistConfig authority mismatch: expected ${expectedAuthority}, got ${whitelist.authority}`);
  }
  if (whitelist.pendingAuthority !== null) {
    throw new Error(`WhitelistConfig still has pending authority ${whitelist.pendingAuthority}`);
  }

  const programs = {};
  for (let index = 0; index < PROGRAM_NAMES.length; index += 1) {
    const name = PROGRAM_NAMES[index];
    const record = programRecords.get(name);
    const programAccount = decodeRpcAccount(dataRead.accounts[index], `${name} Program account (evidence snapshot)`);
    assertAccountOwner(programAccount, BPF_UPGRADEABLE_LOADER_ID, `${name} Program account (evidence snapshot)`);
    if (programAccount.executable !== true) throw new Error(`${name} Program account is not executable in evidence snapshot`);
    const programDecoded = decodeProgramAccount(programAccount.data);
    if (programDecoded.programDataAddress !== record.programDataAddress) {
      throw new Error(`${name} ProgramData pointer changed during verification`);
    }

    const account = decodeRpcAccount(
      dataRead.accounts[PROGRAM_NAMES.length + index],
      `${name} ProgramData account`,
    );
    assertAccountOwner(account, BPF_UPGRADEABLE_LOADER_ID, `${name} ProgramData account`);
    if (account.executable !== false) throw new Error(`${name} ProgramData account must not be executable`);
    const decoded = decodeProgramDataAccount(account.data);
    if (decoded.upgradeAuthority !== expectedAuthority) {
      throw new Error(`${name} upgrade authority mismatch: expected ${expectedAuthority}, got ${decoded.upgradeAuthority ?? "immutable"}`);
    }
    if (decoded.programDataLength === 0) throw new Error(`${name} ProgramData contains no deployed bytes`);
    const declaredSlot = manifest.programs[name].deployedSlot;
    if (declaredSlot !== null && declaredSlot !== undefined) {
      if (!Number.isSafeInteger(declaredSlot) || declaredSlot < 0) {
        throw new Error(`${name} declared deployed slot is missing or unsafe`);
      }
      if (BigInt(declaredSlot) !== BigInt(decoded.slot)) {
        throw new Error(`${name} declared deployed slot ${declaredSlot} does not match RPC slot ${decoded.slot}`);
      }
    }
    programs[name] = {
      name,
      programId: record.programId,
      programDataAddress: record.programDataAddress,
      upgradeAuthority: decoded.upgradeAuthority,
      authorityMatchesExpected: true,
      programDataSlot: decoded.slot,
      programDataAuthorityOption: decoded.authorityOption,
      programDataMetadataLength: decoded.metadataLength,
      programDataLength: decoded.programDataLength,
      programAccountOwner: programAccount.owner,
      programDataAccountOwner: account.owner,
      programAccountExecutable: programAccount.executable,
      programDataAccountExecutable: account.executable,
      programAccountDataLength: programAccount.dataLength,
      programDataAccountDataLength: account.dataLength,
      discoveryReadContextSlot: record.programReadContextSlot,
      programReadContextSlot: dataRead.contextSlot,
      programDataReadContextSlot: dataRead.contextSlot,
    };
  }

  if (manifest.deployment.deployedSlot !== null && manifest.deployment.deployedSlot !== undefined) {
    const declaredSharedSlot = manifest.deployment.deployedSlot;
    if (!Number.isSafeInteger(declaredSharedSlot) || declaredSharedSlot < 0) {
      throw new Error("manifest shared deployed slot is missing or unsafe");
    }
    const actualSlots = new Set(Object.values(programs).map(({ programDataSlot }) => programDataSlot));
    if (actualSlots.size !== 1 || !actualSlots.has(String(declaredSharedSlot))) {
      throw new Error("manifest shared deployed slot does not match every RPC ProgramData slot");
    }
  }

  return {
    evidenceVersion: 1,
    project: manifest.project,
    sourceManifest: {
      schemaVersion: manifest.schemaVersion ?? null,
      gitCommit: manifest.git?.commit ?? null,
      sha256: sourceManifestSha256.toLowerCase(),
      environment: manifest.deployment.environment,
      cluster: manifest.deployment.cluster,
      declaredRpcOrigin,
    },
    verification: {
      status: "verified",
      source: "rpc",
      rpcOrigin,
      commitment: FINALIZED_COMMITMENT,
      observedAt: observedDate.toISOString(),
      expectedAuthority,
      firstReadContextSlot: programsRead.contextSlot,
      secondReadContextSlot: dataRead.contextSlot,
    },
    programs,
    whitelistConfig: {
      address: WHITELIST_CONFIG_PDA,
      programId: WHITELIST_PROGRAM_ID,
      accountOwner: whitelistAccount.owner,
      executable: whitelistAccount.executable,
      accountDataLength: whitelistAccount.dataLength,
      authority: whitelist.authority,
      pendingAuthority: whitelist.pendingAuthority,
      authorityMatchesExpected: true,
      readContextSlot: dataRead.contextSlot,
    },
    checks: {
      allProgramAccountsExecutable: true,
      allProgramDataAccountsNonExecutable: true,
      allLoaderOwnersVerified: true,
      allAuthoritiesMatchExpected: true,
      whitelistAuthorityMatchesExpected: true,
      whitelistPendingAuthorityEmpty: true,
      noProgramDataAliases: true,
    },
    limitations: [
      "RPC evidence verifies loader state and whitelist authority only; it does not prove Squads threshold, signer autonomy, timelock configuration, or source reproducibility.",
      "ProgramData slots are loader last-modified slots, not source commit identifiers.",
      "No deployed ELF hash is emitted because this verifier has no subprocess or artifact-download path.",
      "The manifest cluster label and RPC origin are recorded, but cluster genesis identity is not independently proven by this account-read-only verifier.",
    ],
  };
}

export function atomicWriteJson(outputPath, value) {
  const absolutePath = resolve(outputPath);
  const temporaryPath = `${absolutePath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, absolutePath);
  } catch (error) {
    try { if (existsSync(temporaryPath)) unlinkSync(temporaryPath); } catch { /* preserve original error */ }
    throw error;
  }
}

export function loadManifest(manifestPath) {
  return loadManifestDocument(manifestPath).manifest;
}

export function loadManifestDocument(manifestPath) {
  const absolutePath = resolve(manifestPath);
  let raw;
  try {
    raw = readFileSync(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`cannot read manifest ${absolutePath}: ${error.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new Error(`cannot parse manifest ${absolutePath}: ${error.message}`);
  }
  return {
    manifest,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

export function defaultEvidencePath(manifestPath) {
  const absolutePath = resolve(manifestPath);
  return `${absolutePath}.rpc-evidence.json`;
}

export function usage() {
  return `Usage: node scripts/verify-deployment-manifest.mjs --manifest <path> --rpc-url <url> --expected-authority <vault> --output <path> [--observed-at <iso>]`;
}
