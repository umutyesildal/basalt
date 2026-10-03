/** Read-only devnet byte attestation. No signing-key or transaction-submission paths. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PublicKey } from "@solana/web3.js";
import { decodeProgramAccount, decodeProgramDataAccount, decodeWhitelistConfig } from "./deployment-verifier.mjs";

export const DEPLOYMENT_RPC = "https://api.devnet.solana.com";
export const EXPECTED_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const EXPECTED_AUTHORITY = "y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE";
export const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const DEPLOYMENT_PROGRAMS = {
  whitelist: "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS",
  basket_factory: "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF",
  basket: "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k",
} as const;
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
export function programDataAddress(program: string): string {
  return PublicKey.findProgramAddressSync([new PublicKey(program).toBuffer()], new PublicKey(LOADER))[0].toBase58();
}
/** Reject CPI-only artifacts before RPC, including the observed 896-byte no-entrypoint ELF. */
export function validateSbfElf(bytes: Buffer) {
  if (bytes.length < 64 || !bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1) throw new Error("Artifact is not a complete little-endian ELF64 file");
  const machine = bytes.readUInt16LE(18), entry = bytes.readBigUInt64LE(24), phoff = Number(bytes.readBigUInt64LE(32));
  const phsize = bytes.readUInt16LE(54), phcount = bytes.readUInt16LE(56);
  if (![247, 263].includes(machine) || bytes.readUInt16LE(16) !== 3) throw new Error("Artifact is not an SBF shared-object ELF");
  if (entry === 0n) throw new Error("Artifact has no entrypoint; a CPI-only build must not be deployed");
  if (!Number.isSafeInteger(phoff) || phoff < 64 || phsize !== 56 || phcount === 0 || phcount > 64 || phoff + phsize * phcount > bytes.length) throw new Error("Artifact ELF program headers are malformed");
  let entryCovered = false;
  for (let i = 0; i < phcount; i++) {
    const at = phoff + i * phsize, type = bytes.readUInt32LE(at), flags = bytes.readUInt32LE(at + 4);
    const offset = Number(bytes.readBigUInt64LE(at + 8)), vaddr = bytes.readBigUInt64LE(at + 16), fileSize = Number(bytes.readBigUInt64LE(at + 32)), memorySize = bytes.readBigUInt64LE(at + 40);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(fileSize) || offset + fileSize > bytes.length || BigInt(fileSize) > memorySize) throw new Error("Artifact ELF segment exceeds its file");
    if (type === 1 && (flags & 1) && entry >= vaddr && entry < vaddr + BigInt(fileSize)) entryCovered = true;
  }
  if (!entryCovered) throw new Error("Artifact entrypoint is outside executable file bytes");
  return { format: "ELF64-LE", machine, entrypoint: `0x${entry.toString(16)}`, flags: bytes.readUInt32LE(48), bytes: bytes.length, sha256: sha256(bytes) };
}
export function verifyProgramBytes(data: Buffer, artifact: Buffer) {
  const decoded = decodeProgramDataAccount(data);
  if (decoded.upgradeAuthority !== EXPECTED_AUTHORITY) throw new Error("ProgramData upgrade authority does not match the expected wallet");
  const stored = data.subarray(45), prefix = stored.subarray(0, artifact.length), padding = stored.subarray(artifact.length);
  if (stored.length < artifact.length) throw new Error("ProgramData is shorter than the local artifact");
  if (!prefix.equals(artifact)) throw new Error("Deployed executable bytes differ from the local artifact");
  if (padding.some(byte => byte !== 0)) throw new Error("ProgramData trailing capacity contains nonzero bytes");
  return { deployedSlot: decoded.slot, upgradeAuthority: decoded.upgradeAuthority, executableOffset: 45, capacityBytes: stored.length,
    matchedPrefixBytes: prefix.length, storedPrefixSha256: sha256(prefix), trailingPaddingBytes: padding.length, trailingPaddingAllZero: true, accountDataSha256: sha256(data) };
}
function rpcAccount(value: any, owner: string, executable: boolean, label: string) {
  if (!value || value.owner !== owner || value.executable !== executable || !Array.isArray(value.data) || value.data[1] !== "base64" || typeof value.data[0] !== "string") throw new Error(`${label}: missing account, wrong owner, executable flag or encoding`);
  const encoded = value.data[0];
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error(`${label}: malformed base64`);
  const data = Buffer.from(encoded, "base64");
  if (data.length > 10 * 1024 * 1024) throw new Error(`${label}: oversized account`);
  return data;
}
async function sourceFiles(root: string) {
  const paths = ["Cargo.toml", "Cargo.lock", "Anchor.toml"];
  for (const name of Object.keys(DEPLOYMENT_PROGRAMS)) {
    paths.push(`programs/${name}/Cargo.toml`);
    await walk(join(root, "programs", name, "src"));
  }
  paths.push("crates/token-policy/Cargo.toml"); await walk(join(root, "crates/token-policy/src"));
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".rs")) paths.push(relative(root, path));
    }
  }
  const files = await Promise.all(paths.sort().map(async path => { const bytes = await readFile(join(root, path)); return { path, bytes: bytes.length, sha256: sha256(bytes) }; }));
  return { files, fileSetSha256: sha256(JSON.stringify(files)) };
}
export async function attestDeployment(options: { fetchImpl?: typeof fetch; root?: string; now?: () => Date } = {}) {
  const root = options.root ?? ROOT, fetchImpl = options.fetchImpl ?? fetch, now = options.now ?? (() => new Date());
  const artifacts = await Promise.all(Object.entries(DEPLOYMENT_PROGRAMS).map(async ([name, programId]) => {
    const path = `target/deploy/${name}.so`, bytes = await readFile(join(root, path));
    return { name, programId, programData: programDataAddress(programId), path, bytes, elf: validateSbfElf(bytes) };
  }));
  const source = await sourceFiles(root);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  const startedAt = now().toISOString(); let requestId = 0;
  async function rpc(method: "getGenesisHash" | "getMultipleAccounts", params: unknown[]) {
    const id = ++requestId;
    const response = await fetchImpl(DEPLOYMENT_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok) throw new Error(`Read-only RPC HTTP ${response.status}`);
    const body = await response.json() as any;
    if (body.jsonrpc !== "2.0" || body.id !== id || body.error || !("result" in body)) throw new Error(`Read-only ${method} RPC failed or returned an invalid envelope`);
    return body.result;
  }
  const genesisHash = await rpc("getGenesisHash", []);
  if (genesisHash !== EXPECTED_GENESIS) throw new Error("RPC genesis is not Solana devnet");
  const whitelistConfig = PublicKey.findProgramAddressSync([Buffer.from("config")], new PublicKey(DEPLOYMENT_PROGRAMS.whitelist))[0].toBase58();
  const addresses = [...artifacts.map(row => row.programId), ...artifacts.map(row => row.programData), whitelistConfig];
  const result = await rpc("getMultipleAccounts", [addresses, { commitment: "finalized", encoding: "base64" }]);
  if (!Number.isSafeInteger(result?.context?.slot) || result.context.slot < 0 || !Array.isArray(result.value) || result.value.length !== addresses.length) throw new Error("Finalized account batch is incomplete");
  const programs = artifacts.map((artifact, index) => {
    const program = rpcAccount(result.value[index], LOADER, true, `${artifact.name} program`);
    if (decodeProgramAccount(program).programDataAddress !== artifact.programData) throw new Error(`${artifact.name}: ProgramData link does not match its PDA`);
    const data = rpcAccount(result.value[index + artifacts.length], LOADER, false, `${artifact.name} ProgramData`);
    const match = verifyProgramBytes(data, artifact.bytes);
    if (BigInt(match.deployedSlot) > BigInt(result.context.slot)) throw new Error("Deployment slot is newer than finalized observation");
    return { name: artifact.name, programId: artifact.programId, programData: artifact.programData, owner: LOADER, executable: true, artifactPath: artifact.path, artifact: artifact.elf, ...match };
  });
  const configData = rpcAccount(result.value.at(-1), DEPLOYMENT_PROGRAMS.whitelist, false, "Whitelist config");
  const config = decodeWhitelistConfig(configData);
  if (config.authority !== EXPECTED_AUTHORITY || config.pendingAuthority !== null) throw new Error("Whitelist authority/pending authority changed");
  // Fail instead of mixing files from concurrent edits/builds into a passing attestation.
  if ((await sourceFiles(root)).fileSetSha256 !== source.fileSetSha256) throw new Error("Source files changed during observation");
  for (const artifact of artifacts) if (sha256(await readFile(join(root, artifact.path))) !== artifact.elf.sha256) throw new Error("Local artifact changed during observation");
  return { schemaVersion: 1, kind: "basalt-devnet-executable-byte-attestation", startedAt, observedAt: now().toISOString(), rpc: DEPLOYMENT_RPC,
    commitment: "finalized", genesisHash, finalizedSlot: result.context.slot, expectedAuthority: EXPECTED_AUTHORITY, byteMatch: true, programs,
    whitelist: { address: whitelistConfig, authority: config.authority, pendingAuthority: config.pendingAuthority },
    checkout: { head, dirty: status.trim().length > 0, statusLines: status.trimEnd().split("\n").filter(Boolean), sourceFiles: source.files, sourceFileSetSha256: source.fileSetSha256 },
    claim: "Deployed executable prefixes equal the observed local ELF files, with zero-only trailing capacity. Source hashes describe this checkout; they do not prove reproducible source-to-binary compilation or an independent audit." };
}
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { output: { type: "string", default: "-" } }, strict: true });
  const result = await attestDeployment(); const output = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output === "-") process.stdout.write(output);
  else {
    const path = resolve(values.output!); await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, output, { flag: "wx" }); await rename(`${path}.tmp`, path);
    console.log(`Verified deployed bytes; wrote ${path}`);
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : "Read-only verification failed"); process.exitCode = 1; });
