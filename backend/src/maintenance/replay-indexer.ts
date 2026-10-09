/**
 * Candidate-only archival replay and NONDESTRUCTIVE position staging.
 * Set CANDIDATE_DATABASE_URL, RELEASE_SOURCE_SHA, RPC_URL and PROGRAM_*.
 * node backend/dist/maintenance/replay-indexer.js --manifest=/private/candidate.json --max-polls=100
 * Add --stage-basket=<address> to prepare a separately reviewed run. Never activates.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { applySchema } from "../db/init.js";
import { EventIndexer, indexerConfigFromEnv } from "../indexer/listener.js";
import { stagePositionRebuild } from "../indexer/positions.js";
import { fetchFinalizedPositionSnapshot } from "../indexer/positionsSync.js";
import { replayThroughFinalizedSlot } from "./historyReadiness.js";
import {
  loadCandidateContext, assertCandidateIdentity, openCandidateDatabase, candidateRpc, candidateProgramSet, RecoveryOperatorError,
} from "./recovery-operator.js";

export const REPLAY_HELP = [
  "Candidate-only finalized archival replay. Never activates positions.",
  "--manifest=/private/candidate.json is required before ANY schema/history writes.",
  "Set CANDIDATE_DATABASE_URL, RELEASE_SOURCE_SHA, RPC_URL and all three PROGRAM_*.",
  "Optional --max-polls=1..10000 (default1), --timeout-seconds=5..300 (default300),",
  "--stage-basket=<canonical-address>. Replay and post-snapshot catch-up share the budget.",
  "On exhaustion rerun the same candidate to continue its durable checkpoint.",
  "Inspect/export/review with recovery-operator.js before any explicit candidate activation.",
].join("\n");
export function parseReplayArgs(args: string[]) {
  const values = new Map<string,string>();
  for (const arg of args) {
    const match = /^--(manifest|max-polls|stage-basket|timeout-seconds)=(.+)$/.exec(arg);
    if (!match || values.has(match[1])) throw new RecoveryOperatorError("Unknown, malformed or duplicate replay option");
    values.set(match[1],match[2]);
  }
  const manifestPath = values.get("manifest");
  if (!manifestPath) throw new RecoveryOperatorError("Explicit candidate --manifest is required");
  if (["timeout-seconds","max-polls"].some(key => values.has(key) && !/^[0-9]+$/.test(values.get(key)!))) throw new RecoveryOperatorError("Integer replay budgets required");
  const maxPolls = Number(values.get("max-polls") ?? 1), timeoutSeconds = Number(values.get("timeout-seconds") ?? 300);
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 10_000 || !Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 300) throw new RecoveryOperatorError("Invalid replay poll/time budget");
  const basketArg = values.get("stage-basket");
  if (basketArg) {
    try {
      const address = new PublicKey(basketArg);
      if (address.equals(PublicKey.default) || address.toBase58() !== basketArg) throw new Error();
    } catch { throw new RecoveryOperatorError("Canonical nonzero stage-basket required"); }
  }
  return { manifestPath,maxPolls,timeoutSeconds,basketArg };
}
export async function runCandidateReplay(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const options = parseReplayArgs(args);
  const context = await loadCandidateContext(options.manifestPath,env);
  const cfg = indexerConfigFromEnv(env), ids = context.manifest.programIds;
  if (!cfg || cfg.basketProgramId !== ids.basket || cfg.factoryProgramId !== ids.factory || cfg.whitelistProgramId !== ids.whitelist) throw new RecoveryOperatorError("Explicit RPC_URL/program roles must match the candidate manifest");
  const signal = AbortSignal.timeout(options.timeoutSeconds * 1000);
  const db = openCandidateDatabase(context,signal);
  try {
    // Identity and devnet are authenticated before schema bootstrap or replay.
    await assertCandidateIdentity(db,context);
    const rpc = candidateRpc(cfg.rpcUrl,signal);
    if (await rpc.getGenesisHash() !== context.manifest.genesisHash) throw new RecoveryOperatorError("RPC does not report the reviewed devnet genesis");
    if (!(await applySchema(db))) throw new RecoveryOperatorError("Candidate schema unavailable");
    const indexer = new EventIndexer(rpc,{...cfg,replayOnly:true},db);
    const budget = {remaining:options.maxPolls,polls:0};
    const report = (progress:Record<string,unknown>) => console.log(JSON.stringify(progress));
    await replayThroughFinalizedSlot(indexer,db,cfg.programIds,budget,0,report);
    if (!options.basketArg) return;
    const proofPrograms = candidateProgramSet(context.manifest);
    const snapshot = await fetchFinalizedPositionSnapshot(rpc,options.basketArg,proofPrograms);
    // A fresh discovery after the snapshot rules out omitted zero-net history.
    await replayThroughFinalizedSlot(indexer,db,cfg.programIds,budget,snapshot.slot,report);
    const staged = await stagePositionRebuild(db,options.basketArg,proofPrograms.ids,snapshot);
    console.log(JSON.stringify({...staged,basket:options.basketArg,candidateId:context.manifest.candidateId,activeProjectionChanged:false}));
  } finally { await db.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--help") console.log(REPLAY_HELP);
  else runCandidateReplay(process.argv.slice(2)).catch(error=>{
    console.error(error instanceof RecoveryOperatorError ? error.message : "Candidate replay failed; inspect private candidate diagnostics and rerun the same durable checkpoint");
    process.exitCode=1;
  });
}
