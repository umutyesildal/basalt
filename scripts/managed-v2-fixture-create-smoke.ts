/** Reproduce the lab's sample/create/propose/approve/redeem path on localnet. */
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
import {
  buildApproveManagedMix, buildCreateManagedBasket, buildProposeManagedMix, buildRedeemManagedShares,
  decodeManagedBasket, decodeManagedProposal, proposalPda, tokenAta, vaultAuthorityPda,
} from "../app/lib/managed-chain";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const creator = Keypair.generate();
const guardian = Keypair.generate();

async function sample(wallet: PublicKey, mode?: "sol") {
  const response = await fetch("http://localhost:3002/api/managed/lab/fixture", {
    method: "POST", headers: { Origin: "http://localhost:3002", "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: wallet.toBase58(), mode }),
  });
  if (!response.ok) throw new Error(`Fixture HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ tokenA?: string; tokenB?: string; balanceLamports?: number }>;
}

async function send(wallet: Keypair, instruction: TransactionInstruction): Promise<string> {
  const blockhash = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet.publicKey, recentBlockhash: blockhash.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }), instruction],
  }).compileToV0Message());
  const simulation = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  if (simulation.value.err) throw new Error(`Simulation: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n")}`);
  tx.sign([wallet]);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err) throw new Error(`Transaction: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  throw new Error("Transaction confirmation timed out.");
}

async function main() {
  const fixture = await sample(creator.publicKey);
  const guardianFunds = await sample(guardian.publicKey, "sol");
  if (!fixture.tokenA || !fixture.tokenB || !guardianFunds.balanceLamports || guardianFunds.balanceLamports < 1_000_000_000) throw new Error("Sample setup did not fund both roles.");
  const mints: [PublicKey, PublicKey] = [new PublicKey(fixture.tokenA), new PublicKey(fixture.tokenB)];
  const creation = buildCreateManagedBasket({
    creator: creator.publicKey, guardian: guardian.publicKey, nonce: BigInt(Date.now()),
    mints,
    weightsBps: [5_000, 5_000], seedsRaw: [10_000_000n, 10_000_000n], noticeSlots: 216_000n,
  });
  const signatures = [await send(creator, creation.instruction)];
  const info = await connection.getAccountInfo(creation.basket, "confirmed");
  if (!info) throw new Error("Created basket was not found.");
  const state = decodeManagedBasket(info.data);
  signatures.push(await send(creator, buildProposeManagedMix(creation.basket, state, creator.publicKey, [4_000, 6_000], mints[0], 1_000_000n)));
  signatures.push(await send(guardian, buildApproveManagedMix(creation.basket, guardian.publicKey, 0n, 750_000n)));
  const proposalInfo = await connection.getAccountInfo(proposalPda(creation.basket, 0n), "confirmed");
  if (!proposalInfo || decodeManagedProposal(proposalInfo.data).status !== 1) throw new Error("Guardian approval did not reach the proposal account.");
  signatures.push(await send(creator, buildRedeemManagedShares(creation.basket, state, creator.publicKey, 100_000n)));
  const [vaultA, vaultB, shares] = await Promise.all([
    connection.getTokenAccountBalance(tokenAta(vaultAuthorityPda(creation.basket), mints[0]), "confirmed"),
    connection.getTokenAccountBalance(tokenAta(vaultAuthorityPda(creation.basket), mints[1]), "confirmed"),
    connection.getTokenAccountBalance(tokenAta(creator.publicKey, state.shareMint), "confirmed"),
  ]);
  if (vaultA.value.amount !== "9000000" || vaultB.value.amount !== "9000000" || shares.value.amount !== "900000") {
    throw new Error("Notice-period redemption did not produce the expected balances.");
  }
  console.log(JSON.stringify({ result: "PASS", basket: creation.basket.toBase58(), signatures, vaultRaw: [vaultA.value.amount, vaultB.value.amount], sharesRaw: shares.value.amount }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
