/**
 * Explicit maintenance entry point: canonical-history replay + NONDESTRUCTIVE
 * position staging only. Stop normal indexer before replay. No keys or signers.
 * node backend/dist/maintenance/replay-indexer.js --max-polls=100
 * Add --stage-basket=<address> after complete history to prepare a reviewed run.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { connectFromEnv, disconnectFromEnv } from "../db/client.js";
import { applySchema } from "../db/init.js";
import { EventIndexer, indexerConfigFromEnv } from "../indexer/listener.js";
import { stagePositionRebuild } from "../indexer/positions.js";
import { fetchFinalizedPositionSnapshot } from "../indexer/positionsSync.js";
import { replayThroughFinalizedSlot } from "./historyReadiness.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => !/^--(?:max-polls=\d+|stage-basket=[1-9A-HJ-NP-Za-km-z]+)$/.test(arg))) throw new Error("Supported options: --max-polls=1..10000 --stage-basket=<address>");
  const maxPolls = Number(args.find((a) => a.startsWith("--max-polls="))?.split("=")[1] ?? 1);
  if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > 10_000) throw new Error("Invalid max-polls budget");
  const cfg = indexerConfigFromEnv();
  if (!cfg?.basketProgramId || !cfg.factoryProgramId || !cfg.whitelistProgramId || new Set(cfg.programIds).size !== 3 || !process.env.DATABASE_URL) throw new Error("Explicit DATABASE_URL, RPC_URL and all program IDs are required");
  const db = await connectFromEnv();
  if (!db || !(await applySchema(db))) throw new Error("Database/schema unavailable");
  const rpc = new Connection(cfg.rpcUrl, { commitment: "finalized", disableRetryOnRateLimit: true });
  const indexer = new EventIndexer(rpc, { ...cfg, replayOnly: true }, db);
  const budget = {remaining:maxPolls,polls:0};
  const report = (progress:Record<string,unknown>) => console.log(JSON.stringify(progress));
  await replayThroughFinalizedSlot(indexer,db,cfg.programIds,budget,0,report);
  const basketArg = args.find((arg) => arg.startsWith("--stage-basket="))?.split("=")[1];
  if (!basketArg) return;
  const address = new PublicKey(basketArg);
  const snapshot = await fetchFinalizedPositionSnapshot(rpc, address.toBase58(), {
    basket: new PublicKey(cfg.basketProgramId),
    factory: new PublicKey(cfg.factoryProgramId),
    ids: cfg.programIds,
  });
  // Prove discovery through the authenticated holder snapshot after reading it.
  // Supply equality alone cannot detect omitted zero-net mint/redeem history.
  await replayThroughFinalizedSlot(indexer, db, cfg.programIds, budget, snapshot.slot, report);
  const staged = await stagePositionRebuild(db, address.toBase58(), cfg.programIds, snapshot);
  console.log(JSON.stringify({ ...staged, basket:basketArg, activeProjectionChanged:false }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode=1; }).finally(() => disconnectFromEnv());
