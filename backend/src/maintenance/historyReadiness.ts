/** Nondestructive replay readiness: require a successful fresh poll and persisted coverage. */
import type { PgLike } from "../db/client.js";

export interface ReplayPoller {
  pollOnce(): Promise<unknown>;
  readonly lastCompletedDiscoverySlot: number | null;
}
export interface ReplayBudget { remaining: number; polls: number }

/** Initial replay and post-snapshot catch-up share one explicit total poll budget. */
export async function replayThroughFinalizedSlot(
  indexer: ReplayPoller,
  db: PgLike,
  programIds: readonly string[],
  budget: ReplayBudget,
  minimumFinalizedSlot = 0,
  report: (progress: Record<string, unknown>) => void = () => {},
): Promise<void> {
  if (!programIds.length || new Set(programIds).size !== programIds.length || !Number.isSafeInteger(minimumFinalizedSlot) || minimumFinalizedSlot < 0) throw new Error("Explicit programs and finalized replay slot are required");
  if (!Number.isSafeInteger(budget.remaining) || budget.remaining < 0 || budget.remaining > 10_000 || !Number.isSafeInteger(budget.polls) || budget.polls < 0 || budget.polls + budget.remaining > 10_000) throw new Error("Invalid replay poll budget");
  while (budget.remaining > 0) {
    budget.remaining--; budget.polls++;
    await indexer.pollOnce();
    const result = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM indexer_program_state WHERE program_id=ANY($1::text[]) AND history_complete
        AND scan_before IS NULL AND scan_head IS NULL AND finalized_through_slot >= $2) AS complete_programs,
      (SELECT COUNT(*)::int FROM indexer_signature_queue WHERE program_id=ANY($1::text[]) AND status='pending') AS pending,
      (SELECT COUNT(*)::int FROM indexer_signature_queue WHERE program_id=ANY($1::text[]) AND status='quarantined') AS quarantined`, [[...programIds],String(minimumFinalizedSlot)]);
    const state = result.rows[0];
    const discoverySlot = indexer.lastCompletedDiscoverySlot;
    report({poll:budget.polls,...state,discoveryThroughSlot:discoverySlot,minimumFinalizedSlot});
    if (state.quarantined > 0) throw new Error("History contains quarantined transactions; inspect them before staging");
    // Failed/busy discovery returns no successful watermark, even when old persisted
    // history_complete and an empty queue would otherwise appear ready.
    if (Number.isSafeInteger(discoverySlot) && discoverySlot! >= minimumFinalizedSlot && state.complete_programs === programIds.length && state.pending === 0) return;
  }
  throw new Error("Replay budget exhausted before verified catch-up; durable cursor retained. Rerun to continue");
}
