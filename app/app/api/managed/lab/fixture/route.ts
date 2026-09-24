import { NextRequest, NextResponse } from "next/server";
import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";

import { MANAGED_PROGRAM_ID, isLocalManagedEndpoint, tokenAta } from "@/lib/managed-chain";
import { CLUSTER, RPC_ENDPOINT } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DemoFixture = { wallet: string; tokenA: string; tokenB: string; balanceEach: "100" };
const fixtures = new Map<string, Promise<DemoFixture>>();

function localRequest(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== "development" || !isLocalManagedEndpoint(CLUSTER, RPC_ENDPOINT)) return false;
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === url.origin; }
  catch { return false; }
}

async function airdrop(connection: Connection, recipient: PublicKey, lamports: number) {
  const signature = await connection.requestAirdrop(recipient, lamports);
  await confirmHttp(connection, signature);
}

async function confirmHttp(connection: Connection, signature: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err) throw new Error(`Local transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  throw new Error("Local transaction confirmation timed out.");
}

async function sendHttp(connection: Connection, payer: Keypair, instructions: TransactionInstruction[], extraSigners: Keypair[] = []) {
  const blockhash = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash.blockhash });
  tx.add(...instructions);
  tx.sign(payer, ...extraSigners);
  const signature = await connection.sendRawTransaction(tx.serialize());
  await confirmHttp(connection, signature);
}

async function createFixture(connection: Connection, wallet: PublicKey): Promise<DemoFixture> {
  const program = await connection.getAccountInfo(MANAGED_PROGRAM_ID, "confirmed");
  if (!program?.executable) throw new Error("Start the Managed V2 local validator first.");

  const payer = Keypair.generate();
  await airdrop(connection, payer.publicKey, 5_000_000_000);
  if ((await connection.getBalance(wallet, "confirmed")) < 1_000_000_000) {
    await airdrop(connection, wallet, 2_000_000_000);
  }
  async function mockMint(): Promise<PublicKey> {
    const mint = Keypair.generate();
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE, "confirmed");
    await sendHttp(connection, payer, [
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_2022_PROGRAM_ID }),
      createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    ], [mint]);
    const ata = getAssociatedTokenAddressSync(mint.publicKey, wallet, false, TOKEN_2022_PROGRAM_ID);
    await sendHttp(connection, payer, [
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, wallet, mint.publicKey, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(mint.publicKey, ata, payer.publicKey, 100_000_000n, [], TOKEN_2022_PROGRAM_ID),
      createSetAuthorityInstruction(mint.publicKey, payer.publicKey, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
    ]);
    return mint.publicKey;
  }
  const tokenA = await mockMint();
  const tokenB = await mockMint();
  return { wallet: wallet.toBase58(), tokenA: tokenA.toBase58(), tokenB: tokenB.toBase58(), balanceEach: "100" };
}

/** A local-only convenience endpoint; it is unavailable in every production build. */
export async function POST(request: NextRequest) {
  if (!localRequest(request)) return new NextResponse(null, { status: 404 });
  let wallet: PublicKey;
  let mode: "tokens" | "sol" = "tokens";
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || typeof (body as { wallet?: unknown }).wallet !== "string") throw new Error("Missing wallet.");
    wallet = new PublicKey((body as { wallet: string }).wallet);
    if (!PublicKey.isOnCurve(wallet.toBytes())) throw new Error("Connect a regular wallet.");
    const requestedMode = (body as { mode?: unknown }).mode;
    if (requestedMode !== undefined && requestedMode !== "sol") throw new Error("Invalid sample mode.");
    if (requestedMode === "sol") mode = "sol";
  } catch {
    return NextResponse.json({ error: "Connect a valid wallet first." }, { status: 400 });
  }

  const address = wallet.toBase58();
  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  if (mode === "sol") {
    try {
      if ((await connection.getBalance(wallet, "confirmed")) < 1_000_000_000) await airdrop(connection, wallet, 2_000_000_000);
      return NextResponse.json({ wallet: address, balanceLamports: await connection.getBalance(wallet, "confirmed") }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Local SOL setup failed." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
  const existing = fixtures.get(address);
  if (existing) {
    try {
      const result = await existing;
      const [a, b, balanceA, balanceB] = await Promise.all([
        connection.getAccountInfo(new PublicKey(result.tokenA), "confirmed"),
        connection.getAccountInfo(new PublicKey(result.tokenB), "confirmed"),
        connection.getTokenAccountBalance(tokenAta(wallet, new PublicKey(result.tokenA)), "confirmed"),
        connection.getTokenAccountBalance(tokenAta(wallet, new PublicKey(result.tokenB)), "confirmed"),
      ]);
      if (a && b && BigInt(balanceA.value.amount) >= 10_000_000n && BigInt(balanceB.value.amount) >= 10_000_000n) {
        return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
      }
    } catch { /* Stale fixture after a validator reset; create a fresh pair. */ }
  }

  const pending = createFixture(connection, wallet);
  fixtures.set(address, pending);
  try {
    const result = await pending;
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    fixtures.delete(address);
    const message = error instanceof Error ? error.message : "Local sample setup failed.";
    return NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
