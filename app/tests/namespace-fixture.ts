import { Buffer } from "buffer";
import { Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import { PROGRAM_NAMESPACES, DEVNET_GENESIS_HASH, type ProgramNamespace } from "../../backend/src/config/programNamespaces";
import { createNamespaceRouting, namespacePrograms } from "../lib/program-namespaces";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "../lib/token-2022";
import type { BasketCoreKeys } from "../lib/transactions";
import { factoryFixture } from "./factory-fixture";

export const TEST_TREASURY = new PublicKey(Buffer.alloc(32, 91));
const program = (seed: number) => Keypair.fromSeed(Buffer.alloc(32, seed)).publicKey.toBase58();
const programs = { whitelist: program(201), factory: program(202), basket: program(203) };
export const TEST_NAMESPACE: ProgramNamespace = {
  id: "devnet-test-clean", genesisHash: DEVNET_GENESIS_HASH, programs,
  factoryConfig: PublicKey.findProgramAddressSync([Buffer.from("factory")], new PublicKey(programs.factory))[0].toBase58(),
  whitelistConfig: PublicKey.findProgramAddressSync([Buffer.from("config")], new PublicKey(programs.whitelist))[0].toBase58(),
  creation: { enabled: true, treasury: TEST_TREASURY.toBase58() },
};
export const TEST_ROUTING = createNamespaceRouting([PROGRAM_NAMESPACES[0], TEST_NAMESPACE], TEST_NAMESPACE.id);
export function routedBasketFixture(options: { namespace?: ProgramNamespace; nonce?: bigint; user?: PublicKey; creator?: PublicKey; treasury?: PublicKey; constituents?: string[] } = {}) {
  const namespace = options.namespace ?? PROGRAM_NAMESPACES[0], p = namespacePrograms(namespace);
  const creator = options.creator ?? new PublicKey(Buffer.alloc(32, 8)), user = options.user ?? new PublicKey(Buffer.alloc(32, 7)), treasury = options.treasury ?? TEST_TREASURY;
  const constituents = options.constituents ?? [10, 11].map(n => new PublicKey(Buffer.alloc(32, n)).toBase58());
  const nonce = Buffer.alloc(8); nonce.writeBigUInt64LE(options.nonce ?? 42n);
  const factory = new PublicKey(namespace.factoryConfig);
  const [basket, bump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), factory.toBuffer(), creator.toBuffer(), nonce], p.factory);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), basket.toBuffer()], p.factory);
  const [vault, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), basket.toBuffer()], p.basket);
  const data = Buffer.alloc(888); data.set([219,79,107,135,231,243,218,248]);
  factory.toBuffer().copy(data, 8); creator.toBuffer().copy(data, 40); treasury.toBuffer().copy(data, 72); shareMint.toBuffer().copy(data, 104); nonce.copy(data, 136);
  data.writeBigInt64LE(1_700_000_000n, 144); data.writeBigInt64LE(1_700_000_000n, 152); data.fill(1, 160, 192); data[192] = constituents.length;
  constituents.forEach((m, i) => { new PublicKey(m).toBuffer().copy(data, 193 + 32 * i); data.writeUInt16LE(10_000 / constituents.length, 833 + 2 * i); });
  data[879] = bump; data[880] = vaultBump;
  const info = (owner: PublicKey, bytes: Buffer): AccountInfo<Buffer> => ({ owner, data: bytes, executable: false, lamports: 1 });
  const share = Buffer.alloc(82); share.writeUInt32LE(1); vault.toBuffer().copy(share, 4); share.writeBigUInt64LE(1_000_000n, 36); share[44] = 6; share[45] = 1;
  const accounts = new Map<string, AccountInfo<Buffer>>([
    [basket.toBase58(), info(p.basket, data)], [factory.toBase58(), factoryFixture(treasury, namespace)], [shareMint.toBase58(), info(TOKEN_2022_PROGRAM_ID, share)],
  ]);
  for (const m of constituents) {
    const mint = new PublicKey(m), address = getAssociatedTokenAddressSync(mint, vault, true, TOKEN_2022_PROGRAM_ID);
    const bytes = Buffer.alloc(165); mint.toBuffer().copy(bytes); vault.toBuffer().copy(bytes, 32); bytes.writeBigUInt64LE(1_000_000n, 64); bytes[108] = 1;
    accounts.set(address.toBase58(), info(TOKEN_2022_PROGRAM_ID, bytes));
  }
  const keys: BasketCoreKeys = { basket, factory, creator, treasury, shareMint, constituents, user };
  return { namespace, keys, accounts, data, vault };
}
