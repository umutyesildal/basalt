import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DEVNET_FAUCET_PROGRAM_ID, DEVNET_MOCK_TOKENS, DEVNET_FAUCET_CLAIM_RAW, DEVNET_GENESIS_HASH, buildDevnetFaucetClaim, deriveDevnetFaucetClaim, deriveDevnetFaucetAuthority, readDevnetFaucetClaimed } from "../../app/lib/devnet-faucet.ts";

test("fixed UI mock identities match the recorded fixture proof", async () => {
  const fixture = JSON.parse(await readFile(new URL("../../docs/assets/xstocks-devnet-runtime-2026-10-03/fixture-state.json", import.meta.url), "utf8"));
  assert.deepEqual(DEVNET_MOCK_TOKENS.map(({ mint, decimals, multiplier }) => ({ mint: mint.toBase58(), decimals, multiplier })), fixture.mocks.map(({ mint, decimals, multiplier }: {mint:string;decimals:number;multiplier:number}) => ({ mint, decimals, multiplier })));
  assert.equal(DEVNET_FAUCET_CLAIM_RAW, 1000n * 10n ** 8n);
});
test("legacy wallet claim fits one packet and uses canonical wallet destinations", () => {
  const wallet = new PublicKey("y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE");
  const instructions = buildDevnetFaucetClaim(wallet);
  const tx = new Transaction({ feePayer: wallet, recentBlockhash: PublicKey.default.toBase58() }).add(...instructions);
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  assert(bytes <= 1232, `Claim transaction ${bytes} > 1232`);
  console.log(`Faucet claim legacy wire bytes: ${bytes}`);
  assert.equal(instructions.length, 5);
  const claim = instructions[4]; assert(claim.programId.equals(DEVNET_FAUCET_PROGRAM_ID));
  assert.deepEqual([...claim.data], [0]); assert.equal(claim.keys.length, 17);
  assert(claim.keys[0].isSigner && claim.keys[0].isWritable);
  assert(claim.keys[1].pubkey.equals(deriveDevnetFaucetClaim(wallet)));
  assert(claim.keys[2].pubkey.equals(deriveDevnetFaucetAuthority()));
  assert(claim.keys[3].pubkey.equals(SystemProgram.programId));
  assert(claim.keys[4].pubkey.equals(TOKEN_2022_PROGRAM_ID));
  DEVNET_MOCK_TOKENS.forEach(({ mint }, i) => assert(claim.keys[7 + i * 3].pubkey.equals(getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID))));
});
test("claim reads enforce devnet and reject foreign or malformed claim records", async () => {
  const wallet = PublicKey.default;
  const read = (genesis: string, account: unknown) => readDevnetFaucetClaimed({ getGenesisHash: async () => genesis, getAccountInfo: async () => account } as never, wallet);
  await assert.rejects(read("mainnet", null), /devnet only/);
  assert.equal(await read(DEVNET_GENESIS_HASH, null), false);
  assert.equal(await read(DEVNET_GENESIS_HASH, { owner: SystemProgram.programId, data: Buffer.alloc(0) }), false);
  assert.equal(await read(DEVNET_GENESIS_HASH, { owner: DEVNET_FAUCET_PROGRAM_ID, data: Buffer.from([1]) }), true);
  await assert.rejects(read(DEVNET_GENESIS_HASH, { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.from([1]) }), /could not be verified/);
  await assert.rejects(read(DEVNET_GENESIS_HASH, { owner: DEVNET_FAUCET_PROGRAM_ID, data: Buffer.from([0]) }), /could not be verified/);
});
