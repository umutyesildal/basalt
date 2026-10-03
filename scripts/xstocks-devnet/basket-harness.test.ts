import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { accountDiscriminator } from "../lib.ts";
import { decodeFeeCheckpoint, expectedMint, expectedRedeem, assertShareSupply, validateFixtureSelection, confirmSubmittedTransaction, safeProofError, main } from "../testXStockBaskets.ts";
import { DEVNET_GENESIS, FIXTURE_PROFILE } from "./profile.ts";
import { getRunDir, type FixtureState } from "./runtime.ts";

function fixtureState(): FixtureState {
  return { version: 1, cluster: "devnet", genesisHash: DEVNET_GENESIS, profile: FIXTURE_PROFILE, payer: Keypair.generate().publicKey.toBase58(), createdAt: "test", updatedAt: "test",
    mocks: ["A", "B", "C", "D"].map(letter => ({ letter, symbol: `BSTEST${letter}`, name: `Test ${letter}`, mint: Keypair.generate().publicKey.toBase58(), decimals: 8, multiplier: 1, signatures: { whitelist: "fixture" } })) };
}
test("default mode does not read a payer, contact RPC, or create its state directory", async () => {
  const id = `readonly-harness-test-${Date.now()}`, dir = getRunDir(id), originalFetch = globalThis.fetch;
  assert.equal(existsSync(dir), false);
  globalThis.fetch = async () => { throw new Error("Default mode must not access RPC"); };
  try {
    const result = await main(["--run-id", id, "--payer", "/does-not-exist/keypair.json"]);
    assert.equal((result as { mode: string }).mode, "plan");
    assert.equal(existsSync(dir), false);
  } finally { globalThis.fetch = originalFetch; }
});
test("execution needs an explicit run and signer path before RPC access", async () => {
  await assert.rejects(main(["--execute"]), /requires both --run-id and --payer/);
});
test("fixture selection pins all four distinct project mocks with completed admission", () => {
  const state = fixtureState(); assert.equal(validateFixtureSelection(state).length, 4);
  state.mocks[3].mint = state.mocks[0].mint;
  assert.throws(() => validateFixtureSelection(state), /distinct/);
  const incomplete = fixtureState(); delete incomplete.mocks[2].signatures.whitelist;
  assert.throws(() => validateFixtureSelection(incomplete), /incomplete/);
});
test("checkpoint reads five-byte management remainder without consuming reserved padding", () => {
  const data = Buffer.alloc(888); accountDiscriminator("Basket").copy(data); data.writeBigInt64LE(100n, 152);
  const remainder = 315_359_999_999n;
  for (let index = 0; index < 5; index++) data[881 + index] = Number((remainder >> BigInt(index * 8)) & 255n);
  data[886] = 255;
  assert.deepEqual(decodeFeeCheckpoint(data), { lastAccrual: 100n, remainder });
  assert.throws(() => decodeFeeCheckpoint(data.subarray(0, 885)), /Invalid Basket layout/);
  assert.throws(() => decodeFeeCheckpoint(Buffer.alloc(888)), /Invalid Basket layout/);
});
test("raw mint expectation uses post-accrual supply and exact 90/10 fee conservation", () => {
  const result = expectedMint(1_000_003n, [400n, 320n, 280n], [400_000n, 320_000n, 280_000n]);
  assert.equal(result.gross, 1_000_003_000n);
  assert.equal(result.fee, 10_000_030n);
  assert.equal(result.creator, 9_000_027n); assert.equal(result.treasury, 1_000_003n);
  assert.equal(result.net + result.creator + result.treasury, result.gross);
  assert.throws(() => expectedMint(1_000_000n, [400n, 320n, 280n], [400n, 640n, 280n]), /Off-weight/);
});
test("raw redemption floors pro-rata output and preserves exit-fee dust in treasury", () => {
  const result = expectedRedeem(201n, 1_000n, [997n, 499n, 333n]);
  assert.equal(result.fee, 1n); assert.equal(result.burn, 200n);
  assert.deepEqual(result.outputs, [199n, 99n, 66n]);
  assert.equal(result.creator, 0n); assert.equal(result.treasury, 1n);
  assert.equal(result.burn + result.creator + result.treasury, 201n);
});
test("holder reconciliation catches unaccounted minted shares", () => {
  assertShareSupply({ supply: 1000n, creator: 100n, investor: 890n, treasury: 10n });
  assert.throws(() => assertShareSupply({ supply: 1001n, creator: 100n, investor: 890n, treasury: 10n }), /Share supply/);
});

const pausedError = { InstructionError: [1, { Custom: 67 }] };
test("plain SDK InstructionError resolves the same confirmed failed signature", async () => {
  const queried: string[] = [];
  await confirmSubmittedTransaction("submitted-signature", pausedError,
    async () => { throw pausedError; },
    async signature => { queried.push(signature); return { confirmationStatus: "confirmed", err: pausedError }; });
  assert.deepEqual(queried, ["submitted-signature"]);
});
test("normal SDK Error can resolve only a finalized matching expected rejection", async () => {
  await confirmSubmittedTransaction("submitted-signature", pausedError,
    async () => { throw new Error("HTTP confirmation race"); },
    async () => ({ confirmationStatus: "finalized", err: { InstructionError: [1, { Custom: 67 }] } }));
});
test("absent or processed expected-failure status stays ambiguous", async () => {
  for (const status of [null, { confirmationStatus: "processed" as const, err: pausedError }, { err: pausedError }]) {
    await assert.rejects(confirmSubmittedTransaction("submitted-signature", pausedError,
      async () => { throw pausedError; }, async () => status), /Ambiguous confirmation.*no resend/);
  }
});
test("confirmed success is not accepted as an expected rejection", async () => {
  await assert.rejects(confirmSubmittedTransaction("submitted-signature", pausedError,
    async () => { throw pausedError; }, async () => ({ confirmationStatus: "confirmed", err: null })), /unexpectedly succeeded/);
  await assert.rejects(confirmSubmittedTransaction("submitted-signature", pausedError,
    async () => ({ value: { err: null } }), async () => { throw new Error("Must not query"); }), /unexpectedly succeeded/);
});
test("a confirmed failure must match the exact simulated error", async () => {
  await assert.rejects(confirmSubmittedTransaction("submitted-signature", pausedError,
    async () => { throw pausedError; }, async () => ({ confirmationStatus: "confirmed", err: { InstructionError: [1, { Custom: 99 }] } })), /differs from expected/);
  await assert.rejects(confirmSubmittedTransaction("submitted-signature", pausedError,
    async () => ({ value: { err: "BlockhashNotFound" } }), async () => null), /differs from expected/);
});
test("positive confirmation failure is rethrown without a lookup or resend", async () => {
  const error = new Error("Positive confirmation unavailable"); let lookups = 0;
  await assert.rejects(confirmSubmittedTransaction("submitted-signature", null,
    async () => { throw error; }, async () => { lookups++; return { confirmationStatus: "confirmed", err: null }; }), actual => actual === error);
  assert.equal(lookups, 0);
});
test("failed status retrieval cannot become evidence of rejection", async () => {
  await assert.rejects(confirmSubmittedTransaction("submitted-signature", pausedError,
    async () => { throw pausedError; }, async () => { throw new Error("RPC unavailable"); }), /status lookup failed; no resend/);
});
test("normal confirmations validate either success or the simulated rejection", async () => {
  const noLookup = async () => { throw new Error("Unexpected fallback lookup"); };
  await confirmSubmittedTransaction("submitted-signature", null, async () => ({ value: { err: null } }), noLookup);
  await confirmSubmittedTransaction("submitted-signature", pausedError, async () => ({ value: { err: pausedError } }), noLookup);
  await assert.rejects(confirmSubmittedTransaction("submitted-signature", null, async () => ({ value: { err: pausedError } }), noLookup), /confirmed transaction failed/);
});
test("non-Error diagnostics serialize only whitelisted public InstructionError fields", () => {
  assert.equal(safeProofError({ ...pausedError, secretKey: "must-not-print" }), 'Basket proof failed: {"InstructionError":[1,{"Custom":67}]}');
  assert.equal(safeProofError({ InstructionError: [1, { Custom: 67, key: "must-not-print" }] }), 'Basket proof failed: {"InstructionError":[1,{"Custom":67}]}');
  assert.equal(safeProofError({ secretKey: "must-not-print" }), "Basket proof failed with an unrecognized error");
});
