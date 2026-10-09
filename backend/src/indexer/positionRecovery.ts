/** Explicit reviewed activation API. Bootstrap, workers and replay never call this. */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { withTransaction, type PgLike } from "../db/client.js";
import { unresolvedPositionRebuildCondition } from "../db/projectionGuard.js";
import { assertBasketProjectionMatches } from "./positionSnapshotProjection.js";
import { validatePositionRebuildHistory } from "./positions.js";
import {
  fetchFinalizedPositionSnapshot, lockCompleteHistory, assertFinalizedHistoryCoverage,
  type PositionsSyncRpc, type RecoveryPrograms,
} from "./positionsSync.js";

type RecoveryRun = {
  run_id: string; basket: string; history_hash: string; program_ids: string[];
  chain_slot: string; chain_supply: string; event_count: number; status: string;
  created_at: Date; activated_at: Date | null; activated_slot: string | null;
};
type HistoryRow = { sig: string; log_index: number; type: string; data: Record<string, unknown>; slot: string };
type Claim = { sig: string; log_index: number; kind: string; basket: string };
type Holder = { user: string; shares: string };
export interface PositionRecoveryOptions {
  /** Optional operator attestation, rechecked under the locked immutable run before publication. */
  validateReviewedEvidence?: (client: PgLike) => Promise<void>;
  /** Explicit caller discovers/drains through the already authenticated snapshot. */
  catchUpThroughSlot?: (slot: number) => Promise<void>;
}
export interface PositionRecoveryReceipt {
  runId: string; basket: string; historyHash: string; finalizedSlot: string; activatedAt: string;
}
const U64_MAX = (1n << 64n) - 1n;
const PG_BIGINT_MAX = (1n << 63n) - 1n;
const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sortedIds = (ids: readonly string[]) => [...ids].sort(ordinal);
const sameIds = (a: readonly string[], b: readonly string[]) => JSON.stringify(sortedIds(a)) === JSON.stringify(sortedIds(b));
const claimKey = (claim: Claim) => JSON.stringify([claim.sig, claim.log_index]);

function canonicalKey(value: string): void {
  const key = new PublicKey(value);
  if (key.toBase58() !== value || key.equals(PublicKey.default)) throw new Error("Canonical nonzero public key required");
}
function validatePrograms(programs: RecoveryPrograms): void {
  if (programs.ids.length !== 3 || new Set(programs.ids).size !== 3) throw new Error("Three distinct recovery program IDs required");
  programs.ids.forEach(canonicalKey);
  if (programs.factory.equals(programs.basket) || !programs.ids.includes(programs.factory.toBase58()) || !programs.ids.includes(programs.basket.toBase58())) {
    throw new Error("Explicit distinct factory/basket roles required");
  }
}
function rawAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > U64_MAX) throw new Error("Invalid canonical raw share amount");
  return BigInt(value);
}
function normalizeHolders(rows: Holder[]): Holder[] {
  const seen = new Set<string>();
  return rows.map(row => {
    canonicalKey(row.user);
    const shares = rawAmount(row.shares);
    if (shares <= 0n || shares > PG_BIGINT_MAX || seen.has(row.user)) throw new Error("Invalid or duplicate staged holder");
    seen.add(row.user);
    return { user: row.user, shares: shares.toString() };
  }).sort((a, b) => ordinal(a.user, b.user));
}
function validateRun(run: RecoveryRun | undefined, runId: string, hash: string, programs: RecoveryPrograms): asserts run is RecoveryRun {
  if (!run || run.run_id !== runId || run.history_hash !== hash || !Array.isArray(run.program_ids) || !sameIds(run.program_ids, programs.ids)) {
    throw new Error("Reviewed run/hash/program attestation does not match");
  }
  canonicalKey(run.basket);
  if (!/^(0|[1-9]\d*)$/.test(String(run.chain_slot)) || !Number.isSafeInteger(Number(run.chain_slot)) ||
      !Number.isSafeInteger(run.event_count) || run.event_count < 1 || !(run.created_at instanceof Date) || !Number.isFinite(run.created_at.getTime())) {
    throw new Error("Invalid reviewed recovery evidence");
  }
  rawAmount(String(run.chain_supply));
}
function evidence(run: RecoveryRun): string {
  return JSON.stringify([run.run_id, run.basket, run.history_hash, sortedIds(run.program_ids), String(run.chain_slot),
    String(run.chain_supply), run.event_count, run.created_at.toISOString()]);
}
function validateHistory(history: HistoryRow[], run: RecoveryRun, programs: RecoveryPrograms): Claim[] {
  if (history.length !== run.event_count || createHash("sha256").update(JSON.stringify(history)).digest("hex") !== run.history_hash) {
    throw new Error("Canonical history changed; restage");
  }
  validatePositionRebuildHistory(history, run.basket, programs.ids, { slot: Number(run.chain_slot), supply: String(run.chain_supply) });
  for (const row of history) {
    const program = row.type === "BasketCreated" ? programs.factory.toBase58() : programs.basket.toBase58();
    if (row.data.programId !== program) throw new Error("Canonical event program role differs from reviewed programs");
  }
  const claims = history.filter(row => row.type !== "BasketCreated")
    .map(row => ({ sig: row.sig, log_index: row.log_index, kind: row.type, basket: run.basket }));
  return claims;
}
function validateClaims(staged: Claim[], expected: Claim[]): void {
  const normalize = (rows: Claim[]) => rows.map(row => JSON.stringify([row.sig, row.log_index, row.kind, row.basket])).sort(ordinal);
  if (JSON.stringify(normalize(staged)) !== JSON.stringify(normalize(expected))) throw new Error("Staged claims differ from canonical history");
}
async function activatedReceipt(client: PgLike, run: RecoveryRun): Promise<PositionRecoveryReceipt> {
  if (run.status !== "activated" || run.activated_slot == null || !run.activated_at ||
      !Number.isFinite(run.activated_at.getTime()) || BigInt(run.activated_slot) < BigInt(run.chain_slot)) throw new Error("Incomplete activation receipt");
  const guard = await client.query("SELECT activated_run_id FROM position_rebuild_required WHERE basket=$1 FOR SHARE", [run.basket]);
  const barrier = await client.query("SELECT snapshot_slot::text FROM position_reconciliation_state WHERE basket=$1 FOR SHARE", [run.basket]);
  if (guard.rows[0]?.activated_run_id !== run.run_id || !barrier.rows[0] || BigInt(barrier.rows[0].snapshot_slot) < BigInt(run.activated_slot)) {
    throw new Error("Activated run is no longer the current guarded projection");
  }
  return { runId: run.run_id, basket: run.basket, historyHash: run.history_hash,
    finalizedSlot: String(run.activated_slot), activatedAt: run.activated_at.toISOString() };
}

/** Publish only the explicitly reviewed run. Every write and immutable backup commits together. */
export async function activateStagedPositionRebuild(
  db: PgLike, rpc: PositionsSyncRpc, runId: string, expectedHistoryHash: string, programs: RecoveryPrograms,
  options: PositionRecoveryOptions = {},
): Promise<PositionRecoveryReceipt> {
  if (!runId || !/^[a-f0-9]{64}$/.test(expectedHistoryHash)) throw new Error("Explicit reviewed run/hash required");
  validatePrograms(programs);
  const found = (await db.query("SELECT * FROM position_rebuild_runs WHERE run_id=$1", [runId])).rows[0] as RecoveryRun | undefined;
  validateRun(found, runId, expectedHistoryHash, programs);
  if (found.status !== "activated" && found.status !== "staged-pending-review") throw new Error("Reviewed staged run is not activatable");
  // Read chain state before locking discovery so a moving finalized watermark can catch up.
  const snapshot = found.status === "staged-pending-review" ? await fetchFinalizedPositionSnapshot(rpc, found.basket, programs) : null;
  if (snapshot && options.catchUpThroughSlot) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([options.catchUpThroughSlot(snapshot.slot), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Recovery catch-up deadline exceeded")), 10_000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  return withTransaction(db, async client => {
    // A committed exact retry needs no RPC. Lock order still serializes against normal position writers.
    if (found.status === "activated") {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`positions:${found.basket}`]);
    } else if (found.status === "staged-pending-review") {
      await lockCompleteHistory(client, found.basket, programs.ids);
    } else throw new Error("Reviewed staged run is not activatable");
    const run = (await client.query("SELECT * FROM position_rebuild_runs WHERE run_id=$1 FOR UPDATE", [runId])).rows[0] as RecoveryRun | undefined;
    validateRun(run, runId, expectedHistoryHash, programs);
    if (evidence(found) !== evidence(run)) throw new Error("Reviewed run metadata changed while acquiring locks");
    if (options.validateReviewedEvidence) await options.validateReviewedEvidence(client);
    if (run.status === "activated") return activatedReceipt(client, run);
    if (run.status !== "staged-pending-review") throw new Error("Run was superseded");
    const pending = await client.query(`SELECT basket FROM position_rebuild_required r WHERE basket=$1 AND ${unresolvedPositionRebuildCondition("r")} FOR UPDATE`, [run.basket]);
    if (pending.rows.length !== 1) throw new Error("No quarantined projection to activate");
    const history = (await client.query("SELECT sig,log_index,type,data,slot::text AS slot FROM events WHERE basket=$1 AND log_index>=0 ORDER BY slot,sig,log_index FOR SHARE", [run.basket])).rows as HistoryRow[];
    const expectedClaims = validateHistory(history, run, programs);
    if (!snapshot) throw new Error("Pending activation requires an authenticated snapshot");
    await assertBasketProjectionMatches(client, snapshot.basketState);
    await assertFinalizedHistoryCoverage(client, programs.ids, snapshot.slot);
    if (BigInt(snapshot.slot) < BigInt(run.chain_slot) || snapshot.supply !== String(run.chain_supply)) throw new Error("Finalized snapshot no longer matches staged supply");
    if (history.some(row => BigInt(row.slot) > BigInt(snapshot.slot))) throw new Error("Snapshot predates history");
    const creation = history.find(row => row.type === "BasketCreated")!;
    const state = snapshot.basketState;
    if (creation.data.creator !== state.creator || creation.data.shareMint !== state.shareMint || creation.data.numConstituents !== state.numConstituents ||
        creation.data.ts !== state.createdAt.getTime() / 1000) throw new Error("Creation history differs from authenticated basket state");
    const staged = (await client.query('SELECT "user" AS user,basket,share_balance::text AS shares,cost_basis,cost_basis_source FROM position_rebuild_staging WHERE run_id=$1 FOR SHARE', [runId])).rows;
    if (staged.some(row => row.basket !== run.basket || row.cost_basis !== null || row.cost_basis_source !== null)) throw new Error("Staged position metadata was changed");
    const normalized = normalizeHolders(snapshot.balances.filter(row => BigInt(row.shares) > 0n));
    if (JSON.stringify(normalizeHolders(staged)) !== JSON.stringify(normalized)) throw new Error("Finalized holders changed; restage");
    const stagedClaims = (await client.query("SELECT sig,log_index,kind,basket FROM position_rebuild_claims WHERE run_id=$1 FOR SHARE", [runId])).rows as Claim[];
    validateClaims(stagedClaims, expectedClaims);
    const existingClaims = (await client.query("SELECT sig,log_index,kind,basket FROM position_events WHERE basket=$1 AND log_index>=0 FOR UPDATE", [run.basket])).rows as Claim[];
    const expectedByKey = new Map(expectedClaims.map(claim => [claimKey(claim), claim]));
    for (const claim of existingClaims) {
      const expected = expectedByKey.get(claimKey(claim));
      if (!expected || expected.kind !== claim.kind) throw new Error("Applied claim is absent from reviewed canonical history");
    }
    for (const claim of expectedClaims) {
      const conflict = (await client.query("SELECT kind,basket FROM position_events WHERE sig=$1 AND log_index=$2 FOR UPDATE", [claim.sig, claim.log_index])).rows[0];
      if (conflict && (conflict.kind !== claim.kind || conflict.basket !== claim.basket)) throw new Error("Canonical claim collision");
    }
    const previous = (await client.query("SELECT snapshot_slot::text FROM position_reconciliation_state WHERE basket=$1 FOR UPDATE", [run.basket])).rows[0];
    if (previous && BigInt(previous.snapshot_slot) > BigInt(snapshot.slot)) throw new Error("Activation would move projection backwards");
    const backups = await client.query("SELECT EXISTS(SELECT 1 FROM position_rebuild_positions_backup WHERE run_id=$1) OR EXISTS(SELECT 1 FROM position_rebuild_claims_backup WHERE run_id=$1) AS present", [runId]);
    if (backups.rows[0].present) throw new Error("Pending run already contains backup evidence; restage");
    await client.query(`INSERT INTO position_rebuild_positions_backup(run_id,"user",basket,share_balance,cost_basis,cost_basis_source,position_updated_at)
      SELECT $1,"user",basket,share_balance,cost_basis,cost_basis_source,updated_at FROM user_positions WHERE basket=$2`, [runId, run.basket]);
    await client.query(`INSERT INTO position_rebuild_claims_backup(run_id,sig,log_index,kind,basket,claimed_at,slot)
      SELECT $1,sig,log_index,kind,basket,ts,slot FROM position_events WHERE basket=$2`, [runId, run.basket]);
    await client.query(`UPDATE user_positions SET share_balance=0,cost_basis=NULL,cost_basis_source=NULL,updated_at=NOW()
      WHERE basket=$1 AND NOT("user"=ANY($2::text[]))`, [run.basket, normalized.map(row => row.user)]);
    for (const holder of normalized) await client.query(`INSERT INTO user_positions("user",basket,share_balance,cost_basis,cost_basis_source)
      VALUES($1,$2,$3,NULL,NULL) ON CONFLICT("user",basket) DO UPDATE SET share_balance=EXCLUDED.share_balance,cost_basis=NULL,cost_basis_source=NULL,updated_at=NOW()`, [holder.user, run.basket, holder.shares]);
    const slots = new Map(history.map(row => [claimKey({ ...row, kind: row.type, basket: run.basket }), row.slot]));
    for (const claim of expectedClaims) {
      const published = await client.query(`INSERT INTO position_events(sig,log_index,kind,basket,slot) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(sig,log_index) DO UPDATE SET slot=EXCLUDED.slot
        WHERE position_events.kind=EXCLUDED.kind AND position_events.basket=EXCLUDED.basket RETURNING sig`,
      [claim.sig, claim.log_index, claim.kind, claim.basket, slots.get(claimKey(claim))]);
      if (published.rows.length !== 1) throw new Error("Canonical claim collision during publication");
    }
    await client.query(`INSERT INTO position_reconciliation_state(basket,snapshot_slot) VALUES($1,$2)
      ON CONFLICT(basket) DO UPDATE SET snapshot_slot=EXCLUDED.snapshot_slot,updated_at=NOW()`, [run.basket, String(snapshot.slot)]);
    await client.query("UPDATE position_rebuild_required SET activated_run_id=$2 WHERE basket=$1", [run.basket, runId]);
    const activated = (await client.query("UPDATE position_rebuild_runs SET status='activated',activated_at=NOW(),activated_slot=$2 WHERE run_id=$1 RETURNING *", [runId, String(snapshot.slot)])).rows[0] as RecoveryRun;
    return activatedReceipt(client, activated);
  });
}
