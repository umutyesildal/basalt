import { Buffer } from "buffer";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, unpackMint, unpackAccount, getAssociatedTokenAddressSync } from "./token-2022";
import { APP_NAMESPACE_ROUTING, DEVNET_GENESIS_HASH, namespacePrograms, type NamespaceRouting } from "./program-namespaces";
import { MANAGEMENT_FEE_DENOMINATOR } from "../../backend/src/workers/feeMath";
import type { BasketCoreKeys } from "./transactions";

const fail = (): never => { throw new Error("Basket owner, layout, discriminator or PDA does not match a registered devnet namespace."); };
const key = (data: Buffer, offset: number) => new PublicKey(data.subarray(offset, offset + 32));
const checked = (account: AccountInfo<Buffer> | null, owner: PublicKey, size: number, disc?: string) => {
  if (!account || account.executable || !account.owner.equals(owner) || account.data.length < size || (disc && account.data.subarray(0, 8).toString("hex") !== disc)) return fail();
  return account;
};
/** Authenticate immutable identities before trusting an API row or deriving wallet accounts. */
export function authenticateBasketAccount(address: PublicKey, account: AccountInfo<Buffer>, routing: NamespaceRouting = APP_NAMESPACE_ROUTING) {
  if (account.data.length < 886) return fail();
  const data = account.data, factory = key(data, 8), namespace = routing.forFactory(factory.toBase58()), programs = namespacePrograms(namespace);
  checked(account, programs.basket, 886, "db4f6b87e7f3daf8");
  const creator = key(data, 40), treasury = key(data, 72), shareMint = key(data, 104), nonce = data.subarray(136, 144);
  const [basket, basketBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), factory.toBuffer(), creator.toBuffer(), nonce], programs.factory);
  const [share] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), address.toBuffer()], programs.factory);
  const [vaultAuthority, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), address.toBuffer()], programs.basket);
  const count = data[192], constituents = Array.from({ length: Math.min(count, 20) }, (_, i) => key(data, 193 + i * 32).toBase58());
  const weights = constituents.map((_, i) => data.readUInt16LE(833 + i * 2));
  if (!address.equals(basket) || !share.equals(shareMint) || data[879] !== basketBump || data[880] !== vaultBump ||
      creator.equals(PublicKey.default) || treasury.equals(PublicKey.default) || count < 2 || count > 20 ||
      new Set(constituents).size !== count || constituents.includes(PublicKey.default.toBase58()) ||
      weights.some(w => w === 0) || weights.reduce((a, b) => a + b, 0) !== 10_000 ||
      data.readUInt16LE(873) > 300 || data.readUInt16LE(875) > 100 || data.readUInt16LE(877) > 300 ||
      data.subarray(160, 192).every(b => b === 0) || data.readBigInt64LE(144) < 0n || data.readBigInt64LE(152) < data.readBigInt64LE(144) || BigInt(data.readUIntLE(881, 5)) >= MANAGEMENT_FEE_DENOMINATOR) return fail();
  return { namespace, programs, factory, creator, treasury, shareMint, constituents, vaultAuthority };
}

/** Factory share mints are plain initialized Token-2022 mints, with no extensions or freeze authority. */
export function authenticateBasketShareMint(address: PublicKey, account: AccountInfo<Buffer> | null, vaultAuthority: PublicKey) {
  const info = checked(account, TOKEN_2022_PROGRAM_ID, 82);
  if (info.data.length !== 82 || info.data[45] !== 1 || info.data.readUInt32LE(0) !== 1 || info.data.readUInt32LE(46) !== 0) return fail();
  const share = unpackMint(address, info, TOKEN_2022_PROGRAM_ID);
  if (share.decimals !== 6 || !share.mintAuthority?.equals(vaultAuthority) || share.freezeAuthority !== null) return fail();
  return share;
}

/** Read-only RPC validation. Redemption never requires whitelist status, pricing, or backend health. */
export async function assertBasketCoreKeysOnChain(connection: Pick<Connection, "getGenesisHash" | "getAccountInfo" | "getMultipleAccountsInfo">, keys: BasketCoreKeys, routing: NamespaceRouting = APP_NAMESPACE_ROUTING): Promise<void> {
  // Resolve locally first: unknown factories must fail before wallet/setup or RPC work.
  routing.forFactory(keys.factory.toBase58());
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) return fail();
  const account = await connection.getAccountInfo(keys.basket, "finalized");
  if (!account) return fail();
  const authenticated = authenticateBasketAccount(keys.basket, account, routing);
  if (!authenticated.factory.equals(keys.factory) || !authenticated.creator.equals(keys.creator) || !authenticated.treasury.equals(keys.treasury) ||
      !authenticated.shareMint.equals(keys.shareMint) || JSON.stringify(authenticated.constituents) !== JSON.stringify(keys.constituents)) return fail();
  const mints = keys.constituents.map(m => new PublicKey(m));
  const vaults = mints.map(m => getAssociatedTokenAddressSync(m, authenticated.vaultAuthority, true, TOKEN_2022_PROGRAM_ID));
  const accounts = await connection.getMultipleAccountsInfo([keys.factory, keys.shareMint, ...vaults], "finalized");
  if (accounts.length !== vaults.length + 2) return fail();
  const f = checked(accounts[0], authenticated.programs.factory, 89, "1dc5ffe81680431a").data;
  const [, bump] = PublicKey.findProgramAddressSync([Buffer.from("factory")], authenticated.programs.factory);
  if (!key(f, 40).equals(keys.treasury) || f[88] !== bump || f.readUInt16LE(72) !== 9_000 || f.readUInt16LE(74) !== 300 || f.readUInt16LE(76) !== 100 || f.readUInt16LE(78) !== 300) return fail();
  authenticateBasketShareMint(keys.shareMint, accounts[1], authenticated.vaultAuthority);
  vaults.forEach((vault, i) => {
    const token = unpackAccount(vault, checked(accounts[i + 2], TOKEN_2022_PROGRAM_ID, 165), TOKEN_2022_PROGRAM_ID);
    if (!token.isInitialized || !token.mint.equals(mints[i]) || !token.owner.equals(authenticated.vaultAuthority)) fail();
  });
}
