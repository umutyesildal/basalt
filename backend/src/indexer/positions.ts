/**
 * indexer/positions.ts — event-driven `user_positions` sync (devnet prep).
 *
 * The listener already persists events/baskets/holdings; this module folds
 * Minted / Redeemed / FeeAccrued events into per-(user, basket) share
 * balances so the holders count and /users/:pubkey/portfolio route read real
 * data instead of zeros.
 *
 * IDEMPOTENCY: runtime (signature, log_index) is claimed on a dedicated pool
 * connection in the same transaction as all balance/cost/fee effects. A basket
 * advisory lock serializes event updates. Errors roll back the claim and all
 * effects, so the listener may retry the exact event safely.
 * Legacy nonatomic claims are quarantined pending separately reviewed recovery.
 *
 * INTEGER-SAFETY (AGENTS.md §2 #7 — see events.ts header): all u64 share
 * amounts arrive as decimal STRINGS and are converted to BigInt before any
 * arithmetic. Balances are bound back to Postgres as decimal strings. The
 * only non-integer value, cost_basis (NUMERIC, USD), is handled in BigInt
 * fixed-point at COST_BASIS_SCALE digits — never a JS number.
 *
 * COST BASIS PROVENANCE: cost_basis is nullable. On mint it is set/blended
 * from the basket's LATEST nav_snapshots.share_price and the row is marked
 * cost_basis_source = 'reference' (an estimate, not a fill price). On redeem
 * it scales down proportionally (BigInt floor). Fee income (entry/exit/mgmt
 * fee shares credited to creator/treasury) carries NO cost basis.
 *
 * FEE SPLIT: feeMath CREATOR_FEE_SPLIT_BPS = 9000 — fees split 90% creator /
 * 10% treasury with dust to treasury (mirrors the on-chain fee_split_amounts).
 *
 * DEGRADATION: db === null (or non-PgLike) skips every write with a warn and
 * returns false — the indexer stays runnable without Postgres.
 */
import { createHash, randomUUID } from "node:crypto";
import { isPgLike, withTransaction, type PgLike } from "../db/client.js";
import type { DecodedFolioxEvent, FeeAccruedEvent, MintedEvent, RedeemedEvent } from "./events.js";
import { splitFeeBigInt } from "../workers/feeMath.js";

/** Fixed-point scale (digits after the dot) for cost_basis math. */
export const COST_BASIS_SCALE = 12n;

// --- decimal-string fixed-point helpers (BigInt only, never Number) ---------

/**
 * Parse a decimal string ("0.155", "-2.5", "191000") into a BigInt scaled by
 * `scale` digits. Extra fractional digits are truncated. Returns null for
 * null/empty/malformed input — callers treat that as "no value".
 */
export function decimalToFixed(value: string | null | undefined, scale: bigint = COST_BASIS_SCALE): bigint | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const negative = s.startsWith("-");
  const unsigned = s.replace(/^[+-]/, "");
  const [intPart, fracPart = ""] = unsigned.split(".");
  const frac = (fracPart + "0".repeat(Number(scale))).slice(0, Number(scale));
  const mag = BigInt(intPart + frac);
  return negative ? -mag : mag;
}

/** Format a `scale`-digit fixed-point BigInt back to a plain decimal string. */
export function fixedToDecimalString(fixed: bigint, scale: bigint = COST_BASIS_SCALE): string {
  const negative = fixed < 0n;
  const abs = negative ? -fixed : fixed;
  const unit = 10n ** scale;
  const intPart = abs / unit;
  let frac = (abs % unit).toString().padStart(Number(scale), "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${intPart.toString()}${frac ? `.${frac}` : ""}`;
}

// --- position_events idempotency guard ---------------------------------------

export class PositionRebuildRequiredError extends Error {
  constructor(readonly basket: string) {
    super(`Position history rebuild required for ${basket}`);
    this.name = "PositionRebuildRequiredError";
  }
}

/** A known missing/insufficient projection must be repaired before this claim can commit. */
export class PositionProjectionGapError extends Error {
  constructor(readonly basket: string, readonly user: string, readonly reason: "missing-position" | "insufficient-indexed-balance") {
    super(`position-projection-gap:${reason}:${basket}:${user}`);
    this.name = "PositionProjectionGapError";
  }
}

function assertLogIndex(logIndex: number | undefined): asserts logIndex is number {
  if (!Number.isSafeInteger(logIndex) || logIndex! < 0) throw new Error("A real attributed runtime logIndex is required");
}

async function lockBasket(db: PgLike, basket: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`positions:${basket}`]);
}

async function claimPositionEvent(db: PgLike, sig: string, kind: string, basket: string, logIndex: number): Promise<boolean> {
  const legacy = await db.query(`SELECT basket FROM position_rebuild_required WHERE basket = $1`, [basket]);
  if (legacy.rows.length) throw new PositionRebuildRequiredError(basket);
  const res = await db.query(
    `INSERT INTO position_events (sig, log_index, kind, basket) VALUES ($1, $2, $3, $4)
     ON CONFLICT (sig, log_index) DO NOTHING`,
    [sig, logIndex, kind, basket],
  );
  return res.rowCount === 1;
}

interface PositionRow {
  share_balance: string;
  cost_basis: string | null;
  cost_basis_source: string | null;
}

/** Current (user, basket) position, or null when no row exists yet. */
async function readPosition(db: PgLike, user: string, basket: string): Promise<PositionRow | null> {
  const res = await db.query(
    `SELECT share_balance::text AS share_balance, cost_basis::text AS cost_basis,
            cost_basis_source
     FROM user_positions WHERE "user" = $1 AND basket = $2 FOR UPDATE`,
    [user, basket],
  );
  const row = (res.rows as unknown as PositionRow[])[0];
  return row ?? null;
}

/** Latest nav_snapshots.share_price for a basket as a decimal string, or null. */
async function latestSharePrice(db: PgLike, basket: string): Promise<string | null> {
  const res = await db.query(
    `SELECT share_price::text AS share_price FROM nav_snapshots
     WHERE basket = $1 AND valuation_eligible AND valuation_status = 'complete' ORDER BY ts DESC LIMIT 1`,
    [basket],
  );
  const price = (res.rows as unknown as Array<{ share_price: string | null }>)[0]?.share_price;
  return typeof price === "string" && price.length > 0 ? price : null;
}

interface PositionDelta {
  user: string;
  basket: string;
  /** Raw share delta; positive for credits, negative for burns/fees paid. */
  delta: bigint;
  /**
   * Fixed-point cost_basis delta (scale COST_BASIS_SCALE) for purchases, or
   * null to leave cost_basis untouched (fee income / no price available).
   */
  costDeltaFixed: bigint | null;
}

/**
 * Read-modify-write one user_positions row with BigInt math. Balances are
 * clamped at zero (an indexer gap can never produce a negative balance).
 * Zero-balance rows are deleted so the holders COUNT stays honest.
 */
async function applyPositionDelta(db: PgLike, d: PositionDelta): Promise<void> {
  const existing = await readPosition(db, d.user, d.basket);
  const balanceBefore = existing ? BigInt(existing.share_balance) : 0n;
  const balanceAfter = balanceBefore + d.delta;
  if (balanceAfter < 0n) {
    console.warn(
      `[positions] clamping negative balance for ${d.user}/${d.basket}: ${balanceBefore.toString()} + ${d.delta.toString()}`,
    );
  }
  const clamped = balanceAfter < 0n ? 0n : balanceAfter;

  if (clamped === 0n) {
    if (existing) {
      await db.query(`DELETE FROM user_positions WHERE "user" = $1 AND basket = $2`, [d.user, d.basket]);
    }
    return;
  }

  let costFixed: bigint | null = existing ? decimalToFixed(existing.cost_basis) : null;
  let source: string | null = existing?.cost_basis_source ?? null;
  if (d.costDeltaFixed !== null) {
    costFixed = (costFixed ?? 0n) + d.costDeltaFixed;
    source = "reference"; // blended from nav_snapshots share_price — an estimate
  }

  const costString = costFixed === null ? null : fixedToDecimalString(costFixed);
  if (existing) {
    await db.query(
      `UPDATE user_positions
       SET share_balance = $3, cost_basis = $4, cost_basis_source = $5, updated_at = NOW()
       WHERE "user" = $1 AND basket = $2`,
      [d.user, d.basket, clamped.toString(), costString, source],
    );
  } else {
    await db.query(
      `INSERT INTO user_positions ("user", basket, share_balance, cost_basis, cost_basis_source, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT ("user", basket) DO UPDATE
         SET share_balance = EXCLUDED.share_balance,
             cost_basis = EXCLUDED.cost_basis,
             cost_basis_source = EXCLUDED.cost_basis_source,
             updated_at = NOW()`,
      [d.user, d.basket, clamped.toString(), costString, source],
    );
  }
}

/**
 * Credit a u64 fee amount 90/10 to the basket's creator and treasury
 * (programs/basket fee_split_amounts: floor to creator, dust to treasury).
 * No cost basis — fee income is not a purchase. Missing recipients fail the
 * entire transaction so the event claim remains retryable.
 */
async function creditFeeSplit(db: PgLike, basket: string, feeShares: bigint): Promise<void> {
  if (feeShares <= 0n) return;
  const res = await db.query(`SELECT creator, treasury FROM baskets WHERE pubkey = $1`, [basket]);
  const row = (res.rows as unknown as Array<{ creator?: string | null; treasury?: string | null }>)[0];
  if (!row?.creator || !row?.treasury) {
    throw new Error(`Fee recipients are not indexed for basket ${basket}`);
  }
  const { creator: creatorAmt, treasury: treasuryAmt } = splitFeeBigInt(feeShares);
  if (creatorAmt > 0n) {
    await applyPositionDelta(db, { user: row.creator, basket, delta: creatorAmt, costDeltaFixed: null });
  }
  if (treasuryAmt > 0n) {
    await applyPositionDelta(db, { user: row.treasury, basket, delta: treasuryAmt, costDeltaFixed: null });
  }
}

// --- public apply* API (all idempotent via the position_events ledger) -------

/**
 * Minted: user gains netShares; entryFeeShares is credited 90/10 to the
 * basket's creator/treasury. cost_basis is set/blended from the latest
 * nav_snapshots.share_price (marked 'reference') when one exists.
 * Returns true when the event was newly applied.
 */
async function applyMintedEffect(db: PgLike, ev: MintedEvent): Promise<boolean> {

  const netShares = BigInt(ev.netShares);
  const price = await latestSharePrice(db, ev.basket);
  const priceFixed = decimalToFixed(price);
  await applyPositionDelta(db, {
    user: ev.user,
    basket: ev.basket,
    delta: netShares,
    // shares (raw, scale 0) × price (fixed scale S) stays at scale S
    costDeltaFixed: priceFixed === null ? null : netShares * priceFixed,
  });
  await creditFeeSplit(db, ev.basket, BigInt(ev.entryFeeShares));
  return true;
}

/**
 * Redeemed: user loses sharesBurned + exitFeeShares (burn + fee); the exit
 * fee is credited 90/10 to creator/treasury. cost_basis scales down
 * proportionally (BigInt floor). A fully-redeemed row is deleted so the
 * holders count only counts live positions.
 * Returns true when the event was newly applied.
 */
async function applyRedeemedEffect(db: PgLike, ev: RedeemedEvent): Promise<boolean> {

  const existing = await readPosition(db, ev.user, ev.basket);
  if (!existing) throw new PositionProjectionGapError(ev.basket, ev.user, "missing-position");

  const balanceBefore = BigInt(existing.share_balance);
  const removed = BigInt(ev.sharesBurned) + BigInt(ev.exitFeeShares);
  if (removed > balanceBefore) throw new PositionProjectionGapError(ev.basket, ev.user, "insufficient-indexed-balance");
  const balanceAfter = balanceBefore - removed;

  if (balanceAfter === 0n) {
    await db.query(`DELETE FROM user_positions WHERE "user" = $1 AND basket = $2`, [ev.user, ev.basket]);
  } else {
    const costFixed = decimalToFixed(existing.cost_basis);
    const scaledCost =
      costFixed === null || balanceBefore === 0n
        ? costFixed
        : (costFixed * balanceAfter) / balanceBefore; // proportional, floor
    await db.query(
      `UPDATE user_positions
       SET share_balance = $3, cost_basis = $4, updated_at = NOW()
       WHERE "user" = $1 AND basket = $2`,
      [
        ev.user,
        ev.basket,
        balanceAfter.toString(),
        scaledCost === null ? null : fixedToDecimalString(scaledCost),
      ],
    );
  }
  await creditFeeSplit(db, ev.basket, BigInt(ev.exitFeeShares));
  return true;
}

/**
 * FeeAccrued: management-fee sharesMinted is credited 90/10 to the basket's
 * creator/treasury (the event itself carries no recipients — they are
 * resolved from the indexed baskets row). No cost basis for fee income.
 * Returns true when the event was newly applied.
 */
async function applyFeeAccruedEffect(db: PgLike, ev: FeeAccruedEvent): Promise<boolean> {

  await creditFeeSplit(db, ev.basket, BigInt(ev.sharesMinted));
  return true;
}

type PositionEvent = MintedEvent | RedeemedEvent | FeeAccruedEvent;

async function applyEffect(db: PgLike, ev: PositionEvent): Promise<boolean> {
  if (ev.type === "Minted") return applyMintedEffect(db, ev);
  if (ev.type === "Redeemed") return applyRedeemedEffect(db, ev);
  return applyFeeAccruedEffect(db, ev);
}

async function applyAtomic(db: PgLike | null | undefined, sig: string, ev: PositionEvent, logIndex?: number): Promise<boolean> {
  if (!isPgLike(db)) return false;
  assertLogIndex(logIndex);
  return withTransaction(db, async (client) => {
    await lockBasket(client, ev.basket);
    if (!(await claimPositionEvent(client, sig, ev.type, ev.basket, logIndex))) return false;
    await applyEffect(client, ev);
    return true;
  });
}

export function applyMinted(db: PgLike | null | undefined, sig: string, ev: MintedEvent, logIndex?: number): Promise<boolean> {
  return applyAtomic(db, sig, ev, logIndex);
}
export function applyRedeemed(db: PgLike | null | undefined, sig: string, ev: RedeemedEvent, logIndex?: number): Promise<boolean> {
  return applyAtomic(db, sig, ev, logIndex);
}
export function applyFeeAccrued(db: PgLike | null | undefined, sig: string, ev: FeeAccruedEvent, logIndex?: number): Promise<boolean> {
  return applyAtomic(db, sig, ev, logIndex);
}

/** The index is the original runtime log offset, not an index after event filtering. */
export async function applyPositionEvent(
  db: PgLike | null | undefined,
  sig: string,
  ev: DecodedFolioxEvent,
  logIndex?: number,
): Promise<boolean> {
  return ev.type === "BasketCreated" ? false : applyAtomic(db, sig, ev, logIndex);
}


export interface FinalizedPositionSnapshot {
  /** Authenticated finalized RPC context; caller validates share mint and Token-2022 owners. */
  slot: number;
  supply: string;
  balances: Array<{ user: string; shares: string }>;
}

/**
 * Stage exact current-chain positions plus complete canonical event claims.
 * No existing balance/claim is overwritten and legacy quarantine remains active.
 * Old/latest NAVs are never used to invent historical fill cost. The separately
 * reviewed activation must re-read finalized balances and verify this history
 * fingerprint before switching projections; this function does not activate.
 */
export async function stagePositionRebuild(
  db: PgLike,
  basket: string,
  programIds: readonly string[],
  snapshot: FinalizedPositionSnapshot,
): Promise<{ runId: string; eventCount: number; historyHash: string }> {
  if (!programIds.length || new Set(programIds).size !== programIds.length) throw new Error("Expected program IDs are required for complete-history attestation");
  if (!Number.isSafeInteger(snapshot.slot) || snapshot.slot < 0 || !/^\d+$/.test(snapshot.supply)) throw new Error("Invalid finalized position snapshot");
  const users = new Set<string>();
  let total = 0n;
  for (const row of snapshot.balances) {
    if (!row.user || users.has(row.user) || !/^\d+$/.test(row.shares)) throw new Error("Invalid or duplicate finalized holder");
    users.add(row.user);
    total += BigInt(row.shares);
  }
  if (total !== BigInt(snapshot.supply)) throw new Error("Finalized holder balances must reconcile exactly to share supply");
  return withTransaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["indexer-global-finalized-poll"]);
    await lockBasket(client, basket);
    const state = await client.query("SELECT program_id, history_complete, scan_before, scan_head, finalized_through_slot::text AS finalized_through_slot FROM indexer_program_state WHERE program_id = ANY($1::text[])", [[...programIds]]);
    if (state.rows.length !== programIds.length || state.rows.some(row => !row.history_complete || row.scan_before !== null || row.scan_head !== null || row.finalized_through_slot == null || BigInt(row.finalized_through_slot) < BigInt(snapshot.slot))) throw new Error("Canonical program history backfill is incomplete through the finalized snapshot slot");
    const pending = await client.query("SELECT COUNT(*)::int AS count FROM indexer_signature_queue WHERE program_id = ANY($1::text[]) AND status <> 'processed'", [[...programIds]]);
    if (pending.rows[0]?.count !== 0) throw new Error("Canonical history contains pending or quarantined signatures");
    const history = await client.query("SELECT sig,log_index,type,data,slot::text AS slot FROM events WHERE basket=$1 AND log_index >= 0 ORDER BY slot,sig,log_index", [basket]);
    const creations = history.rows.filter(row => row.type === "BasketCreated" && row.data?.basket === basket);
    if (creations.length !== 1) throw new Error("Exactly one authenticated creation event is required in canonical history");
    let eventSupply = 1_000_000n; // Immutable V0 genesis amount, verified by the creation instruction.
    for (const row of history.rows) {
      const field = row.type === "Minted" ? "grossShares" : row.type === "FeeAccrued" ? "sharesMinted" : row.type === "Redeemed" ? "sharesBurned" : null;
      if (field === null) continue;
      const amount = row.data?.[field];
      if (typeof amount !== "string" || !/^\d+$/.test(amount)) throw new Error("Canonical event contains invalid raw share amount");
      eventSupply += row.type === "Redeemed" ? -BigInt(amount) : BigInt(amount);
    }
    if (eventSupply !== BigInt(snapshot.supply)) throw new Error("Canonical events do not reconcile to finalized share supply");
    if (history.rows.some(row => BigInt(row.slot) > BigInt(snapshot.slot))) throw new Error("Finalized chain snapshot predates event history");
    const historyHash = createHash("sha256").update(JSON.stringify(history.rows)).digest("hex");
    const runId = randomUUID();
    await client.query("INSERT INTO position_rebuild_runs(run_id,basket,chain_slot,chain_supply,event_count,history_hash) VALUES($1,$2,$3,$4,$5,$6)",
      [runId,basket,String(snapshot.slot),snapshot.supply,history.rows.length,historyHash]);
    for (const row of snapshot.balances) {
      if (BigInt(row.shares) === 0n) continue;
      await client.query('INSERT INTO position_rebuild_staging(run_id,"user",basket,share_balance,cost_basis,cost_basis_source) VALUES($1,$2,$3,$4,NULL,NULL)',
        [runId,row.user,basket,row.shares]);
    }
    for (const row of history.rows) {
      if (row.type === "BasketCreated") continue;
      await client.query("INSERT INTO position_rebuild_claims(run_id,sig,log_index,kind,basket) VALUES($1,$2,$3,$4,$5)",
        [runId,row.sig,row.log_index,row.type,basket]);
    }
    return {runId,eventCount:history.rows.length,historyHash};
  });
}
