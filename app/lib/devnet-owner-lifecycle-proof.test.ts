import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, lstat, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressLookupTableAccount, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import {
  LIFECYCLE_LIMITS, lifecyclePlan, lifecycleRouting, lifecycleBasketArgs, assertCompleteOwnerSetup,
  assertFreshActors, assertLifecycleTransition, assertBudget, submitLifecycleOnce, createLifecycleRun,
  assertPublicLifecycleJournal, quoteLifecycleBudget, main,
  verifyLifecycleFaucet, type LifecycleJournal, type LifecycleSnapshot, type SendRpc,
} from "../../scripts/devnet-owner-lifecycle-proof";
import { APP_NAMESPACE_ROUTING, DEVNET_GENESIS_HASH } from "./program-namespaces";
import { DEVNET_MOCK_TOKENS, DEVNET_FAUCET_CLAIM_RAW, DEVNET_FAUCET_PROGRAM_ID, deriveDevnetFaucetAuthority } from "./devnet-faucet";
import { TOKEN_2022_PROGRAM_ID } from "./token-2022";
import { pack } from "@solana/spl-token-metadata";
import { fixtureMetadata } from "../../scripts/xstocks-devnet/profile";
import { LOADER, programData } from "../../scripts/devnet-owner-bootstrap";
import { deriveCreateBasketPdas, buildCreateBasketInstruction } from "./create-basket";
import { buildMintInKind, buildRedeemInKind, computeBudgetInstructions, deriveCreateBasketAltAddresses, deriveMintRedeemAltAddresses, type BasketCoreKeys } from "./transactions";
import { managementFeeWithRemainder, splitFeeBigInt } from "../../backend/src/workers/feeMath";
import { checkGrossShares, entryFeeOf, computeRedeemPreview } from "../components/basket/basket-math";
import policy from "../../backend/src/config/devnetOwnerPolicy.json";
import artifacts from "./devnet-owner-artifacts.json";

const creator = Keypair.fromSeed(new Uint8Array(32).fill(41)), investor = Keypair.fromSeed(new Uint8Array(32).fill(42));
const blockhash = Keypair.fromSeed(new Uint8Array(32).fill(43)).publicKey.toBase58();
function journal(): LifecycleJournal {
  return { version: 1, mode: "devnet-owner-lifecycle-proof", sourceCommit: "a".repeat(40), buildSourceCommit: artifacts.sourceCommit,
    genesisHash: DEVNET_GENESIS_HASH, owner: policy.owner, treasury: policy.treasury!, bootstrapAuthority: policy.bootstrapAuthority,
    creator: creator.publicKey.toBase58(), investor: investor.publicKey.toBase58(), startedAt: "2026-10-10T00:00:00Z", completed: false,
    allocated: { bootstrap: 0, creator: 0, investor: 0 }, initialBootstrapBalance: 1_000_000_000, receipts: [], proofs: [] };
}
function basket(count: 3 | 4 = 3) {
  const { args } = lifecycleBasketArgs(creator.publicKey, 7n, count), pda = deriveCreateBasketPdas(creator.publicKey.toBase58(), args, lifecycleRouting());
  const keys: BasketCoreKeys = { basket: pda.basket, factory: pda.factory, shareMint: pda.shareMint, creator: creator.publicKey,
    treasury: new PublicKey(policy.treasury!), user: investor.publicKey, constituents: args.constituents };
  return { args, pda, keys };
}
function before(): LifecycleSnapshot {
  return { slot: 100, supply: 1_000_000_000n, creator: 1_000_000n, investor: 998_000_000n, treasury: 1_000_000n,
    vaults: [4_000_000n, 3_200_000n, 2_800_000n], investorAssets: [100_000_000_000n, 100_000_000_000n, 100_000_000_000n],
    creatorAssets: [20_000_000n, 20_000_000n, 20_000_000n], underlyingSupplies: [500_000_000_000n, 600_000_000_000n, 700_000_000_000n],
    lastAccrual: 1000n, remainder: 123n, immutableHash: "b".repeat(64), underlyingConfigHashes: ["mint-a", "mint-b", "mint-c"], accountHashes: {} };
}
function after(stage: "mint" | "management" | "redeem", input?: bigint[] | bigint): LifecycleSnapshot {
  const pre = before(), next = structuredClone(pre); next.slot++; next.lastAccrual += 31n;
  const management = managementFeeWithRemainder(pre.supply, 200, 31n, pre.remainder), split = splitFeeBigInt(management.fee);
  next.supply += management.fee; next.creator += split.creator; next.treasury += split.treasury; next.remainder = management.remainder;
  if (stage === "mint") {
    assert(Array.isArray(input)); const gross = checkGrossShares(input, pre.vaults, next.supply); assert(gross.ok);
    const fee = entryFeeOf(gross.gross, 100), feeSplit = splitFeeBigInt(fee);
    next.supply += gross.gross; next.investor += gross.gross - fee; next.creator += feeSplit.creator; next.treasury += feeSplit.treasury;
    next.vaults = pre.vaults.map((value, i) => value + input[i]); next.investorAssets = pre.investorAssets.map((value, i) => value - input[i]);
  } else if (stage === "redeem") {
    assert(typeof input === "bigint"); const redeem = computeRedeemPreview(pre.vaults, next.supply, input, 50); assert(redeem);
    const feeSplit = splitFeeBigInt(redeem.exitFee); next.supply -= redeem.burn; next.investor -= input; next.creator += feeSplit.creator; next.treasury += feeSplit.treasury;
    next.vaults = pre.vaults.map((value, i) => value - redeem.outs[i]); next.investorAssets = pre.investorAssets.map((value, i) => value + redeem.outs[i]);
  }
  return next;
}
function sendHarness() {
  const record = journal(), events: string[] = [], receipts: LifecycleJournal[] = [];
  const { keys } = basket();
  const instructions = buildMintInKind({ keys, amounts: [4n, 3n, 2n], vaultBalances: [4n, 3n, 2n] }, lifecycleRouting()).instructions;
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: investor.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message());
  let sends = 0, fee: number | null = 15000, balance = 60_000_000, genesis = DEVNET_GENESIS_HASH, simulationError: unknown = null, sendError = false, statusError = false, pending = false;
  const rpc = {
    getGenesisHash: async () => genesis,
    getFeeForMessage: async () => ({ context: { slot: 100 }, value: fee }),
    getBalance: async () => balance,
    simulateTransaction: async (_tx: VersionedTransaction, config: any) => { events.push("simulate"); assert.equal(config.sigVerify, true); assert.equal(config.replaceRecentBlockhash, false); return { context: { slot: 100 }, value: { err: simulationError } }; },
    sendRawTransaction: async (bytes: Uint8Array, config: any) => {
      events.push("send"); sends++; assert.equal(config.maxRetries, 0); assert.equal(config.preflightCommitment, "finalized");
      assert.equal(receipts.at(-1)?.receipts[0].status, "prepared");
      assert.equal(receipts.at(-1)?.receipts[0].wireSha256, createHash("sha256").update(bytes).digest("hex"));
      if (sendError) throw new Error("Ambiguous transport"); return record.receipts[0].signature;
    },
    getSignatureStatuses: async () => ({ context: { slot: 99999 }, value: pending ? [null] : [{ slot: 101, confirmations: null, confirmationStatus: "finalized", err: statusError ? { InstructionError: [0, "test"] } : null }] }),
  } as unknown as SendRpc;
  const store = { async write(value: LifecycleJournal) { events.push(`persist-${value.receipts.at(-1)?.status}`); receipts.push(structuredClone(value)); } };
  const execute = (overrides: Record<string, unknown> = {}) => submitLifecycleOnce({ rpc, store, journal: record, label: "mint-3", actor: "investor", signer: investor,
    transaction, lifetime: { blockhash, lastValidBlockHeight: 200 }, slot: 100, beforeSend: async () => { events.push("recheck"); }, ...overrides });
  return { record, rpc, store, events, receipts, execute, transaction, get sends() { return sends; },
    set fee(value: number | null) { fee = value; }, set balance(value: number) { balance = value; }, set genesis(value: string) { genesis = value; },
    set simulationError(value: unknown) { simulationError = value; }, set sendError(value: boolean) { sendError = value; },
    set statusError(value: boolean) { statusError = value; }, set pending(value: boolean) { pending = value; } };
}

test("default plan is offline, fixed-policy and does not activate production routing", async () => {
  const plan = lifecyclePlan("a".repeat(40)); assert.equal(plan.chainWrites, false); assert.equal(plan.publicCreationEnabled, false);
  assert.equal(plan.namespace.id, "devnet-owner-v1"); assert.equal(plan.namespace.creation.treasury, policy.owner);
  assert.throws(() => APP_NAMESPACE_ROUTING.creation(), /blocked/); assert.throws(() => lifecyclePlan("main"), /committed/);
  const originalFetch = globalThis.fetch, originalLog = console.log; globalThis.fetch = async () => { throw new Error("Offline mode touched RPC"); }; console.log = () => {};
  try { assert.equal((await main([]) as any).mode, "offline-owner-lifecycle-plan"); } finally { globalThis.fetch = originalFetch; console.log = originalLog; }
  assert.throws(() => APP_NAMESPACE_ROUTING.creation(), /blocked/);
});

test("owner guards reject empty steps without genuine authority, factory and four admissions", () => {
  const complete = { contextSlot: 100, loaderAuthority: "owner", whitelist: "owner", factoryInitialized: true,
    admitted: DEVNET_MOCK_TOKENS.map(token => token.symbol), steps: [], ownerBalanceLamports: 1 } as const;
  assert.doesNotThrow(() => assertCompleteOwnerSetup(complete as any));
  for (const override of [{ loaderAuthority: "bootstrap" }, { whitelist: "waiting-proposal" }, { factoryInitialized: false }, { admitted: ["BSTESTA"] },
    { admitted: ["BSTESTA", "BSTESTA", "BSTESTC", "BSTESTD"] }, { steps: ["init-factory"] }, { contextSlot: 0 }]) assert.throws(() => assertCompleteOwnerSetup({ ...complete, ...override } as any), /Genuine owner/);
});

test("actors reject owner/bootstrap aliases and identical keys", () => {
  assert.doesNotThrow(() => assertFreshActors(creator.publicKey, investor.publicKey));
  assert.throws(() => assertFreshActors(creator.publicKey, creator.publicKey));
  assert.throws(() => assertFreshActors(new PublicKey(policy.owner), investor.publicKey));
  assert.throws(() => assertFreshActors(creator.publicKey, new PublicKey(policy.bootstrapAuthority)));
});

test("three/four token metadata hashes, seeds, routing, mint/redeem identities are exact", () => {
  for (const count of [3, 4] as const) {
    const { args, metadata } = lifecycleBasketArgs(creator.publicKey, 7n, count), { pda, keys } = basket(count), routing = lifecycleRouting();
    assert.equal(Buffer.from(args.metadataHash).toString("hex"), createHash("sha256").update(metadata).digest("hex"));
    assert.equal(JSON.parse(metadata).testTokens, true); assert.equal(args.weightsBps.reduce((sum, value) => sum + value), 10000);
    assert.deepEqual(args.seedAmounts, args.weightsBps.map(value => BigInt(value) * 1000n));
    assert.equal(buildCreateBasketInstruction(creator.publicKey.toBase58(), args, routing).programId.toBase58(), policy.programIds.basket_factory);
    const mint = buildMintInKind({ keys, amounts: args.seedAmounts as bigint[], vaultBalances: args.seedAmounts as bigint[] }, routing).instructions[0];
    const redeem = buildRedeemInKind({ keys, sharesToBurn: 1n, vaultBalances: args.seedAmounts as bigint[] }, routing).instructions[0];
    assert.equal(mint.programId.toBase58(), policy.programIds.basket); assert.equal(redeem.programId.toBase58(), policy.programIds.basket);
    for (const admitted of pda.whitelistedMints) { assert(mint.keys.some(meta => meta.pubkey.equals(admitted))); assert(!redeem.keys.some(meta => meta.pubkey.equals(admitted))); }
    if (count === 4) { assert.equal(deriveCreateBasketAltAddresses(creator.publicKey.toBase58(), args, routing).length, 28); assert.equal(deriveMintRedeemAltAddresses(keys, routing).length, 29); }
  }
  assert.throws(() => lifecycleBasketArgs(creator.publicKey, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 3), /safe integer/);
});

test("raw mint uses post-accrual supply and preserves exact remainder, fees and underlying", () => {
  const pre = before(), next = after("mint", pre.vaults); const result = assertLifecycleTransition("mint", pre, next, pre.vaults);
  assert.equal(result.managementFee, 19n); assert.equal(result.actionFee, 10_000_000n);
  assert.equal(next.supply, 2_000_000_038n);
  assert.notEqual(next.remainder, 0n);
});

test("raw redeem floors after auto-accrual and transfers exit fees without minting supply", () => {
  const pre = before(), next = after("redeem", 100_000_000n), result = assertLifecycleTransition("redeem", pre, next, 100_000_000n);
  assert.equal(result.managementFee, 19n); assert.equal(result.actionFee, 500_000n);
  assert.equal(next.supply, 900_500_019n); assert.equal(pre.vaults[0] - next.vaults[0], 397_999n);
});

test("management proof requires observable streaming and leaves raw vaults unchanged", () => {
  assert.equal(assertLifecycleTransition("management", before(), after("management")).managementFee, 19n);
  const next = after("management"); next.vaults[0]++;
  assert.throws(() => assertLifecycleTransition("management", before(), next), /Vault raw/);
});

for (const field of ["remainder", "supply", "creator", "treasury", "vaults", "underlyingSupplies", "underlyingConfigHashes", "immutableHash", "slot"] as const) {
  test(`transition rejects corrupted ${field} evidence`, () => {
    const next = after("redeem", 100_000_000n);
    if (field === "underlyingConfigHashes") next[field][0] = "changed";
    else if (field === "immutableHash") next[field] = "changed";
    else if (field === "slot") next[field] = 1;
    else if (field === "vaults" || field === "underlyingSupplies") next[field][0]++;
    else next[field]++;
    assert.throws(() => assertLifecycleTransition("redeem", before(), next, 100_000_000n));
  });
}

test("fresh exact rent quotes fit ceilings and excessive/invalid quotes fail closed", async () => {
  const quotes: Array<[number, string]> = [];
  const budget = await quoteLifecycleBudget({ getMinimumBalanceForRentExemption: async (size: number, commitment?: any) => { quotes.push([size, commitment]); return 6960 * (size + 128); } } as any, [482, 482, 482, 482]);
  assert(budget.creator < LIFECYCLE_LIMITS.creator); assert(budget.investor < LIFECYCLE_LIMITS.investor); assert(quotes.every(([, commitment]) => commitment === "finalized"));
  await assert.rejects(quoteLifecycleBudget({ getMinimumBalanceForRentExemption: async () => 100_000_000 } as any, [482, 482, 482, 482]), /do not fit/);
  await assert.rejects(quoteLifecycleBudget({ getMinimumBalanceForRentExemption: async () => NaN } as any, [482, 482, 482, 482]), /rent quote/);
  await assert.rejects(quoteLifecycleBudget({} as any, [165]), /account sizes/);
  const record = journal(); record.allocated.investor = LIFECYCLE_LIMITS.investor;
  assert.throws(() => assertBudget(record, "investor", 1, 1_000_000_000), /ceiling/);
  assert.throws(() => assertBudget(journal(), "bootstrap", 150_000_000, 200_000_000), /reserve/);
});

test("simulation and owner recheck precede durable prepared receipt, then exactly one send", async () => {
  const h = sendHarness(); const receipt = await h.execute({ lifetime: { blockhash, lastValidBlockHeight: 200, transaction: h.transaction } });
  assert.equal(h.sends, 1); assert.equal(receipt.status, "finalized"); assert.equal(receipt.finalizedSlot, 101);
  assert.deepEqual(h.events, ["simulate", "recheck", "persist-prepared", "send", "persist-finalized"]);
  assert.equal(Object.hasOwn(receipt, "transaction"), false); assert.equal(receipt.preSlot, 100);
  assert.doesNotThrow(() => assertPublicLifecycleJournal(h.record));
  await assert.rejects(h.execute(), /never replay/); assert.equal(h.sends, 1);
});

test("persistence failure prevents broadcasting even after successful signed simulation", async () => {
  const h = sendHarness(); await assert.rejects(h.execute({ store: { write: async () => { throw new Error("fsync failure"); } } }), /fsync failure/);
  assert.equal(h.sends, 0); assert.equal(h.record.receipts[0].status, "prepared");
});

test("ambiguous transport and confirmed execution error retain original receipt and refuse replay", async () => {
  for (const kind of ["transport", "execution"] as const) {
    const h = sendHarness(); if (kind === "transport") h.sendError = true; else h.statusError = true;
    await assert.rejects(h.execute()); assert.equal(h.sends, 1); assert.equal(h.receipts.at(-1)?.receipts[0].status, "prepared");
    const signature = h.record.receipts[0].signature; await assert.rejects(h.execute(), /never replay/);
    assert.equal(h.record.receipts[0].signature, signature); assert.equal(h.sends, 1);
  }
});

test("confirmation timeout records no new signature or send", async () => {
  const h = sendHarness(); h.pending = true; let time = 0;
  await assert.rejects(h.execute({ now: () => time, sleep: async () => { time += 15000; } }), /ambiguous/);
  assert.equal(h.sends, 1); assert.equal(h.record.receipts.length, 1); assert.equal(h.record.receipts[0].status, "prepared");
});

for (const kind of ["network", "signer", "fee-null", "fee-high", "balance", "simulation", "lifetime", "recheck"] as const) {
  test(`rejects ${kind} before any send or durable economic receipt`, async () => {
    const h = sendHarness(); let override = {};
    if (kind === "network") h.genesis = "mainnet";
    if (kind === "signer") override = { signer: creator };
    if (kind === "fee-null") h.fee = null;
    if (kind === "fee-high") h.fee = LIFECYCLE_LIMITS.maxFee + 1;
    if (kind === "balance") h.balance = 1;
    if (kind === "simulation") h.simulationError = { InstructionError: [0, "bad"] };
    if (kind === "lifetime") override = { lifetime: { blockhash: creator.publicKey.toBase58(), lastValidBlockHeight: 200 } };
    if (kind === "recheck") override = { beforeSend: async () => { throw new Error("Owner setup changed"); } };
    await assert.rejects(h.execute(override)); assert.equal(h.sends, 0); assert.equal(h.record.receipts.length, 0);
  });
}

test("fresh private run is durable, outside Git, owner-only, and cannot be reused or export secrets", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "basalt-proof-test-"))), directory = join(parent, "basalt-devnet-lifecycle-offlinetest");
  try {
    const run = await createLifecycleRun(directory); assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    for (const file of ["creator.json", "investor.json"]) assert.equal((await lstat(join(directory, file))).mode & 0o777, 0o600);
    const record = journal(); record.creator = run.creator.publicKey.toBase58(); record.investor = run.investor.publicKey.toBase58();
    await run.store.write(record); const saved = JSON.parse(await readFile(join(directory, "lifecycle-receipt.json"), "utf8"));
    assert.equal(saved.creator, run.creator.publicKey.toBase58()); assert(!Object.hasOwn(saved, "secretKey"));
    assert(!(await readdir(directory)).some(file => file.endsWith(".tmp")));
    await assert.rejects(createLifecycleRun(directory), /EEXIST/);
    assert.throws(() => assertPublicLifecycleJournal({ ...record, secretKey: [1, 2, 3] } as any), /public lifecycle journal schema/);
    assert.throws(() => assertPublicLifecycleJournal({ ...record, proofs: [{ signer: run.creator }] }), /private signer/);
    assert.throws(() => assertPublicLifecycleJournal({ ...record, proofs: [{ binary: new Uint8Array([1]) }] }), /private binary/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});


test("faucet evidence accepts exact two claims followed by zero remaining balance, without weakening readiness", () => {
  const info = (data: Buffer, owner: PublicKey, executable = false): AccountInfo<Buffer> => ({ data, owner, executable, lamports: 1_000_000, rentEpoch: 0 });
  const tlv = (type: number, bytes: Buffer) => { const header = Buffer.alloc(4); header.writeUInt16LE(type); header.writeUInt16LE(bytes.length, 2); return Buffer.concat([header, bytes]); };
  const pointer = Buffer.alloc(36); pointer.writeUInt32LE(2); programData(DEVNET_FAUCET_PROGRAM_ID).toBuffer().copy(pointer, 4);
  const accounts: AccountInfo<Buffer>[] = [info(pointer, LOADER, true)];
  for (const token of DEVNET_MOCK_TOKENS) {
    const authority = creator.publicKey, base = Buffer.alloc(166); base.writeUInt32LE(1); authority.toBuffer().copy(base, 4);
    base.writeBigUInt64LE(1_000_000_000_000n, 36); base[44] = 8; base[45] = 1; base.writeUInt32LE(1, 46); authority.toBuffer().copy(base, 50); base[165] = 1;
    const scale = Buffer.alloc(56); authority.toBuffer().copy(scale); scale.writeDoubleLE(token.multiplier, 32); scale.writeDoubleLE(token.multiplier, 48);
    const confidential = Buffer.alloc(65); authority.toBuffer().copy(confidential);
    const mint = Buffer.concat([base, tlv(18, Buffer.concat([authority.toBuffer(), token.mint.toBuffer()])), tlv(12, authority.toBuffer()), tlv(6, Buffer.from([1])),
      tlv(25, scale), tlv(26, Buffer.concat([authority.toBuffer(), Buffer.from([0])])), tlv(4, confidential), tlv(14, Buffer.concat([authority.toBuffer(), Buffer.alloc(32)])),
      tlv(19, Buffer.from(pack(fixtureMetadata(token.mint, authority, token.letter))))]);
    const vault = Buffer.alloc(165); token.mint.toBuffer().copy(vault); deriveDevnetFaucetAuthority().toBuffer().copy(vault, 32); vault.writeBigUInt64LE(DEVNET_FAUCET_CLAIM_RAW * 2n, 64); vault[108] = 1;
    accounts.push(info(mint, TOKEN_2022_PROGRAM_ID), info(vault, TOKEN_2022_PROGRAM_ID));
  }
  assert.doesNotThrow(() => verifyLifecycleFaucet(accounts, 2n * DEVNET_FAUCET_CLAIM_RAW));
  for (let claims = 1; claims <= 2; claims++) {
    DEVNET_MOCK_TOKENS.forEach((_, index) => accounts[2 + index * 2].data.writeBigUInt64LE(DEVNET_FAUCET_CLAIM_RAW * BigInt(2 - claims), 64));
    assert.doesNotThrow(() => verifyLifecycleFaucet(accounts));
  }
  assert.throws(() => verifyLifecycleFaucet(accounts, DEVNET_FAUCET_CLAIM_RAW), /readiness/);
  creator.publicKey.toBuffer().copy(accounts[2].data, 32);
  assert.throws(() => verifyLifecycleFaucet(accounts), /identity/);
});


test("all six exact three/four-token signed packet shapes fit with their reviewed lookup coverage", () => {
  const sizes: Record<string, number> = {};
  for (const count of [3, 4] as const) {
    const { args, keys } = basket(count), routing = lifecycleRouting();
    const createAddresses = deriveCreateBasketAltAddresses(creator.publicKey.toBase58(), args, routing), tradeAddresses = deriveMintRedeemAltAddresses(keys, routing);
    for (const kind of ["create", "mint", "redeem"] as const) {
      const signer = kind === "create" ? creator : investor;
      const instructions = kind === "create" ? [buildCreateBasketInstruction(creator.publicKey.toBase58(), args, routing)] : kind === "mint" ?
        buildMintInKind({ keys, amounts: args.seedAmounts as bigint[], vaultBalances: args.seedAmounts as bigint[] }, routing).instructions :
        buildRedeemInKind({ keys, sharesToBurn: 500000n, vaultBalances: args.seedAmounts as bigint[] }, routing).instructions;
      const table = new AddressLookupTableAccount({ key: new PublicKey(blockhash), state: { deactivationSlot: (1n << 64n) - 1n, lastExtendedSlot: 99,
        lastExtendedSlotStartIndex: 0, authority: signer.publicKey, addresses: kind === "create" ? createAddresses : tradeAddresses } });
      const message = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions: [...computeBudgetInstructions(), ...instructions] }).compileToV0Message(count === 4 ? [table] : []);
      const transaction = new VersionedTransaction(message); transaction.sign([signer]);
      const bytes = transaction.serialize(); sizes[`${kind}-${count}`] = bytes.length;
      assert.equal(bytes[0], 1); assert.equal(bytes.length, message.serialize().length + 65);
      assert(bytes.length <= 1232); assert.equal(message.addressTableLookups.length, count === 4 ? 1 : 0);
    }
  }
  assert.deepEqual(sizes, { "create-3": 1110, "mint-3": 1047, "redeem-3": 928, "create-4": 543, "mint-4": 392, "redeem-4": 356 });
});
