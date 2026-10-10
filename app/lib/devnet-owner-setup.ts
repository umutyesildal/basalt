/** Source-pinned, public-only devnet administration. No key loading or creation activation. */
import { Buffer } from "buffer";
import bs58 from "bs58";
import { ComputeBudgetProgram, Message, NonceAccount, NONCE_ACCOUNT_LENGTH, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction, type AccountInfo, type Connection } from "@solana/web3.js";
import publicPolicy from "../../backend/src/config/devnetOwnerPolicy.json";
import reviewedArtifacts from "./devnet-owner-artifacts.json";
import { DEVNET_GENESIS_HASH } from "./program-namespaces";
import { UPGRADEABLE_LOADER } from "./devnet-owner-claim";
import { DEVNET_MOCK_TOKENS } from "./devnet-faucet";
import { getScaledUiAmountConfig, unpackMint } from "./token-2022";
import { assertWalletIntentNow } from "./wallet-intent";

export interface OwnerSetupPolicy {
  owner: string; bootstrapAuthority: string; treasury: string | null;
  programs: Readonly<{ whitelist: string; factory: string; basket: string }>;
}
export const DEVNET_OWNER_SETUP_POLICY: Readonly<OwnerSetupPolicy> = Object.freeze({
  owner: publicPolicy.owner, bootstrapAuthority: publicPolicy.bootstrapAuthority, treasury: publicPolicy.treasury,
  programs: Object.freeze({ whitelist: publicPolicy.programIds.whitelist, factory: publicPolicy.programIds.basket_factory, basket: publicPolicy.programIds.basket }),
});
export interface OwnerHandoffPackage {
  version: 1; cluster: "devnet"; genesisHash: string; sourceCommit: string;
  owner: string; bootstrapAuthority: string; nonceAccount: string; nonceValue: string; transactionBase64: string;
}
export interface OwnerSetupState {
  contextSlot: number; loaderAuthority: "bootstrap" | "owner";
  whitelist: "absent" | "owner" | "claim-ready" | "waiting-proposal";
  factoryInitialized: boolean; admitted: string[]; steps: string[]; ownerBalanceLamports: number;
}
export interface OwnerSetupReview {
  state: OwnerSetupState; steps: string[]; transaction: Transaction | null; rentLamports: number; feeLamports: number;
}
export interface OwnerSetupReceipt {
  version: 1; genesisHash: string; owner: string; kind: "handoff" | "setup";
  contextSlot: number; signature: string; status: "prepared" | "finalized" | "failed" | "expired"; steps: string[];
  blockhash?: string; lastValidBlockHeight?: number;
}
export type OwnerSetupRpc = Pick<Connection, "getGenesisHash" | "getMultipleAccountsInfoAndContext" | "getLatestBlockhash" | "getMinimumBalanceForRentExemption" | "getFeeForMessage" | "simulateTransaction" | "sendRawTransaction" | "getSignatureStatuses" | "getBlockHeight">;
export interface OwnerSetupIntent {
  connection: object; wallet: string | null; active: boolean; accepted: boolean; reviewKey: string;
}
export interface OwnerSetupSubmission {
  wallet: PublicKey; signTransaction: (transaction: Transaction) => Promise<Transaction>;
  current: () => OwnerSetupIntent; reviewKey: string;
  /** Must persist synchronously before the single broadcast. Failure prevents sending. */
  onPrepared: (receipt: OwnerSetupReceipt) => void;
  onProgress?: (status: "checking" | "simulating" | "signing" | "confirming") => void;
}
const DISCS = {
  initWhitelist: Buffer.from("17eb73e8a86001e7", "hex"), initFactory: Buffer.from("4188dbb1eac51827", "hex"),
  addMint: Buffer.from("abde6f253ca6d06c", "hex"), claim: Buffer.from("de84b97b7f6b061f", "hex"),
  whitelist: Buffer.from("3a330ca6266d12ff", "hex"), factory: Buffer.from("1dc5ffe81680431a", "hex"), mint: Buffer.from("6883dd77df010112", "hex"),
};
const MAX_FEE = 100_000, MAX_SETUP_SPEND = 20_000_000, RESERVE = 1_000_000;
export type OwnerSetupProgress = "checking" | "simulating" | "signing" | "confirming";
/** Only internally generated public messages may be rendered verbatim. */
export class DevnetOwnerSetupError extends Error {
  constructor(message: string) { super(message); this.name = "DevnetOwnerSetupError"; }
}
export function describeDevnetOwnerSetupError(error: unknown, stage: OwnerSetupProgress = "checking"): string {
  if (error instanceof DevnetOwnerSetupError) return error.message;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/blockhash|expired/.test(message)) return "The setup transaction expired before it was sent. Review the current setup to prepare a fresh transaction.";
  if (/429|rate.?limit/.test(message)) return "Devnet is busy. The setup was not sent. Refresh the finalized status before reviewing again.";
  if (/reject|declin|cancel|denied/.test(message)) return "The wallet request was declined. The setup was not sent.";
  if (/network|failed to fetch|timed? out/.test(message)) return "The devnet connection did not respond. The setup was not sent.";
  const action = { checking: "verifying finalized accounts", simulating: "simulating the transaction", signing: "requesting your wallet signature", confirming: "preparing the broadcast" }[stage];
  return `Setup stopped while ${action}. Nothing was broadcast. Refresh and review the current setup.`;
}
const fail = (message = "The devnet setup does not match the reviewed public identities."): never => { throw new DevnetOwnerSetupError(message); };
function requireThat(value: unknown, message?: string): asserts value { if (!value) fail(message); }
const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
const canonical = (value: unknown): PublicKey => {
  requireThat(typeof value === "string", "Invalid public identity.");
  const key = new PublicKey(value);
  requireThat(key.toBase58() === value && !key.equals(PublicKey.default), "Invalid public identity.");
  return key;
};
const derive = (seed: string, program: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from(seed)], program);
export const ownerProgramData = (program: PublicKey) => PublicKey.findProgramAddressSync([program.toBuffer()], UPGRADEABLE_LOADER)[0];
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DevnetOwnerSetupError("Devnet verification timed out. Refresh the finalized status.")), 15_000); })]); }
  finally { clearTimeout(timer); }
}
function vacant(value: AccountInfo<Buffer> | null) {
  if (!value) return true;
  return !value.executable && value.owner.equals(SystemProgram.programId) && value.data.length === 0 && Number.isSafeInteger(value.lamports) && value.lamports >= 0;
}
function info(value: AccountInfo<Buffer> | null, owner: PublicKey, size?: number) {
  requireThat(value && !value.executable && value.owner.equals(owner) && (size === undefined || value.data.length === size));
  return value;
}
export interface OwnerSetupArtifacts {
  sourceCommit: string;
  programs: Record<"whitelist" | "basket_factory" | "basket", { programId: string; programData: string; elfSha256: string; elfBytes: number; deployedSlot: string }>;
}
async function authenticateProgram(program: PublicKey, programInfo: AccountInfo<Buffer> | null, loaderInfo: AccountInfo<Buffer> | null, slot: number, policy: OwnerSetupPolicy, artifact: OwnerSetupArtifacts["programs"]["whitelist"]) {
  const dataAddress = ownerProgramData(program);
  requireThat(programInfo?.executable && programInfo.owner.equals(UPGRADEABLE_LOADER) && programInfo.data.length === 36 && programInfo.data.readUInt32LE(0) === 2 && new PublicKey(programInfo.data.subarray(4, 36)).equals(dataAddress));
  const loader = info(loaderInfo, UPGRADEABLE_LOADER).data;
  requireThat(loader.length >= 45 && loader.readUInt32LE(0) === 3 && loader[12] === 1 && loader.readBigUInt64LE(4) <= BigInt(slot));
  requireThat(artifact.programId === program.toBase58() && artifact.programData === dataAddress.toBase58() && /^[a-f0-9]{64}$/.test(artifact.elfSha256) && Number.isSafeInteger(artifact.elfBytes) && artifact.elfBytes >= 1 && artifact.elfBytes <= 2_000_000 && /^(0|[1-9][0-9]*)$/.test(artifact.deployedSlot));
  requireThat(loader.readBigUInt64LE(4).toString() === artifact.deployedSlot && loader.length >= 45 + artifact.elfBytes && loader.subarray(45 + artifact.elfBytes).every(byte => byte === 0), "Deployed program slot or padding changed. Stop for a fresh code review.");
  const digest = Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(loader.subarray(45, 45 + artifact.elfBytes)).buffer)).toString("hex");
  requireThat(digest === artifact.elfSha256, "Deployed program bytes differ from the reviewed release.");
  const authority = new PublicKey(loader.subarray(13, 45)).toBase58();
  requireThat(authority === policy.bootstrapAuthority || authority === policy.owner);
  return authority === policy.owner ? "owner" as const : "bootstrap" as const;
}
function stateKey(state: OwnerSetupState) {
  return JSON.stringify([state.loaderAuthority, state.whitelist, state.factoryInitialized, state.admitted, state.steps]);
}
function versioned(transaction: Transaction) {
  const tx = new VersionedTransaction(transaction.compileMessage());
  tx.signatures = transaction.signatures.map(pair => pair.signature ? Uint8Array.from(pair.signature) : new Uint8Array(64));
  return tx;
}

/** Internal source-policy injection supports isolated tests only. UI uses the pinned singleton below. */
export function createDevnetOwnerSetupClient(policy: Readonly<OwnerSetupPolicy> = DEVNET_OWNER_SETUP_POLICY, artifacts: OwnerSetupArtifacts = reviewedArtifacts) {
  requireThat(/^[a-f0-9]{40}$/.test(artifacts.sourceCommit));
  const roleArtifacts = [artifacts.programs.whitelist, artifacts.programs.basket_factory, artifacts.programs.basket];
  const owner = canonical(policy.owner), bootstrap = canonical(policy.bootstrapAuthority);
  requireThat(!owner.equals(bootstrap) && PublicKey.isOnCurve(owner.toBytes()) && PublicKey.isOnCurve(bootstrap.toBytes()));
  const programs = [policy.programs.whitelist, policy.programs.factory, policy.programs.basket].map(canonical);
  requireThat(new Set(programs.map(String)).size === 3 && !programs.some(program => program.equals(owner) || program.equals(bootstrap)));
  const [whitelistConfig, whitelistBump] = derive("config", programs[0]), [factoryConfig, factoryBump] = derive("factory", programs[1]);
  const admissions = DEVNET_MOCK_TOKENS.map(token => PublicKey.findProgramAddressSync([Buffer.from("mint"), token.mint.toBuffer()], programs[0]));
  const assertOwner = (wallet: PublicKey) => requireThat(wallet.equals(owner), "Connect the designated owner wallet to review devnet setup.");
  const assertIntent = (rpc: OwnerSetupRpc, options: OwnerSetupSubmission) => {
    assertOwner(options.wallet);
    const current = options.current();
    assertWalletIntentNow({ connection: rpc, wallet: policy.owner }, current);
    requireThat(current.active && current.accepted && current.reviewKey === options.reviewKey, "Review this devnet setup step again before signing.");
  };
  const assertGenesis = async (rpc: OwnerSetupRpc) => requireThat(await bounded(rpc.getGenesisHash()) === DEVNET_GENESIS_HASH, "Owner setup is available on Solana devnet only.");
  function expectedHandoff(value: OwnerHandoffPackage) {
    const nonce = canonical(value.nonceAccount);
    requireThat(![owner, bootstrap, ...programs, ...programs.map(ownerProgramData)].some(address => address.equals(nonce)));
    const checked = Buffer.alloc(4); checked.writeUInt32LE(7);
    // solana-program 1.18.26 bpf_loader_upgradeable::set_upgrade_authority_checked:
    // enum7; canonical ProgramData writable, current authority signer, new authority signer.
    return new Transaction({ feePayer: bootstrap, recentBlockhash: value.nonceValue }).add(
      SystemProgram.nonceAdvance({ noncePubkey: nonce, authorizedPubkey: bootstrap }),
      ...programs.map(program => new TransactionInstruction({ programId: UPGRADEABLE_LOADER, data: checked,
        keys: [meta(ownerProgramData(program), true), meta(bootstrap, false, true), meta(owner, false, true)] })),
    );
  }
  function parsePackage(input: string | unknown): Readonly<OwnerHandoffPackage> {
    requireThat(typeof input !== "string" || input.length <= 8_192, "The public handoff file is too large.");
    const value = typeof input === "string" ? JSON.parse(input) : input;
    requireThat(value && typeof value === "object" && !Array.isArray(value), "Choose the public handoff JSON file.");
    const fields = ["version", "cluster", "genesisHash", "sourceCommit", "owner", "bootstrapAuthority", "nonceAccount", "nonceValue", "transactionBase64"];
    requireThat(Object.keys(value).sort().join() === fields.sort().join(), "Unexpected fields in the public handoff file.");
    requireThat(value.version === 1 && value.cluster === "devnet" && value.genesisHash === DEVNET_GENESIS_HASH && value.owner === policy.owner && value.bootstrapAuthority === policy.bootstrapAuthority);
    // sourceCommit is informational metadata, not a substitute for deployed-byte attestation.
    requireThat(typeof value.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(value.sourceCommit));
    requireThat(typeof value.nonceValue === "string" && bs58.decode(value.nonceValue).length === 32 && bs58.encode(bs58.decode(value.nonceValue)) === value.nonceValue);
    requireThat(typeof value.transactionBase64 === "string" && value.transactionBase64.length <= 1_644 && /^[A-Za-z0-9+/]+={0,2}$/.test(value.transactionBase64));
    const bytes = Buffer.from(value.transactionBase64, "base64");
    requireThat(bytes.length <= 1_232 && bytes.toString("base64") === value.transactionBase64);
    const tx = Transaction.from(bytes), expected = expectedHandoff(value);
    requireThat(tx.serializeMessage().equals(expected.serializeMessage()), "The handoff transaction contains an unreviewed instruction or account.");
    requireThat(tx.signatures.length === 2 && tx.signatures[0].publicKey.equals(bootstrap) && tx.signatures[0].signature?.length === 64 && tx.signatures[1].publicKey.equals(owner) && tx.signatures[1].signature === null && tx.verifySignatures(false), "The bootstrap signature is missing or invalid.");
    requireThat(tx.serialize({ requireAllSignatures: false, verifySignatures: true }).equals(bytes), "The public transaction encoding is not canonical.");
    return Object.freeze({ ...value }) as Readonly<OwnerHandoffPackage>;
  }
  async function inspectHandoff(rpc: OwnerSetupRpc, value: OwnerHandoffPackage, minContextSlot = 0) {
    const pkg = parsePackage(value);
    requireThat(Number.isSafeInteger(minContextSlot) && minContextSlot >= 0);
    await assertGenesis(rpc);
    const keys = [...programs, ...programs.map(ownerProgramData), canonical(pkg.nonceAccount), bootstrap];
    const result = await bounded(rpc.getMultipleAccountsInfoAndContext(keys, { commitment: "finalized", minContextSlot }));
    const slot = result.context.slot;
    requireThat(Number.isSafeInteger(slot) && slot >= minContextSlot && result.value.length === keys.length);
    const authorities = await Promise.all(programs.map((program, index) => authenticateProgram(program, result.value[index], result.value[index + 3], slot, policy, roleArtifacts[index])));
    requireThat(authorities.every(authority => authority === "bootstrap"), "Program ownership already changed. Refresh finalized status; do not resend the package.");
    const data = info(result.value[6], SystemProgram.programId, NONCE_ACCOUNT_LENGTH).data;
    // SDK NonceAccount parser does not itself enforce the version/state fields.
    requireThat(data.readUInt32LE(0) === 1 && data.readUInt32LE(4) === 1, "The handoff nonce account is not initialized in its current format.");
    const nonce = NonceAccount.fromAccountData(data);
    requireThat(nonce.authorizedPubkey.equals(bootstrap) && nonce.nonce === pkg.nonceValue, "This handoff nonce changed or was already used. Obtain a freshly reviewed package.");
    const balance = result.value[7]?.lamports ?? 0;
    requireThat(Number.isSafeInteger(balance) && balance >= RESERVE, "The bootstrap fee payer needs devnet SOL.");
    return { contextSlot: slot, balanceLamports: balance };
  }
  async function inspect(rpc: OwnerSetupRpc, minContextSlot = 0): Promise<OwnerSetupState> {
    requireThat(Number.isSafeInteger(minContextSlot) && minContextSlot >= 0);
    await assertGenesis(rpc);
    const keys = [...programs, ...programs.map(ownerProgramData), whitelistConfig, factoryConfig, ...admissions.map(([key]) => key), ...DEVNET_MOCK_TOKENS.map(token => token.mint), owner];
    const result = await bounded(rpc.getMultipleAccountsInfoAndContext(keys, { commitment: "finalized", minContextSlot }));
    const slot = result.context.slot;
    requireThat(Number.isSafeInteger(slot) && slot >= minContextSlot && result.value.length === keys.length);
    const authorities = await Promise.all(programs.map((program, i) => authenticateProgram(program, result.value[i], result.value[i + 3], slot, policy, roleArtifacts[i])));
    requireThat(authorities.every(authority => authority === authorities[0]), "The three program authorities disagree. Setup requires manual review.");
    let whitelist: OwnerSetupState["whitelist"] = "absent", count = 0;
    if (!vacant(result.value[6])) {
      const data = info(result.value[6], programs[0], 78).data;
      requireThat(data.subarray(0, 8).equals(DISCS.whitelist) && (data[40] === 0 || data[40] === 1));
      const authority = new PublicKey(data.subarray(8, 40)).toBase58(), pending = data[40] === 1 ? new PublicKey(data.subarray(41, 73)).toBase58() : null;
      const countOffset = pending ? 73 : 41;
      count = data.readUInt32LE(countOffset);
      requireThat(data[countOffset + 4] === whitelistBump);
      if (authority === policy.owner && pending === null) whitelist = "owner";
      else if (authority === policy.bootstrapAuthority && pending === policy.owner) whitelist = "claim-ready";
      else if (authority === policy.bootstrapAuthority && pending === null) whitelist = "waiting-proposal";
      else fail("Unexpected whitelist ownership. Setup requires manual review.");
    }
    const treasury = policy.treasury ? canonical(policy.treasury) : null;
    let factoryInitialized = false;
    if (!vacant(result.value[7])) {
      const data = info(result.value[7], programs[1], 89).data;
      requireThat(treasury && data.subarray(0, 8).equals(DISCS.factory) && new PublicKey(data.subarray(8, 40)).equals(owner) && new PublicKey(data.subarray(40, 72)).equals(treasury), "Factory authority or treasury differs from the owner-first setup.");
      requireThat(data.readUInt16LE(72) === 9000 && data.readUInt16LE(74) === 300 && data.readUInt16LE(76) === 100 && data.readUInt16LE(78) === 300 && data[88] === factoryBump);
      factoryInitialized = true;
    }
    const admitted: string[] = [];
    DEVNET_MOCK_TOKENS.forEach((token, index) => {
      const mint = unpackMint(token.mint, result.value[12 + index]);
      const scale = getScaledUiAmountConfig(mint);
      requireThat(mint.isInitialized && mint.decimals === token.decimals && scale?.multiplier === token.multiplier && scale.newMultiplier === token.multiplier, "A fixed devnet test mint changed. Review its configuration before admission.");
      const account = result.value[8 + index];
      if (vacant(account)) return;
      const data = info(account, programs[0], 119).data, source = Buffer.from(`mock:${token.symbol}`);
      requireThat(data.subarray(0, 8).equals(DISCS.mint) && new PublicKey(data.subarray(8, 40)).equals(token.mint) && data[40] === token.decimals && data.readBigUInt64LE(41) === 1_000_000n && data[49] === 0 && data.readUInt32LE(50) === source.length && data.subarray(54, 54 + source.length).equals(source) && data[54 + source.length] === admissions[index][1], "A test-token admission differs from the fixed setup.");
      admitted.push(token.symbol);
    });
    requireThat(count === admitted.length && (whitelist !== "absent" || admitted.length === 0), "Whitelist count differs from the four reviewed test-token admissions.");
    const steps: string[] = [];
    if (authorities[0] === "owner") {
      if (whitelist === "absent") steps.push("init-whitelist");
      if (whitelist === "claim-ready") steps.push("claim-whitelist");
      if (whitelist !== "waiting-proposal") {
        if (!factoryInitialized) steps.push("init-factory");
        DEVNET_MOCK_TOKENS.forEach(token => { if (!admitted.includes(token.symbol)) steps.push(`admit-${token.symbol}`); });
      }
    }
    const ownerBalanceLamports = result.value[16]?.lamports ?? 0;
    requireThat(Number.isSafeInteger(ownerBalanceLamports) && ownerBalanceLamports >= 0);
    return { contextSlot: slot, loaderAuthority: authorities[0], whitelist, factoryInitialized, admitted, steps, ownerBalanceLamports };
  }
  function instruction(step: string) {
    if (step === "init-whitelist" || step === "init-factory") {
      const factory = step === "init-factory", program = programs[factory ? 1 : 0];
      const split = Buffer.alloc(2); split.writeUInt16LE(9000);
      requireThat(!factory || policy.treasury, "The treasury recipient has not been recorded in reviewed source yet.");
      return new TransactionInstruction({ programId: program, keys: [meta(factory ? factoryConfig : whitelistConfig, true), meta(owner, true, true), meta(SystemProgram.programId), meta(program), meta(ownerProgramData(program))],
        data: factory ? Buffer.concat([DISCS.initFactory, canonical(policy.treasury).toBuffer(), split]) : DISCS.initWhitelist });
    }
    if (step === "claim-whitelist") return new TransactionInstruction({ programId: programs[0], data: DISCS.claim, keys: [meta(whitelistConfig, true), meta(owner, false, true)] });
    const index = DEVNET_MOCK_TOKENS.findIndex(token => step === `admit-${token.symbol}`);
    requireThat(index >= 0, "Only the four reviewed test tokens may be admitted.");
    const token = DEVNET_MOCK_TOKENS[index], source = Buffer.from(`mock:${token.symbol}`), length = Buffer.alloc(4); length.writeUInt32LE(source.length);
    return new TransactionInstruction({ programId: programs[0], keys: [meta(whitelistConfig, true), meta(owner, true, true), meta(token.mint), meta(admissions[index][0], true), meta(SystemProgram.programId)], data: Buffer.concat([DISCS.addMint, Buffer.from([token.decimals]), length, source]) });
  }
  async function prepare(rpc: OwnerSetupRpc, wallet: PublicKey, minContextSlot = 0): Promise<OwnerSetupReview> {
    assertOwner(wallet);
    const state = await inspect(rpc, minContextSlot);
    requireThat(state.loaderAuthority === "owner", "Accept ownership of all three programs first.");
    requireThat(state.whitelist !== "waiting-proposal", "The bootstrap administrator must propose the existing whitelist handoff first.");
    if (state.steps.length === 0) return { state, steps: [] as string[], transaction: null, rentLamports: 0, feeLamports: 0 };
    const latest = await bounded(rpc.getLatestBlockhash("finalized"));
    const transaction = new Transaction({ feePayer: owner, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
    const steps: string[] = [];
    for (const step of state.steps) {
      const ix = instruction(step); transaction.add(ix);
      try { transaction.serialize({ requireAllSignatures: false, verifySignatures: false }); steps.push(step); }
      catch { transaction.instructions.pop(); break; }
    }
    requireThat(steps.length > 0 && transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1_232, "The reviewed setup does not fit a bounded transaction.");
    let rentLamports = 0;
    for (const step of steps) {
      const bytes = step === "init-whitelist" ? 78 : step === "init-factory" ? 89 : step.startsWith("admit-") ? 119 : 0;
      if (bytes) {
        const rent = await bounded(rpc.getMinimumBalanceForRentExemption(bytes, "finalized"));
        requireThat(Number.isSafeInteger(rent) && rent >= 0); rentLamports += rent;
      }
    }
    const feeLamports = (await bounded(rpc.getFeeForMessage(transaction.compileMessage(), "finalized"))).value;
    requireThat(Number.isSafeInteger(feeLamports) && feeLamports !== null && feeLamports >= 0 && feeLamports <= MAX_FEE && rentLamports + feeLamports <= MAX_SETUP_SPEND, "The setup rent or network fee exceeds the reviewed limit.");
    requireThat(state.ownerBalanceLamports >= rentLamports + feeLamports + RESERVE, "The owner wallet needs more devnet SOL for account rent and fees.");
    return { state, steps, transaction, rentLamports, feeLamports };
  }
  async function simulate(rpc: OwnerSetupRpc, transaction: Transaction, slot: number, signed: boolean) {
    const result = await bounded(rpc.simulateTransaction(versioned(transaction), { commitment: "finalized", minContextSlot: slot, sigVerify: signed, replaceRecentBlockhash: false }));
    if (result.value.err === "BlockhashNotFound") fail("The setup transaction expired before it was sent. Review the current setup to prepare a fresh transaction.");
    requireThat(result.value.err === null, "The reviewed devnet transaction did not pass simulation. No transaction was sent.");
  }
  function verifyOwnerSigned(unsigned: Transaction, signed: unknown, originalMessage: Buffer, originalBootstrap?: Buffer) {
    // Wallet adapters can return a Transaction from another module/realm. Treat only
    // its bounded wire bytes as input; never trust its message/signature methods.
    let wire: Buffer;
    try {
      requireThat(typeof signed === "object" && signed !== null && "serialize" in signed && typeof signed.serialize === "function", "The wallet did not return a serialized transaction. Nothing was broadcast.");
      const raw: unknown = signed.serialize({ requireAllSignatures: false, verifySignatures: false });
      requireThat(ArrayBuffer.isView(raw) && Object.prototype.toString.call(raw) === "[object Uint8Array]", "The wallet did not return transaction bytes. Nothing was broadcast.");
      requireThat(raw.byteLength > 0 && raw.byteLength <= 1_232, "The wallet returned an invalid transaction size. Nothing was broadcast.");
      wire = Buffer.from(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    } catch (error) {
      if (error instanceof DevnetOwnerSetupError) throw error;
      return fail("The wallet transaction could not be serialized. Nothing was broadcast.");
    }
    let normalized: Transaction;
    try {
      normalized = Transaction.from(wire);
      requireThat(normalized.compileMessage().version === "legacy" && normalized.serialize({ requireAllSignatures: false, verifySignatures: false }).equals(wire), "The wallet returned noncanonical transaction bytes. Nothing was broadcast.");
    } catch (error) {
      if (error instanceof DevnetOwnerSetupError) throw error;
      return fail("The wallet did not return a valid legacy transaction. Nothing was broadcast.");
    }
    if (!normalized.serializeMessage().equals(originalMessage)) {
      const original = Transaction.populate(Message.from(originalMessage));
      const compute = (tx: Transaction) => JSON.stringify(tx.instructions.filter(ix => ix.programId.equals(ComputeBudgetProgram.programId)).map(ix => [ix.data.toString("hex"), ix.keys.map(key => [key.pubkey.toBase58(), key.isSigner, key.isWritable])]));
      requireThat(compute(normalized) === compute(original), "The wallet changed the reviewed compute budget. Nothing was broadcast.");
      requireThat(normalized.recentBlockhash === original.recentBlockhash, "The wallet changed the reviewed blockhash. Nothing was broadcast.");
      requireThat(normalized.feePayer?.equals(original.feePayer!), "The wallet changed the reviewed fee payer. Nothing was broadcast.");
      const before = original.compileMessage(), after = normalized.compileMessage();
      requireThat(JSON.stringify(before.header) === JSON.stringify(after.header) && before.accountKeys.length === after.accountKeys.length && before.accountKeys.every((key, index) => key.equals(after.accountKeys[index])), "The wallet changed the reviewed transaction accounts. Nothing was broadcast.");
      fail("The wallet changed the reviewed program instructions. Nothing was broadcast.");
    }
    const required = originalBootstrap ? [bootstrap, owner] : [owner];
    requireThat(normalized.signatures.length === required.length && required.every((key, index) => normalized.signatures[index].publicKey.equals(key)) && normalized.verifySignatures(true), "The wallet did not provide the exact required signatures.");
    if (originalBootstrap) requireThat(normalized.signatures[0].signature?.equals(originalBootstrap), "The bootstrap signature changed. Nothing was broadcast.");
    requireThat(unsigned.serializeMessage().equals(originalMessage), "The wallet mutated the reviewed transaction.");
    return { transaction: normalized, bytes: normalized.serialize({ requireAllSignatures: true, verifySignatures: true }) };
  }
  async function reconcile(rpc: OwnerSetupRpc, receipt: OwnerSetupReceipt): Promise<OwnerSetupReceipt> {
    requireThat(receipt.version === 1 && receipt.genesisHash === DEVNET_GENESIS_HASH && receipt.owner === policy.owner && ["handoff", "setup"].includes(receipt.kind) && bs58.decode(receipt.signature).length === 64);
    await assertGenesis(rpc);
    const result = await bounded(rpc.getSignatureStatuses([receipt.signature], { searchTransactionHistory: true }));
    const status = result.value[0];
    if (!status && receipt.kind === "setup" && Number.isSafeInteger(receipt.lastValidBlockHeight) && typeof receipt.blockhash === "string" && bs58.decode(receipt.blockhash).length === 32) {
      const height = await bounded(rpc.getBlockHeight("finalized"));
      if (height > receipt.lastValidBlockHeight!) {
        // No automatic retry: authenticate the current complete state before a later owner review.
        // Signature-status RPC uses a processed context, which can exceed finalized.
        await inspect(rpc, Number.isSafeInteger(receipt.contextSlot) ? receipt.contextSlot : 0);
        // A landing may have raced the first missing-status read. Reconcile again.
        const again = (await bounded(rpc.getSignatureStatuses([receipt.signature], { searchTransactionHistory: true }))).value[0];
        if (again?.confirmationStatus === "finalized") return { ...receipt, status: again.err ? "failed" : "finalized" };
        if (again) return { ...receipt, status: "prepared" };
        return { ...receipt, status: "expired" };
      }
    }
    if (status?.confirmationStatus !== "finalized") return { ...receipt, status: "prepared" };
    return { ...receipt, status: status.err ? "failed" : "finalized" };
  }
  async function broadcast(rpc: OwnerSetupRpc, options: OwnerSetupSubmission, bytes: Buffer, kind: OwnerSetupReceipt["kind"], steps: string[], slot: number, lifetime?: { blockhash: string; lastValidBlockHeight: number }) {
    const signed = Transaction.from(bytes), signature = bs58.encode(signed.signatures[0].signature!);
    const receipt: OwnerSetupReceipt = { version: 1, genesisHash: DEVNET_GENESIS_HASH, owner: policy.owner, kind, contextSlot: slot, signature, status: "prepared", steps, ...lifetime };
    assertIntent(rpc, options);
    options.onPrepared(receipt); // Persist before invocation, including ambiguous network failures.
    assertIntent(rpc, options);
    options.onProgress?.("confirming");
    try {
      const returned = await bounded(rpc.sendRawTransaction(bytes, { skipPreflight: false, preflightCommitment: "finalized", maxRetries: 0, minContextSlot: slot }));
      requireThat(returned === signature, "RPC returned an unexpected signature. Reconcile the saved transaction.");
    } catch { return receipt; } // Never manufacture a new signature or automatically resend.
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      try {
        const next = await reconcile(rpc, receipt);
        if (next.status !== "prepared") return next;
      } catch { return receipt; }
      if (!options.current().active) return receipt;
      await new Promise(resolve => setTimeout(resolve, 1_500));
    }
    return receipt;
  }
  async function submitHandoff(rpc: OwnerSetupRpc, input: OwnerHandoffPackage, options: OwnerSetupSubmission) {
    assertIntent(rpc, options); options.onProgress?.("checking");
    const pkg = parsePackage(input), transaction = Transaction.from(Buffer.from(pkg.transactionBase64, "base64"));
    const originalMessage = Buffer.from(transaction.serializeMessage()), originalBootstrap = Buffer.from(transaction.signatures[0].signature!);
    let state = await inspectHandoff(rpc, pkg); assertIntent(rpc, options);
    const fee = (await bounded(rpc.getFeeForMessage(transaction.compileMessage(), "finalized"))).value;
    requireThat(fee !== null && Number.isSafeInteger(fee) && fee >= 0 && fee <= MAX_FEE && state.balanceLamports >= fee + RESERVE, "The checked handoff network fee exceeds its reviewed limit.");
    options.onProgress?.("simulating"); await simulate(rpc, transaction, state.contextSlot, false);
    state = await inspectHandoff(rpc, pkg, state.contextSlot); assertIntent(rpc, options);
    transaction.nonceInfo = { nonce: pkg.nonceValue, nonceInstruction: transaction.instructions[0] };
    transaction.minNonceContextSlot = state.contextSlot;
    options.onProgress?.("signing"); assertIntent(rpc, options);
    const signed = await options.signTransaction(transaction); assertIntent(rpc, options);
    const verified = verifyOwnerSigned(transaction, signed, originalMessage, originalBootstrap);
    await simulate(rpc, verified.transaction, state.contextSlot, true); assertIntent(rpc, options);
    state = await inspectHandoff(rpc, pkg, state.contextSlot); assertIntent(rpc, options);
    return broadcast(rpc, options, verified.bytes, "handoff", ["checked-loader-whitelist", "checked-loader-factory", "checked-loader-basket"], state.contextSlot);
  }
  async function submitSetup(rpc: OwnerSetupRpc, reviewed: OwnerSetupReview, options: OwnerSetupSubmission) {
    assertIntent(rpc, options); options.onProgress?.("checking");
    const next = await prepare(rpc, options.wallet, reviewed.state.contextSlot); assertIntent(rpc, options);
    requireThat(stateKey(next.state) === stateKey(reviewed.state), "Finalized setup changed. Refresh and review the remaining actions.");
    requireThat(JSON.stringify(next.steps) === JSON.stringify(reviewed.steps) && next.rentLamports <= reviewed.rentLamports && next.feeLamports <= reviewed.feeLamports, "The reviewed setup actions or spending changed. Review the updated costs before signing.");
    requireThat(next.transaction && next.steps.length > 0, "The reviewed devnet setup is already complete.");
    const transaction = next.transaction, originalMessage = Buffer.from(transaction.serializeMessage());
    requireThat(typeof transaction.recentBlockhash === "string" && Number.isSafeInteger(transaction.lastValidBlockHeight));
    const lifetime = { blockhash: transaction.recentBlockhash, lastValidBlockHeight: transaction.lastValidBlockHeight! };
    options.onProgress?.("simulating"); await simulate(rpc, transaction, next.state.contextSlot, false);
    let state = await inspect(rpc, next.state.contextSlot); assertIntent(rpc, options);
    requireThat(stateKey(state) === stateKey(next.state), "Finalized setup changed. Refresh and review the remaining actions.");
    options.onProgress?.("signing"); assertIntent(rpc, options);
    const signed = await options.signTransaction(transaction); assertIntent(rpc, options);
    const verified = verifyOwnerSigned(transaction, signed, originalMessage);
    await simulate(rpc, verified.transaction, state.contextSlot, true); assertIntent(rpc, options);
    state = await inspect(rpc, state.contextSlot); assertIntent(rpc, options);
    requireThat(stateKey(state) === stateKey(next.state), "Finalized setup changed. Refresh and review the remaining actions.");
    return broadcast(rpc, options, verified.bytes, "setup", next.steps, state.contextSlot, lifetime);
  }
  return Object.freeze({ parsePackage, inspectHandoff, inspect, prepare, submitHandoff, submitSetup, reconcile });
}
export const devnetOwnerSetup = createDevnetOwnerSetupClient();
