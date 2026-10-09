/**
 * Explicit maintenance entry point: canonical-history replay + NONDESTRUCTIVE
 * position staging only. Stop normal indexer before replay. No keys or signers.
 * node backend/dist/maintenance/replay-indexer.js --max-polls=100
 * Add --stage-basket=<address> after complete history to prepare a reviewed run.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { unpackMint, unpackAccount, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { connectFromEnv, disconnectFromEnv } from "../db/client.js";
import { applySchema } from "../db/init.js";
import { EventIndexer, indexerConfigFromEnv } from "../indexer/listener.js";
import { stagePositionRebuild } from "../indexer/positions.js";
import { decodeBasketState } from "../indexer/basketState.js";
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
  const account = await rpc.getAccountInfo(address,"finalized");
  if (!account) throw new Error("Basket account unavailable");
  const basket = decodeBasketState(address.toBase58(),account,{ basket:new PublicKey(cfg.basketProgramId),factory:new PublicKey(cfg.factoryProgramId) });
  // Two matching finalized supply reads bracket the authenticated full holder scan.
  const before = await rpc.getAccountInfoAndContext(new PublicKey(basket.shareMint),"finalized");
  if (!before.value) throw new Error("Share mint unavailable");
  const mint = unpackMint(new PublicKey(basket.shareMint),before.value,TOKEN_2022_PROGRAM_ID);
  if (!mint.isInitialized || mint.decimals !== 6 || !mint.mintAuthority?.equals(new PublicKey(basket.vaultAuthority))) throw new Error("Share mint authentication failed");
  const holders = await rpc.getProgramAccounts(TOKEN_2022_PROGRAM_ID,{ commitment:"finalized",withContext:true,minContextSlot:before.context.slot,filters:[{memcmp:{offset:0,bytes:basket.shareMint}}] });
  const totals = new Map<string,bigint>();
  for (const row of holders.value) {
    const token = unpackAccount(row.pubkey,row.account,TOKEN_2022_PROGRAM_ID);
    if (!token.isInitialized || !token.mint.equals(new PublicKey(basket.shareMint))) throw new Error("Holder authentication failed");
    const owner = token.owner.toBase58(); totals.set(owner,(totals.get(owner) ?? 0n) + token.amount);
  }
  const after = await rpc.getAccountInfoAndContext(new PublicKey(basket.shareMint),{commitment:"finalized",minContextSlot:holders.context.slot});
  if (!after.value || unpackMint(new PublicKey(basket.shareMint),after.value,TOKEN_2022_PROGRAM_ID).supply !== mint.supply) throw new Error("Supply changed during snapshot; retry staging");
  // Snapshot may include newer zero-net mint/redeem histories. Prove all three
  // program scans cover its exact slot after reading it; supply equality alone
  // is insufficient. A busy/failed poll cannot reuse old completion evidence.
  await replayThroughFinalizedSlot(indexer,db,cfg.programIds,budget,holders.context.slot,report);
  const staged = await stagePositionRebuild(db,address.toBase58(),cfg.programIds,{slot:holders.context.slot,supply:mint.supply.toString(),balances:[...totals].map(([user,shares]) => ({user,shares:shares.toString()}))});
  console.log(JSON.stringify({ ...staged, basket:basketArg, activeProjectionChanged:false }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode=1; }).finally(() => disconnectFromEnv());
