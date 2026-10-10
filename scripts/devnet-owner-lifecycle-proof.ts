/** Fixed-policy permissionless devnet proof. Default is offline. Never activates creation or uses an owner/issuer key. */
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, realpath, mkdir, open, rename, rm, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import bs58 from "bs58";
import {
  AddressLookupTableAccount, AddressLookupTableProgram, Connection, Keypair, PublicKey,
  SystemProgram, TransactionMessage, VersionedTransaction,
  type AccountInfo, type TransactionInstruction,
} from "@solana/web3.js";
import {
  ExtensionType, getAccountLen, getExtensionTypes, getAccountTypeOfMintType, getScaledUiAmountConfig, unpackMint,
} from "@solana/spl-token";
import { DEVNET_OWNER_NAMESPACE, CREATION_NAMESPACE_ID, DEVNET_GENESIS_HASH } from "../backend/src/config/programNamespaces.js";
import { createNamespaceRouting } from "../app/lib/program-namespaces.js";
import { devnetOwnerSetup, type OwnerSetupState } from "../app/lib/devnet-owner-setup.js";
import artifacts from "../app/lib/devnet-owner-artifacts.json";
import policy from "../backend/src/config/devnetOwnerPolicy.json";
import {
  DEVNET_MOCK_TOKENS, DEVNET_FAUCET_PROGRAM_ID, DEVNET_FAUCET_CLAIM_RAW,
  buildDevnetFaucetClaim, deriveDevnetFaucetClaim, deriveDevnetFaucetVault, deriveDevnetFaucetAuthority,
} from "../app/lib/devnet-faucet.js";
import { TOKEN_2022_PROGRAM_ID, unpackAccount } from "../app/lib/token-2022.js";
import { deriveCreateBasketPdas, type CreateBasketArgs } from "../app/lib/create-basket.js";
import {
  buildCreateBasketTransaction, buildMintInKindTransaction, buildRedeemInKindTransaction,
  buildAccrueManagementFee, buildRedeemInKind, computeBudgetInstructions, deriveAta,
  deriveCreateBasketAltAddresses, deriveMintRedeemAltAddresses, type BasketCoreKeys,
} from "../app/lib/transactions.js";
import { authenticateBasketAccount, authenticateBasketShareMint } from "../app/lib/basket-account-security.js";
import { checkGrossShares, entryFeeOf, computeRedeemPreview } from "../app/components/basket/basket-math.js";
import { managementFeeWithRemainder, splitFeeBigInt } from "../backend/src/workers/feeMath.js";
import { verifyOwnerHandoffSourceBinding } from "./devnet-owner-handoff.js";
import { openPrivateRun, LOADER, programData } from "./devnet-owner-bootstrap.js";
import { assertFixtureMint } from "./xstocks-devnet/profile.js";
import { assertNotRetiredPublicKey } from "./security/retired-keys.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const LIFECYCLE_RPC_URL = "https://api.devnet.solana.com";
export const LIFECYCLE_LIMITS = Object.freeze({ creator: 90_000_000, investor: 60_000_000,
  bootstrap: 160_000_000, bootstrapReserve: 100_000_000, actorReserve: 1_000_000,
  maxFee: 100_000, maxTransactions: 24, deadlineMs: 20 * 60_000 });
export const LIFECYCLE_FEES = Object.freeze({ entry: 100, exit: 50, management: 200 });
const GENESIS_SHARES = 1_000_000n;
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.stringify(value, (_, field) => typeof field === "bigint" ? field.toString() : field, 2);
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
function canonicalKey(value: string): PublicKey {
  const key = new PublicKey(value);
  assert(key.toBase58() === value && !key.equals(PublicKey.default), "Canonical nonzero public identity required");
  assertNotRetiredPublicKey(key, "lifecycle proof public identity"); return key;
}
/** Internal fixed routing only. The production registry is never edited. */
export function lifecycleRouting() {
  assert(CREATION_NAMESPACE_ID === null && DEVNET_OWNER_NAMESPACE.creation.enabled === false,
    "This pre-activation proof requires public creation to remain disabled");
  assert(DEVNET_OWNER_NAMESPACE.creation.treasury === policy.treasury && policy.treasury === policy.owner,
    "The explicitly approved treasury differs from the fixed source policy");
  return createNamespaceRouting([{ ...DEVNET_OWNER_NAMESPACE, creation: { enabled: true, treasury: policy.treasury } }], DEVNET_OWNER_NAMESPACE.id);
}
export function lifecyclePlan(sourceCommit: string) {
  assert(/^[a-f0-9]{40}$/.test(sourceCommit), "Exact committed source required");
  const routing = lifecycleRouting();
  return Object.freeze({ version: 1, mode: "offline-owner-lifecycle-plan", cluster: "devnet", genesisHash: DEVNET_GENESIS_HASH,
    sourceCommit, buildSourceCommit: artifacts.sourceCommit, owner: policy.owner, treasury: policy.treasury,
    bootstrapAuthority: policy.bootstrapAuthority, namespace: routing.creation(), limits: LIFECYCLE_LIMITS,
    baskets: [3, 4], testTokenMints: DEVNET_MOCK_TOKENS.map(token => token.mint.toBase58()),
    prerequisites: ["Genuine finalized owner authority on all three exact deployed artifacts", "Owner whitelist, factory and four active admissions complete", "Fresh isolated actors and exact rent/fee quotes"],
    chainWrites: false, publicCreationEnabled: false });
}
export function assertCompleteOwnerSetup(state: OwnerSetupState): void {
  assert(Number.isSafeInteger(state.contextSlot) && state.contextSlot > 0 && state.loaderAuthority === "owner" &&
    state.whitelist === "owner" && state.factoryInitialized && state.steps.length === 0 &&
    state.admitted.length === 4 && new Set(state.admitted).size === 4 &&
    DEVNET_MOCK_TOKENS.every(token => state.admitted.includes(token.symbol)),
  "Genuine owner signatures and complete finalized setup are required before lifecycle execution");
}
export function assertFreshActors(creator: PublicKey, investor: PublicKey): void {
  const forbidden = new Set([policy.owner, policy.treasury, policy.bootstrapAuthority, ...Object.values(policy.programIds),
    DEVNET_OWNER_NAMESPACE.factoryConfig, DEVNET_OWNER_NAMESPACE.whitelistConfig, ...DEVNET_MOCK_TOKENS.map(token => token.mint.toBase58())]);
  assert(!creator.equals(investor), "Fresh creator and investor must be distinct");
  for (const actor of [creator, investor]) {
    canonicalKey(actor.toBase58());
    assert(PublicKey.isOnCurve(actor.toBytes()) && !forbidden.has(actor.toBase58()), "Fresh actors must not alias any fixed public role");
  }
}
export function lifecycleBasketArgs(creator: PublicKey, nonce: bigint, count: 3 | 4) {
  assert((count === 3 || count === 4) && nonce >= 0n && nonce <= BigInt(Number.MAX_SAFE_INTEGER), "Fresh safe integer nonce and three/four token count required");
  const weights = count === 3 ? [4000, 3200, 2800] : [3000, 2700, 2300, 2000];
  const metadata = JSON.stringify({ version: 1, cluster: "devnet", testTokens: true,
    name: `Devnet lifecycle proof ${count}`, description: `${count} project-issued test tokens. No market value.`,
    creator: creator.toBase58(), constituents: DEVNET_MOCK_TOKENS.slice(0, count).map(token => token.mint.toBase58()), weightsBps: weights });
  const args: CreateBasketArgs = { nonce: Number(nonce), constituents: DEVNET_MOCK_TOKENS.slice(0, count).map(token => token.mint.toBase58()),
    weightsBps: weights, seedAmounts: weights.map(weight => BigInt(weight) * 1000n),
    entryFeeBps: LIFECYCLE_FEES.entry, exitFeeBps: LIFECYCLE_FEES.exit, managementFeeBps: LIFECYCLE_FEES.management,
    metadataHash: Buffer.from(sha256(metadata), "hex") };
  return { args, metadata };
}

export interface LifecycleSnapshot {
  slot: number; supply: bigint; creator: bigint; investor: bigint; treasury: bigint;
  vaults: bigint[]; investorAssets: bigint[]; creatorAssets: bigint[]; underlyingSupplies: bigint[];
  lastAccrual: bigint; remainder: bigint; immutableHash: string; underlyingConfigHashes: string[]; accountHashes: Record<string, string | null>;
}
function equal(actual: unknown, expected: unknown, label: string): void { assert(json(actual) === json(expected), `${label}: raw accounting mismatch`); }
export function assertLifecycleTransition(stage: "mint" | "management" | "redeem", before: LifecycleSnapshot, after: LifecycleSnapshot, value?: bigint[] | bigint) {
  assert(after.slot >= before.slot && after.lastAccrual >= before.lastAccrual, "Regressing finalized lifecycle snapshot");
  equal(after.immutableHash, before.immutableHash, "Immutable basket fields");
  equal(after.underlyingSupplies, before.underlyingSupplies, "Underlying mint supplies");
  equal(after.underlyingConfigHashes, before.underlyingConfigHashes, "Underlying mint configuration");
  equal(after.creatorAssets, before.creatorAssets, "Creator underlying balances");
  const management = managementFeeWithRemainder(before.supply, LIFECYCLE_FEES.management, after.lastAccrual - before.lastAccrual, before.remainder);
  equal(after.remainder, management.remainder, "Carried management remainder");
  const managementSplit = splitFeeBigInt(management.fee), accruedSupply = before.supply + management.fee;
  let creator = managementSplit.creator, treasury = managementSplit.treasury, supply = accruedSupply, investor = before.investor;
  let vaults = before.vaults, assets = before.investorAssets; let actionFee = 0n;
  if (stage === "mint") {
    assert(Array.isArray(value) && value.length === before.vaults.length, "Raw per-leg mint amounts required");
    const gross = checkGrossShares(value, before.vaults, accruedSupply); assert(gross.ok, "Mint deposits are not raw proportional amounts");
    actionFee = entryFeeOf(gross.gross, LIFECYCLE_FEES.entry); supply += gross.gross; investor += gross.gross - actionFee;
    vaults = before.vaults.map((amount, i) => amount + value[i]); assets = before.investorAssets.map((amount, i) => amount - value[i]);
  } else if (stage === "redeem") {
    assert(typeof value === "bigint" && value > 0n && value <= before.investor, "Valid raw investor redemption required");
    const redeem = computeRedeemPreview(before.vaults, accruedSupply, value, LIFECYCLE_FEES.exit); assert(redeem && redeem.burn > 0n, "Valid raw redemption preview required");
    actionFee = redeem.exitFee; supply -= redeem.burn; investor -= value;
    vaults = before.vaults.map((amount, i) => amount - redeem.outs[i]); assets = before.investorAssets.map((amount, i) => amount + redeem.outs[i]);
  } else assert(value === undefined && management.fee >= 10n, "Management fee must be observable without economic input");
  const split = splitFeeBigInt(actionFee); creator += split.creator; treasury += split.treasury;
  equal(after.supply, supply, "Share supply"); equal(after.investor, investor, "Investor shares");
  equal(after.creator - before.creator, creator, "Creator fee shares"); equal(after.treasury - before.treasury, treasury, "Treasury fee shares");
  equal(after.vaults, vaults, "Vault raw balances"); equal(after.investorAssets, assets, "Investor raw balances");
  equal(after.supply, after.creator + after.investor + after.treasury, "Share conservation");
  return { stage, managementFee: management.fee, managementRemainder: management.remainder, actionFee, supply: after.supply };
}

export interface LifecycleReceipt {
  label: string; actor: "bootstrap" | "creator" | "investor"; signature: string; wireSha256: string; messageSha256: string;
  blockhash: string; lastValidBlockHeight: number; preSlot: number; feeLamports: number; rentLamports: number;
  status: "prepared" | "finalized"; finalizedSlot?: number; preState: unknown; lookupTables: string[];
}
export interface LifecycleJournal {
  version: 1; mode: "devnet-owner-lifecycle-proof"; sourceCommit: string; buildSourceCommit: string; genesisHash: string;
  owner: string; treasury: string; bootstrapAuthority: string; creator: string; investor: string;
  startedAt: string; completed: boolean; allocated: Record<"bootstrap" | "creator" | "investor", number>;
  initialBootstrapBalance: number; receipts: LifecycleReceipt[]; proofs: unknown[];
}
export interface LifecycleStore { write(journal: LifecycleJournal): Promise<void> }
export type SendRpc = Pick<Connection, "getGenesisHash" | "getFeeForMessage" | "getBalance" | "simulateTransaction" | "sendRawTransaction" | "getSignatureStatuses">;
export function assertBudget(journal: LifecycleJournal, actor: LifecycleReceipt["actor"], cost: number, balance: number): void {
  assert(Number.isSafeInteger(cost) && cost >= 0 && Number.isSafeInteger(balance) && balance >= 0, "Invalid lifecycle budget evidence");
  const reserve = actor === "bootstrap" ? LIFECYCLE_LIMITS.bootstrapReserve : LIFECYCLE_LIMITS.actorReserve;
  assert(journal.allocated[actor] + cost <= LIFECYCLE_LIMITS[actor] && balance >= cost + reserve,
    "Lifecycle funding/spend/reserve ceiling exceeded; no automatic topup");
}
/** Journal write precedes exactly one broadcast; no failure path retries or replaces economic messages. */
export async function submitLifecycleOnce(options: {
  rpc: SendRpc; store: LifecycleStore; journal: LifecycleJournal; label: string; actor: LifecycleReceipt["actor"];
  signer: Keypair; transaction: VersionedTransaction; lifetime: { blockhash: string; lastValidBlockHeight: number };
  slot: number; rentLamports?: number; preState?: unknown; beforeSend?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>; now?: () => number;
}): Promise<LifecycleReceipt> {
  const { rpc, journal, transaction, signer } = options, now = options.now ?? Date.now, pause = options.sleep ?? sleep;
  assert(await rpc.getGenesisHash() === DEVNET_GENESIS_HASH, "Refusing non-devnet transaction submission");
  assert(!journal.completed && journal.receipts.length < LIFECYCLE_LIMITS.maxTransactions && !journal.receipts.some(item => item.label === options.label || item.status !== "finalized"),
    "Existing or ambiguous lifecycle receipt must be reconciled; never replay or replace it");
  assert(signer.publicKey.toBase58() === journal[options.actor === "bootstrap" ? "bootstrapAuthority" : options.actor] &&
    transaction.message.header.numRequiredSignatures === 1 && transaction.message.staticAccountKeys[0].equals(signer.publicKey), "Exact single actor fee payer/signature required");
  assert(Number.isSafeInteger(options.slot) && options.slot > 0 && transaction.message.recentBlockhash === options.lifetime.blockhash &&
    Number.isSafeInteger(options.lifetime.lastValidBlockHeight) && options.lifetime.lastValidBlockHeight > 0, "Bounded transaction lifetime required");
  const message = Buffer.from(transaction.message.serialize()); transaction.sign([signer]);
  const signedKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), signer.publicKey.toBuffer()]), format: "der", type: "spki" });
  assert(Buffer.from(transaction.message.serialize()).equals(message) && verify(null, message, signedKey, transaction.signatures[0]), "Signed message/signature binding failed");
  const raw = transaction.serialize(); assert(raw.length <= 1232, "Signed lifecycle transaction exceeds packet limit");
  const quoted = await rpc.getFeeForMessage(transaction.message, "finalized"), fee = quoted.value;
  assert(Number.isSafeInteger(quoted.context.slot) && quoted.context.slot >= options.slot && fee !== null && Number.isSafeInteger(fee) && fee > 0 && fee <= LIFECYCLE_LIMITS.maxFee,
    "Exact finalized network fee quote invalid or above cap");
  const rent = options.rentLamports ?? 0; assert(Number.isSafeInteger(rent) && rent >= 0, "Invalid rent budget");
  assertBudget(journal, options.actor, fee + rent, await rpc.getBalance(signer.publicKey, "finalized"));
  const simulated = await rpc.simulateTransaction(transaction, { sigVerify: true, replaceRecentBlockhash: false, commitment: "finalized", minContextSlot: options.slot });
  assert(simulated.value.err === null && simulated.context.slot >= options.slot, "Exact signed lifecycle simulation failed; nothing sent");
  await options.beforeSend?.();
  const receipt: LifecycleReceipt = { label: options.label, actor: options.actor, signature: bs58.encode(transaction.signatures[0]),
    wireSha256: sha256(raw), messageSha256: sha256(message), blockhash: options.lifetime.blockhash, lastValidBlockHeight: options.lifetime.lastValidBlockHeight, preSlot: options.slot,
    feeLamports: fee, rentLamports: rent, status: "prepared", preState: options.preState ?? null,
    lookupTables: transaction.message.addressTableLookups?.map(lookup => lookup.accountKey.toBase58()) ?? [] };
  journal.allocated[options.actor] += fee + rent; journal.receipts.push(receipt);
  await options.store.write(journal); // fsync implementation must complete BEFORE the only send.
  const returned = await rpc.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0, preflightCommitment: "finalized", minContextSlot: options.slot });
  assert(returned === receipt.signature, "Unexpected submitted signature; inspect saved receipt, never resend");
  const deadline = now() + 45_000;
  while (now() < deadline) {
    const status = (await rpc.getSignatureStatuses([receipt.signature], { searchTransactionHistory: true })).value[0];
    assert(!status?.err, "Lifecycle transaction failed; inspect saved receipt, never resend");
    if (status?.confirmationStatus === "finalized") {
      assert(Number.isSafeInteger(status.slot) && status.slot >= options.slot, "Regressing finalized transaction slot");
      receipt.status = "finalized"; receipt.finalizedSlot = status.slot; await options.store.write(journal); return receipt;
    }
    await pause(1500);
  }
  throw new Error("Lifecycle confirmation is ambiguous; reconcile the recorded signature without resending");
}

async function syncedWrite(path: string, contents: string, exclusive = true): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | (exclusive ? constants.O_EXCL : 0) | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
}
async function syncDir(path: string) { const handle = await open(path, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }
/** Fresh exclusive directory prevents economic reruns after a crash. Existing runs are reconcile-only. */
export async function createLifecycleRun(path: string): Promise<{ directory: string; store: LifecycleStore; creator: Keypair; investor: Keypair }> {
  const directory = resolve(path), parent = dirname(directory);
  assert(await realpath(parent) === parent && /^basalt-devnet-lifecycle-[A-Za-z0-9_-]{8,80}$/.test(basename(directory)), "Use a real parent and dedicated lifecycle directory name");
  assert(directory !== resolve(ROOT) && !directory.startsWith(`${resolve(ROOT)}/`), "Lifecycle keys must stay outside the repository");
  let inGit = false; try { inGit = execFileSync("git", ["-C", parent, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true"; } catch { /* A non-repository parent is expected. */ }
  assert(!inGit, "Lifecycle keys must stay outside every Git checkout");
  await mkdir(directory, { mode: 0o700 }); await syncDir(parent);
  const creator = Keypair.generate(), investor = Keypair.generate(); assertFreshActors(creator.publicKey, investor.publicKey);
  await syncedWrite(join(directory, "creator.json"), JSON.stringify(Array.from(creator.secretKey)));
  await syncedWrite(join(directory, "investor.json"), JSON.stringify(Array.from(investor.secretKey))); await syncDir(directory);
  const store: LifecycleStore = { async write(journal) {
    assertPublicLifecycleJournal(journal);
    const temporary = join(directory, `.journal-${process.pid}-${Date.now()}.tmp`);
    try { await syncedWrite(temporary, `${json(journal)}\n`); await rename(temporary, join(directory, "lifecycle-receipt.json")); await syncDir(directory); }
    finally { await rm(temporary, { force: true }); }
  } };
  return { directory, store, creator, investor };
}
export function assertPublicLifecycleJournal(value: LifecycleJournal): void {
  const fields = ["version", "mode", "sourceCommit", "buildSourceCommit", "genesisHash", "owner", "treasury", "bootstrapAuthority", "creator", "investor", "startedAt", "completed", "allocated", "initialBootstrapBalance", "receipts", "proofs"];
  assert(value && Object.keys(value).sort().join() === fields.sort().join() && value.version === 1 && value.mode === "devnet-owner-lifecycle-proof" && value.genesisHash === DEVNET_GENESIS_HASH,
    "Only the public lifecycle journal schema may be persisted");
  assert(value.owner === policy.owner && value.treasury === policy.treasury && value.bootstrapAuthority === policy.bootstrapAuthority &&
    /^[a-f0-9]{40}$/.test(value.sourceCommit) && value.buildSourceCommit === artifacts.sourceCommit, "Public journal trust roots differ");
  assertFreshActors(canonicalKey(value.creator), canonicalKey(value.investor));
  const inspect = (input: unknown): void => {
    if (!input || typeof input !== "object") return;
    assert(!ArrayBuffer.isView(input), "Public journal may not contain private binary objects");
    for (const [key, item] of Object.entries(input)) { assert(!/secret|private|keypair|signer/i.test(key), "Public journal may not contain private signer material"); inspect(item); }
  };
  assert(Array.isArray(value.receipts) && value.receipts.length <= LIFECYCLE_LIMITS.maxTransactions && Array.isArray(value.proofs), "Bounded public receipt/proof arrays required");
  assert(typeof value.completed === "boolean" && Object.keys(value.allocated).sort().join() === "bootstrap,creator,investor" &&
    Object.entries(value.allocated).every(([actor, spent]) => Number.isSafeInteger(spent) && spent >= 0 && spent <= LIFECYCLE_LIMITS[actor as "bootstrap" | "creator" | "investor"]), "Invalid public cumulative budget");
  assert(new Set(value.receipts.map(receipt => receipt.label)).size === value.receipts.length, "Duplicate economic receipt labels");
  for (const receipt of value.receipts) {
    assert(receipt && ["bootstrap", "creator", "investor"].includes(receipt.actor) && typeof receipt.label === "string" && /^[a-z0-9-]{1,64}$/.test(receipt.label) &&
      typeof receipt.signature === "string" && bs58.decode(receipt.signature).length === 64 && bs58.encode(bs58.decode(receipt.signature)) === receipt.signature &&
      /^[a-f0-9]{64}$/.test(receipt.wireSha256) && /^[a-f0-9]{64}$/.test(receipt.messageSha256) &&
      ["prepared", "finalized"].includes(receipt.status) && Number.isSafeInteger(receipt.preSlot) && receipt.preSlot > 0 &&
      Number.isSafeInteger(receipt.feeLamports) && receipt.feeLamports > 0 && receipt.feeLamports <= LIFECYCLE_LIMITS.maxFee &&
      Number.isSafeInteger(receipt.rentLamports) && receipt.rentLamports >= 0 && Number.isSafeInteger(receipt.lastValidBlockHeight) && receipt.lastValidBlockHeight > 0,
      "Invalid public transaction receipt");
    canonicalKey(receipt.blockhash);
    assert(Array.isArray(receipt.lookupTables) && receipt.lookupTables.length <= 2, "Invalid bounded lookup table receipt");
    receipt.lookupTables.forEach(canonicalKey);
  }
  inspect(value); assert(Buffer.byteLength(json(value)) <= 512_000, "Lifecycle journal exceeds size bound");
}
async function readFinalizedBatch(connection: Connection, keys: PublicKey[], minContextSlot: number) {
  const result = await connection.getMultipleAccountsInfoAndContext(keys, { commitment: "finalized", minContextSlot });
  assert(Number.isSafeInteger(result.context.slot) && result.context.slot >= minContextSlot && result.value.length === keys.length, "Incomplete/regressing finalized account batch"); return result;
}
const accountHash = (account: AccountInfo<Buffer> | null) => account ? sha256(Buffer.concat([account.owner.toBuffer(), Buffer.from([Number(account.executable)]), account.data])) : null;
/** Identity/profile evidence remains valid after both legitimate claims exhaust a source vault. */
export function verifyLifecycleFaucet(infos: Array<AccountInfo<Buffer> | null>, minimumVaultRaw = 0n): void {
  assert(infos.length === 9 && minimumVaultRaw >= 0n, "Complete fixed faucet evidence and nonnegative readiness threshold required");
  const program = infos[0];
  assert(program?.executable && program.owner.equals(LOADER) && program.data.length === 36 && program.data.readUInt32LE(0) === 2 &&
    new PublicKey(program.data.subarray(4)).equals(programData(DEVNET_FAUCET_PROGRAM_ID)), "Fixed faucet executable identity mismatch");
  DEVNET_MOCK_TOKENS.forEach((token, index) => {
    const mintInfo = infos[1 + index * 2], vaultInfo = infos[2 + index * 2];
    assert(mintInfo && vaultInfo, "Fixed faucet mint/vault missing");
    const mint = unpackMint(token.mint, mintInfo, TOKEN_2022_PROGRAM_ID); assert(mint.mintAuthority, "Fixed mock issuer authority missing");
    assertFixtureMint(mint, mint.mintAuthority); const scale = getScaledUiAmountConfig(mint);
    assert(scale?.multiplier === token.multiplier && scale.newMultiplier === token.multiplier, "Fixed mock multiplier changed");
    const vault = unpackAccount(deriveDevnetFaucetVault(token.mint), vaultInfo, TOKEN_2022_PROGRAM_ID);
    assert(vault.isInitialized && !vault.isFrozen && vault.owner.equals(deriveDevnetFaucetAuthority()) && vault.mint.equals(token.mint) && vault.amount >= minimumVaultRaw,
      "Fixed faucet vault identity/readiness mismatch");
  });
}
async function readFaucetActor(connection: Connection, actor: PublicKey, minSlot: number) {
  const keys = [DEVNET_FAUCET_PROGRAM_ID, deriveDevnetFaucetClaim(actor), ...DEVNET_MOCK_TOKENS.map(token => token.mint),
    ...DEVNET_MOCK_TOKENS.map(token => deriveDevnetFaucetVault(token.mint)), ...DEVNET_MOCK_TOKENS.map(token => deriveAta(actor, token.mint))];
  const batch = await readFinalizedBatch(connection, keys, minSlot), infos = batch.value;
  verifyLifecycleFaucet([infos[0], ...DEVNET_MOCK_TOKENS.flatMap((_, index) => [infos[2 + index], infos[6 + index]])]);
  const raw = (index: number, owner: PublicKey, mint: PublicKey) => {
    const info = infos[index]; if (!info) return 0n;
    const token = unpackAccount(keys[index], info, TOKEN_2022_PROGRAM_ID);
    assert(token.isInitialized && !token.isFrozen && token.owner.equals(owner) && token.mint.equals(mint), "Fixed actor token account mismatch"); return token.amount;
  };
  const claim = infos[1];
  assert(!claim || claim.owner.equals(DEVNET_FAUCET_PROGRAM_ID) && !claim.executable && claim.data.length === 1 && claim.data[0] === 1, "Unexpected faucet claim identity/layout");
  const mints = DEVNET_MOCK_TOKENS.map((token, index) => unpackMint(token.mint, infos[2 + index]!, TOKEN_2022_PROGRAM_ID));
  const accountSizes = mints.map(mint => getAccountLen([...new Set([...getExtensionTypes(mint.tlvData).map(getAccountTypeOfMintType), ExtensionType.ImmutableOwner])]));
  return { slot: batch.context.slot, claimed: !!claim, assets: DEVNET_MOCK_TOKENS.map((token, i) => raw(10 + i, actor, token.mint)),
    vaults: DEVNET_MOCK_TOKENS.map((token, i) => unpackAccount(keys[6 + i], infos[6 + i], TOKEN_2022_PROGRAM_ID).amount),
    supplies: mints.map(mint => mint.supply), mintConfigHashes: mints.map((_, i) => sha256(Buffer.concat([infos[2 + i]!.data.subarray(0, 36), infos[2 + i]!.data.subarray(44)]))), accountSizes, hashes: Object.fromEntries(keys.map((key, i) => [key.toBase58(), accountHash(infos[i])])) };
}
async function snapshot(connection: Connection, keys: BasketCoreKeys, args: CreateBasketArgs, minSlot: number): Promise<LifecycleSnapshot> {
  const pda = deriveCreateBasketPdas(keys.creator.toBase58(), args, lifecycleRouting()), mints = args.constituents.map(value => new PublicKey(value));
  const addresses = [keys.basket, keys.shareMint, deriveAta(keys.creator, keys.shareMint), deriveAta(keys.user, keys.shareMint), deriveAta(keys.treasury, keys.shareMint),
    ...pda.vaultAtas, ...mints.map(mint => deriveAta(keys.user, mint)), ...pda.creatorAtas, ...mints];
  const batch = await readFinalizedBatch(connection, addresses, minSlot), data = batch.value, count = mints.length;
  assert(data[0], "Finalized basket missing");
  const auth = authenticateBasketAccount(keys.basket, data[0], lifecycleRouting());
  assert(auth.creator.equals(keys.creator) && auth.treasury.equals(keys.treasury) && auth.shareMint.equals(keys.shareMint) && json(auth.constituents) === json(args.constituents), "Immutable basket role/constituent mismatch");
  const bytes = data[0].data;
  equal(bytes.readBigUInt64LE(136), BigInt(args.nonce), "Immutable nonce"); equal(bytes.subarray(160, 192).toString("hex"), Buffer.from(args.metadataHash).toString("hex"), "Immutable metadata hash");
  equal(mints.map((_, i) => bytes.readUInt16LE(833 + 2 * i)), args.weightsBps, "Immutable weights");
  equal([bytes.readUInt16LE(873), bytes.readUInt16LE(875), bytes.readUInt16LE(877)], [LIFECYCLE_FEES.entry, LIFECYCLE_FEES.exit, LIFECYCLE_FEES.management], "Immutable fees");
  const share = authenticateBasketShareMint(keys.shareMint, data[1], auth.vaultAuthority);
  const amount = (i: number, owner: PublicKey, mint: PublicKey, optional = false) => {
    if (!data[i]) { assert(optional, "Expected finalized token account missing"); return 0n; }
    const token = unpackAccount(addresses[i], data[i], TOKEN_2022_PROGRAM_ID);
    assert(token.isInitialized && !token.isFrozen && token.owner.equals(owner) && token.mint.equals(mint), "Canonical finalized token account mismatch"); return token.amount;
  };
  const result: LifecycleSnapshot = { slot: batch.context.slot, supply: share.supply,
    creator: amount(2, keys.creator, keys.shareMint), investor: amount(3, keys.user, keys.shareMint, true), treasury: amount(4, keys.treasury, keys.shareMint, true),
    vaults: mints.map((mint, i) => amount(5 + i, auth.vaultAuthority, mint)),
    investorAssets: mints.map((mint, i) => amount(5 + count + i, keys.user, mint)), creatorAssets: mints.map((mint, i) => amount(5 + 2 * count + i, keys.creator, mint)),
    underlyingSupplies: mints.map((mint, i) => { const parsed = unpackMint(mint, data[5 + 3 * count + i]!, TOKEN_2022_PROGRAM_ID); assert(parsed.mintAuthority, "Fixture issuer authority missing"); assertFixtureMint(parsed, parsed.mintAuthority); const scale = getScaledUiAmountConfig(parsed), fixed = DEVNET_MOCK_TOKENS.find(token => token.mint.equals(mint)); assert(fixed && scale?.multiplier === fixed.multiplier && scale.newMultiplier === fixed.multiplier, "Fixed fixture multiplier changed"); return parsed.supply; }),
    lastAccrual: bytes.readBigInt64LE(152), remainder: BigInt(bytes.readUIntLE(881, 5)),
    underlyingConfigHashes: mints.map((_, i) => sha256(Buffer.concat([data[5 + 3 * count + i]!.data.subarray(0, 36), data[5 + 3 * count + i]!.data.subarray(44)]))),
    immutableHash: sha256(Buffer.concat([bytes.subarray(0, 152), bytes.subarray(160, 881), bytes.subarray(886)])),
    accountHashes: Object.fromEntries(addresses.map((address, i) => [address.toBase58(), accountHash(data[i])])) };
  equal(result.supply, result.creator + result.investor + result.treasury, "Share supply conservation"); return result;
}

export async function quoteLifecycleBudget(connection: Pick<Connection, "getMinimumBalanceForRentExemption">, sizes: readonly number[]) {
  assert(sizes.length === 4 && sizes.every(size => Number.isSafeInteger(size) && size >= 170 && size <= 1024), "Invalid fixed mock token account sizes");
  const rent = async (size: number) => { const value = await connection.getMinimumBalanceForRentExemption(size, "finalized"); assert(Number.isSafeInteger(value) && value > 0, "Invalid finalized rent quote"); return value; };
  const [underlying, basket, mint, share, claim, createAlt, tradeAlt] = await Promise.all([
    Promise.all(sizes.map(rent)), rent(888), rent(82), rent(170), rent(1), rent(56 + 28 * 32), rent(56 + 29 * 32),
  ]);
  const tokenAccounts = underlying.reduce((sum, value) => sum + value, 0), vaults = underlying.slice(0, 3).reduce((sum, value) => sum + value, 0) + tokenAccounts;
  const creator = tokenAccounts + claim + 2 * (basket + mint + share) + vaults + createAlt + 8 * LIFECYCLE_LIMITS.maxFee;
  const investor = tokenAccounts + claim + 4 * share + tradeAlt + 12 * LIFECYCLE_LIMITS.maxFee;
  assert(creator + LIFECYCLE_LIMITS.actorReserve <= LIFECYCLE_LIMITS.creator && investor + LIFECYCLE_LIMITS.actorReserve <= LIFECYCLE_LIMITS.investor,
    "Quoted lifecycle rents/fee ceiling do not fit fixed actor funding targets");
  return { creator, investor, underlying, basket, mint, share, claim, createAlt, tradeAlt };
}
function compileSmall(payer: PublicKey, instructions: TransactionInstruction[], lifetime: { blockhash: string; lastValidBlockHeight: number }) {
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: lifetime.blockhash, instructions: [...computeBudgetInstructions(), ...instructions] }).compileToV0Message());
}
/** Execution uses fresh actors only and refuses existing/ambiguous runs. The CLI supplies a fixed RPC and committed source. */
export async function executeLifecycleProof(options: { connection: Connection; sourceCommit: string; runDir: string; bootstrapRunDir: string }) {
  const { connection, sourceCommit } = options, routing = lifecycleRouting(), deadline = Date.now() + LIFECYCLE_LIMITS.deadlineMs;
  const checkTime = () => assert(Date.now() < deadline, "Lifecycle deadline exceeded; inspect receipts without resending");
  const complete = async (min = 0) => { checkTime(); const state = await devnetOwnerSetup.inspect(connection, min); assertCompleteOwnerSetup(state); return state; };
  let state = await complete();
  const creatorProbe = Keypair.generate(), investorProbe = Keypair.generate(); assertFreshActors(creatorProbe.publicKey, investorProbe.publicKey);
  const faucet = await readFaucetActor(connection, creatorProbe.publicKey, state.contextSlot);
  assert(!faucet.claimed && faucet.vaults.every(amount => amount >= 2n * DEVNET_FAUCET_CLAIM_RAW), "Faucet must fund two fresh actor claims");
  const budget = await quoteLifecycleBudget(connection, faucet.accountSizes);
  const bootstrapKey = canonicalKey(policy.bootstrapAuthority), initialBootstrapBalance = await connection.getBalance(bootstrapKey, "finalized");
  assert(Number.isSafeInteger(initialBootstrapBalance) && initialBootstrapBalance >= LIFECYCLE_LIMITS.creator + LIFECYCLE_LIMITS.investor + LIFECYCLE_LIMITS.maxFee + LIFECYCLE_LIMITS.bootstrapReserve, "Insufficient fixed bootstrap funding/reserve");
  state = await complete(faucet.slot);
  const run = await createLifecycleRun(options.runDir), bootstrapRun = await openPrivateRun(options.bootstrapRunDir);
  const journal: LifecycleJournal = { version: 1, mode: "devnet-owner-lifecycle-proof", sourceCommit, buildSourceCommit: artifacts.sourceCommit,
    genesisHash: DEVNET_GENESIS_HASH, owner: policy.owner, treasury: policy.treasury!, bootstrapAuthority: policy.bootstrapAuthority,
    creator: run.creator.publicKey.toBase58(), investor: run.investor.publicKey.toBase58(), startedAt: new Date().toISOString(), completed: false,
    allocated: { bootstrap: 0, creator: 0, investor: 0 }, initialBootstrapBalance, receipts: [], proofs: [{ kind: "finalized-prerequisites", state, rentBudget: budget }] };
  await run.store.write(journal);
  let slot = state.contextSlot;
  const submit = async (label: string, actor: LifecycleReceipt["actor"], signer: Keypair, transaction: VersionedTransaction,
    lifetime: { blockhash: string; lastValidBlockHeight: number }, rentLamports = 0, preState: unknown = null) => {
    checkTime();
    const receipt = await submitLifecycleOnce({ rpc: connection, store: run.store, journal, label, actor, signer, transaction, lifetime, slot, rentLamports, preState,
      beforeSend: async () => { checkTime(); state = await complete(slot); } });
    slot = Math.max(slot, receipt.finalizedSlot!);
    const balance = await connection.getBalance(bootstrapKey, "finalized");
    assert(initialBootstrapBalance - balance <= journal.allocated.bootstrap && journal.allocated.bootstrap <= LIFECYCLE_LIMITS.bootstrap && balance >= LIFECYCLE_LIMITS.bootstrapReserve, "Bootstrap actual outflow/reserve exceeded");
    if (actor !== "bootstrap") {
      const actorBalance = await connection.getBalance(signer.publicKey, "finalized");
      assert(Number.isSafeInteger(actorBalance) && actorBalance >= LIFECYCLE_LIMITS.actorReserve &&
        actorBalance >= LIFECYCLE_LIMITS[actor] - journal.allocated[actor], "Actor actual native spend/reserve exceeded quoted cumulative ceiling");
    }
    console.log(JSON.stringify({ label, signature: receipt.signature, finalizedSlot: receipt.finalizedSlot })); return receipt;
  };
  const small = async (label: string, actor: LifecycleReceipt["actor"], signer: Keypair, instructions: TransactionInstruction[], rent = 0, pre: unknown = null) => {
    const latest = await connection.getLatestBlockhash("finalized"); return submit(label, actor, signer, compileSmall(signer.publicKey, instructions, latest), latest, rent, pre);
  };
  const makeAlt = async (label: string, actor: "creator" | "investor", signer: Keypair, addresses: PublicKey[], rent: number) => {
    assert(addresses.length === (actor === "creator" ? 28 : 29) && new Set(addresses.map(String)).size === addresses.length, "ALT key set differs from the quoted proof budget");
    const recentSlot = await connection.getSlot("finalized"); assert(recentSlot >= slot, "ALT finalized slot regressed");
    const [create, address] = AddressLookupTableProgram.createLookupTable({ authority: signer.publicKey, payer: signer.publicKey, recentSlot });
    await small(`${label}-create`, actor, signer, [create], rent, { address: address.toBase58(), addresses: addresses.map(String) });
    for (let index = 0; index < addresses.length; index += 20) await small(`${label}-extend-${index}`, actor, signer,
      [AddressLookupTableProgram.extendLookupTable({ lookupTable: address, authority: signer.publicKey, payer: signer.publicKey, addresses: addresses.slice(index, index + 20) })]);
    for (let attempt = 0; attempt < 12; attempt++) {
      const found = await readFinalizedBatch(connection, [address], slot), info = found.value[0];
      assert(info && info.owner.equals(AddressLookupTableProgram.programId) && !info.executable, "Canonical ALT account missing");
      const table = AddressLookupTableAccount.deserialize(info.data);
      assert(table.authority?.equals(signer.publicKey) && table.deactivationSlot === (1n << 64n) - 1n &&
        json(table.addresses.map(String)) === json(addresses.map(String)), "Finalized ALT authority/coverage mismatch");
      slot = found.context.slot;
      if (table.lastExtendedSlot < slot) return [address];
      await sleep(750);
    }
    throw new Error("Finalized ALT activation wait exceeded; inspect receipts without resending");
  };
  try {
    const actorAccounts = await readFinalizedBatch(connection, [run.creator.publicKey, run.investor.publicKey], slot);
    assert(actorAccounts.value.every(value => value === null), "Fresh actors already exist; do not reuse this run");
    const bootstrap = await bootstrapRun.loadSigner(); assert(bootstrap.publicKey.equals(bootstrapKey), "Fixed bootstrap signer mismatch");
    await small("fund-fresh-actors", "bootstrap", bootstrap, [
      SystemProgram.transfer({ fromPubkey: bootstrapKey, toPubkey: run.creator.publicKey, lamports: LIFECYCLE_LIMITS.creator }),
      SystemProgram.transfer({ fromPubkey: bootstrapKey, toPubkey: run.investor.publicKey, lamports: LIFECYCLE_LIMITS.investor }),
    ], LIFECYCLE_LIMITS.creator + LIFECYCLE_LIMITS.investor, { creator: journal.creator, investor: journal.investor, initialBootstrapBalance });
    const funded = await readFinalizedBatch(connection, [run.creator.publicKey, run.investor.publicKey], slot);
    for (const [index, actor] of ["creator", "investor"].entries()) {
      const account = funded.value[index];
      assert(account && account.owner.equals(SystemProgram.programId) && !account.executable && account.data.length === 0 &&
        account.lamports === LIFECYCLE_LIMITS[actor as "creator" | "investor"], "Fresh actor funding differs from the exact fixed transfer");
    }
    slot = funded.context.slot;
    journal.proofs.push({ kind: "bounded-native-funding", creatorLamports: funded.value[0]!.lamports, investorLamports: funded.value[1]!.lamports,
      bootstrapMaximumOutflow: LIFECYCLE_LIMITS.bootstrap, bootstrapReserve: LIFECYCLE_LIMITS.bootstrapReserve, slot }); await run.store.write(journal);
    for (const [actor, signer] of [["creator", run.creator], ["investor", run.investor]] as const) {
      const before = await readFaucetActor(connection, signer.publicKey, slot); assert(!before.claimed && before.assets.every(amount => amount === 0n) && before.vaults.every(amount => amount >= DEVNET_FAUCET_CLAIM_RAW), "Only a fresh unclaimed actor with available faucet capacity may claim");
      slot = before.slot;
      await small(`claim-${actor}`, actor, signer, buildDevnetFaucetClaim(signer.publicKey), budget.underlying.reduce((sum, value) => sum + value, budget.claim), before);
      const after = await readFaucetActor(connection, signer.publicKey, slot); assert(after.claimed, "Finalized claim record absent");
      equal(after.assets, before.assets.map(amount => amount + DEVNET_FAUCET_CLAIM_RAW), "Faucet actor raw credits");
      equal(after.vaults, before.vaults.map(amount => amount - DEVNET_FAUCET_CLAIM_RAW), "Faucet raw debits"); equal(after.supplies, before.supplies, "Faucet never issues underlying tokens"); equal(after.mintConfigHashes, before.mintConfigHashes, "Faucet cannot alter mint configuration");
      slot = after.slot; journal.proofs.push({ kind: `claim-${actor}`, before, after }); await run.store.write(journal);
    }
    for (const count of [3, 4] as const) {
      state = await complete(slot); slot = state.contextSlot;
      const factory = await readFinalizedBatch(connection, [new PublicKey(DEVNET_OWNER_NAMESPACE.factoryConfig)], slot); assert(factory.value[0], "Owner factory missing");
      slot = factory.context.slot;
      const { args, metadata } = lifecycleBasketArgs(run.creator.publicKey, factory.value[0].data.readBigUInt64LE(80), count);
      const pda = deriveCreateBasketPdas(journal.creator, args, routing), keys: BasketCoreKeys = { basket: pda.basket, factory: pda.factory,
        shareMint: pda.shareMint, creator: run.creator.publicKey, treasury: canonicalKey(policy.treasury!), user: run.investor.publicKey, constituents: args.constituents };
      const absence = await readFinalizedBatch(connection, [pda.basket, pda.shareMint], slot); assert(absence.value.every(value => value === null), "Fresh unused basket/share PDAs required"); slot = absence.context.slot;
      const creatorBefore = await readFaucetActor(connection, run.creator.publicKey, slot); slot = creatorBefore.slot;
      const createAlt = count === 4 ? await makeAlt("create-4-alt", "creator", run.creator, deriveCreateBasketAltAddresses(journal.creator, args, routing), budget.createAlt) : undefined;
      const create = await buildCreateBasketTransaction({ connection, routing, creator: journal.creator, args, lookupTableAddresses: createAlt });
      const createRent = budget.basket + budget.mint + budget.share + budget.underlying.slice(0, count).reduce((sum, value) => sum + value, 0);
      await submit(`create-${count}`, "creator", run.creator, create.transaction, create, createRent, { metadata, args: { ...args, metadataHash: Buffer.from(args.metadataHash).toString("hex") }, creatorAssets: creatorBefore.assets });
      let current = await snapshot(connection, keys, args, slot); slot = current.slot;
      equal(current.supply, GENESIS_SHARES, "Fixed genesis supply"); equal(current.creator, GENESIS_SHARES, "Creator genesis shares"); equal(current.investor + current.treasury, 0n, "No extra genesis owners");
      equal(current.vaults, args.seedAmounts, "Atomic raw vault seeds");
      equal(current.creatorAssets, creatorBefore.assets.slice(0, count).map((amount, i) => amount - BigInt(args.seedAmounts[i])), "Atomic creator seed debit");
      equal(current.underlyingSupplies, creatorBefore.supplies.slice(0, count), "Create cannot issue underlying");
      equal(current.underlyingConfigHashes, creatorBefore.mintConfigHashes.slice(0, count), "Create cannot alter underlying configuration");
      const factoryAfter = await readFinalizedBatch(connection, [pda.factory], slot), afterInfo = factoryAfter.value[0];
      assert(afterInfo && !afterInfo.executable && afterInfo.owner.equals(new PublicKey(policy.programIds.basket_factory)) && afterInfo.data.length === 89, "Finalized factory owner/layout changed");
      equal(afterInfo.data.readBigUInt64LE(80), factory.value[0].data.readBigUInt64LE(80) + 1n, "Factory counter advances once");
      equal(Buffer.concat([afterInfo.data.subarray(0, 80), afterInfo.data.subarray(88)]).toString("hex"),
        Buffer.concat([factory.value[0].data.subarray(0, 80), factory.value[0].data.subarray(88)]).toString("hex"), "Immutable factory configuration");
      slot = factoryAfter.context.slot;
      journal.proofs.push({ kind: `factory-${count}`, beforeSlot: factory.context.slot, afterSlot: slot,
        beforeCounter: factory.value[0].data.readBigUInt64LE(80), afterCounter: afterInfo.data.readBigUInt64LE(80),
        beforeHash: accountHash(factory.value[0]), afterHash: accountHash(afterInfo) });
      journal.proofs.push({ kind: `create-${count}`, basket: pda.basket.toBase58(), shareMint: pda.shareMint.toBase58(), metadata, snapshot: current, wireBytes: create.transaction.serialize().length }); await run.store.write(journal);
      const tradeAlt = count === 4 ? await makeAlt("trade-4-alt", "investor", run.investor, deriveMintRedeemAltAddresses(keys, routing), budget.tradeAlt) : undefined;
      current = await snapshot(connection, keys, args, slot); slot = current.slot;
      const deposits = args.seedAmounts.map(amount => BigInt(amount) * 1000n);
      const mint = await buildMintInKindTransaction({ connection, routing, keys, amounts: deposits, vaultBalances: current.vaults, lookupTableAddresses: tradeAlt });
      await submit(`mint-${count}`, "investor", run.investor, mint.transaction, mint, 2 * budget.share, current);
      let next = await snapshot(connection, keys, args, slot); slot = next.slot;
      journal.proofs.push({ ...assertLifecycleTransition("mint", current, next, deposits), count, before: current, after: next, wireBytes: mint.transaction.serialize().length }); await run.store.write(journal); current = next;
      const waitDeadline = Date.now() + 45_000;
      for (;;) {
        const clock = await readFinalizedBatch(connection, [new PublicKey("SysvarC1ock11111111111111111111111111111111")], slot);
        assert(clock.value[0]?.data.length === 40, "Canonical clock missing"); slot = clock.context.slot;
        const timestamp = clock.value[0].data.readBigInt64LE(32);
        if (timestamp >= current.lastAccrual && managementFeeWithRemainder(current.supply, LIFECYCLE_FEES.management, timestamp - current.lastAccrual, current.remainder).fee >= 10n) break;
        assert(Date.now() < waitDeadline, "Observable management fee wait exceeded"); await sleep(1500);
      }
      await small(`management-${count}`, "investor", run.investor, buildAccrueManagementFee(keys, routing).instructions, 0, current);
      next = await snapshot(connection, keys, args, slot); slot = next.slot;
      journal.proofs.push({ ...assertLifecycleTransition("management", current, next), count, before: current, after: next }); await run.store.write(journal); current = next;
      for (const part of ["partial", "remaining"] as const) {
        const shares = part === "partial" ? current.investor / 3n : current.investor;
        const redeemInstruction = buildRedeemInKind({ keys, sharesToBurn: shares, vaultBalances: current.vaults }, routing).instructions[0];
        assert(!pda.whitelistedMints.some(address => redeemInstruction.keys.some(meta => meta.pubkey.equals(address))), "Redeem must not request whitelist accounts");
        const redeem = await buildRedeemInKindTransaction({ connection, routing, keys, sharesToBurn: shares, vaultBalances: current.vaults, lookupTableAddresses: tradeAlt });
        await submit(`redeem-${count}-${part}`, "investor", run.investor, redeem.transaction, redeem, 0, current);
        next = await snapshot(connection, keys, args, slot); slot = next.slot;
        journal.proofs.push({ ...assertLifecycleTransition("redeem", current, next, shares), count, part, before: current, after: next, wireBytes: redeem.transaction.serialize().length }); await run.store.write(journal); current = next;
      }
      equal(current.investor, 0n, "Investor full remaining redemption");
    }
    await complete(slot); journal.completed = true; await run.store.write(journal); return journal;
  } finally { await bootstrapRun.close(); }
}

/** Serialize public RPC traffic. Only idempotent reads may retry an explicit HTTP 429. */
export function boundedLifecycleFetch(dependencies: {
  transport?: typeof fetch; now?: () => number; wait?: (ms: number) => Promise<void>;
} = {}): typeof fetch {
  const transport = dependencies.transport ?? fetch, now = dependencies.now ?? Date.now, wait = dependencies.wait ?? sleep;
  const deadline = now() + LIFECYCLE_LIMITS.deadlineMs; let count = 0, lastStart = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();
  const allowed = new Set(["getGenesisHash", "getMultipleAccounts", "getAccountInfo", "getBalance", "getMinimumBalanceForRentExemption", "getLatestBlockhash", "getFeeForMessage", "getSlot", "simulateTransaction", "sendTransaction", "getSignatureStatuses"]);
  return (async (input, init) => {
    const url = String(input), body = String(init?.body), method = init?.method;
    assert(url === LIFECYCLE_RPC_URL || url === `${LIFECYCLE_RPC_URL}/`, "Only the fixed official devnet RPC is permitted");
    const request = JSON.parse(body);
    assert(method === "POST" && request && !Array.isArray(request) && allowed.has(request.method), "Lifecycle RPC method/request/time budget exceeded");
    const captured: RequestInit = { ...init, method, body, headers: new Headers(init?.headers) };
    const perform = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const spacing = Math.max(0, lastStart + 500 - now());
        assert(now() + spacing < deadline, "Lifecycle RPC method/request/time budget exceeded");
        if (spacing) await wait(spacing);
        assert(++count <= 600 && now() < deadline, "Lifecycle RPC method/request/time budget exceeded");
        lastStart = now();
        const response = await transport(url, { ...captured, redirect: "error", signal: AbortSignal.timeout(Math.min(12_000, deadline - now())) });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 429 && request.method !== "sendTransaction" && attempt < 2) {
            const header = response.headers.get("retry-after");
            const delay = header === null ? 5000 : /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now();
            assert(Number.isFinite(delay) && delay >= 0 && delay <= 15_000 && now() + Math.max(500, delay) < deadline,
              "Lifecycle RPC retry delay exceeds bounded read budget");
            await wait(Math.max(500, delay)); continue;
          }
          throw new Error(`Lifecycle RPC HTTP ${response.status} for ${request.method}; ${request.method === "sendTransaction" ? "broadcast not retried" : "read stopped"}`);
        }
        assert(response.body, "Lifecycle RPC response body missing");
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
          assert(size <= 16 * 1024 * 1024 && now() < deadline, "Lifecycle RPC response budget exceeded"); chunks.push(chunk.value); } }
        finally { await reader.cancel(); }
        return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
      }
      throw new Error("Lifecycle RPC read retry budget exceeded");
    };
    const result = queue.then(perform); queue = result.then(() => undefined, () => undefined); return result;
  }) as typeof fetch;
}
export async function main(args = process.argv.slice(2)): Promise<unknown> {
  const { values } = parseArgs({ args, strict: true, options: { execute: { type: "boolean", default: false }, reconcile: { type: "boolean", default: false },
    "run-dir": { type: "string" }, "bootstrap-run-dir": { type: "string" }, help: { type: "boolean" } } });
  assert(!(values.execute && values.reconcile), "Choose execution or read-only reconciliation");
  if (values.help) { console.log("Default offline. Run with tsx --tsconfig app/tsconfig.json scripts/devnet-owner-lifecycle-proof.ts. Explicit later --execute --run-dir <NEW basalt-devnet-lifecycle-* outside Git> --bootstrap-run-dir <owned0700 basalt-devnet-owner-*> requires complete genuinely owner-signed finalized setup. Funds two fresh actors at most 0.15 devnet SOL, bootstrap outflow cap 0.16 SOL, reserve 0.10 SOL. Proves three/four mock-token create/mint/fees/redeem. Never loads owner/issuer keys, changes programs/admissions, or enables creation. Any ambiguous send stops permanently; --reconcile --run-dir <existing> reads public receipts only and never resends. Existing execution directories are always refused."); return; }
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (!values.execute && !values.reconcile) { const plan = lifecyclePlan(sourceCommit); console.log(json(plan)); return plan; }
  verifyOwnerHandoffSourceBinding(artifacts.sourceCommit, ROOT);
  assert(execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" }).trim() === "", "Execution/reconciliation requires clean committed operator source");
  const connection = new Connection(LIFECYCLE_RPC_URL, { commitment: "finalized", disableRetryOnRateLimit: true, fetch: boundedLifecycleFetch() });
  if (values.reconcile) {
    assert(values["run-dir"] && !values["bootstrap-run-dir"], "Read-only reconciliation accepts only the existing lifecycle run directory");
    const directory = resolve(values["run-dir"]); assert(await realpath(directory) === directory, "Real lifecycle run directory required");
    const path = join(directory, "lifecycle-receipt.json"), stat = await lstat(path);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 512_000, "Bounded regular public journal required");
    const journal: LifecycleJournal = JSON.parse(await readFile(path, "utf8")); assertPublicLifecycleJournal(journal);
    assert(await connection.getGenesisHash() === DEVNET_GENESIS_HASH, "Refusing non-devnet reconciliation");
    const statuses = journal.receipts.length ? await connection.getSignatureStatuses(journal.receipts.map(receipt => receipt.signature), { searchTransactionHistory: true }) : { value: [] };
    const result = { mode: "read-only-lifecycle-reconciliation", creator: journal.creator, investor: journal.investor, journalCompleted: journal.completed,
      receipts: journal.receipts.map((receipt, index) => ({ label: receipt.label, signature: receipt.signature, status: statuses.value[index] })),
      economicReplayAllowed: false, chainWrites: false }; console.log(json(result)); return result;
  }
  assert(values["run-dir"] && values["bootstrap-run-dir"], "Execution requires a fresh lifecycle directory and the isolated bootstrap directory");
  const journal = await executeLifecycleProof({ connection, sourceCommit, runDir: values["run-dir"], bootstrapRunDir: values["bootstrap-run-dir"] });
  const result = { mode: journal.mode, sourceCommit, completed: journal.completed, creator: journal.creator, investor: journal.investor,
    report: join(resolve(values["run-dir"]), "lifecycle-receipt.json"), receipts: journal.receipts.map(({ label, signature, finalizedSlot }) => ({ label, signature, finalizedSlot })), publicCreationEnabled: false };
  console.log(json(result)); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  // Messages contain only fixed public intent and identifiers. Never print signer objects or raw RPC requests.
  console.error(`Devnet lifecycle proof stopped: ${error instanceof Error ? error.message : "inspect the public receipt"}. No automatic resend.`); process.exitCode = 1;
});
