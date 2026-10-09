import { unresolvedPositionRebuildCondition } from "../db/projectionGuard.js";

/** Valuation quality applies only to indexed reference data, never redemption. */
export const NAV_INPUT_MAX_AGE_MS = 5 * 60_000;
export const NAV_SNAPSHOT_MAX_AGE_MS = 15 * 60_000;

/** Alias is a programmer-supplied identifier, never an HTTP query value. */
export function navEligibilitySql(alias = ""): string {
  if (alias !== "" && !/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid valuation SQL alias");
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}valuation_eligible IS TRUE AND ${prefix}valuation_status = 'complete'`;
}

export interface ValuationQuality {
  eligible: boolean;
  complete: boolean;
  status: string;
  stale: boolean;
  asOf: string | null;
}

export function valuationQuality(row: Record<string, unknown>, now = new Date()): ValuationQuality {
  const date = row.ts instanceof Date ? row.ts : typeof row.ts === "string" ? new Date(row.ts) : null;
  const timestamp = date?.getTime() ?? NaN;
  const validTime = Number.isFinite(timestamp);
  const currentFailed = ("current_status" in row && row.current_status !== "complete") || ("current_eligible" in row && row.current_eligible !== true);
  const complete = !currentFailed && row.valuation_eligible === true && row.valuation_status === "complete";
  const age = now.getTime() - timestamp;
  const stale = !validTime || !Number.isFinite(age) || age < 0 || age > NAV_SNAPSHOT_MAX_AGE_MS;
  return {
    eligible: complete && !stale,
    complete,
    status: complete ? (stale ? "stale" : "complete") :
      (currentFailed ? String(row.current_reason ?? (row.current_status === "complete" ? "current-ineligible" : row.current_status ?? "unknown")) : typeof row.valuation_status === "string" ? row.valuation_status : "legacy-unverified"),
    stale: stale || !complete,
    asOf: validTime ? date!.toISOString() : null,
  };
}


/** Record current health separately from immutable historical observations. */
export async function recordValuationAttempt(
  db: import("../db/client.js").PgLike,
  basket: string,
  attempt: { complete: boolean; reason: string | null; attemptedAt: string },
): Promise<boolean> {
  const result = await db.query(`INSERT INTO basket_valuation_state (basket,status,reason,attempted_at,last_complete_at)
    VALUES ($1,$2,$3,$4,CASE WHEN $2 = 'complete' THEN $4::timestamptz ELSE NULL END)
    ON CONFLICT (basket) DO UPDATE
      SET status = EXCLUDED.status, reason = EXCLUDED.reason,
          attempted_at = EXCLUDED.attempted_at,
          last_complete_at = CASE WHEN EXCLUDED.status = 'complete'
            THEN EXCLUDED.last_complete_at ELSE basket_valuation_state.last_complete_at END
      WHERE basket_valuation_state.attempted_at < EXCLUDED.attempted_at
         OR (basket_valuation_state.attempted_at = EXCLUDED.attempted_at
             AND (EXCLUDED.status = 'incomplete' OR basket_valuation_state.status = 'complete'))`,
    [basket,attempt.complete ? "complete" : "incomplete",attempt.reason,new Date(attempt.attemptedAt)]);
  return result.rowCount === 1;
}

/** Both arguments are static source identifiers, never user input. */
export function currentNavEligibilitySql(basketExpression: string, navAlias: string): string {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(basketExpression) || !/^[a-z][a-z0-9_]*$/i.test(navAlias)) throw new Error("Invalid current valuation SQL identifier");
  return `EXISTS (SELECT 1 FROM basket_valuation_state vq WHERE vq.basket=${basketExpression} AND vq.status='complete' AND vq.last_complete_at=${navAlias}.ts)`;
}

/** Indexed balances are pending while history or a legacy projection is unresolved. */
export function positionProjectionReadySql(basketExpression: string): string {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(basketExpression)) throw new Error("Invalid projection SQL identifier");
  return `NOT EXISTS(SELECT 1 FROM position_rebuild_required pr WHERE pr.basket=${basketExpression} AND ${unresolvedPositionRebuildCondition("pr")})
    AND NOT EXISTS(SELECT 1 FROM indexer_signature_queue iq WHERE iq.status <> 'processed')
    AND NOT EXISTS(SELECT 1 FROM indexer_program_state ips WHERE ips.history_complete IS NOT TRUE OR ips.scan_before IS NOT NULL OR ips.scan_head IS NOT NULL)`;
}
