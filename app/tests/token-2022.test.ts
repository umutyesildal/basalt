import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey, SystemProgram, type AccountInfo, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, AuthorityType, unpackMint, unpackAccount,
  getScaledUiAmountConfig, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction, createMintToInstruction, createSetAuthorityInstruction } from "../lib/token-2022";

const authority = Keypair.fromSeed(Buffer.alloc(32, 7)).publicKey;
const mint = Keypair.fromSeed(Buffer.alloc(32, 8)).publicKey;
const account = Keypair.fromSeed(Buffer.alloc(32, 9)).publicKey;
const U64_MAX = (1n << 64n) - 1n;
function info(data: Buffer): AccountInfo<Buffer> { return { data, owner: TOKEN_2022_PROGRAM_ID, lamports: 1, executable: false }; }
function mintBytes(): Buffer {
  const data = Buffer.alloc(82); data.writeUInt32LE(1, 0); authority.toBuffer().copy(data, 4);
  data.writeBigUInt64LE(U64_MAX, 36); data[44] = 8; data[45] = 1; return data;
}
function accountBytes(): Buffer {
  const data = Buffer.alloc(165); mint.toBuffer().copy(data, 0); authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(U64_MAX, 64); data[108] = 1; return data;
}
function extendedMint(): Buffer {
  const data = Buffer.alloc(226); mintBytes().copy(data); data[165] = 1;
  data.writeUInt16LE(25, 166); data.writeUInt16LE(56, 168); authority.toBuffer().copy(data, 170);
  data.writeDoubleLE(1.25, 202); data.writeBigUInt64LE(1_800_000_000n, 210); data.writeDoubleLE(2, 218); return data;
}
const meta = (ix: TransactionInstruction) => ix.keys.map(key => [key.pubkey.toBase58(), key.isSigner, key.isWritable]);

test("fixed mint/account layouts retain exact u64 and authorities", () => {
  const decoded = unpackMint(mint, info(mintBytes()));
  assert.equal(decoded.supply, U64_MAX); assert.equal(decoded.decimals, 8); assert.equal(decoded.isInitialized, true);
  assert.equal(decoded.mintAuthority?.toBase58(), authority.toBase58()); assert.equal(decoded.freezeAuthority, null);
  const data = accountBytes(); data.writeUInt32LE(1, 72); authority.toBuffer().copy(data, 76);
  data.writeUInt32LE(1, 109); data.writeBigUInt64LE(123n, 113); data.writeBigUInt64LE(45n, 121);
  data.writeUInt32LE(1, 129); mint.toBuffer().copy(data, 133);
  const token = unpackAccount(account, info(data));
  assert.equal(token.amount, U64_MAX); assert.equal(token.owner.toBase58(), authority.toBase58()); assert.equal(token.mint.toBase58(), mint.toBase58());
  assert.equal(token.delegate?.toBase58(), authority.toBase58()); assert.equal(token.delegatedAmount, 45n);
  assert.equal(token.rentExemptReserve, 123n); assert.equal(token.closeAuthority?.toBase58(), mint.toBase58());
});

test("frozen token balances remain readable; uninitialized stays explicitly false", () => {
  for (const state of [0, 1, 2]) {
    const data = accountBytes(); data[108] = state; const token = unpackAccount(account, info(data));
    assert.equal(token.isInitialized, state !== 0); assert.equal(token.isFrozen, state === 2); assert.equal(token.amount, U64_MAX);
  }
});

test("missing, executable and substituted program owners fail closed", () => {
  for (const decode of [unpackMint, unpackAccount]) {
    const data = decode === unpackMint ? mintBytes() : accountBytes();
    assert.throws(() => decode(mint, null), /account owner/);
    assert.throws(() => decode(mint, { ...info(data), owner: SystemProgram.programId }), /account owner/);
    assert.throws(() => decode(mint, { ...info(data), executable: true }), /account owner/);
    assert.throws(() => decode(mint, info(data), SystemProgram.programId), /account owner/);
  }
});

test("mint and account size, padding, options, bool and state are validated", () => {
  for (const size of [0, 81, 83, 165, 355]) assert.throws(() => unpackMint(mint, info(Buffer.alloc(size))), /size|type/);
  for (const size of [0, 164, 166, 355]) assert.throws(() => unpackAccount(account, info(Buffer.alloc(size))), /size|type/);
  for (const offset of [0, 46]) { const data = mintBytes(); data.writeUInt32LE(2, offset); assert.throws(() => unpackMint(mint, info(data)), /COption/); }
  const badBool = mintBytes(); badBool[45] = 2; assert.throws(() => unpackMint(mint, info(badBool)), /initialization/);
  for (const offset of [72, 109, 129]) { const data = accountBytes(); data.writeUInt32LE(2, offset); assert.throws(() => unpackAccount(account, info(data)), /COption/); }
  const state = accountBytes(); state[108] = 3; assert.throws(() => unpackAccount(account, info(state)), /state/);
  const padding = extendedMint(); padding[82] = 1; assert.throws(() => unpackMint(mint, info(padding)), /padding/);
});

test("Scaled UI extension keeps current and scheduled f64/i64 fields exact", () => {
  const scaled = getScaledUiAmountConfig(unpackMint(mint, info(extendedMint())))!;
  assert.equal(scaled.authority.toBase58(), authority.toBase58()); assert.equal(scaled.multiplier, 1.25);
  assert.equal(scaled.newMultiplierEffectiveTimestamp, 1_800_000_000n); assert.equal(scaled.newMultiplier, 2);
  const negative = extendedMint(); negative.writeBigInt64LE(-1n, 210);
  assert.equal(getScaledUiAmountConfig(unpackMint(mint, info(negative)))!.newMultiplierEffectiveTimestamp, -1n);
  assert.equal(getScaledUiAmountConfig(unpackMint(mint, info(mintBytes()))), null);
});

test("truncated, duplicate, wrong-sized and mistyped TLV records fail closed", () => {
  assert.throws(() => unpackMint(mint, info(extendedMint().subarray(0, 225))), /TLV length/);
  const short = extendedMint(); short.writeUInt16LE(55, 168); assert.throws(() => unpackMint(mint, info(short)), /extension length/);
  const duplicate = Buffer.concat([extendedMint(), extendedMint().subarray(166)]); assert.throws(() => unpackMint(mint, info(duplicate)), /TLV type/);
  const wrongType = extendedMint(); wrongType[165] = 2; assert.throws(() => unpackMint(mint, info(wrongType)), /account type/);
  const header = Buffer.concat([extendedMint(), Buffer.from([1])]); assert.throws(() => unpackMint(mint, info(header)), /TLV header/);
  const token = Buffer.concat([accountBytes(), Buffer.from([2]), extendedMint().subarray(166)]);
  assert.throws(() => unpackAccount(account, info(token)), /mint extension/);
  assert.equal(getScaledUiAmountConfig(unpackMint(mint, info(Buffer.concat([extendedMint(), Buffer.alloc(8)]))))?.multiplier, 1.25);
});

test("ATA derives canonical Token-2022 seeds and enforces explicit PDA ownership", () => {
  const expected = PublicKey.findProgramAddressSync([authority.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
  assert.equal(getAssociatedTokenAddressSync(mint, authority).toBase58(), expected.toBase58());
  const pda = PublicKey.findProgramAddressSync([Buffer.from("vault")], TOKEN_2022_PROGRAM_ID)[0];
  assert.throws(() => getAssociatedTokenAddressSync(mint, pda), /off-curve/);
  assert.ok(getAssociatedTokenAddressSync(mint, pda, true));
  assert.throws(() => getAssociatedTokenAddressSync(mint, authority, false, SystemProgram.programId), /program/);
});

test("idempotent ATA instruction has canonical tag, account order and flags", () => {
  const ata = getAssociatedTokenAddressSync(mint, authority);
  const ix = createAssociatedTokenAccountIdempotentInstruction(authority, ata, authority, mint);
  assert.equal(ix.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()); assert.equal(ix.data.toString("hex"), "01");
  assert.deepEqual(meta(ix), [[authority.toBase58(), true, true], [ata.toBase58(), false, true], [authority.toBase58(), false, false],
    [mint.toBase58(), false, false], [SystemProgram.programId.toBase58(), false, false], [TOKEN_2022_PROGRAM_ID.toBase58(), false, false]]);
  assert.throws(() => createAssociatedTokenAccountIdempotentInstruction(authority, account, authority, mint), /associated token/);
});

test("local lab mint instructions preserve exact wire bytes and signer flags", () => {
  const initialize = createInitializeMint2Instruction(mint, 6, authority, null);
  assert.equal(initialize.data.toString("hex"), `1406${authority.toBuffer().toString("hex")}00`);
  assert.deepEqual(meta(initialize), [[mint.toBase58(), false, true]]);
  const freeze = createInitializeMint2Instruction(mint, 8, authority, account);
  assert.equal(freeze.data.length, 67); assert.equal(freeze.data[34], 1); assert.ok(freeze.data.subarray(35).equals(account.toBuffer()));
  const mintTo = createMintToInstruction(mint, account, authority, U64_MAX);
  assert.equal(mintTo.data.toString("hex"), "07ffffffffffffffff");
  assert.deepEqual(meta(mintTo), [[mint.toBase58(), false, true], [account.toBase58(), false, true], [authority.toBase58(), true, false]]);
  const revoke = createSetAuthorityInstruction(mint, authority, AuthorityType.MintTokens, null);
  assert.equal(revoke.data.toString("hex"), "060000");
  assert.deepEqual(meta(revoke), [[mint.toBase58(), false, true], [authority.toBase58(), true, false]]);
  for (const amount of [-1n, 1n << 64n]) assert.throws(() => createMintToInstruction(mint, account, authority, amount), /u64/);
  for (const decimals of [-1, 256, 0.5]) assert.throws(() => createInitializeMint2Instruction(mint, decimals, authority, null), /decimals/);
  assert.throws(() => createMintToInstruction(mint, account, authority, 1n, [authority]), /multisig/);
  assert.throws(() => createSetAuthorityInstruction(mint, authority, AuthorityType.MintTokens, account), /authority change/);
});
