import { PROGRAM_NAMESPACES, registeredProgramIds, validateNamespaceRegistry, type ProgramNamespace } from "../config/programNamespaces.js";
/**
 * Candidate-only operator. Default inspect/export never modify the database.
 * Activation reuses the reviewed atomic API; no bootstrap/worker calls this CLI.
 */
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, isAbsolute, basename } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { Connection, PublicKey } from "@solana/web3.js";
import { withTransaction, type PgLike } from "../db/client.js";
import { activateStagedPositionRebuild, type PositionRecoveryReceipt } from "../indexer/positionRecovery.js";
import { EventIndexer } from "../indexer/listener.js";
import { replayThroughFinalizedSlot } from "./historyReadiness.js";

export const RELEASE_PROGRAM_IDS = Object.freeze({
  basket:"6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k",
  factory:"3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF",
  whitelist:"FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS",
});
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_SHA = /^[a-f0-9]{40}$/;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_POSITIONS = 10_000;
const MAX_CLAIMS = 100_000;
const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort(ordinal)
    .map(key => JSON.stringify(key) + ":" + stable((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
};
export class RecoveryOperatorError extends Error {}

export interface CandidateManifest {
  schemaVersion: 1;
  candidateId: string;
  databaseName: string;
  sourceDatabase: "foliox";
  sourceSha: string;
  backupSha256: string;
  programIds: { basket: string; factory: string; whitelist: string };
  genesisHash: typeof DEVNET_GENESIS;
  snapshotAt?: string;
  backupFile?: string;
}
export interface CandidateContext {
  manifest: CandidateManifest;
  manifestSha256: string;
  /** Private connection string, deliberately excluded from reports and artifacts. */
  databaseUrl: string;
}
export interface CandidateDatabase extends PgLike { end(): Promise<void> }
type ReviewedRun = {
  runId: string; basket: string; historyHash: string; programIds: string[];
  chainSlot: string; chainSupply: string; eventCount: number; createdAt: string;
};
type StagedEvidence = { positionCount: number; positionsSha256: string; claimCount: number; claimsSha256: string };
export interface RecoveryReview {
  schemaVersion: 1;
  kind: "basalt-candidate-position-recovery";
  createdAt: string;
  manifest: CandidateManifest;
  manifestSha256: string;
  run: ReviewedRun;
  staging: StagedEvidence;
}
export interface OperatorOptions {
  command: "inspect" | "export" | "activate";
  manifestPath: string; runId?: string; outputPath?: string; reviewPath?: string;
  approvalSha256?: string; maxPolls: number; timeoutSeconds: number;
}
export const RECOVERY_OPERATOR_HELP = [
  "Candidate-only devnet recovery. Default command: inspect (database read-only).",
  "Set CANDIDATE_DATABASE_URL and RELEASE_SOURCE_SHA; DATABASE_URL is never used.",
  "inspect --manifest=/private/candidate.json",
  "export --manifest=/private/candidate.json --run-id=<exact-id> --output=/private/review.json",
  "activate --manifest=/private/candidate.json --review=/private/review.json --approve-sha256=<sha256-of-review-file> --max-polls=1",
  "Optional: --timeout-seconds=5..300 (default60); activation max-polls=1..100 (default1).",
  "RPC_URL is required only for activate; it must report the devnet genesis.",
  "The database must be basalt_candidate_<lowercase-id>, with a same-name role and exactly one matching",
  "public.release_candidate_identity row. Candidate preparation creates this marker",
  "before schema/replay. The manifest binds source SHA, backup SHA256, programs and genesis.",
  "Export creates a new0600 file and prints its SHA256. Review before explicit activation.",
  "Activation performs bounded finalized catch-up and revalidates immutable staged evidence.",
  "No live foliox database, signer, automatic publication, or financial rollback command.",
  "After any timeout/failure inspect and retry the SAME reviewed run; the atomic API",
  "returns its committed receipt on exact retry and preserves immutable preactivation backups.",
].join("\n");

function fail(message: string): never { throw new RecoveryOperatorError(message); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected a JSON object");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !(key in value)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail("Unexpected or missing evidence fields");
}
function canonicalKey(value: unknown): asserts value is string {
  if (typeof value !== "string") fail("Canonical public key required");
  try { const key = new PublicKey(value); if (key.equals(PublicKey.default) || key.toBase58() !== value) fail("Canonical nonzero public key required"); }
  catch { fail("Canonical nonzero public key required"); }
}
function isoDate(value: unknown): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("Canonical ISO timestamp required");
}
function boundedId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) fail("Invalid recovery identifier");
}
function raw(value: unknown, maximum = (1n << 64n) - 1n): asserts value is string {
  if (typeof value !== "string" || value.length > 20 || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > maximum) fail("Invalid canonical raw amount");
}
export function validateCandidateManifest(value: unknown, namespaces: readonly ProgramNamespace[] = PROGRAM_NAMESPACES): CandidateManifest {
  const item = record(value);
  exactKeys(item, ["schemaVersion","candidateId","databaseName","sourceDatabase","sourceSha","backupSha256","programIds","genesisHash"], ["snapshotAt","backupFile"]);
  if (item.schemaVersion !== 1 || item.sourceDatabase !== "foliox" || item.genesisHash !== DEVNET_GENESIS) fail("Only the explicit devnet candidate manifest is supported");
  if (typeof item.candidateId !== "string" || !/^[a-z0-9_]{1,40}$/.test(item.candidateId) || item.databaseName !== "basalt_candidate_" + item.candidateId) fail("Candidate ID must exactly match its database suffix");
  if (typeof item.databaseName !== "string" || !/^basalt_candidate_[a-z0-9_]{1,40}$/.test(item.databaseName)) fail("A separate basalt_candidate_* database is required");
  if (typeof item.sourceSha !== "string" || !SOURCE_SHA.test(item.sourceSha) || typeof item.backupSha256 !== "string" || !SHA256.test(item.backupSha256)) fail("Exact source SHA and backup SHA256 are required");
  const programs = record(item.programIds);
  exactKeys(programs, ["basket","factory","whitelist"]);
  Object.values(programs).forEach(canonicalKey);
  if (!validateNamespaceRegistry(namespaces).some(namespace => stable(namespace.programs) === stable(programs))) fail("Program roles must match one registered devnet namespace");
  if (item.snapshotAt !== undefined) isoDate(item.snapshotAt);
  if (item.backupFile !== undefined && (typeof item.backupFile !== "string" || item.backupFile.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(item.backupFile) || basename(item.backupFile) !== item.backupFile)) fail("Backup filename must be a plain basename");
  return item as unknown as CandidateManifest;
}
async function privateJson(path: string): Promise<{ value: unknown; bytes: Buffer }> {
  if (!isAbsolute(path)) fail("Evidence paths must be absolute");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > MAX_JSON_BYTES) fail("Evidence file size/type is invalid");
    const buffer = Buffer.alloc(MAX_JSON_BYTES + 1);
    const { bytesRead } = await handle.read(buffer,0,buffer.length,0);
    const bytes = buffer.subarray(0,bytesRead);
    if (bytes.length !== stat.size || bytes.length > MAX_JSON_BYTES) fail("Evidence file changed while reading");
    try { return { value: JSON.parse(bytes.toString("utf8")), bytes }; }
    catch { fail("Evidence is not valid JSON"); }
  } finally { await handle.close(); }
}
export async function loadCandidateContext(manifestPath: string, env: NodeJS.ProcessEnv = process.env): Promise<CandidateContext> {
  const file = await privateJson(manifestPath);
  const manifest = validateCandidateManifest(file.value);
  if (env.RELEASE_SOURCE_SHA !== manifest.sourceSha) fail("RELEASE_SOURCE_SHA does not match the candidate source");
  if (!env.CANDIDATE_DATABASE_URL) fail("Explicit CANDIDATE_DATABASE_URL is required; DATABASE_URL is never used");
  let url: URL;
  try { url = new URL(env.CANDIDATE_DATABASE_URL); } catch { fail("Invalid candidate database URL"); }
  if (!["postgres:","postgresql:"].includes(url.protocol) || decodeURIComponent(url.pathname) !== "/" + manifest.databaseName || decodeURIComponent(url.username) !== manifest.databaseName || url.searchParams.has("options") || url.searchParams.has("dbname")) fail("Candidate connection does not target the reviewed database");
  return { manifest, manifestSha256: digest(file.bytes), databaseUrl: env.CANDIDATE_DATABASE_URL };
}
/** Call before ANY schema or ledger writes, including standalone archival replay. */
export async function assertCandidateIdentity(db: PgLike, context: CandidateContext): Promise<void> {
  const current = await db.query("SELECT current_database() AS database_name,current_user AS role_name");
  if (current.rows.length !== 1 || current.rows[0].database_name !== context.manifest.databaseName || current.rows[0].role_name !== context.manifest.databaseName) fail("Connected database differs from the reviewed candidate");
  const result = await db.query("SELECT candidate_id,database_name,source_database,source_sha,backup_sha256,genesis_hash,program_ids FROM public.release_candidate_identity LIMIT 2");
  const row = result.rows[0];
  const expected = context.manifest;
  if (result.rows.length !== 1 || row.candidate_id !== expected.candidateId || row.database_name !== expected.databaseName ||
      row.source_database !== expected.sourceDatabase || row.source_sha !== expected.sourceSha || row.backup_sha256 !== expected.backupSha256 ||
      row.genesis_hash !== expected.genesisHash || stable(row.program_ids) !== stable(expected.programIds)) fail("Database candidate identity differs from the manifest");
}
/** Fixed public search path prevents URL/role search_path from redirecting core recovery SQL. */
export function openCandidateDatabase(context: CandidateContext, signal: AbortSignal): CandidateDatabase {
  const pool = new pg.Pool({ connectionString: context.databaseUrl, max: 4, connectionTimeoutMillis: 5_000,
    query_timeout: 15_000, statement_timeout: 15_000, idle_in_transaction_session_timeout: 30_000, options: "-c search_path=public" });
  const check = (sql: string) => { if (sql.trim().toUpperCase() !== "ROLLBACK") signal.throwIfAborted(); };
  return {
    query: async (sql, values) => { check(sql); return pool.query(sql, values); },
    connect: async () => {
      signal.throwIfAborted();
      const client = await pool.connect();
      return { query: async (sql, values) => { check(sql); return client.query(sql, values); }, release: () => client.release() };
    },
    end: () => pool.end(),
  };
}
export function candidateRpc(url: string | undefined, signal: AbortSignal): Connection {
  if (!url) fail("Explicit RPC_URL is required");
  try { const parsed = new URL(url); if (!["https:","http:"].includes(parsed.protocol)) fail("Invalid RPC protocol"); }
  catch { fail("Invalid RPC_URL"); }
  return new Connection(url, { commitment: "finalized", disableRetryOnRateLimit: true,
    fetch: async (input, init) => {
      signal.throwIfAborted();
      const signals = [signal, AbortSignal.timeout(10_000)];
      if (init?.signal) signals.push(init.signal);
      return fetch(input, { ...init, signal: AbortSignal.any(signals) });
    } });
}
/** A basket proof uses exactly its registered trio, independently of union collection. */
export function candidateProgramSet(manifest: Pick<CandidateManifest,"programIds">, namespaces: readonly ProgramNamespace[] = PROGRAM_NAMESPACES) {
  const ids = manifest.programIds;
  if (!validateNamespaceRegistry(namespaces).some(namespace => stable(namespace.programs) === stable(ids))) fail("Program roles must match one registered devnet namespace");
  return { basket: new PublicKey(ids.basket), factory: new PublicKey(ids.factory), ids: [ids.whitelist,ids.factory,ids.basket].sort(ordinal) };
}
function programs(context: CandidateContext) { return candidateProgramSet(context.manifest); }
function reviewedRun(row: Record<string, unknown> | undefined, context: CandidateContext): ReviewedRun {
  if (!row) fail("Reviewed staged run does not exist");
  boundedId(row.run_id); canonicalKey(row.basket);
  if (typeof row.history_hash !== "string" || !SHA256.test(row.history_hash)) fail("Invalid staged history hash");
  const ids = programs(context).ids.sort(ordinal);
  if (!Array.isArray(row.program_ids) || stable([...row.program_ids].sort(ordinal)) !== stable(ids)) fail("Run programs differ from candidate programs");
  raw(String(row.chain_slot), BigInt(Number.MAX_SAFE_INTEGER)); raw(String(row.chain_supply));
  if (!Number.isSafeInteger(row.event_count) || Number(row.event_count) < 1 || Number(row.event_count) > MAX_CLAIMS + 1) fail("Staged event count exceeds operator bounds");
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  isoDate(createdAt);
  if (!["staged-pending-review","activated"].includes(String(row.status))) fail("Run is not a reviewed staged or activated run");
  return { runId: row.run_id, basket: row.basket, historyHash: row.history_hash, programIds: ids,
    chainSlot: String(row.chain_slot), chainSupply: String(row.chain_supply), eventCount: Number(row.event_count), createdAt };
}
async function stagedEvidence(db: PgLike, run: ReviewedRun, lockRows = false): Promise<StagedEvidence> {
  const lock = lockRows ? " FOR SHARE" : "";
  const positions = (await db.query('SELECT "user" AS user,basket,share_balance::text AS shares,cost_basis,cost_basis_source FROM position_rebuild_staging WHERE run_id=$1 LIMIT $2' + lock, [run.runId,MAX_POSITIONS + 1])).rows;
  const claims = (await db.query("SELECT sig,log_index,kind,basket FROM position_rebuild_claims WHERE run_id=$1 LIMIT $2" + lock, [run.runId,MAX_CLAIMS + 1])).rows;
  if (positions.length > MAX_POSITIONS || claims.length > MAX_CLAIMS) fail("Staged evidence exceeds operator bounds");
  const seenUsers = new Set<string>();
  const holderTuples = positions.map(row => {
    canonicalKey(row.user); raw(row.shares, (1n << 63n) - 1n);
    if (row.basket !== run.basket || row.shares === "0" || row.cost_basis !== null || row.cost_basis_source !== null || seenUsers.has(row.user)) fail("Invalid staged position evidence");
    seenUsers.add(row.user);
    return [row.user,row.shares];
  }).sort((a,b) => ordinal(a[0],b[0]));
  const seenClaims = new Set<string>();
  const claimTuples = claims.map(row => {
    if (typeof row.sig !== "string" || row.sig.length < 1 || row.sig.length > 128 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(row.sig) ||
      !Number.isSafeInteger(row.log_index) || row.log_index < 0 || !["Minted","Redeemed","FeeAccrued"].includes(row.kind) || row.basket !== run.basket) fail("Invalid staged claim evidence");
    const key = stable([row.sig,row.log_index]);
    if (seenClaims.has(key)) fail("Duplicate staged claim evidence");
    seenClaims.add(key);
    return [row.sig,row.log_index,row.kind,row.basket];
  }).sort((a,b) => ordinal(stable(a),stable(b)));
  return { positionCount: positions.length, positionsSha256: digest(stable(holderTuples)), claimCount: claims.length, claimsSha256: digest(stable(claimTuples)) };
}
/** Called after the atomic API locks the run; row/FK locks bind the exact review. */
export async function assertReviewedStaging(db: PgLike, review: RecoveryReview): Promise<void> {
  const context = { manifest:review.manifest, manifestSha256:review.manifestSha256, databaseUrl:"" };
  const row = (await db.query("SELECT * FROM position_rebuild_runs WHERE run_id=$1 FOR SHARE", [review.run.runId])).rows[0];
  const run = reviewedRun(row,context);
  const staging = await stagedEvidence(db,run,true);
  if (stable(review.run) !== stable(run) || stable(review.staging) !== stable(staging)) fail("Reviewed run or staged evidence changed; export and review again");
}
async function readRunEvidence(db: PgLike, context: CandidateContext, runId: string) {
  return withTransaction(db, async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await assertCandidateIdentity(client, context);
    const row = (await client.query("SELECT * FROM public.position_rebuild_runs WHERE run_id=$1", [runId])).rows[0];
    const run = reviewedRun(row,context);
    return { run, staging: await stagedEvidence(client,run), status: row.status };
  });
}
async function inspect(db: PgLike, context: CandidateContext) {
  return withTransaction(db, async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await assertCandidateIdentity(client,context);
    const names = ["indexer_program_state","indexer_signature_queue","position_rebuild_runs","position_rebuild_staging","position_rebuild_claims","position_rebuild_required","position_reconciliation_state"];
    const existing = await client.query("SELECT name,to_regclass('public.' || name)::text AS table_name FROM unnest($1::text[]) AS name", [names]);
    const missingTables = existing.rows.filter(row => !row.table_name).map(row => row.name);
    if (missingTables.length) return { candidate: context.manifest, schemaReady: false, missingTables };
    const history = (await client.query("SELECT program_id,history_complete,scan_before,scan_head,finalized_through_slot::text FROM public.indexer_program_state WHERE program_id=ANY($1::text[]) ORDER BY program_id COLLATE \"C\"", [registeredProgramIds()])).rows;
    const queue = (await client.query("SELECT status,COUNT(*)::text AS count FROM public.indexer_signature_queue WHERE program_id=ANY($1::text[]) GROUP BY status ORDER BY status", [registeredProgramIds()])).rows;
    const runs = (await client.query("SELECT run_id,basket,chain_slot::text,chain_supply::text,event_count,history_hash,status,created_at,activated_at,activated_slot::text FROM public.position_rebuild_runs ORDER BY created_at DESC,run_id COLLATE \"C\" LIMIT 20")).rows;
    return { candidate: context.manifest, schemaReady: true, collectionPrograms:registeredProgramIds(), history, queue, recentRuns: runs, activeProjectionChanged: false };
  });
}
export function parseOperatorArgs(args: string[]): OperatorOptions {
  const command = args[0] && !args[0].startsWith("--") ? args.shift()! : "inspect";
  if (!["inspect","export","activate"].includes(command)) fail("Expected inspect, export or activate");
  const allowed: Record<string,string[]> = { inspect:["manifest","timeout-seconds"], export:["manifest","run-id","output","timeout-seconds"], activate:["manifest","review","approve-sha256","max-polls","timeout-seconds"] };
  const values = new Map<string,string>();
  for (const arg of args) {
    const match = /^--([a-z][a-z0-9-]*)=(.+)$/.exec(arg);
    if (!match || !allowed[command].includes(match[1]) || values.has(match[1])) fail("Unknown, malformed or duplicate operator option");
    values.set(match[1],match[2]);
  }
  const manifestPath = values.get("manifest");
  if (!manifestPath || !isAbsolute(manifestPath)) fail("Explicit absolute --manifest is required");
  if (["timeout-seconds","max-polls"].some(key => values.has(key) && !/^[0-9]+$/.test(values.get(key)!))) fail("Integer operator budgets required");
  const timeoutSeconds = Number(values.get("timeout-seconds") ?? 60), maxPolls = Number(values.get("max-polls") ?? 1);
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 300 || !Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 100) fail("Invalid operator time or poll budget");
  const runId = values.get("run-id"), outputPath = values.get("output"), reviewPath = values.get("review"), approvalSha256 = values.get("approve-sha256");
  if (command === "export") { boundedId(runId); if (!outputPath || !isAbsolute(outputPath)) fail("Export requires an absolute output path"); }
  if (command === "activate" && (!reviewPath || !isAbsolute(reviewPath) || !approvalSha256 || !SHA256.test(approvalSha256))) fail("Activation requires exact review file and SHA256 approval");
  return { command: command as OperatorOptions["command"], manifestPath, runId, outputPath, reviewPath, approvalSha256, timeoutSeconds, maxPolls };
}
function validateReview(value: unknown, context: CandidateContext): RecoveryReview {
  const item = record(value);
  exactKeys(item, ["schemaVersion","kind","createdAt","manifest","manifestSha256","run","staging"]);
  if (item.schemaVersion !== 1 || item.kind !== "basalt-candidate-position-recovery" || item.manifestSha256 !== context.manifestSha256 || stable(validateCandidateManifest(item.manifest)) !== stable(context.manifest)) fail("Review artifact targets another candidate, backup or source");
  isoDate(item.createdAt);
  const run = record(item.run), staging = record(item.staging);
  exactKeys(run, ["runId","basket","historyHash","programIds","chainSlot","chainSupply","eventCount","createdAt"]);
  exactKeys(staging, ["positionCount","positionsSha256","claimCount","claimsSha256"]);
  boundedId(run.runId);
  if (typeof staging.positionsSha256 !== "string" || !SHA256.test(staging.positionsSha256) || typeof staging.claimsSha256 !== "string" || !SHA256.test(staging.claimsSha256) ||
    !Number.isSafeInteger(staging.positionCount) || Number(staging.positionCount) < 0 || Number(staging.positionCount) > MAX_POSITIONS ||
    !Number.isSafeInteger(staging.claimCount) || Number(staging.claimCount) < 0 || Number(staging.claimCount) > MAX_CLAIMS) fail("Invalid review staging evidence");
  return item as unknown as RecoveryReview;
}
export interface OperatorDependencies {
  connect?: (context: CandidateContext, signal: AbortSignal) => Promise<CandidateDatabase> | CandidateDatabase;
  rpc?: (url: string | undefined, signal: AbortSignal) => Connection;
  activate?: typeof activateStagedPositionRebuild;
  replay?: typeof replayThroughFinalizedSlot;
  report?: (value: unknown) => void;
  now?: () => Date;
}
export async function runRecoveryOperator(args: string[], env: NodeJS.ProcessEnv = process.env, dependencies: OperatorDependencies = {}): Promise<unknown> {
  const options = parseOperatorArgs([...args]);
  const context = await loadCandidateContext(options.manifestPath,env);
  const signal = AbortSignal.timeout(options.timeoutSeconds * 1000);
  const database = await (dependencies.connect ?? openCandidateDatabase)(context,signal);
  try {
    await assertCandidateIdentity(database,context);
    if (options.command === "inspect") return await inspect(database,context);
    if (options.command === "export") {
      const current = await readRunEvidence(database,context,options.runId!);
      if (current.status !== "staged-pending-review") fail("Only a pending staged run may be exported for review");
      const review: RecoveryReview = { schemaVersion:1, kind:"basalt-candidate-position-recovery", createdAt:(dependencies.now ?? (()=>new Date()))().toISOString(),
        manifest:context.manifest, manifestSha256:context.manifestSha256, run:current.run, staging:current.staging };
      const bytes = JSON.stringify(review,null,2) + "\n";
      signal.throwIfAborted();
      const output = await open(options.outputPath!,"wx",0o600);
      try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
      return { reviewFile:options.outputPath, approvalSha256:digest(bytes), runId:current.run.runId, historyHash:current.run.historyHash, activeProjectionChanged:false };
    }
    const file = await privateJson(options.reviewPath!);
    if (digest(file.bytes) !== options.approvalSha256) fail("Review file SHA256 differs from explicit approval");
    const review = validateReview(file.value,context);
    const current = await readRunEvidence(database,context,review.run.runId);
    if (stable(review.run) !== stable(current.run) || stable(review.staging) !== stable(current.staging)) fail("Reviewed run or staged evidence changed; export and review again");
    const rpc = (dependencies.rpc ?? candidateRpc)(env.RPC_URL,signal);
    if (current.status !== "activated" && await rpc.getGenesisHash() !== context.manifest.genesisHash) fail("RPC does not report the reviewed devnet genesis");
    const programSet = programs(context);
    const indexer = new EventIndexer(rpc, { namespaces:PROGRAM_NAMESPACES, programIds:programSet.ids, basketProgramId:context.manifest.programIds.basket,
      factoryProgramId:context.manifest.programIds.factory, whitelistProgramId:context.manifest.programIds.whitelist,
      pollIntervalMs:15_000, signaturesPerPoll:50, maxSeenCache:10_000, historyPagesPerPoll:2, durableHistory:true, replayOnly:true },database);
    const budget = {remaining:options.maxPolls,polls:0};
    signal.throwIfAborted();
    const receipt: PositionRecoveryReceipt = await (dependencies.activate ?? activateStagedPositionRebuild)(database,rpc,review.run.runId,review.run.historyHash,programSet,{
      validateReviewedEvidence: async client => {
        await assertCandidateIdentity(client,context);
        await assertReviewedStaging(client,review);
      },
      catchUpThroughSlot: async slot => {
        await assertCandidateIdentity(database,context);
        signal.throwIfAborted();
        await (dependencies.replay ?? replayThroughFinalizedSlot)(indexer,database,registeredProgramIds(),budget,slot,dependencies.report);
      },
    });
    return { candidateId:context.manifest.candidateId, databaseName:context.manifest.databaseName, sourceSha:context.manifest.sourceSha,
      backupSha256:context.manifest.backupSha256, reviewSha256:options.approvalSha256, receipt, polls:budget.polls, activeProjectionChanged:true };
  } finally { await database.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--help") console.log(RECOVERY_OPERATOR_HELP);
  else runRecoveryOperator(process.argv.slice(2),process.env,{report:value=>console.log(JSON.stringify(value))})
    .then(result=>console.log(JSON.stringify(result)),error=>{
      // Unknown driver/provider errors can contain private connection details.
      console.error(error instanceof RecoveryOperatorError ? error.message : "Recovery operator failed; inspect the private candidate and retry the exact reviewed run");
      process.exitCode=1;
    });
}
