/**
 * Prepare a checked loader handoff for the owner's wallet. No chain writes exist
 * in this operator. Default execution is offline; --prepare uses an existing,
 * separately reviewed durable nonce and only the isolated bootstrap signer.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { open, lstat, realpath, link, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, NONCE_ACCOUNT_LENGTH,
  type AccountInfo, type Context, type Message,
} from "@solana/web3.js";
import { DEVNET_GENESIS_HASH } from "../backend/src/config/programNamespaces.js";
import { DEVNET_OWNER_POLICY } from "./security/devnet-owner-bootstrap.mjs";
import { assertNotRetiredPublicKey } from "./security/retired-keys.mjs";
import {
  createBootstrapPlan, validateDeploymentProof, verifyDeployedBytes,
  openPrivateRun, programData, LOADER, ROLES, MAX_FEE_LAMPORTS, MIN_RESERVE_LAMPORTS,
  type BootstrapPlan, type OwnerManifest,
} from "./devnet-owner-bootstrap.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RPC_URL = "https://api.devnet.solana.com";
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function publicKey(value: unknown): PublicKey {
  assert(typeof value === "string", "Canonical public identity required");
  const key = new PublicKey(value);
  assert(key.toBase58() === value && !key.equals(PublicKey.default), "Canonical nonzero public identity required");
  assertNotRetiredPublicKey(key, "devnet handoff public identity");
  return key;
}

export interface OwnerHandoffPackage {
  version: 1;
  cluster: "devnet";
  genesisHash: string;
  sourceCommit: string;
  owner: string;
  bootstrapAuthority: string;
  nonceAccount: string;
  nonceValue: string;
  transactionBase64: string;
}
export interface HandoffReadRpc {
  getGenesisHash(): Promise<string>;
  getMultipleAccountsInfoAndContext(
    keys: PublicKey[], config: { commitment: "finalized"; minContextSlot?: number },
  ): Promise<{ context: Context; value: Array<AccountInfo<Buffer> | null> }>;
  getMinimumBalanceForRentExemption(bytes: number, commitment: "finalized"): Promise<number>;
  getFeeForMessage(message: Message, commitment: "finalized"): Promise<{ context: Context; value: number | null }>;
}
export interface HandoffState {
  slot: number;
  nonceAccount: string;
  nonceValue: string;
  feeLamports: number;
  bootstrapBalance: number;
}
/** Synthetic policy injection is for isolated tests; the CLI has no override. */
export function createOwnerHandoffPlan(sourceCommit: string, internal: { policy?: OwnerManifest } = {}): BootstrapPlan {
  const policy = internal.policy ?? DEVNET_OWNER_POLICY;
  // Accepted declarations are not needed for a CHECKED transfer: the wallet must
  // supply the genuine second signature before this transaction can execute.
  return createBootstrapPlan(structuredClone(policy), sourceCommit, { policy });
}
function nonceKey(value: string, plan: BootstrapPlan): PublicKey {
  const key = publicKey(value);
  const forbidden = [plan.manifest.owner, plan.manifest.bootstrapAuthority,
    ...ROLES.flatMap(role => [plan.manifest.programIds[role], programData(new PublicKey(plan.manifest.programIds[role])).toBase58()]),
    plan.namespace.whitelistConfig, plan.namespace.factoryConfig, LOADER.toBase58()];
  assert(PublicKey.isOnCurve(key.toBytes()) && !forbidden.includes(value), "Distinct on-curve durable nonce account required");
  return key;
}
/** All loader bytes, authorities, nonce and fee payer come from one finalized bank. */
export async function readOwnerHandoffState(
  rpc: HandoffReadRpc, plan: BootstrapPlan, proofInput: unknown, nonceAccount: string, minContextSlot = 0,
): Promise<HandoffState> {
  const proof = validateDeploymentProof(proofInput, plan), nonce = nonceKey(nonceAccount, plan);
  assert(Number.isSafeInteger(minContextSlot) && minContextSlot >= 0, "Invalid finalized slot bound");
  assert(await rpc.getGenesisHash() === DEVNET_GENESIS_HASH, "Refusing non-devnet genesis");
  const artifacts = ROLES.map(role => proof.programs[role]);
  const keys = [...artifacts.map(artifact => new PublicKey(artifact.programId)),
    ...artifacts.map(artifact => new PublicKey(artifact.programData)), nonce, new PublicKey(plan.manifest.bootstrapAuthority)];
  const [batch, rent] = await Promise.all([
    rpc.getMultipleAccountsInfoAndContext(keys, { commitment: "finalized", minContextSlot }),
    rpc.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH, "finalized"),
  ]);
  assert(Number.isSafeInteger(batch.context.slot) && batch.context.slot >= minContextSlot && batch.value.length === keys.length,
    "Incomplete or regressing finalized handoff state");
  artifacts.forEach((artifact, index) => verifyDeployedBytes(batch.value[index], batch.value[index + 3], artifact, plan.manifest.bootstrapAuthority));
  const nonceInfo = batch.value[6], payer = batch.value[7];
  assert(Number.isSafeInteger(rent) && rent > 0, "Invalid nonce rent quote");
  assert(nonceInfo && nonceInfo.owner.equals(SystemProgram.programId) && !nonceInfo.executable &&
    nonceInfo.data.length === NONCE_ACCOUNT_LENGTH && Number.isSafeInteger(nonceInfo.lamports) && nonceInfo.lamports >= rent,
  "Nonce must be a rent-exempt initialized system account");
  // SDK decoding alone accepts uninitialized/legacy state. Require current
  // Versions::Current + State::Initialized before reading its saved blockhash.
  assert(nonceInfo.data.readUInt32LE(0) === 1 && nonceInfo.data.readUInt32LE(4) === 1 &&
    new PublicKey(nonceInfo.data.subarray(8, 40)).toBase58() === plan.manifest.bootstrapAuthority,
  "Nonce version/state/bootstrap authority mismatch");
  const nonceValue = publicKey(new PublicKey(nonceInfo.data.subarray(40, 72)).toBase58()).toBase58();
  const storedRate = nonceInfo.data.readBigUInt64LE(72);
  assert(storedRate > 0n && storedRate * 2n <= BigInt(MAX_FEE_LAMPORTS), "Durable nonce saved signature fee exceeds the fixed cap");
  assert(payer && payer.owner.equals(SystemProgram.programId) && !payer.executable && payer.data.length === 0 &&
    Number.isSafeInteger(payer.lamports) && payer.lamports >= MIN_RESERVE_LAMPORTS,
  "Bootstrap fee payer is invalid or below the fee/reserve budget");
  const state = { slot: batch.context.slot, nonceAccount, nonceValue, feeLamports: 0, bootstrapBalance: payer.lamports };
  // Modern runtimes may use their current fee structure after recognizing the
  // durable nonce. Quote the exact two-signature message rather than assuming
  // its stored fee calculator is the final network fee.
  const quote = await rpc.getFeeForMessage(buildOwnerHandoffTransaction(plan, state).compileMessage(), "finalized");
  assert(Number.isSafeInteger(quote.context.slot) && quote.context.slot >= state.slot && quote.value !== null &&
    Number.isSafeInteger(quote.value) && quote.value > 0 && quote.value <= MAX_FEE_LAMPORTS &&
    payer.lamports >= quote.value + MIN_RESERVE_LAMPORTS, "Finalized handoff fee quote is invalid or exceeds the fee/reserve budget");
  return { ...state, feeLamports: quote.value };
}
/** Exact legacy message. No token movement, initialization or unchecked transfer. */
export function buildOwnerHandoffTransaction(plan: BootstrapPlan, state: HandoffState): Transaction {
  const bootstrap = new PublicKey(plan.manifest.bootstrapAuthority), owner = new PublicKey(plan.manifest.owner);
  const nonce = nonceKey(state.nonceAccount, plan);
  publicKey(state.nonceValue);
  const transaction = new Transaction({ feePayer: bootstrap, recentBlockhash: state.nonceValue });
  transaction.add(SystemProgram.nonceAdvance({ noncePubkey: nonce, authorizedPubkey: bootstrap }));
  const data = Buffer.alloc(4); data.writeUInt32LE(7); // UpgradeableLoaderInstruction::SetAuthorityChecked
  for (const role of ROLES) transaction.add(new TransactionInstruction({ programId: LOADER, data: Buffer.from(data), keys: [
    { pubkey: programData(new PublicKey(plan.manifest.programIds[role])), isWritable: true, isSigner: false },
    { pubkey: bootstrap, isWritable: false, isSigner: true },
    { pubkey: owner, isWritable: false, isSigner: true },
  ] }));
  return transaction;
}
export interface HandoffPreparation {
  package: OwnerHandoffPackage;
  evidence: {
    commitment: "finalized"; contextSlot: number; sourceCommit: string;
    deploymentProofSha256: string; messageSha256: string; transactionSha256: string;
    feeLamports: number; maximumFeeLamports: number; chainWrites: false; ownerSigned: false;
  };
}
/** Prepare only. The supplied RPC interface intentionally cannot submit anything. */
export async function prepareOwnerHandoff(options: {
  sourceCommit: string; deploymentProof: unknown; nonceAccount: string; rpc: HandoffReadRpc;
  loadSigner: () => Promise<Keypair>; internal?: { policy?: OwnerManifest }; now?: () => number;
}): Promise<HandoffPreparation> {
  const plan = createOwnerHandoffPlan(options.sourceCommit, options.internal);
  const proof = validateDeploymentProof(options.deploymentProof, plan), now = options.now ?? Date.now, started = now();
  const first = await readOwnerHandoffState(options.rpc, plan, proof, options.nonceAccount);
  const fresh = await readOwnerHandoffState(options.rpc, plan, proof, options.nonceAccount, first.slot);
  assert(fresh.nonceValue === first.nonceValue && fresh.feeLamports === first.feeLamports, "Nonce changed during preparation; start a new reviewed preparation");
  assert(now() - started < 45_000, "Finalized preparation evidence is too old");
  const transaction = buildOwnerHandoffTransaction(plan, fresh), message = transaction.serializeMessage();
  const signer = await options.loadSigner();
  assert(signer.publicKey.toBase58() === plan.manifest.bootstrapAuthority, "Private signer differs from the fixed bootstrap identity");
  assert(now() - started < 45_000, "Finalized preparation evidence expired before signing");
  transaction.partialSign(signer);
  assert(transaction.serializeMessage().equals(message) && transaction.signatures.length === 2 &&
    transaction.signatures[0].publicKey.equals(signer.publicKey) && transaction.signatures[0].signature !== null &&
    transaction.signatures[1].publicKey.toBase58() === plan.manifest.owner && transaction.signatures[1].signature === null &&
    transaction.verifySignatures(false), "Partial-signature/message binding failed");
  const raw = transaction.serialize({ requireAllSignatures: false, verifySignatures: true });
  return {
    package: { version: 1, cluster: "devnet", genesisHash: DEVNET_GENESIS_HASH, sourceCommit: plan.sourceCommit,
      owner: plan.manifest.owner, bootstrapAuthority: plan.manifest.bootstrapAuthority,
      nonceAccount: fresh.nonceAccount, nonceValue: fresh.nonceValue, transactionBase64: raw.toString("base64") },
    evidence: { commitment: "finalized", contextSlot: fresh.slot, sourceCommit: plan.sourceCommit,
      deploymentProofSha256: sha256(JSON.stringify(proof)), messageSha256: sha256(message), transactionSha256: sha256(raw),
      feeLamports: fresh.feeLamports, maximumFeeLamports: MAX_FEE_LAMPORTS, chainWrites: false, ownerSigned: false },
  };
}
/** A later UI-only commit may reuse exact committed program artifacts. */
export function verifyOwnerHandoffSourceBinding(sourceCommit: string, root = ROOT): {
  buildSourceCommit: string; checkoutSourceCommit: string; programSourceMatches: true;
} {
  assert(/^[a-f0-9]{40}$/.test(sourceCommit), "Exact deployment source commit required");
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const checkoutSourceCommit = git(["rev-parse", "HEAD"]);
  assert(/^[a-f0-9]{40}$/.test(checkoutSourceCommit) && git(["cat-file", "-t", sourceCommit]) === "commit", "Committed build source required");
  git(["merge-base", "--is-ancestor", sourceCommit, checkoutSourceCommit]);
  assert(git(["diff", "--name-only", sourceCommit, checkoutSourceCommit, "--", "programs", "crates", "vendor/rust", "scripts/security/rust-parent-verification", "Cargo.toml", "Cargo.lock", "Anchor.toml", "Anchor.owner-devnet.toml", ".cargo", "rust-toolchain", "rust-toolchain.toml", "scripts/build-v0-sbf.sh"]) === "", "Program/build inputs differ from deployment proof source");
  const path = "backend/src/config/devnetOwnerPolicy.json";
  const historical = JSON.parse(git(["show", `${sourceCommit}:${path}`]));
  const current = JSON.parse(git(["show", `${checkoutSourceCommit}:${path}`]));
  for (const field of ["version", "cluster", "genesisHash", "owner", "bootstrapAuthority"]) {
    assert(historical[field] === current[field], "Historical/current handoff trust roots differ");
  }
  assert(ROLES.every(role => historical.programIds?.[role] === current.programIds?.[role]), "Historical/current program identities differ");
  return { buildSourceCommit: sourceCommit, checkoutSourceCommit, programSourceMatches: true };
}
async function readPublicProof(path: string): Promise<unknown> {
  const stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 128_000, "Public proof must be a regular JSON file of at most 128 KiB");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat();
    assert(actual.ino === stat.ino && actual.dev === stat.dev && actual.size <= 128_000, "Public proof changed during open");
    return JSON.parse(await handle.readFile("utf8"));
  } finally { await handle.close(); }
}
/** Atomic, no-overwrite export. Only public package bytes may reach this writer. */
export async function writeOwnerHandoffPackage(path: string, value: OwnerHandoffPackage): Promise<void> {
  const target = resolve(path), directory = dirname(target);
  assert(value && Object.keys(value).sort().join() === ["version", "cluster", "genesisHash", "sourceCommit", "owner", "bootstrapAuthority", "nonceAccount", "nonceValue", "transactionBase64"].sort().join(), "Only the public package schema may be exported");
  assert(await realpath(directory) === directory && /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$/.test(basename(target)), "Use a real output directory and a simple JSON filename");
  const temporary = join(directory, `.handoff-${process.pid}-${Date.now()}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync();
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  finally { await handle.close(); }
  try {
    // link is atomic and fails if target already exists, including a symlink.
    await link(temporary, target);
    const parent = await open(directory, constants.O_RDONLY);
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await unlink(temporary).catch(() => {}); }
}
function boundedReadFetch(): typeof fetch {
  const deadline = Date.now() + 45_000; let count = 0;
  return (async (input, init) => {
    assert(String(input) === RPC_URL || String(input) === `${RPC_URL}/`, "Only the fixed official devnet endpoint is permitted");
    const method = JSON.parse(String(init?.body)).method;
    assert(++count <= 12 && Date.now() < deadline && ["getGenesisHash", "getMultipleAccounts", "getMinimumBalanceForRentExemption", "getFeeForMessage"].includes(method), "Read-only handoff RPC budget exceeded");
    const response = await fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(Math.min(12_000, deadline - Date.now())) });
    assert(response.ok && response.body, "Read-only devnet verification unavailable");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
        assert(size <= 16 * 1024 * 1024 && Date.now() < deadline, "Read-only response exceeds size/time budget"); chunks.push(chunk.value); }
    } finally { await reader.cancel(); }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  }) as typeof fetch;
}
export async function main(args = process.argv.slice(2)): Promise<unknown> {
  const { values } = parseArgs({ args, strict: true, options: {
    prepare: { type: "boolean", default: false }, execute: { type: "boolean", default: false },
    "deployment-proof": { type: "string" }, "nonce-account": { type: "string" },
    "run-dir": { type: "string" }, output: { type: "string" }, help: { type: "boolean" },
  } });
  assert(!values.execute, "This operator never executes chain transactions; nonce creation must be separately reviewed");
  if (values.help) {
    console.log("Default: offline public handoff plan. --prepare --deployment-proof <source-bound-public-proof.json> --nonce-account <existing-reviewed-nonce> --run-dir <owned0700 basalt-devnet-owner-* outside repo> --output <new-public-package.json> rechecks the fixed trio and nonce on finalized official devnet, loads only run-dir/bootstrap.json, and exports a bootstrap partial signature for /devnet/setup. No nonce creation, deployment, send, authority change, owner private key, backend signer or namespace activation. The owner must inspect and sign the exact imported transaction. Existing output is never overwritten.");
    return;
  }
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const plan = createOwnerHandoffPlan(sourceCommit);
  if (!values.prepare) {
    const output = { mode: "offline-owner-handoff-plan", sourceCommit, cluster: "devnet", genesisHash: DEVNET_GENESIS_HASH,
      owner: plan.manifest.owner, bootstrapAuthority: plan.manifest.bootstrapAuthority,
      programs: ROLES.map(role => ({ role, programId: plan.manifest.programIds[role], programData: programData(new PublicKey(plan.manifest.programIds[role])).toBase58() })),
      existingReviewedNonceRequired: true, chainWrites: false, partialSignaturePrepared: false };
    console.log(JSON.stringify(output, null, 2)); return output;
  }
  assert(values["deployment-proof"] && values["nonce-account"] && values["run-dir"] && values.output,
    "Preparation requires a public proof, existing nonce, isolated run directory and new output path");
  assert(execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" }).trim() === "",
    "Preparation requires exact clean committed source matching the deployment proof");
  const proofInput = await readPublicProof(values["deployment-proof"]);
  assert(proofInput && typeof proofInput === "object" && !Array.isArray(proofInput) && typeof (proofInput as Record<string, unknown>).sourceCommit === "string", "Public proof source commit required");
  const buildSourceCommit = (proofInput as Record<string, unknown>).sourceCommit as string;
  const binding = verifyOwnerHandoffSourceBinding(buildSourceCommit);
  const proof = validateDeploymentProof(proofInput, createOwnerHandoffPlan(buildSourceCommit));
  const rpc = new Connection(RPC_URL, { commitment: "finalized", disableRetryOnRateLimit: true, fetch: boundedReadFetch() });
  const run = await openPrivateRun(values["run-dir"]);
  try {
    const prepared = await prepareOwnerHandoff({ sourceCommit: buildSourceCommit, deploymentProof: proof, nonceAccount: values["nonce-account"], rpc, loadSigner: run.loadSigner });
    await writeOwnerHandoffPackage(values.output, prepared.package);
    const receipt = { mode: "public-owner-handoff-package-prepared", output: resolve(values.output), ...binding, ...prepared.evidence };
    console.log(JSON.stringify(receipt, null, 2)); return receipt;
  } finally { await run.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error("Devnet owner handoff preparation stopped. Inspect public proof, nonce and isolated signer prerequisites; no transaction was submitted.");
  process.exitCode = 1;
});
