/** Canonical raw Rust/SPL layouts for read-only position recovery tests. */
import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { PositionsSyncRpc, RecoveryPrograms } from "../../src/indexer/positionsSync";
export const recoveryKey = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
export const recoveryPrograms: RecoveryPrograms = {
  basket: recoveryKey(250), factory: recoveryKey(249),
  ids: [recoveryKey(250).toBase58(), recoveryKey(249).toBase58(), recoveryKey(248).toBase58()],
};
const info = (data: Buffer, owner = TOKEN_2022_PROGRAM_ID): AccountInfo<Buffer> => ({ data, owner, executable: false, lamports: 1 });
export function recoveryTokenAccount(user: PublicKey, mint: PublicKey, amount: bigint, address = recoveryKey(100)) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0); user.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64); data[108] = 1;
  return { pubkey: address, account: info(data) };
}
export function positionRecoveryFixture(options: {
  nonce?: bigint; slot?: number; supply?: bigint;
  holders?: Array<{ user: PublicKey; amount: bigint }>;
} = {}) {
  const nonce = options.nonce ?? 7n, slot = options.slot ?? 100;
  const creator = recoveryKey(201), treasury = recoveryKey(202);
  const [factory] = PublicKey.findProgramAddressSync([Buffer.from("factory")], recoveryPrograms.factory);
  const seed = Buffer.alloc(8); seed.writeBigUInt64LE(nonce);
  const [basket, basketBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), factory.toBuffer(), creator.toBuffer(), seed], recoveryPrograms.factory);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), basket.toBuffer()], recoveryPrograms.factory);
  const [vaultAuthority, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), basket.toBuffer()], recoveryPrograms.basket);
  const data = Buffer.alloc(888);
  createHash("sha256").update("account:Basket").digest().subarray(0, 8).copy(data);
  factory.toBuffer().copy(data, 8); creator.toBuffer().copy(data, 40); treasury.toBuffer().copy(data, 72); shareMint.toBuffer().copy(data, 104);
  data.writeBigUInt64LE(nonce, 136); data.writeBigInt64LE(1_725_148_800n, 144); data.writeBigInt64LE(1_725_148_800n, 152);
  Buffer.alloc(32, 7).copy(data, 160); data[192] = 2;
  recoveryKey(1).toBuffer().copy(data, 193); recoveryKey(2).toBuffer().copy(data, 225);
  data.writeUInt16LE(5000, 833); data.writeUInt16LE(5000, 835); data[879] = basketBump; data[880] = vaultBump;
  const basketAccount = info(data, recoveryPrograms.basket);
  const holders = options.holders ?? [{ user: recoveryKey(20), amount: 1_000_000n }];
  const accounts = holders.map((holder, i) => recoveryTokenAccount(holder.user, shareMint, holder.amount, recoveryKey(100 + i)));
  const supply = options.supply ?? holders.reduce((total, holder) => total + holder.amount, 0n);
  const mintData = Buffer.alloc(82); mintData.writeUInt32LE(1, 0); vaultAuthority.toBuffer().copy(mintData, 4);
  mintData.writeBigUInt64LE(supply, 36); mintData[44] = 6; mintData[45] = 1;
  const mintAccount = info(mintData);
  const calls: Array<{ method: string; address: string; config: unknown }> = [];
  const rpc: PositionsSyncRpc = {
    async getAccountInfoAndContext(address, config) {
      calls.push({ method: "account", address: address.toBase58(), config });
      if (address.equals(basket)) return { context: { slot }, value: basketAccount };
      if (address.equals(shareMint)) return { context: { slot }, value: mintAccount };
      throw new Error("Unexpected account address");
    },
    async getProgramAccounts(programId, config) {
      calls.push({ method: "holders", address: programId.toBase58(), config });
      if (!programId.equals(TOKEN_2022_PROGRAM_ID) || config.filters[0]?.memcmp.bytes !== shareMint.toBase58()) throw new Error("Unexpected holder query");
      return { context: { slot }, value: accounts };
    },
  };
  return { basket, factory, creator, treasury, shareMint, vaultAuthority, basketAccount, mintAccount, accounts, supply, slot, rpc, calls, programs: recoveryPrograms };
}
export type PositionRecoveryFixture = ReturnType<typeof positionRecoveryFixture>;
