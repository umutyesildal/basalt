/**
 * Small Token-2022 wire helpers for the devnet pack and local lab. Layouts and
 * instruction tags match SPL Token-2022; integers use Buffer's native bigint
 * reads/writes, without native numeric conversion dependencies. This is not a
 * general token SDK: multisig signing and other authority changes are excluded.
 */
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction, type AccountInfo } from "@solana/web3.js";

export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const MINT_SIZE = 82;
const ACCOUNT_SIZE = 165;
const MULTISIG_SIZE = 355;
const SCALED_UI_AMOUNT = 25;
export enum AuthorityType { MintTokens = 0 }

function invalid(reason: string): never { throw new Error(`Invalid Token-2022 ${reason}.`); }
function option(data: Buffer, offset: number): boolean {
  const value = data.readUInt32LE(offset);
  if (value !== 0 && value !== 1) invalid("COption");
  return value === 1;
}
function optionalKey(data: Buffer, offset: number): PublicKey | null {
  return option(data, offset) ? new PublicKey(data.subarray(offset + 4, offset + 36)) : null;
}
function extensions(data: Buffer): Map<number, Buffer> {
  const values = new Map<number, Buffer>();
  for (let offset = 0; offset < data.length;) {
    if (data.subarray(offset).every(byte => byte === 0)) break;
    if (data.length - offset < 4) invalid("TLV header");
    const type = data.readUInt16LE(offset), length = data.readUInt16LE(offset + 2);
    if (type === 0 || values.has(type)) invalid("TLV type");
    const end = offset + 4 + length;
    if (end > data.length) invalid("TLV length");
    if (type === SCALED_UI_AMOUNT && length !== 56) invalid("scaled amount extension length");
    values.set(type, data.subarray(offset + 4, end));
    offset = end;
  }
  return values;
}
function tokenData(info: AccountInfo<Buffer> | null, programId: PublicKey, size: number, accountType: 1 | 2): { data: Buffer; tlvData: Buffer } {
  if (!info || info.executable || !info.owner.equals(programId) || !programId.equals(TOKEN_2022_PROGRAM_ID)) invalid("account owner");
  const data = info.data;
  if (data.length < size) invalid("account size");
  let tlvData: Buffer = Buffer.alloc(0);
  if (data.length > size) {
    if (data.length <= ACCOUNT_SIZE || data.length === MULTISIG_SIZE || data[ACCOUNT_SIZE] !== accountType) invalid("account type or size");
    if (size === MINT_SIZE && !data.subarray(MINT_SIZE, ACCOUNT_SIZE).every(byte => byte === 0)) invalid("mint padding");
    tlvData = data.subarray(ACCOUNT_SIZE + 1);
    const values = extensions(tlvData);
    if (accountType === 2 && values.has(SCALED_UI_AMOUNT)) invalid("mint extension on token account");
  }
  return { data, tlvData };
}

export function unpackMint(address: PublicKey, info: AccountInfo<Buffer> | null, programId = TOKEN_2022_PROGRAM_ID) {
  const { data, tlvData } = tokenData(info, programId, MINT_SIZE, 1);
  if (data[45] !== 0 && data[45] !== 1) invalid("mint initialization flag");
  return { address, mintAuthority: optionalKey(data, 0), supply: data.readBigUInt64LE(36), decimals: data[44],
    isInitialized: data[45] === 1, freezeAuthority: optionalKey(data, 46), tlvData };
}
export function unpackAccount(address: PublicKey, info: AccountInfo<Buffer> | null, programId = TOKEN_2022_PROGRAM_ID) {
  const { data, tlvData } = tokenData(info, programId, ACCOUNT_SIZE, 2);
  const state = data[108];
  if (state > 2) invalid("token account state");
  const isNative = option(data, 109);
  return { address, mint: new PublicKey(data.subarray(0, 32)), owner: new PublicKey(data.subarray(32, 64)),
    amount: data.readBigUInt64LE(64), delegate: optionalKey(data, 72), delegatedAmount: data.readBigUInt64LE(121),
    isInitialized: state !== 0, isFrozen: state === 2, isNative,
    rentExemptReserve: isNative ? data.readBigUInt64LE(113) : null, closeAuthority: optionalKey(data, 129), tlvData };
}
export function getScaledUiAmountConfig(mint: { tlvData: Buffer }) {
  const data = extensions(mint.tlvData).get(SCALED_UI_AMOUNT);
  if (!data) return null;
  // Token-2022 stores UnixTimestamp as signed i64, including past negatives.
  return { authority: new PublicKey(data.subarray(0, 32)), multiplier: data.readDoubleLE(32),
    newMultiplierEffectiveTimestamp: data.readBigInt64LE(40), newMultiplier: data.readDoubleLE(48) };
}

export function getAssociatedTokenAddressSync(mint: PublicKey, owner: PublicKey, allowOwnerOffCurve = false, programId = TOKEN_2022_PROGRAM_ID): PublicKey {
  if (!programId.equals(TOKEN_2022_PROGRAM_ID)) invalid("token program");
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) invalid("off-curve wallet owner");
  return PublicKey.findProgramAddressSync([owner.toBuffer(), programId.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}
export function createAssociatedTokenAccountIdempotentInstruction(payer: PublicKey, associatedToken: PublicKey, owner: PublicKey, mint: PublicKey, programId = TOKEN_2022_PROGRAM_ID): TransactionInstruction {
  if (!getAssociatedTokenAddressSync(mint, owner, true, programId).equals(associatedToken)) invalid("associated token address");
  return new TransactionInstruction({ programId: ASSOCIATED_TOKEN_PROGRAM_ID, data: Buffer.from([1]), keys: [
    { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: associatedToken, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: programId, isSigner: false, isWritable: false },
  ] });
}
function instruction(programId: PublicKey, data: Buffer, keys: TransactionInstruction["keys"]): TransactionInstruction {
  if (!programId.equals(TOKEN_2022_PROGRAM_ID)) invalid("token program");
  return new TransactionInstruction({ programId, data, keys });
}
export function createInitializeMint2Instruction(mint: PublicKey, decimals: number, mintAuthority: PublicKey, freezeAuthority: PublicKey | null, programId = TOKEN_2022_PROGRAM_ID): TransactionInstruction {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) invalid("mint decimals");
  const data = Buffer.alloc(freezeAuthority ? 67 : 35);
  data[0] = 20; data[1] = decimals; mintAuthority.toBuffer().copy(data, 2); data[34] = freezeAuthority ? 1 : 0;
  freezeAuthority?.toBuffer().copy(data, 35);
  return instruction(programId, data, [{ pubkey: mint, isSigner: false, isWritable: true }]);
}
export function createMintToInstruction(mint: PublicKey, destination: PublicKey, authority: PublicKey, amount: bigint, multiSigners: readonly unknown[] = [], programId = TOKEN_2022_PROGRAM_ID): TransactionInstruction {
  if (typeof amount !== "bigint" || amount < 0n || amount >= 1n << 64n) invalid("mint amount u64");
  if (multiSigners.length) invalid("unsupported multisig");
  const data = Buffer.alloc(9); data[0] = 7; data.writeBigUInt64LE(amount, 1);
  return instruction(programId, data, [{ pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: false }]);
}
export function createSetAuthorityInstruction(account: PublicKey, currentAuthority: PublicKey, authorityType: AuthorityType, newAuthority: PublicKey | null, multiSigners: readonly unknown[] = [], programId = TOKEN_2022_PROGRAM_ID): TransactionInstruction {
  if (authorityType !== AuthorityType.MintTokens || newAuthority !== null || multiSigners.length) invalid("unsupported authority change");
  return instruction(programId, Buffer.from([6, 0, 0]), [{ pubkey: account, isSigner: false, isWritable: true },
    { pubkey: currentAuthority, isSigner: true, isWritable: false }]);
}
