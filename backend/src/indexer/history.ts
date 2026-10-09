/** Finalized, bounded, restart-safe history ingestion. Never signs transactions. */
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

  async state(program: string): Promise<ProgramHistory> {
    await this.db.query(`INSERT INTO indexer_program_state(program_id) VALUES($1) ON CONFLICT DO NOTHING`, [program]);
    const result = await this.db.query(STATE, [program]);
    if (!result.rows[0]) throw new Error("Durable indexer history state unavailable");
    return result.rows[0] as ProgramHistory;
  }

  /** Enqueue first, then advance the scan cursor IN THE SAME transaction. */
  async savePage(previous: ProgramHistory, page: HistorySignature[], limit: number): Promise<boolean> {
    return withTransaction(this.db, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`indexer-history:${previous.program_id}`]);
      const current = (await client.query(STATE, [previous.program_id])).rows[0] as ProgramHistory;
      if (JSON.stringify(current) !== JSON.stringify(previous)) return false; // another scanner advanced; reload next poll
      for (const info of page) {
        await client.query(`INSERT INTO indexer_signature_queue(program_id,sig,slot,block_time,status)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(program_id,sig) DO NOTHING`,
        [previous.program_id,info.signature,info.slot, info.blockTime == null ? null : new Date(info.blockTime * 1000), info.err ? "processed" : "pending"]);
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
