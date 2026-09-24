import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

/** The Managed V2 client is deliberately localnet-only until asset admission is enforced. */
export const MANAGED_PROGRAM_ID = new PublicKey("CZ3eG8JutryawXTcA1h97PMrhAGuWzsrYSgssMH43cKL");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const DISCRIMINATORS = {
  basket: "d5bc9fde1b26932e",
  proposal: "904c35bea5c3b335",
  create: "fda0c81ff84154a7",
  mint: "65f8252a97d80b53",
  redeem: "663abdfcc0db8c59",
  propose: "0b59debfee5d5eb1",
  approve: "880bb3b3ffbfed27",
  fill: "72689ed0181e79e0",
  cancel: "b25b89926343976e",
  expire: "74be7b9c83585f87",
} as const;

export interface ManagedBasketAccount {
  creator: PublicKey;
  manager: PublicKey;
  guardian: PublicKey;
  shareMint: PublicKey;
  identityMint: PublicKey;
  mints: [PublicKey, PublicKey];
  decimals: [number, number];
  weightsBps: [number, number];
  version: bigint;
  nextProposalNonce: bigint;
  pendingProposalNonce: bigint | null;
  noticeSlots: bigint;
}

export interface ManagedProposalAccount {
  nonce: bigint;
  inputMint: PublicKey;
  outputMint: PublicKey;
  maxInputRaw: bigint;
  minOutputRaw: bigint;
  weightsBps: [number, number];
  approvalDeadlineSlot: bigint;
  notBeforeSlot: bigint;
  expiresAtSlot: bigint;
  status: number;
}

function discriminator(data: Uint8Array, expected: string, minLength: number): Buffer {
  const bytes = Buffer.from(data);
  if (bytes.length < minLength || bytes.subarray(0, 8).toString("hex") !== expected) {
    throw new Error("This is not a Managed V2 account.");
  }
  return bytes;
}

function key(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

export function decodeManagedBasket(data: Uint8Array): ManagedBasketAccount {
  const b = discriminator(data, DISCRIMINATORS.basket, 298);
  if (b[8] !== 1) throw new Error("Unsupported Managed V2 basket version.");
  const pendingTag = b[263];
  if (pendingTag !== 0 && pendingTag !== 1) throw new Error("Invalid proposal state.");
  const afterPending = pendingTag === 1 ? 272 : 264;
  const weights: [number, number] = [b.readUInt16LE(243), b.readUInt16LE(245)];
  if (weights[0] <= 0 || weights[1] <= 0 || weights[0] + weights[1] !== 10_000) {
    throw new Error("Invalid basket weights.");
  }
  return {
    creator: key(b, 9), manager: key(b, 41), guardian: key(b, 73),
    shareMint: key(b, 113), identityMint: key(b, 145),
    mints: [key(b, 177), key(b, 209)], decimals: [b[241], b[242]],
    weightsBps: weights,
    version: b.readBigUInt64LE(247),
    nextProposalNonce: b.readBigUInt64LE(255),
    pendingProposalNonce: pendingTag === 1 ? b.readBigUInt64LE(264) : null,
    noticeSlots: b.readBigUInt64LE(afterPending + 8),
  };
}

export function decodeManagedProposal(data: Uint8Array): ManagedProposalAccount {
  const b = discriminator(data, DISCRIMINATORS.proposal, 286);
  return {
    nonce: b.readBigUInt64LE(40),
    inputMint: key(b, 88), outputMint: key(b, 120),
    maxInputRaw: b.readBigUInt64LE(152), minOutputRaw: b.readBigUInt64LE(160),
    weightsBps: [b.readUInt16LE(168), b.readUInt16LE(170)],
    approvalDeadlineSlot: b.readBigUInt64LE(172),
    notBeforeSlot: b.readBigUInt64LE(204),
    expiresAtSlot: b.readBigUInt64LE(212),
    status: b[284],
  };
}

export function isLocalManagedEndpoint(cluster: string, endpoint: string): boolean {
  if (cluster !== "localnet") return false;
  try {
    const url = new URL(endpoint);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

export function u64(value: bigint): Buffer {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new Error("Amount is outside the supported range.");
  const b = Buffer.alloc(8); b.writeBigUInt64LE(value); return b;
}
function u16(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) throw new Error("Invalid weight.");
  const b = Buffer.alloc(2); b.writeUInt16LE(value); return b;
}
function data(name: keyof typeof DISCRIMINATORS, ...fields: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from(DISCRIMINATORS[name], "hex"), ...fields]);
}
function meta(pubkey: PublicKey, isWritable = false, isSigner = false) {
  return { pubkey, isWritable, isSigner };
}
function ix(name: keyof typeof DISCRIMINATORS, keys: ReturnType<typeof meta>[], ...fields: Buffer[]) {
  return new TransactionInstruction({ programId: MANAGED_PROGRAM_ID, keys, data: data(name, ...fields) });
}
function pda(...seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, MANAGED_PROGRAM_ID)[0];
}
export function basketPda(creator: PublicKey, nonce: bigint) { return pda(Buffer.from("managed_basket"), creator.toBuffer(), u64(nonce)); }
export function vaultAuthorityPda(basket: PublicKey) { return pda(Buffer.from("managed_vault_authority"), basket.toBuffer()); }
export function shareMintPda(basket: PublicKey) { return pda(Buffer.from("managed_share_mint"), basket.toBuffer()); }
export function identityMintPda(basket: PublicKey) { return pda(Buffer.from("basket_identity_nft"), basket.toBuffer()); }
export function proposalPda(basket: PublicKey, nonce: bigint) { return pda(Buffer.from("managed_rebalance_proposal"), basket.toBuffer(), u64(nonce)); }
export function tokenAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

/** Parse a visible token amount without floating-point rounding. */
export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.trim())) {
    throw new Error("Enter a valid token amount.");
  }
  const [whole, fraction = ""] = value.trim().split(".");
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction.padEnd(decimals, "0") || "0"));
  u64(raw);
  return raw;
}

export function formatTokenAmount(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${raw / scale}${fraction ? `.${fraction}` : ""}`;
}

export function buildCreateManagedBasket(a: {
  creator: PublicKey; guardian: PublicKey; nonce: bigint; mints: [PublicKey, PublicKey];
  weightsBps: [number, number]; seedsRaw: [bigint, bigint]; noticeSlots: bigint;
}): { basket: PublicKey; instruction: TransactionInstruction } {
  const basket = basketPda(a.creator, a.nonce);
  const authority = vaultAuthorityPda(basket);
  const shareMint = shareMintPda(basket);
  const identity = identityMintPda(basket);
  return { basket, instruction: ix("create", [
    meta(a.creator, true, true), meta(a.guardian), meta(basket, true), meta(authority),
    meta(a.mints[0]), meta(a.mints[1]), meta(shareMint, true), meta(identity, true),
    meta(tokenAta(a.creator, a.mints[0]), true), meta(tokenAta(a.creator, a.mints[1]), true),
    meta(tokenAta(authority, a.mints[0]), true), meta(tokenAta(authority, a.mints[1]), true),
    meta(tokenAta(a.creator, shareMint), true), meta(tokenAta(a.creator, identity), true),
    meta(TOKEN_2022_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
  ], u64(a.nonce), u16(a.weightsBps[0]), u16(a.weightsBps[1]), u64(a.seedsRaw[0]), u64(a.seedsRaw[1]),
  u64(10_000n), u64(a.noticeSlots), u64(10_000n)) };
}

function basketAccounts(basket: PublicKey, state: ManagedBasketAccount, user: PublicKey) {
  const authority = vaultAuthorityPda(basket);
  return [meta(user, true, true), meta(basket), meta(authority), meta(state.mints[0]), meta(state.mints[1]),
    meta(tokenAta(authority, state.mints[0]), true), meta(tokenAta(authority, state.mints[1]), true)];
}

export function buildMintManagedShares(basket: PublicKey, state: ManagedBasketAccount, user: PublicKey, amounts: [bigint, bigint]) {
  return ix("mint", [...basketAccounts(basket, state, user), meta(tokenAta(user, state.mints[0]), true),
    meta(tokenAta(user, state.mints[1]), true), meta(state.shareMint, true), meta(tokenAta(user, state.shareMint), true),
    meta(TOKEN_2022_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId)],
  u64(amounts[0]), u64(amounts[1]));
}

export function buildRedeemManagedShares(basket: PublicKey, state: ManagedBasketAccount, user: PublicKey, sharesRaw: bigint) {
  return ix("redeem", [...basketAccounts(basket, state, user), meta(state.shareMint, true),
    meta(tokenAta(user, state.shareMint), true), meta(tokenAta(user, state.mints[0]), true),
    meta(tokenAta(user, state.mints[1]), true), meta(TOKEN_2022_PROGRAM_ID),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId)], u64(sharesRaw));
}

export function buildProposeManagedMix(basket: PublicKey, state: ManagedBasketAccount, manager: PublicKey,
  weights: [number, number], inputMint: PublicKey, maxInputRaw: bigint) {
  const nonce = state.nextProposalNonce;
  return ix("propose", [meta(manager, true, true), meta(basket, true), meta(proposalPda(basket, nonce), true),
    meta(SystemProgram.programId)], u64(nonce), u64(state.version), u16(weights[0]), u16(weights[1]),
  inputMint.toBuffer(), u64(maxInputRaw));
}

export function buildApproveManagedMix(basket: PublicKey, guardian: PublicKey, nonce: bigint, minOutputRaw: bigint) {
  return ix("approve", [meta(guardian, false, true), meta(basket, true), meta(proposalPda(basket, nonce), true)],
    u64(nonce), u64(minOutputRaw));
}

export function buildCancelManagedMix(basket: PublicKey, actor: PublicKey, nonce: bigint) {
  return ix("cancel", [meta(actor, false, true), meta(basket, true), meta(proposalPda(basket, nonce), true)], u64(nonce));
}

export function buildExpireManagedMix(basket: PublicKey, nonce: bigint) {
  return ix("expire", [meta(basket, true), meta(proposalPda(basket, nonce), true)], u64(nonce));
}

export function buildFillManagedMix(basket: PublicKey, state: ManagedBasketAccount, taker: PublicKey,
  nonce: bigint, inputRaw: bigint, outputRaw: bigint) {
  const authority = vaultAuthorityPda(basket);
  return ix("fill", [meta(taker, false, true), meta(basket, true), meta(proposalPda(basket, nonce), true),
    meta(authority), meta(state.mints[0]), meta(state.mints[1]),
    meta(tokenAta(authority, state.mints[0]), true), meta(tokenAta(authority, state.mints[1]), true),
    meta(tokenAta(taker, state.mints[0]), true), meta(tokenAta(taker, state.mints[1]), true),
    meta(state.shareMint), meta(TOKEN_2022_PROGRAM_ID)], u64(nonce), u64(inputRaw), u64(outputRaw));
}
