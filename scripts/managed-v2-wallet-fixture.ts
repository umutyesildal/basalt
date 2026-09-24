/**
 * Give a browser wallet two extension-free local Token-2022 mock assets.
 * This runs against loopback only. The temporary mint authority is revoked
 * after minting; no fixture keypair is saved or printed.
 *
 * Usage: npx tsx scripts/managed-v2-wallet-fixture.ts <wallet-pubkey>
 */
import {
  AuthorityType,
  TOKEN_2022_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const endpoint = process.env.MANAGED_V2_RPC_URL ?? "http://127.0.0.1:8899";
const url = new URL(endpoint);
if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  throw new Error("Managed wallet fixtures are allowed only on a loopback local validator.");
}
if (!process.argv[2]) throw new Error("Pass the public key of your connected browser wallet.");
const recipient = new PublicKey(process.argv[2]);
const connection = new Connection(endpoint, "confirmed");
const payer = Keypair.generate();

async function airdrop(to: PublicKey, lamports: number) {
  const signature = await connection.requestAirdrop(to, lamports);
  const blockhash = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...blockhash }, "confirmed");
}

async function createLocalAsset(): Promise<PublicKey> {
  const mint = await createMint(connection, payer, payer.publicKey, null, 6, undefined, { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  const account = await getOrCreateAssociatedTokenAccount(connection, payer, mint, recipient, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
  await mintTo(connection, payer, mint, account.address, payer, 100_000_000n, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  await setAuthority(connection, payer, mint, payer.publicKey, AuthorityType.MintTokens, null, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  return mint;
}

async function main() {
  await airdrop(payer.publicKey, 5_000_000_000);
  await airdrop(recipient, 2_000_000_000);
  const tokenA = await createLocalAsset();
  const tokenB = await createLocalAsset();
  console.log(JSON.stringify({
    network: "localnet",
    wallet: recipient.toBase58(),
    tokenA: tokenA.toBase58(),
    tokenB: tokenB.toBase58(),
    balanceEach: "100",
    meaning: "project mock tokens; no xStocks or live value",
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
