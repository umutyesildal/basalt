/** Reproduce the lab's Prepare sample -> Create basket path on the local validator. */
import { Connection, Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import { buildCreateManagedBasket } from "../app/lib/managed-chain";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const creator = Keypair.generate();
const guardian = Keypair.generate();

async function main() {
  const response = await fetch("http://localhost:3002/api/managed/lab/fixture", {
    method: "POST", headers: { Origin: "http://localhost:3002", "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: creator.publicKey.toBase58() }),
  });
  if (!response.ok) throw new Error(`Fixture HTTP ${response.status}: ${await response.text()}`);
  const fixture = await response.json() as { tokenA: string; tokenB: string };
  const { PublicKey } = await import("@solana/web3.js");
  const creation = buildCreateManagedBasket({
    creator: creator.publicKey, guardian: guardian.publicKey, nonce: BigInt(Date.now()),
    mints: [new PublicKey(fixture.tokenA), new PublicKey(fixture.tokenB)],
    weightsBps: [5_000, 5_000], seedsRaw: [10_000_000n, 10_000_000n], noticeSlots: 216_000n,
  });
  const blockhash = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: creator.publicKey, recentBlockhash: blockhash.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }), creation.instruction],
  }).compileToV0Message());
  const simulation = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  if (simulation.value.err) throw new Error(`Simulation: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n")}`);
  tx.sign([creator]);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err) throw new Error(`Transaction: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      console.log(JSON.stringify({ result: "PASS", basket: creation.basket.toBase58(), signature, units: simulation.value.unitsConsumed }));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  throw new Error("Transaction confirmation timed out.");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
