/** Independent raw-accounting proof for project-issued devnet fixtures. Default: no RPC or signer access. */
import { assertNotRetiredPublicKey } from "./security/retired-keys.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { PublicKey, SystemProgram, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { AccountState, getMint, getScaledUiAmountConfig, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  BASKET_PROGRAM_ID, FACTORY_PROGRAM_ID, WHITELIST_PROGRAM_ID, accountDiscriminator,
  deriveFactoryConfig, deriveWhitelistConfig, decodeWhitelistAuthority, deriveWhitelistedMint,
  deriveBasketPda, deriveShareMint, deriveVaultAuthority, deriveAta, createAtaIdempotent,
  transferChecked, ixCreateBasket, ixMintInKind, ixRedeemInKind, ixAccrueManagementFee,
  ixSetMintPaused, readClockTimestamp, getOrCreateAlt, loadLookupTables, toVersionedTx,
  serializedTxSize, PACKET_LIMIT, type BasketCore,
} from "./lib.ts";
import { splitFeeBigInt, managementFeeWithRemainder } from "../backend/src/workers/feeMath.ts";
import { DEVNET_GENESIS, FIXTURE_PROFILE, assertFixtureMint, fixtureMutations } from "./xstocks-devnet/profile.ts";
import { createDevnetConnection, getRunDir, loadSigner, loadOrCreateRunKeypair, loadFixtureState } from "./xstocks-devnet/runtime.ts";

const RPC = "https://api.devnet.solana.com";
const FEES = { entry: 100, exit: 50, management: 200 };
const GENESIS = 1_000_000n;
const MIN_RESERVE = 200_000_000;
const MAX_SPEND = 200_000_000;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const json = (value: unknown) => JSON.stringify(value, (_, entry) => typeof entry === "bigint" ? entry.toString() : entry, 2);

type ConfirmationValue = { err: unknown | null };
type SignatureEvidence = ConfirmationValue & { confirmationStatus?: "processed" | "confirmed" | "finalized" };
/**
 * web3 can reject confirmTransaction with a plain InstructionError when its HTTP
 * status check wins the websocket race. Resolve only the same submitted signature,
 * never resend. An expected rejection needs confirmed/finalized status and the exact
 * error already observed in simulation; processed or missing status is ambiguous.
 */
export async function confirmSubmittedTransaction(
  signature: string,
  expectedError: unknown | null,
  confirm: () => Promise<{ value: ConfirmationValue }>,
  readStatus: (signature: string) => Promise<SignatureEvidence | null>,
): Promise<void> {
  let confirmation: { value: ConfirmationValue };
  try { confirmation = await confirm(); }
  catch (confirmationError) {
    if (expectedError === null) throw confirmationError;
    let status: SignatureEvidence | null;
    try { status = await readStatus(signature); }
    catch { throw new Error(`Ambiguous confirmation for ${signature}: status lookup failed; no resend`); }
    if (!status || (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized")) {
      throw new Error(`Ambiguous confirmation for ${signature}: no confirmed status; no resend`);
    }
    assert(status.err !== null, `${signature}: expected rejection unexpectedly succeeded`);
    assert.deepEqual(status.err, expectedError, `${signature}: confirmed failure differs from expected simulation error`);
    return;
  }
  if (expectedError === null) assert.equal(confirmation.value.err, null, `${signature}: confirmed transaction failed`);
  else {
    assert(confirmation.value.err !== null, `${signature}: expected rejection unexpectedly succeeded`);
    assert.deepEqual(confirmation.value.err, expectedError, `${signature}: confirmed failure differs from expected simulation error`);
  }
}
/** Print only the SDK's public instruction index/code, never arbitrary thrown objects. */
export function safeProofError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "InstructionError" in error) {
    const instruction = (error as { InstructionError: unknown }).InstructionError;
    if (Array.isArray(instruction) && instruction.length === 2 && Number.isSafeInteger(instruction[0]) && instruction[0] >= 0) {
      const detail = instruction[1];
      if (typeof detail === "string" && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(detail)) return `Basket proof failed: ${JSON.stringify({ InstructionError: [instruction[0], detail] })}`;
      if (detail && typeof detail === "object" && Number.isSafeInteger(detail.Custom) && detail.Custom >= 0) return `Basket proof failed: ${JSON.stringify({ InstructionError: [instruction[0], { Custom: detail.Custom }] })}`;
    }
  }
  return "Basket proof failed with an unrecognized error";
}

type Snapshot = { supply: bigint; creator: bigint; investor: bigint; treasury: bigint; vaults: bigint[]; userAssets: bigint[]; lastAccrual: bigint; remainder: bigint };
export function decodeFeeCheckpoint(data: Buffer): { lastAccrual: bigint; remainder: bigint } {
  assert(data.length >= 886 && data.subarray(0, 8).equals(accountDiscriminator("Basket")), "Invalid Basket layout");
  let remainder = 0n;
  for (let i = 0; i < 5; i++) remainder |= BigInt(data[881 + i]) << BigInt(i * 8);
  return { lastAccrual: data.readBigInt64LE(152), remainder };
}
export function expectedMint(supply: bigint, vaults: bigint[], deposits: bigint[]) {
  assert(vaults.length > 0 && vaults.length === deposits.length && supply > 0n);
  const gross = vaults.map((value, index) => { assert(value > 0n && deposits[index] > 0n); return deposits[index] * supply / value; });
  const min = gross.reduce((a, b) => a < b ? a : b), max = gross.reduce((a, b) => a > b ? a : b);
  assert(min > 0n && (max - min) * 100n <= min, "Off-weight deposit");
  const fee = min * BigInt(FEES.entry) / 10_000n;
  return { gross: min, net: min - fee, fee, ...splitFeeBigInt(fee) };
}
export function expectedRedeem(shares: bigint, supply: bigint, vaults: bigint[]) {
  assert(shares > 0n && supply >= shares);
  const fee = shares * BigInt(FEES.exit) / 10_000n, burn = shares - fee;
  return { fee, burn, outputs: vaults.map(amount => amount * burn / supply), ...splitFeeBigInt(fee) };
}
function managementDelta(before: Snapshot, after: Snapshot) {
  assert(after.lastAccrual >= before.lastAccrual, "Accrual timestamp regressed");
  const expected = managementFeeWithRemainder(before.supply, FEES.management, after.lastAccrual - before.lastAccrual, before.remainder);
  assert.equal(after.remainder, expected.remainder, "Management fee carried remainder");
  return { fee: expected.fee, ...splitFeeBigInt(expected.fee) };
}
export function assertShareSupply(snapshot: Pick<Snapshot, "supply" | "creator" | "investor" | "treasury">) {
  assert.equal(snapshot.supply, snapshot.creator + snapshot.investor + snapshot.treasury, "Share supply must equal all three holder balances");
}
export function validateFixtureSelection(state: NonNullable<Awaited<ReturnType<typeof loadFixtureState>>>) {
  assert.equal(state.profile, FIXTURE_PROFILE);
  assert.equal(state.mocks.length, 4, "Exactly four isolated fixture mints are required");
  const mocks = ["A", "B", "C", "D"].map(letter => {
    const row = state.mocks.find(item => item.letter === letter);
    assert(row && row.symbol === `BSTEST${letter}` && row.decimals === 8 && row.signatures.whitelist, `Fixture ${letter} is incomplete`);
    return { ...row, key: new PublicKey(row.mint) };
  });
  assert.equal(new Set(mocks.map(row => row.mint)).size, 4, "Fixture mint identities must be distinct");
  return mocks;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { execute: { type: "boolean", default: false }, "run-id": { type: "string" }, payer: { type: "string" } }, strict: true });
  const dir = getRunDir(values["run-id"] ?? "RUN_ID");
  const plan = { mode: values.execute ? "execute" : "plan", cluster: "devnet", expectedGenesis: DEVNET_GENESIS, stateDirectory: dir,
    fixtures: "Four project-issued eight-extension mocks, not official xStocks", baskets: [3, 4],
    checks: ["Raw atomic seed, deposits and pro-rata redemption", "Share supply and separate 90/10 entry, exit and management fees", "Four-asset v0 address lookup table", "Whitelist pause rejects new deposits while redemption succeeds", "Issuer pause, active hook and frozen default state reject deposits with full state rollback", "Issuer pause can also prevent underlying redemption", "Multiplier changes display units without changing raw custody or redemption math"],
    maximumSpendSol: MAX_SPEND / 1e9, minimumRemainingSol: MIN_RESERVE / 1e9,
    note: "Without --execute: no RPC requests, key reads, file writes or transactions. No program deployment in either mode." };
  console.log(json(plan));
  if (!values.execute) return plan;
  assert(values["run-id"] && values.payer, "Execution requires both --run-id and --payer <existing keypair file>");
  const state = await loadFixtureState(dir); assert(state, "Run setupXStockDevnet first");
  const mocks = validateFixtureSelection(state);
  const conn = createDevnetConnection();
  try {
  assert.equal(await conn.getGenesisHash(), DEVNET_GENESIS, "Refusing a non-devnet cluster");
  const payer = await loadSigner(resolve(values.payer), new PublicKey(state.payer));
  const originalBalance = await conn.getBalance(payer.publicKey, "confirmed");
  assert(originalBalance >= MIN_RESERVE + MAX_SPEND, "Insufficient devnet SOL for bounded tests and reserve");
  for (const id of [WHITELIST_PROGRAM_ID, FACTORY_PROGRAM_ID, BASKET_PROGRAM_ID]) assert((await conn.getAccountInfo(id))?.executable, `Program unavailable: ${id}`);
  const whitelist = await conn.getAccountInfo(deriveWhitelistConfig());
  assert(whitelist?.owner.equals(WHITELIST_PROGRAM_ID) && decodeWhitelistAuthority(whitelist.data).equals(payer.publicKey), "Unexpected whitelist authority");
  const factory = await conn.getAccountInfo(deriveFactoryConfig());
  assert(factory?.owner.equals(FACTORY_PROGRAM_ID) && factory.data.subarray(0, 8).equals(accountDiscriminator("FactoryConfig")), "Existing factory required");
  const treasury = new PublicKey(factory.data.subarray(40, 72));
  assertNotRetiredPublicKey(treasury, "factory treasury for new devnet baskets");
  assert.equal(factory.data.readUInt16LE(72), 9000, "Factory must use 90/10 fee split");
  for (const row of mocks) {
    assertFixtureMint(await getMint(conn, row.key, "confirmed", TOKEN_2022_PROGRAM_ID), payer.publicKey);
    const entry = await conn.getAccountInfo(deriveWhitelistedMint(row.key));
    assert(entry?.owner.equals(WHITELIST_PROGRAM_ID) && entry.data.subarray(8, 40).equals(row.key.toBuffer()) && entry.data[49] === 0, "Mock mint whitelist must be active");
  }
  // Existing ALT helpers are confined to this fresh run. No historical .e2e state is read.
  process.env.FOLIOX_E2E_STATE_DIR = dir;
  process.env.FOLIOX_E2E_RPC_URL = RPC;
  const creator = await loadOrCreateRunKeypair(dir, "basket-creator.json");
  const investor = await loadOrCreateRunKeypair(dir, "basket-investor.json");
  assert.equal(new Set([creator.publicKey, investor.publicKey, treasury].map(key => key.toBase58())).size, 3, "Fee wallets must be distinct");
  const report: { startedAt: string; profile: string; transactions: unknown[]; proofs: unknown[]; complete?: boolean } = { startedAt: new Date().toISOString(), profile: FIXTURE_PROFILE, transactions: [], proofs: [] };
  const persist = () => writeFile(join(dir, "basket-proof.json"), json(report), { mode: 0o600 });
  async function spendingGuard() {
    const balance = await conn.getBalance(payer.publicKey, "confirmed");
    assert(balance >= MIN_RESERVE && originalBalance - balance <= MAX_SPEND, "Devnet test spending bound reached");
  }
  async function transaction(label: string, instructions: TransactionInstruction[], signers: Keypair[] = [payer], rejected?: RegExp) {
    await spendingGuard();
    const signerSet = new Set(signers.map(key => key.publicKey.toBase58()));
    const keys = instructions.flatMap(ix => [ix.programId, ...ix.keys.filter(meta => !signerSet.has(meta.pubkey.toBase58())).map(meta => meta.pubkey)]);
    // One run-scoped ALT amortizes rent and keeps larger baskets below packet size.
    const alt = await getOrCreateAlt(conn, payer, "xstocks-basket-proof", keys);
    await spendingGuard();
    const tables = await loadLookupTables(conn, [alt.address]);
    const latest = await conn.getLatestBlockhash("confirmed");
    const tx = toVersionedTx(instructions, tables, payer.publicKey, latest.blockhash, { computeUnitLimit: 700_000 });
    assert(serializedTxSize(tx) <= PACKET_LIMIT, "Transaction exceeds Solana packet size");
    tx.sign(signers);
    const simulation = await conn.simulateTransaction(tx, { commitment: "confirmed", sigVerify: true });
    if (rejected) {
      assert(simulation.value.err, `${label}: expected simulation rejection`);
      assert(rejected.test((simulation.value.logs ?? []).join("\n")), `${label}: wrong simulation failure: ${(simulation.value.logs ?? []).join("\n")}`);
    } else assert.equal(simulation.value.err, null, `${label}: simulation failed: ${(simulation.value.logs ?? []).join("\n")}`);
    // One send only. Ambiguous confirmation stops the run rather than duplicating an economic action.
    const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: !!rejected, maxRetries: 3 });
    const transactionRecord = { label, signature, wire: "v0", alt: alt.address.toBase58(), bytes: tx.serialize().length, expectedRejection: !!rejected, stage: "submitted", submittedAt: new Date().toISOString() };
    report.transactions.push(transactionRecord);
    await persist(); // Preserve the submitted ID even when confirmation is ambiguous.
    await confirmSubmittedTransaction(signature, rejected ? simulation.value.err : null,
      () => conn.confirmTransaction({ signature, ...latest }, "confirmed"),
      async submittedSignature => (await conn.getSignatureStatuses([submittedSignature], { searchTransactionHistory: true })).value[0]);
    transactionRecord.stage = rejected ? "confirmed-failure" : "confirmed-success";
    await persist();
    let landed = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    for (let attempt = 0; !landed && attempt < 4; attempt++) { await sleep(750); landed = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }); }
    assert(landed?.meta, `${label}: confirmed transaction metadata unavailable`);
    if (rejected) { assert(landed.meta.err); assert(rejected.test((landed.meta.logMessages ?? []).join("\n")), `${label}: unexpected onchain error`); }
    else assert.equal(landed.meta.err, null);
    Object.assign(transactionRecord, { stage: rejected ? "validated-rejection" : "validated-success", slot: landed.slot, computeUnits: landed.meta.computeUnitsConsumed });
    await persist(); console.log(json({ label, signature, result: rejected ? "expected rejection" : "confirmed" }));
    return signature;
  }
  async function accountFingerprint(keys: PublicKey[]) {
    const unique = [...new Map(keys.map(key => [key.toBase58(), key])).values()];
    const infos = await conn.getMultipleAccountsInfo(unique, "confirmed");
    return infos.map((info, index) => ({ key: unique[index].toBase58(), owner: info?.owner.toBase58() ?? null, data: info?.data.toString("base64") ?? null }));
  }
  async function rejectAtomic(label: string, instruction: TransactionInstruction, signers: Keypair[], expected: RegExp) {
    const financialAccounts = instruction.keys.filter(meta => meta.isWritable && !meta.isSigner).map(meta => meta.pubkey);
    const before = await accountFingerprint(financialAccounts);
    await transaction(label, [instruction], signers, expected);
    assert.deepEqual(await accountFingerprint(financialAccounts), before, `${label}: failed instruction changed financial account data`);
    report.proofs.push({ label, assertion: "Confirmed failure preserved every writable non-signer account byte" }); await persist();
  }
  // Fund isolated actors only with explicitly labelled fixture assets.
  for (const [name, actor, sol] of [["creator", creator, 60_000_000], ["investor", investor, 30_000_000]] as const) {
    const existing = await conn.getBalance(actor.publicKey);
    if (existing < sol) await transaction(`fund-${name}`, [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: actor.publicKey, lamports: sol - existing })]);
    for (const row of mocks) {
      const ata = deriveAta(actor.publicKey, row.key), info = await conn.getAccountInfo(ata);
      const target = name === "creator" ? 10_000_000_000n : 1_000_000_000_000n;
      const current = info ? info.data.readBigUInt64LE(64) : 0n;
      if (current < target) await transaction(`fund-${name}-${row.letter}`, [createAtaIdempotent(payer.publicKey, actor.publicKey, row.key), transferChecked(deriveAta(payer.publicKey, row.key), row.key, ata, payer.publicKey, target - current, 8)]);
    }
  }
  for (const count of [3, 4] as const) {
    const selected = mocks.slice(0, count), constituents = selected.map(row => row.key);
    const weights = count === 3 ? [4000, 3200, 2800] : [3000, 2700, 2300, 2000];
    const seeds = weights.map(weight => BigInt(weight) * 100_000n);
    const latestFactory = await conn.getAccountInfo(deriveFactoryConfig()); assert(latestFactory);
    const nonce = latestFactory.data.readBigUInt64LE(80);
    const basket = deriveBasketPda(deriveFactoryConfig(), creator.publicKey, nonce), shareMint = deriveShareMint(basket);
    assert.equal(await conn.getAccountInfo(basket), null, "Fresh basket expected; use a new run after a partial proof");
    const core: BasketCore = { basket, shareMint, creator: creator.publicKey, treasury, user: investor.publicKey, constituents };
    async function snapshot(): Promise<Snapshot> {
      const keys = [shareMint, deriveAta(creator.publicKey, shareMint), deriveAta(investor.publicKey, shareMint), deriveAta(treasury, shareMint), ...constituents.map(mint => deriveAta(deriveVaultAuthority(basket), mint)), ...constituents.map(mint => deriveAta(investor.publicKey, mint)), basket];
      const accounts = await conn.getMultipleAccountsInfo(keys, "confirmed");
      assert(accounts[0]?.owner.equals(TOKEN_2022_PROGRAM_ID) && accounts.at(-1)?.owner.equals(BASKET_PROGRAM_ID));
      const tokenAmount = (index: number) => { const info = accounts[index]; if (!info) return 0n; assert(info.owner.equals(TOKEN_2022_PROGRAM_ID)); return info.data.readBigUInt64LE(64); };
      const data: Snapshot = { supply: accounts[0]!.data.readBigUInt64LE(36), creator: tokenAmount(1), investor: tokenAmount(2), treasury: tokenAmount(3), vaults: constituents.map((_, index) => tokenAmount(4 + index)), userAssets: constituents.map((_, index) => tokenAmount(4 + count + index)), ...decodeFeeCheckpoint(accounts.at(-1)!.data) };
      assertShareSupply(data); return data;
    }
    const seedKeys = constituents.map(mint => deriveAta(creator.publicKey, mint));
    const seedBefore = await conn.getMultipleAccountsInfo(seedKeys);
    const createArgs = { creator: creator.publicKey, nonce, constituents, weightsBps: weights, entryFeeBps: FEES.entry, exitFeeBps: FEES.exit, managementFeeBps: FEES.management, metadataHash: createHash("sha256").update(`Basalt isolated mock proof ${count} ${values["run-id"]}`).digest(), seedAmounts: seeds, basket, shareMint };
    await transaction(`create-${count}`, [ixCreateBasket(createArgs)], [payer, creator]);
    let current = await snapshot();
    assert.equal(current.supply, GENESIS); assert.equal(current.creator, GENESIS); assert.equal(current.investor + current.treasury, 0n); assert.deepEqual(current.vaults, seeds);
    const seedAfter = await conn.getMultipleAccountsInfo(seedKeys);
    seeds.forEach((seed, index) => assert.equal(seedBefore[index]!.data.readBigUInt64LE(64) - seedAfter[index]!.data.readBigUInt64LE(64), seed, "Atomic raw seed debit"));
    async function deposit(label: string, amounts: bigint[]) {
      const before = await snapshot();
      await transaction(label, [ixMintInKind(core, amounts, before.vaults)], [payer, investor]);
      const after = await snapshot(), management = managementDelta(before, after), expected = expectedMint(before.supply + management.fee, before.vaults, amounts);
      assert.equal(after.supply - before.supply, management.fee + expected.gross);
      assert.equal(after.investor - before.investor, expected.net);
      assert.equal(after.creator - before.creator, management.creator + expected.creator);
      assert.equal(after.treasury - before.treasury, management.treasury + expected.treasury);
      amounts.forEach((amount, index) => { assert.equal(after.vaults[index] - before.vaults[index], amount); assert.equal(before.userAssets[index] - after.userAssets[index], amount); });
      report.proofs.push({ label, gross: expected.gross, entryFee: expected.fee, creatorFee: expected.creator, treasuryFee: expected.treasury, managementFee: management.fee }); await persist();
    }
    async function redeem(label: string, shares: bigint) {
      const before = await snapshot(), instruction = ixRedeemInKind(core, shares, before.vaults);
      for (const mint of constituents) assert(!instruction.keys.some(meta => meta.pubkey.equals(deriveWhitelistedMint(mint))), "Redeem must not request whitelist accounts");
      await transaction(label, [instruction], [payer, investor]);
      const after = await snapshot(), management = managementDelta(before, after), expected = expectedRedeem(shares, before.supply + management.fee, before.vaults);
      assert.equal(after.supply, before.supply + management.fee - expected.burn);
      assert.equal(before.investor - after.investor, shares);
      assert.equal(after.creator - before.creator, management.creator + expected.creator);
      assert.equal(after.treasury - before.treasury, management.treasury + expected.treasury);
      expected.outputs.forEach((amount, index) => { assert.equal(before.vaults[index] - after.vaults[index], amount); assert.equal(after.userAssets[index] - before.userAssets[index], amount); });
      report.proofs.push({ label, shares, exitFee: expected.fee, creatorFee: expected.creator, treasuryFee: expected.treasury, rawOutputs: expected.outputs }); await persist();
    }
    await deposit(`mint-${count}`, seeds.map(amount => amount * 1000n));
    // Observable management shares, calculated against actual onchain checkpoints and carried dust.
    current = await snapshot();
    const deadline = Date.now() + 45_000;
    while (managementFeeWithRemainder(current.supply, FEES.management, BigInt(await readClockTimestamp(conn)) - current.lastAccrual, current.remainder).fee < 10n) { assert(Date.now() < deadline, "Management accrual did not become observable"); await sleep(1500); }
    await transaction(`management-${count}`, [ixAccrueManagementFee(core, payer.publicKey)]);
    const accrued = await snapshot(), management = managementDelta(current, accrued);
    assert(management.fee >= 10n); assert.equal(accrued.supply - current.supply, management.fee); assert.equal(accrued.creator - current.creator, management.creator); assert.equal(accrued.treasury - current.treasury, management.treasury); assert.equal(accrued.investor, current.investor); assert.deepEqual(accrued.vaults, current.vaults);
    report.proofs.push({ label: `management-${count}`, ...management }); await persist();
    // Block the final leg to exercise transaction-wide rollback after earlier possible work.
    const blocked = constituents.at(-1)!;
    async function blockedCreateInstruction() {
      const config = await conn.getAccountInfo(deriveFactoryConfig()); assert(config);
      const rejectedNonce = config.data.readBigUInt64LE(80);
      const rejectedBasket = deriveBasketPda(deriveFactoryConfig(), creator.publicKey, rejectedNonce);
      assert.equal(await conn.getAccountInfo(rejectedBasket), null, "Negative create must target a fresh PDA");
      return ixCreateBasket({ ...createArgs, nonce: rejectedNonce, basket: rejectedBasket, shareMint: deriveShareMint(rejectedBasket) });
    }
    await transaction(`whitelist-pause-${count}`, [ixSetMintPaused(payer.publicKey, blocked, true)]);
    try {
      current = await snapshot();
      await rejectAtomic(`whitelist-reject-${count}`, ixMintInKind(core, current.vaults.map(amount => amount / 100n), current.vaults), [payer, investor], /MintPaused/);
      await redeem(`redeem-whitelist-paused-${count}`, current.investor / 10n);
    } finally { await transaction(`whitelist-resume-${count}`, [ixSetMintPaused(payer.publicKey, blocked, false)]); }
    await transaction(`issuer-pause-${count}`, [fixtureMutations.pause(blocked, payer.publicKey)]);
    try {
      current = await snapshot();
      await rejectAtomic(`issuer-deposit-reject-${count}`, ixMintInKind(core, current.vaults.map(amount => amount / 100n), current.vaults), [payer, investor], /UnsupportedMintExtensions/);
      await rejectAtomic(`issuer-create-reject-${count}`, await blockedCreateInstruction(), [payer, creator], /UnsupportedMintExtensions/);
      await rejectAtomic(`issuer-redeem-reject-${count}`, ixRedeemInKind(core, current.investor / 100n, current.vaults), [payer, investor], /paused/i);
    } finally { await transaction(`issuer-resume-${count}`, [fixtureMutations.resume(blocked, payer.publicKey)]); }
    await transaction(`issuer-hook-${count}`, [fixtureMutations.hook(blocked, payer.publicKey, BASKET_PROGRAM_ID)]);
    try {
      current = await snapshot();
      await rejectAtomic(`hook-deposit-reject-${count}`, ixMintInKind(core, current.vaults.map(amount => amount / 100n), current.vaults), [payer, investor], /UnsupportedMintExtensions/);
      await rejectAtomic(`hook-create-reject-${count}`, await blockedCreateInstruction(), [payer, creator], /UnsupportedMintExtensions/);
    } finally { await transaction(`issuer-unhook-${count}`, [fixtureMutations.hook(blocked, payer.publicKey, null)]); }
    await transaction(`issuer-default-frozen-${count}`, [fixtureMutations.defaultState(blocked, payer.publicKey, AccountState.Frozen)]);
    try {
      current = await snapshot();
      await rejectAtomic(`default-frozen-deposit-reject-${count}`, ixMintInKind(core, current.vaults.map(amount => amount / 100n), current.vaults), [payer, investor], /UnsupportedMintExtensions/);
      await rejectAtomic(`default-frozen-create-reject-${count}`, await blockedCreateInstruction(), [payer, creator], /UnsupportedMintExtensions/);
    } finally { await transaction(`issuer-default-restore-${count}`, [fixtureMutations.defaultState(blocked, payer.publicKey, AccountState.Initialized)]); }
    const oldScale = getScaledUiAmountConfig(await getMint(conn, blocked, "confirmed", TOKEN_2022_PROGRAM_ID)); assert(oldScale);
    const oldMultiplier = BigInt(await readClockTimestamp(conn)) >= oldScale.newMultiplierEffectiveTimestamp ? oldScale.newMultiplier : oldScale.multiplier;
    const beforeScale = await snapshot();
    await transaction(`multiplier-${count}`, [fixtureMutations.multiplier(blocked, payer.publicKey, oldMultiplier * 2, 0n)]);
    try {
      assert.deepEqual(await snapshot(), beforeScale, "Multiplier changed raw balances, share supply or accrual state");
      const scale = getScaledUiAmountConfig(await getMint(conn, blocked, "confirmed", TOKEN_2022_PROGRAM_ID)); assert(scale);
      const nowMultiplier = BigInt(await readClockTimestamp(conn)) >= scale.newMultiplierEffectiveTimestamp ? scale.newMultiplier : scale.multiplier;
      assert.equal(nowMultiplier, oldMultiplier * 2);
      const raw = beforeScale.vaults.at(-1)!;
      assert.equal(Number(raw) * nowMultiplier / 1e8, 2 * Number(raw) * oldMultiplier / 1e8, "Displayed amount must double");
      await redeem(`redeem-after-multiplier-${count}`, beforeScale.investor / 5n);
      report.proofs.push({ label: `multiplier-${count}`, rawUnchanged: raw, previousMultiplier: oldMultiplier, multiplier: nowMultiplier }); await persist();
    } finally { await transaction(`multiplier-restore-${count}`, [fixtureMutations.multiplier(blocked, payer.publicKey, oldMultiplier, 0n)]); }
    report.proofs.push({ label: `basket-${count}`, basket: basket.toBase58(), shareMint: shareMint.toBase58(), creator: creator.publicKey.toBase58(), investor: investor.publicKey.toBase58(), treasury: treasury.toBase58(), status: "passed" }); await persist();
  }
  report.complete = true; await persist(); console.log(json({ complete: true, proof: join(dir, "basket-proof.json") })); return report;
  } finally { conn.closeRpc(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(safeProofError(error)); process.exitCode = 1; });
