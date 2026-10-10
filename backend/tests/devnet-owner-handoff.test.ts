import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Keypair, PublicKey, SystemProgram, Transaction, SystemInstruction, type AccountInfo } from "@solana/web3.js";
import { DEVNET_GENESIS_HASH, DEVNET_OWNER_NAMESPACE } from "../src/config/programNamespaces";
import { DEVNET_OWNER_POLICY } from "../../scripts/security/devnet-owner-bootstrap.mjs";
import { createBootstrapPlan, programData, LOADER, ROLES, MAX_FEE_LAMPORTS, type OwnerManifest, type DeploymentProof } from "../../scripts/devnet-owner-bootstrap";
import {
  createOwnerHandoffPlan, readOwnerHandoffState, prepareOwnerHandoff,
  writeOwnerHandoffPackage, verifyOwnerHandoffSourceBinding, main, type HandoffReadRpc,
} from "../../scripts/devnet-owner-handoff";

const source = "a".repeat(40);
const bootstrap = Keypair.fromSeed(Buffer.alloc(32, 91));
const owner = Keypair.fromSeed(Buffer.alloc(32, 92));
const nonce = Keypair.fromSeed(Buffer.alloc(32, 93)).publicKey;
const nonceValue = Keypair.fromSeed(Buffer.alloc(32, 94)).publicKey.toBase58();
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function policy(): OwnerManifest {
  return { version: 1, mode: "devnet-owner-bootstrap-preparation", cluster: "devnet", genesisHash: DEVNET_GENESIS_HASH,
    owner: owner.publicKey.toBase58(), treasury: owner.publicKey.toBase58(), bootstrapAuthority: bootstrap.publicKey.toBase58(),
    programIds: { whitelist: DEVNET_OWNER_NAMESPACE.programs.whitelist, basket_factory: DEVNET_OWNER_NAMESPACE.programs.factory, basket: DEVNET_OWNER_NAMESPACE.programs.basket },
    ownerRoleAcceptance: "pending", governance: { kind: "single-owner-devnet-only", multisig: false, productionApproval: false }, deploymentExecuted: false };
}
// Only synthetic historical policy uses the isolated closed namespace. Default production calls retain the active guard.
const closedOwnerNamespace = {...DEVNET_OWNER_NAMESPACE, creation:{...DEVNET_OWNER_NAMESPACE.creation, enabled:false}};
vi.mock("../../scripts/devnet-owner-bootstrap", async importOriginal => {
  const actual = await importOriginal<typeof import("../../scripts/devnet-owner-bootstrap")>();
  return {...actual, createBootstrapPlan: (...args: Parameters<typeof actual.createBootstrapPlan>) => {
    const [record, commit, internal = {}] = args;
    return actual.createBootstrapPlan(record, commit, internal.policy?.owner === owner.publicKey.toBase58()
      ? {...internal, namespaces:[closedOwnerNamespace]} : internal);
  }};
});
const internal = () => ({ policy: policy() });
const plan = () => createOwnerHandoffPlan(source, internal());
function elf(): Buffer {
  const bytes = Buffer.alloc(1024); bytes.set([127, 69, 76, 70, 2, 1, 1]);
  bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(263, 18); bytes.writeBigUInt64LE(512n, 24);
  bytes.writeBigUInt64LE(64n, 32); bytes.writeUInt16LE(56, 54); bytes.writeUInt16LE(1, 56);
  bytes.writeUInt32LE(1, 64); bytes.writeUInt32LE(1, 68); bytes.writeBigUInt64LE(512n, 72);
  bytes.writeBigUInt64LE(512n, 80); bytes.writeBigUInt64LE(128n, 96); bytes.writeBigUInt64LE(128n, 104); return bytes;
}
function proof(): DeploymentProof {
  return { version: 1, mode: "devnet-owner-deployment-proof", cluster: "devnet", genesisHash: DEVNET_GENESIS_HASH,
    sourceCommit: source, feature: "owner-devnet", bootstrapAuthority: bootstrap.publicKey.toBase58(), owner: owner.publicKey.toBase58(),
    programs: Object.fromEntries(ROLES.map(role => { const id = policy().programIds[role]; return [role,
      { programId: id, programData: programData(new PublicKey(id)).toBase58(), elfSha256: sha(elf()), elfBytes: 1024, deployedSlot: "10" }]; })) as DeploymentProof["programs"] };
}
const info = (data: Buffer, accountOwner: PublicKey, executable = false, lamports = 3_000_000): AccountInfo<Buffer> => ({ data, owner: accountOwner, executable, lamports, rentEpoch: 0 });
function program(id: string): AccountInfo<Buffer> {
  const data = Buffer.alloc(36); data.writeUInt32LE(2); programData(new PublicKey(id)).toBuffer().copy(data, 4); return info(data, LOADER, true);
}
function deployed(): AccountInfo<Buffer> {
  const data = Buffer.alloc(45 + 1024 + 32); data.writeUInt32LE(3); data.writeBigUInt64LE(10n, 4); data[12] = 1;
  bootstrap.publicKey.toBuffer().copy(data, 13); elf().copy(data, 45); return info(data, LOADER);
}
function nonceAccount(): AccountInfo<Buffer> {
  const data = Buffer.alloc(80); data.writeUInt32LE(1); data.writeUInt32LE(1, 4);
  bootstrap.publicKey.toBuffer().copy(data, 8); new PublicKey(nonceValue).toBuffer().copy(data, 40); data.writeBigUInt64LE(5000n, 72);
  return info(data, SystemProgram.programId);
}
function harness() {
  let loads = 0, reads = 0;
  const raw: Array<AccountInfo<Buffer> | null> = [
    ...ROLES.map(role => program(policy().programIds[role])), deployed(), deployed(), deployed(), nonceAccount(), info(Buffer.alloc(0), SystemProgram.programId),
  ];
  const minSlots: Array<number | undefined> = [];
  const rpc: HandoffReadRpc = {
    async getGenesisHash() { return DEVNET_GENESIS_HASH; },
    async getMultipleAccountsInfoAndContext(keys, config) {
      expect(config.commitment).toBe("finalized"); expect(keys).toHaveLength(8);
      expect(keys[6].equals(nonce)).toBe(true); expect(keys[7].equals(bootstrap.publicKey)).toBe(true);
      minSlots.push(config.minContextSlot); reads++; return { context: { slot: 99 + reads }, value: raw };
    },
    async getMinimumBalanceForRentExemption(bytes, commitment) { expect(bytes).toBe(80); expect(commitment).toBe("finalized"); return 1_000_000; },
    async getFeeForMessage(message, commitment) { expect(message.header.numRequiredSignatures).toBe(2); expect(message.recentBlockhash).toBe(nonceValue); expect(commitment).toBe("finalized"); return { context: { slot: 99 + reads }, value: Number(raw[6]!.data.readBigUInt64LE(72)) * 2 }; },
  };
  return { raw, rpc, minSlots, get loads() { return loads; }, get reads() { return reads; }, async loadSigner() { loads++; return bootstrap; } };
}
const prepare = (h: ReturnType<typeof harness>, overrides: Record<string, unknown> = {}) => prepareOwnerHandoff({ sourceCommit: source, deploymentProof: proof(), nonceAccount: nonce.toBase58(), rpc: h.rpc, loadSigner: h.loadSigner, internal: internal(), ...overrides });

describe("durable devnet owner handoff preparation", () => {
  it("rejects archived production planning and preparation after activation before proof, signer or RPC access", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No RPC permitted"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(main(["--deployment-proof", "/does-not-exist.json", "--run-dir", "/does-not-exist"])).rejects.toThrow(/creation to remain disabled/);
      await expect(main(["--prepare", "--deployment-proof", "/does-not-exist.json", "--nonce-account", nonce.toBase58(), "--run-dir", "/does-not-exist/basalt-devnet-owner-blocked", "--output", "/does-not-exist/package.json"])).rejects.toThrow(/creation to remain disabled/);
      expect(fetch).not.toHaveBeenCalled();
      await expect(main(["--execute"])).rejects.toThrow(/never executes/);
    } finally { fetch.mockRestore(); log.mockRestore(); }
  });
  it("pins production owner/bootstrap/trio and keeps acceptance pending until a genuine wallet signature", () => {
    expect(() => createOwnerHandoffPlan(source)).toThrow(/creation to remain disabled/);
    const pinned = createBootstrapPlan(DEVNET_OWNER_POLICY, source, {namespaces:[closedOwnerNamespace]});
    expect(pinned.manifest.owner).toBe(DEVNET_OWNER_POLICY.owner);
    expect(pinned.manifest.bootstrapAuthority).toBe(DEVNET_OWNER_POLICY.bootstrapAuthority);
    expect(pinned.manifest.programIds).toEqual(DEVNET_OWNER_POLICY.programIds);
    expect(pinned.namespace.creation.enabled).toBe(false);
    expect(plan().manifest.ownerRoleAcceptance).toBe("pending");
    expect(() => createOwnerHandoffPlan("mainnet")).toThrow(/source commit/);
  });
  it("exports exactly the public schema and an unchanged four-instruction two-signature legacy message", async () => {
    const h = harness(), result = await prepare(h), pack = result.package;
    expect(Object.keys(pack).sort()).toEqual(["version", "cluster", "genesisHash", "sourceCommit", "owner", "bootstrapAuthority", "nonceAccount", "nonceValue", "transactionBase64"].sort());
    expect(pack).toMatchObject({ version: 1, cluster: "devnet", genesisHash: DEVNET_GENESIS_HASH, sourceCommit: source, owner: owner.publicKey.toBase58(), bootstrapAuthority: bootstrap.publicKey.toBase58(), nonceValue });
    const tx = Transaction.from(Buffer.from(pack.transactionBase64, "base64"));
    expect(tx.instructions).toHaveLength(4); expect(tx.recentBlockhash).toBe(nonceValue); expect(tx.feePayer?.equals(bootstrap.publicKey)).toBe(true);
    expect(SystemInstruction.decodeNonceAdvance(tx.instructions[0])).toMatchObject({ noncePubkey: nonce, authorizedPubkey: bootstrap.publicKey });
    tx.instructions.slice(1).forEach((ix, index) => {
      expect(ix.programId.equals(LOADER)).toBe(true); expect(ix.data.equals(Buffer.from([7, 0, 0, 0]))).toBe(true);
      expect(ix.keys.map(key => key.pubkey.toBase58())).toEqual([programData(new PublicKey(policy().programIds[ROLES[index]])).toBase58(), bootstrap.publicKey.toBase58(), owner.publicKey.toBase58()]);
      // The serialized fee payer is globally writable, including when SDK
      // reconstructs an instruction whose builder marked it readonly.
      expect(ix.keys.map(key => [key.isWritable, key.isSigner])).toEqual([[true, false], [true, true], [false, true]]);
    });
    expect(tx.signatures.map(entry => entry.publicKey.toBase58())).toEqual([bootstrap.publicKey.toBase58(), owner.publicKey.toBase58()]);
    expect(tx.signatures[0].signature).not.toBeNull(); expect(tx.signatures[1].signature).toBeNull(); expect(tx.verifySignatures(false)).toBe(true); expect(tx.verifySignatures(true)).toBe(false);
    expect(result.evidence).toMatchObject({ contextSlot: 101, feeLamports: 10000, maximumFeeLamports: MAX_FEE_LAMPORTS, chainWrites: false, ownerSigned: false });
    expect(h.minSlots).toEqual([0, 100]); expect(h.loads).toBe(1); expect(h.reads).toBe(2);
    const original = tx.serializeMessage(); tx.partialSign(owner); expect(tx.serializeMessage().equals(original)).toBe(true); expect(tx.verifySignatures(true)).toBe(true);
  });
  it.each(["source", "feature", "role", "authority", "extra"])("rejects a mismatched %s deployment proof before RPC/signer access", async kind => {
    const h = harness(), p: any = proof();
    if (kind === "source") p.sourceCommit = "b".repeat(40);
    if (kind === "feature") p.feature = "legacy";
    if (kind === "role") p.programs.basket.programId = p.programs.whitelist.programId;
    if (kind === "authority") p.bootstrapAuthority = owner.publicKey.toBase58();
    if (kind === "extra") p.transaction = {};
    await expect(prepare(h, { deploymentProof: p })).rejects.toThrow(); expect(h.loads).toBe(0); expect(h.reads).toBe(0);
  });
  it.each(["missing", "authority", "pointer", "hash", "padding", "slot"])("rejects invalid finalized program %s before loading a signer", async kind => {
    const h = harness();
    if (kind === "missing") h.raw[2] = null;
    if (kind === "authority") owner.publicKey.toBuffer().copy(h.raw[3]!.data, 13);
    if (kind === "pointer") owner.publicKey.toBuffer().copy(h.raw[0]!.data, 4);
    if (kind === "hash") h.raw[5]!.data[45 + 600] ^= 1;
    if (kind === "padding") h.raw[4]!.data[h.raw[4]!.data.length - 1] = 1;
    if (kind === "slot") h.raw[5]!.data.writeBigUInt64LE(11n, 4);
    await expect(prepare(h)).rejects.toThrow(); expect(h.loads).toBe(0);
  });
  it.each(["owner", "executable", "length", "version", "state", "authority", "rent", "zero-fee", "high-fee"])("rejects invalid durable nonce %s before loading a signer", async kind => {
    const h = harness(), n = h.raw[6]!;
    if (kind === "owner") n.owner = LOADER;
    if (kind === "executable") n.executable = true;
    if (kind === "length") n.data = Buffer.concat([n.data, Buffer.alloc(1)]);
    if (kind === "version") n.data.writeUInt32LE(0);
    if (kind === "state") n.data.writeUInt32LE(0, 4);
    if (kind === "authority") owner.publicKey.toBuffer().copy(n.data, 8);
    if (kind === "rent") n.lamports = 1;
    if (kind === "zero-fee") n.data.writeBigUInt64LE(0n, 72);
    if (kind === "high-fee") n.data.writeBigUInt64LE(100000n, 72);
    await expect(prepare(h)).rejects.toThrow(); expect(h.loads).toBe(0);
  });
  it("rejects wrong network, insufficient payer reserve, nonce alias and partial account batches before signer access", async () => {
    for (const kind of ["network", "reserve", "nonce-alias", "batch"]) {
      const h = harness(); let overrides = {};
      if (kind === "network") h.rpc.getGenesisHash = async () => "mainnet";
      if (kind === "reserve") h.raw[7]!.lamports = 10000;
      if (kind === "nonce-alias") overrides = { nonceAccount: owner.publicKey.toBase58() };
      if (kind === "batch") h.raw.pop();
      await expect(prepare(h, overrides)).rejects.toThrow(); expect(h.loads).toBe(0);
    }
  });
  it.each(["null", "high", "negative", "regressing"])("rejects an invalid %s actual network fee quote before signer access", async kind => {
    const h = harness();
    h.rpc.getFeeForMessage = async () => ({ context: { slot: kind === "regressing" ? 0 : 100 }, value: kind === "null" ? null : kind === "high" ? MAX_FEE_LAMPORTS + 1 : kind === "negative" ? -1 : 10000 });
    await expect(prepare(h)).rejects.toThrow(/fee quote/); expect(h.loads).toBe(0);
  });
  it("requires fresh nonregressing evidence and rejects a nonce consumed between reads before signer access", async () => {
    for (const kind of ["slot", "nonce", "fee"]) {
      const h = harness(), read = h.rpc.getMultipleAccountsInfoAndContext;
      h.rpc.getMultipleAccountsInfoAndContext = async (keys, config) => {
        const result = await read(keys, config);
        if (h.reads === 2) {
          if (kind === "slot") result.context.slot = 1;
          if (kind === "nonce") owner.publicKey.toBuffer().copy(h.raw[6]!.data, 40);
          if (kind === "fee") h.raw[6]!.data.writeBigUInt64LE(6000n, 72);
        }
        return result;
      };
      await expect(prepare(h)).rejects.toThrow(); expect(h.loads).toBe(0);
    }
  });
  it("rejects a substituted private signer and stale preparation without exporting a package", async () => {
    const h = harness(); await expect(prepare(h, { loadSigner: async () => owner })).rejects.toThrow(/fixed bootstrap/);
    let tick = 0; const stale = harness();
    await expect(prepare(stale, { now: () => tick++ ? 46_000 : 0 })).rejects.toThrow(/too old/); expect(stale.loads).toBe(0);
  });
  it("keeps bootstrap signature bound to the exact nonce/message and never treats it as an owner signature", async () => {
    const tx = Transaction.from(Buffer.from((await prepare(harness())).package.transactionBase64, "base64"));
    expect(tx.verifySignatures(false)).toBe(true); tx.instructions[1].data[0] = 4;
    expect(tx.verifySignatures(false)).toBe(false); expect(tx.signatures[1].signature).toBeNull();
  });
  it("exports atomically without overwriting files/symlinks or allowing extra secret fields", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "basalt-handoff-public-"))), path = join(directory, "package.json");
    try {
      const pack = (await prepare(harness())).package;
      await writeOwnerHandoffPackage(path, pack); expect(JSON.parse(await readFile(path, "utf8"))).toEqual(pack);
      await expect(writeOwnerHandoffPackage(path, pack)).rejects.toThrow();
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(pack);
      const alias = join(directory, "alias.json"); await symlink(path, alias);
      await expect(writeOwnerHandoffPackage(alias, pack)).rejects.toThrow();
      await expect(writeOwnerHandoffPackage(join(directory, "bad.json"), { ...pack, secretKey: [1, 2, 3] } as any)).rejects.toThrow(/public package schema/);
      expect((await readdir(directory)).some(name => name.endsWith(".tmp"))).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("allows a later UI-only commit but rejects changed shared Rust, vendored source or handoff identities", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "basalt-handoff-source-")));
    const git = (args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git(["init", "-q"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
      await mkdir(join(directory, "backend/src/config"), { recursive: true }); await mkdir(join(directory, "crates/token-policy/src"), { recursive: true }); await mkdir(join(directory, "vendor/rust/solana-sdk/src"), { recursive: true });
      const policyPath = join(directory, "backend/src/config/devnetOwnerPolicy.json");
      await writeFile(policyPath, JSON.stringify(DEVNET_OWNER_POLICY)); await writeFile(join(directory, "Cargo.toml"), "[workspace]\n");
      await writeFile(join(directory, "crates/token-policy/src/lib.rs"), "// original\n"); await writeFile(join(directory, "vendor/rust/solana-sdk/src/lib.rs"), "// original\n");
      git(["add", "."]); git(["commit", "-qm", "Build source"]); const buildSource = git(["rev-parse", "HEAD"]);
      await writeFile(join(directory, "ui-only.md"), "UI update\n"); git(["add", "."]); git(["commit", "-qm", "UI only"]);
      expect(verifyOwnerHandoffSourceBinding(buildSource, directory)).toMatchObject({ buildSourceCommit: buildSource, checkoutSourceCommit: git(["rev-parse", "HEAD"]), programSourceMatches: true });
      const uiSource = git(["rev-parse", "HEAD"]);
      for (const path of ["crates/token-policy/src/lib.rs", "vendor/rust/solana-sdk/src/lib.rs"]) {
        await writeFile(join(directory, path), "// changed program dependency\n"); git(["add", "."]); git(["commit", "-qm", "Dependency change"]);
        expect(() => verifyOwnerHandoffSourceBinding(buildSource, directory)).toThrow(/Program\/build inputs differ/); git(["reset", "--hard", uiSource]);
      }
      await writeFile(policyPath, JSON.stringify({ ...DEVNET_OWNER_POLICY, bootstrapAuthority: bootstrap.publicKey.toBase58() })); git(["add", "."]); git(["commit", "-qm", "Identity change"]);
      expect(() => verifyOwnerHandoffSourceBinding(buildSource, directory)).toThrow(/trust roots differ/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
