/** Finalized, bounded, restart-safe history ingestion. Never signs transactions. */
import { unresolvedPositionRebuildCondition } from "../db/projectionGuard.js";
import { withTransaction, type PgLike } from "../db/client.js";

export interface HistorySignature { signature: string; slot: number; err: unknown; blockTime?: number | null }
export interface ProgramHistory {
  program_id: string; head_signature: string | null; scan_before: string | null;
  scan_until: string | null; scan_head: string | null; history_complete: boolean;
  finalized_through_slot: string | number | null;
}
const STATE = `SELECT program_id,head_signature,scan_before,scan_until,scan_head,history_complete,finalized_through_slot FROM indexer_program_state WHERE program_id=$1`;

export class DurableHistory {
  constructor(private readonly db: PgLike) {}

  /** Runtime-authenticated emitters bind an unsafe transaction to every affected namespace. */
  async quarantineEmitters(programs: string[], sig: string, slot: number, reason: string): Promise<void> {
    if (!programs.length) return;
    await withTransaction(this.db, async client => {
      for (const program of new Set(programs)) await client.query(`INSERT INTO indexer_signature_queue(program_id,sig,slot,status,last_error)
        VALUES($1,$2,$3,'quarantined',$4) ON CONFLICT(program_id,sig) DO UPDATE SET status='quarantined',last_error=EXCLUDED.last_error`,
        [program,sig,slot,reason.slice(0,500)]);
    });
  }

  async state(program: string): Promise<ProgramHistory> {
    await this.db.query(`INSERT INTO indexer_program_state(program_id) VALUES($1) ON CONFLICT DO NOTHING`, [program]);
    const result = await this.db.query(STATE, [program]);
    if (!result.rows[0]) throw new Error("Durable indexer history state unavailable");
    return result.rows[0] as ProgramHistory;
  }

  /** Enqueue first, then advance the scan cursor IN THE SAME transaction. */
  async savePage(previous: ProgramHistory, page: HistorySignature[], limit: number, canonicalPrograms?: readonly string[]): Promise<boolean> {
    return withTransaction(this.db, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`indexer-history:${previous.program_id}`]);
      const current = (await client.query(STATE, [previous.program_id])).rows[0] as ProgramHistory;
      if (JSON.stringify(current) !== JSON.stringify(previous)) return false; // another scanner advanced; reload next poll
      for (const info of page) {
        if (!Number.isSafeInteger(info.slot) || info.slot < 0 || typeof info.signature !== "string" || !info.signature) throw new Error("Invalid finalized history signature");
        const inconsistent = await client.query("SELECT 1 FROM indexer_signature_queue WHERE sig=$1 AND slot<>$2 LIMIT 1",[info.signature,info.slot]);
        if (inconsistent.rows.length) throw new Error("Shared signature has inconsistent finalized slots");
        // A different namespace may discover the same transaction later. Full
        // canonical completion deduplicates it; quarantine always wins and must
        // follow the signature into every newly discovered role queue.
        const prior = (await client.query(`SELECT status,last_error,tx_index,canonical_collected_at,canonical_event_count,canonical_program_ids
          FROM indexer_signature_queue WHERE sig=$1 AND (status='quarantined' OR (status='processed' AND canonical_collected_at IS NOT NULL AND canonical_program_ids=$2::text[]))
          ORDER BY CASE WHEN status='quarantined' THEN 0 ELSE 1 END,program_id COLLATE "C" LIMIT 1`,[info.signature,canonicalPrograms ? [...canonicalPrograms].sort() : null])).rows[0];
        const status = prior?.status ?? (info.err ? "processed" : "pending");
        await client.query(`INSERT INTO indexer_signature_queue(program_id,sig,slot,block_time,status,last_error,tx_index,canonical_collected_at,canonical_event_count,canonical_program_ids,processed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $5='pending' THEN NULL ELSE NOW() END)
          ON CONFLICT(program_id,sig) DO UPDATE SET
            status=CASE WHEN EXCLUDED.status='quarantined' THEN 'quarantined' ELSE indexer_signature_queue.status END,
            last_error=CASE WHEN EXCLUDED.status='quarantined' THEN EXCLUDED.last_error ELSE indexer_signature_queue.last_error END`,
        [previous.program_id,info.signature,info.slot, info.blockTime == null ? null : new Date(info.blockTime * 1000),
          status,prior?.last_error ?? null,prior?.tx_index ?? null,prior?.canonical_collected_at ?? null,prior?.canonical_event_count ?? null,prior?.canonical_program_ids ?? null]);
      }
      const scanHead = previous.scan_head ?? page[0]?.signature ?? null;
      const complete = page.length < limit;
      // An endpoint repeating the same page is a fault, never a completed scan.
      const before = page.at(-1)?.signature ?? null;
      if (!complete && before === previous.scan_before) throw new Error("RPC history pagination did not advance");
      await client.query(`UPDATE indexer_program_state SET head_signature=$2,scan_before=$3,scan_until=$4,
        scan_head=$5,history_complete=$6,updated_at=NOW() WHERE program_id=$1`,
      [previous.program_id, complete ? scanHead ?? previous.head_signature : previous.head_signature,
        complete ? null : before, complete ? null : previous.scan_until ?? previous.head_signature,
        complete ? null : scanHead, previous.history_complete || complete]);
      return complete;
    });
  }

  /** Serialize discovery + drain across processes. RPC work is bounded by poll budgets. */
  async withPollLock<T>(run: () => Promise<T>, busy: T): Promise<T> {
    return withTransaction(this.db, async client => {
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('indexer-global-finalized-poll',0)) AS acquired");
      return lock.rows[0]?.acquired === true ? run() : busy;
    });
  }

  /** Called only after this poll's fresh scan completed under the global poll lock. */
  async markVerifiedThrough(program: string, watermark: number): Promise<void> {
    if (!Number.isSafeInteger(watermark) || watermark < 0) throw new Error("Invalid finalized discovery watermark");
    const result = await this.db.query(`UPDATE indexer_program_state
      SET finalized_through_slot=GREATEST(COALESCE(finalized_through_slot,0),$2),updated_at=NOW()
      WHERE program_id=$1 AND history_complete AND scan_before IS NULL AND scan_head IS NULL AND scan_until IS NULL
      RETURNING program_id`, [program,watermark]);
    if (result.rows.length !== 1) throw new Error("Incomplete scan cannot attest finalized discovery watermark");
  }

  async hasQuarantined(programs: readonly string[]): Promise<boolean> {
    const result = await this.db.query("SELECT EXISTS(SELECT 1 FROM indexer_signature_queue WHERE program_id=ANY($1::text[]) AND status='quarantined') AS blocked", [[...programs]]);
    return result.rows[0]?.blocked === true;
  }

  /** One global oldest signature; NULL indices must be resolved before ANY effects. */
  async nextPendingGlobal(programs: readonly string[]): Promise<(HistorySignature & { programId: string; txIndex: number | null }) | null> {
    const result = await this.db.query(`SELECT sig,slot,MIN(tx_index) AS tx_index,
      MIN(program_id) AS program_id,MIN(block_time) AS block_time
      FROM indexer_signature_queue WHERE program_id=ANY($1::text[]) AND status='pending'
      GROUP BY sig,slot ORDER BY slot ASC,MIN(tx_index) ASC NULLS FIRST LIMIT 1`, [[...programs]]);
    const row = result.rows[0];
    return row ? { signature: String(row.sig), slot: Number(row.slot), err: null, programId: String(row.program_id),
      txIndex: row.tx_index == null ? null : Number(row.tx_index), blockTime: row.block_time ? new Date(row.block_time).getTime()/1000 : null } : null;
  }

  /** Persist canonical finalized-block order for every queued signature in this slot. */
  async assignTransactionIndices(programs: readonly string[], slot: number, signatures: readonly string[]): Promise<void> {
    if (!Number.isSafeInteger(slot) || slot < 0 || !Array.isArray(signatures) || !signatures.length || signatures.length > 20_000 || signatures.some(sig => typeof sig !== 'string' || !sig) || new Set(signatures).size !== signatures.length) throw new Error("Invalid finalized block signature list");
    await withTransaction(this.db, async client => {
      const mismatch = await client.query(`WITH canonical AS (SELECT sig,(ordinality-1)::int AS tx_index FROM unnest($3::text[]) WITH ORDINALITY AS t(sig,ordinality))
        SELECT 1 FROM indexer_signature_queue q JOIN canonical c ON c.sig=q.sig
        WHERE q.program_id=ANY($1::text[]) AND q.slot=$2 AND q.tx_index IS NOT NULL AND q.tx_index<>c.tx_index LIMIT 1`, [[...programs],slot,[...signatures]]);
      if (mismatch.rows.length) throw new Error("Finalized block order disagrees with persisted transaction index");
      await client.query(`WITH canonical AS (SELECT sig,(ordinality-1)::int AS tx_index FROM unnest($3::text[]) WITH ORDINALITY AS t(sig,ordinality))
        UPDATE indexer_signature_queue q SET tx_index=c.tx_index FROM canonical c
        WHERE q.program_id=ANY($1::text[]) AND q.slot=$2 AND q.sig=c.sig AND q.status='pending'`, [[...programs],slot,[...signatures]]);
    });
  }

  /** Only selects facts not yet authenticated; it does not select effect work. */
  async nextUncollectedGlobal(programs: readonly string[]): Promise<(HistorySignature & { programId: string; txIndex: number | null }) | null> {
    const result = await this.db.query(`SELECT sig,slot,MIN(tx_index) AS tx_index,
      MIN(program_id) AS program_id,MIN(block_time) AS block_time
      FROM indexer_signature_queue WHERE program_id=ANY($1::text[]) AND status='pending' AND canonical_collected_at IS NULL
      GROUP BY sig,slot ORDER BY slot ASC,MIN(tx_index) ASC NULLS FIRST LIMIT 1`, [[...programs]]);
    const row=result.rows[0];
    return row ? { signature:String(row.sig),slot:Number(row.slot),err:null,programId:String(row.program_id),
      txIndex:row.tx_index==null?null:Number(row.tx_index),blockTime:row.block_time?new Date(row.block_time).getTime()/1000:null } : null;
  }

  /** A process cache never substitutes for exact durable decoder provenance. */
  async reusableCompletion(programs: readonly string[], sig: string, slot: number): Promise<{status:"processed"|"quarantined";reason:string|null}|null> {
    const row=(await this.db.query(`SELECT status,last_error FROM indexer_signature_queue WHERE sig=$1 AND slot=$2
      AND (status='quarantined' OR (status='processed' AND canonical_collected_at IS NOT NULL AND canonical_program_ids=$3::text[]))
      ORDER BY CASE WHEN status='quarantined' THEN 0 ELSE 1 END LIMIT 1`,[sig,slot,[...programs].sort()])).rows[0];
    return row ? {status:row.status as "processed"|"quarantined",reason:typeof row.last_error==="string" ? row.last_error : null} : null;
  }

  async markCanonicalCollected(programs: readonly string[], sig: string, slot: number, eventCount: number): Promise<void> {
    if (!Number.isSafeInteger(slot) || slot<0 || !Number.isSafeInteger(eventCount) || eventCount<0 || eventCount>10000) throw new Error("Invalid canonical collection identity");
    const result=await this.db.query(`UPDATE indexer_signature_queue
      SET canonical_collected_at=COALESCE(canonical_collected_at,NOW()),canonical_event_count=$4,canonical_program_ids=$1::text[]
      WHERE program_id=ANY($1::text[]) AND sig=$2 AND slot=$3 AND status='pending' AND tx_index IS NOT NULL
        AND (canonical_program_ids IS DISTINCT FROM $1::text[] OR canonical_event_count IS NULL OR canonical_event_count=$4) RETURNING sig`, [[...programs].sort(),sig,slot,eventCount]);
    if (!result.rows.length) throw new Error("Canonical collection could not bind queued signature/order");
  }

  async markProjectionBlocked(programs: readonly string[], sig: string, basket: string): Promise<void> {
    await this.db.query(`UPDATE indexer_signature_queue SET projection_blocked_basket=$3
      WHERE program_id=ANY($1::text[]) AND sig=$2 AND status='pending'`,[[...programs],sig,basket]);
  }
  async projectionBlocked(programs: readonly string[], sig: string): Promise<boolean> {
    const result=await this.db.query(`SELECT EXISTS(SELECT 1 FROM indexer_signature_queue q
      JOIN position_rebuild_required pr ON pr.basket=q.projection_blocked_basket
      WHERE q.program_id=ANY($1::text[]) AND q.sig=$2 AND q.status='pending'
        AND ${unresolvedPositionRebuildCondition("pr")}) AS blocked`,[[...programs],sig]);
    return result.rows[0]?.blocked===true;
  }

  async finishGlobal(programs: readonly string[], sig: string, quarantine?: string): Promise<void> {
    await this.db.query(`UPDATE indexer_signature_queue SET status=$3,last_error=$4,processed_at=NOW()
      WHERE program_id=ANY($1::text[]) AND sig=$2 AND status='pending'`, [[...programs],sig,quarantine ? 'quarantined' : 'processed',quarantine ?? null]);
  }
  async retryGlobal(programs: readonly string[], sig: string, error: unknown): Promise<void> {
    await this.db.query(`UPDATE indexer_signature_queue SET attempts=attempts+1,last_error=$3
      WHERE program_id=ANY($1::text[]) AND sig=$2 AND status='pending'`, [[...programs],sig,error instanceof Error ? error.message.slice(0,500) : 'processing failed']);
  }

  async pending(program: string, limit: number): Promise<HistorySignature[]> {
    const rows = (await this.db.query(`SELECT sig,slot,block_time FROM indexer_signature_queue
      WHERE program_id=$1 AND status='pending' ORDER BY slot ASC,sig ASC LIMIT $2`, [program,limit])).rows;
    return rows.map((row) => ({ signature: String(row.sig), slot: Number(row.slot), err: null,
      blockTime: row.block_time ? new Date(row.block_time).getTime() / 1000 : null }));
  }
  async finish(program: string, sig: string, quarantine?: string): Promise<void> {
    await this.db.query(`UPDATE indexer_signature_queue SET status=$3,last_error=$4,processed_at=NOW()
      WHERE program_id=$1 AND sig=$2`, [program,sig,quarantine ? "quarantined" : "processed",quarantine ?? null]);
  }
  async retry(program: string, sig: string, error: unknown): Promise<void> {
    await this.db.query(`UPDATE indexer_signature_queue SET attempts=attempts+1,last_error=$3
      WHERE program_id=$1 AND sig=$2 AND status='pending'`, [program,sig,error instanceof Error ? error.message.slice(0,500) : "processing failed"]);
  }
}
