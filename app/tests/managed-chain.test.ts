import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";

import {
  MANAGED_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
  basketPda, buildCreateManagedBasket, buildMintManagedShares,
  buildRedeemManagedShares, decodeManagedBasket, decodeManagedProposal,
  formatTokenAmount, isLocalManagedEndpoint, parseTokenAmount,
  proposalPda, tokenAta, vaultAuthorityPda,
} from "../lib/managed-chain";

const key = (n: number) => new PublicKey(Uint8Array.from({ length: 32 }, () => n));
const discriminator = (name: string) => createHash("sha256").update(name).digest().subarray(0, 8);

describe("Managed V2 browser wire contract", () => {
  it("parses and formats raw Token-2022 amounts without floating-point rounding", () => {
    expect(parseTokenAmount("0.000001", 6)).toBe(1n);
    expect(parseTokenAmount("10.25", 6)).toBe(10_250_000n);
    expect(formatTokenAmount(10_250_000n, 6)).toBe("10.25");
    expect(() => parseTokenAmount("0.0000001", 6)).toThrow("decimal places");
    expect(() => parseTokenAmount("-1", 6)).toThrow();
    expect(() => parseTokenAmount("1e9", 6)).toThrow();
  });

  it("keeps signing on loopback localnet only", () => {
    expect(isLocalManagedEndpoint("localnet", "http://127.0.0.1:8899")).toBe(true);
    expect(isLocalManagedEndpoint("localnet", "http://localhost:8899")).toBe(true);
    expect(isLocalManagedEndpoint("devnet", "http://localhost:8899")).toBe(false);
    expect(isLocalManagedEndpoint("localnet", "https://api.devnet.solana.com")).toBe(false);
  });

  it("derives the same basket and vault addresses as the Anchor seeds", () => {
    const basket = basketPda(key(1), 42n);
    expect(basket.equals(PublicKey.findProgramAddressSync([Buffer.from("managed_basket"), key(1).toBuffer(), Buffer.from([42, 0, 0, 0, 0, 0, 0, 0])], MANAGED_PROGRAM_ID)[0])).toBe(true);
    expect(vaultAuthorityPda(basket).equals(PublicKey.findProgramAddressSync([Buffer.from("managed_vault_authority"), basket.toBuffer()], MANAGED_PROGRAM_ID)[0])).toBe(true);
    expect(proposalPda(basket, 0n).equals(PublicKey.findProgramAddressSync([Buffer.from("managed_rebalance_proposal"), basket.toBuffer(), Buffer.alloc(8)], MANAGED_PROGRAM_ID)[0])).toBe(true);
  });

  it("decodes basket fields including an optional pending proposal", () => {
    const bytes = Buffer.alloc(298);
    discriminator("account:ManagedBasket").copy(bytes, 0);
    bytes[8] = 1;
    key(1).toBuffer().copy(bytes, 9);
    key(2).toBuffer().copy(bytes, 41);
    key(3).toBuffer().copy(bytes, 73);
    key(4).toBuffer().copy(bytes, 113);
    key(5).toBuffer().copy(bytes, 145);
    key(6).toBuffer().copy(bytes, 177);
    key(7).toBuffer().copy(bytes, 209);
    bytes[241] = 6; bytes[242] = 9;
    bytes.writeUInt16LE(4_000, 243); bytes.writeUInt16LE(6_000, 245);
    bytes.writeBigUInt64LE(2n, 247); bytes.writeBigUInt64LE(3n, 255);
    bytes[263] = 1; bytes.writeBigUInt64LE(2n, 264);
    bytes.writeBigUInt64LE(100n, 272); bytes.writeBigUInt64LE(216_000n, 280);
    const state = decodeManagedBasket(bytes);
    expect(state.manager.equals(key(2))).toBe(true);
    expect(state.mints[1].equals(key(7))).toBe(true);
    expect(state.pendingProposalNonce).toBe(2n);
    expect(state.noticeSlots).toBe(216_000n);
    bytes[0] ^= 1;
    expect(() => decodeManagedBasket(bytes)).toThrow("not a Managed V2");
  });

  it("decodes the approved proposal bounds and timing", () => {
    const bytes = Buffer.alloc(286);
    discriminator("account:RebalanceProposal").copy(bytes, 0);
    bytes.writeBigUInt64LE(3n, 40);
    key(8).toBuffer().copy(bytes, 88);
    key(9).toBuffer().copy(bytes, 120);
    bytes.writeBigUInt64LE(1_000_000n, 152);
    bytes.writeBigUInt64LE(800_000n, 160);
    bytes.writeUInt16LE(3_000, 168); bytes.writeUInt16LE(7_000, 170);
    bytes.writeBigUInt64LE(220_000n, 204); bytes.writeBigUInt64LE(230_000n, 212);
    bytes[284] = 1;
    const proposal = decodeManagedProposal(bytes);
    expect(proposal.nonce).toBe(3n);
    expect(proposal.weightsBps).toEqual([3_000, 7_000]);
    expect(proposal.minOutputRaw).toBe(800_000n);
    expect(proposal.notBeforeSlot).toBe(220_000n);
  });

  it("builds create, mint and redeem account metas in Anchor order", () => {
    const creator = key(1), guardian = key(2), mints: [PublicKey, PublicKey] = [key(3), key(4)];
    const { basket, instruction } = buildCreateManagedBasket({ creator, guardian, nonce: 42n, mints, weightsBps: [5_000, 5_000], seedsRaw: [100n, 200n], noticeSlots: 216_000n });
    expect(instruction.keys).toHaveLength(17);
    expect(instruction.keys[0].pubkey.equals(creator)).toBe(true);
    expect(instruction.keys[8].pubkey.equals(tokenAta(creator, mints[0]))).toBe(true);
    expect(instruction.keys[14].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(instruction.data.subarray(0, 8).equals(discriminator("global:create_managed_basket"))).toBe(true);
    const state = { mints, shareMint: key(5) } as Parameters<typeof buildMintManagedShares>[1];
    const mint = buildMintManagedShares(basket, state, creator, [10n, 20n]);
    const redeem = buildRedeemManagedShares(basket, state, creator, 1_000n);
    expect(mint.keys[7].pubkey.equals(tokenAta(creator, mints[0]))).toBe(true);
    expect(redeem.keys[7].pubkey.equals(key(5))).toBe(true);
    expect(redeem.keys[10].pubkey.equals(tokenAta(creator, mints[1]))).toBe(true);
    expect(redeem.data.subarray(0, 8).equals(discriminator("global:redeem_in_kind"))).toBe(true);
  });
});
