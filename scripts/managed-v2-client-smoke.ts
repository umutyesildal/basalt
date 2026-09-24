/** Proves that the browser's Managed V2 instruction builders execute on localnet. */
import {
  TOKEN_2022_PROGRAM_ID, createMint, getAccount, getMint,
  getOrCreateAssociatedTokenAccount, mintTo,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram, Connection, Keypair, TransactionMessage, VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  MANAGED_PROGRAM_ID, buildApproveManagedMix, buildCreateManagedBasket,
  buildMintManagedShares, buildProposeManagedMix, buildRedeemManagedShares,
  decodeManagedBasket, decodeManagedProposal, proposalPda, tokenAta, vaultAuthorityPda,
} from "../app/lib/managed-chain";

const endpoint = process.env.MANAGED_V2_RPC_URL ?? "http://127.0.0.1:8899";
const url = new URL(endpoint);
if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  throw new Error("Client smoke runs only against a loopback local validator.");
}
const connection = new Connection(endpoint, "confirmed");

async function fund(wallet: Keypair) {
  const signature = await connection.requestAirdrop(wallet.publicKey, 5_000_000_000);
  const blockhash = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...blockhash }, "confirmed");
}

async function send(wallet: Keypair, instruction: TransactionInstruction): Promise<string> {
  const blockhash = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }), instruction],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const simulation = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  if (simulation.value.err) throw new Error(`Client transaction simulation failed: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n")}`);
  tx.sign([wallet]);
  const signature = await connection.sendTransaction(tx, { skipPreflight: true });
  await connection.confirmTransaction({ signature, ...blockhash }, "confirmed");
  return signature;
}

async function main() {
  const program = await connection.getAccountInfo(MANAGED_PROGRAM_ID, "confirmed");
  if (!program?.executable) throw new Error("Start scripts/managed-v2-lab.sh first.");
  const creator = Keypair.generate();
  const holder = Keypair.generate();
  const guardian = Keypair.generate();
  await Promise.all([fund(creator), fund(holder), fund(guardian)]);
  const mintA = await createMint(connection, creator, creator.publicKey, null, 6, undefined, { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  const mintB = await createMint(connection, creator, creator.publicKey, null, 6, undefined, { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  for (const mint of [mintA, mintB]) {
    for (const wallet of [creator, holder]) {
      const ata = await getOrCreateAssociatedTokenAccount(connection, creator, mint, wallet.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
      await mintTo(connection, creator, mint, ata.address, creator, 100_000_000n, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
    }
  }
  const creation = buildCreateManagedBasket({
    creator: creator.publicKey, guardian: guardian.publicKey, nonce: BigInt(Date.now()),
    mints: [mintA, mintB], weightsBps: [5_000, 5_000],
    seedsRaw: [50_000_000n, 50_000_000n], noticeSlots: 216_000n,
  });
  const signatures: string[] = [];
  signatures.push(await send(creator, creation.instruction));
  let info = await connection.getAccountInfo(creation.basket, "confirmed");
  if (!info || !info.owner.equals(MANAGED_PROGRAM_ID)) throw new Error("Create did not make a Managed basket.");
  let state = decodeManagedBasket(info.data);
  if (!state.guardian.equals(guardian.publicKey) || state.noticeSlots !== 216_000n) throw new Error("Create terms mismatch.");
  const identity = await getMint(connection, state.identityMint, "confirmed", TOKEN_2022_PROGRAM_ID);
  if (identity.supply !== 1n || identity.mintAuthority !== null) throw new Error("Identity token is not supply-one and immutable.");
  signatures.push(await send(holder, buildMintManagedShares(creation.basket, state, holder.publicKey, [5_000_000n, 5_000_000n])));
  const holderShares = await getAccount(connection, tokenAta(holder.publicKey, state.shareMint), "confirmed", TOKEN_2022_PROGRAM_ID);
  if (holderShares.amount !== 100_000n) throw new Error("Holder did not receive 0.1 basket share.");
  signatures.push(await send(creator, buildProposeManagedMix(creation.basket, state, creator.publicKey, [4_000, 6_000], mintA, 1_000_000n)));
  info = await connection.getAccountInfo(creation.basket, "confirmed");
  if (!info) throw new Error("Basket disappeared.");
  state = decodeManagedBasket(info.data);
  if (state.pendingProposalNonce !== 0n || state.version !== 0n) throw new Error("Proposal changed current holdings/version.");
  signatures.push(await send(guardian, buildApproveManagedMix(creation.basket, guardian.publicKey, 0n, 750_000n)));
  const proposalInfo = await connection.getAccountInfo(proposalPda(creation.basket, 0n), "confirmed");
  if (!proposalInfo || decodeManagedProposal(proposalInfo.data).status !== 1) throw new Error("Guardian approval not recorded.");
  signatures.push(await send(holder, buildRedeemManagedShares(creation.basket, state, holder.publicKey, 50_000n)));
  const vaultA = await getAccount(connection, tokenAta(vaultAuthorityPda(creation.basket), mintA), "confirmed", TOKEN_2022_PROGRAM_ID);
  const vaultB = await getAccount(connection, tokenAta(vaultAuthorityPda(creation.basket), mintB), "confirmed", TOKEN_2022_PROGRAM_ID);
  const holderAfter = await getAccount(connection, tokenAta(holder.publicKey, state.shareMint), "confirmed", TOKEN_2022_PROGRAM_ID);
  if (holderAfter.amount !== 50_000n || vaultA.amount !== 52_500_000n || vaultB.amount !== 52_500_000n) {
    throw new Error("Notice-period redemption did not match live vault balances.");
  }
  console.log(JSON.stringify({ result: "PASS", basket: creation.basket.toBase58(), signatures, holderSharesRaw: holderAfter.amount.toString(), vaultRaw: [vaultA.amount.toString(), vaultB.amount.toString()] }, null, 2));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
