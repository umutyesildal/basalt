/** Current finalized balances are independent of incomplete historical claims. */
import type { PgLike } from "../db/client.js";
import { DEVNET_PROGRAMS } from "./readiness.js";
export const CURRENT_BALANCE_MAX_AGE_MS = 5 * 60_000;
export interface BalanceEvidence { slot:number; observedAt:string; historyComplete:false; costBasisKnown:false }
export interface CurrentBalanceRow { basket:string; symbol:string|null; shares:string; evidence:BalanceEvidence }
export async function currentBalancesForWallet(db:PgLike,user:string,now=new Date(),programIds:readonly string[]=DEVNET_PROGRAMS) {
  const result=await db.query(`SELECT b.pubkey AS basket,b.metadata_json->>'symbol' AS symbol,
    COUNT(*) OVER()::int AS indexed_baskets,cs.slot::text,cs.observed_at,
    cs.status='verified' AS balance_verified,h.value IS NOT NULL AS holder_present,h.value->>'shares' AS shares
    FROM baskets b LEFT JOIN current_balance_snapshots cs ON cs.basket=b.pubkey
      AND cs.status='verified' AND cs.history_complete IS FALSE AND cs.program_ids=$2::text[]
      AND cs.observed_at BETWEEN $3::timestamptz-interval '5 minutes' AND $3::timestamptz
    LEFT JOIN LATERAL jsonb_array_elements(COALESCE(cs.balances,'[]'::jsonb)) h(value)
      ON h.value->>'user'=$1 ORDER BY b.pubkey LIMIT 1001`,[user,[...programIds].sort(),now.toISOString()]);
  const rows:CurrentBalanceRow[]=[],covered=new Set<string>(),seen=new Set<string>();
  let indexedBaskets=0;
  for (const row of result.rows as Array<Record<string,unknown>>) {
    indexedBaskets=Math.max(indexedBaskets,Number(row.indexed_baskets)||0);
    const slot=typeof row.slot==='string' && /^(0|[1-9]\d*)$/.test(row.slot)?Number(row.slot):NaN;
    const observed=new Date(row.observed_at as string).getTime();
    if(row.balance_verified!==true || typeof row.basket!=='string' || !Number.isSafeInteger(slot) || slot<0 ||
      !Number.isFinite(observed) || now.getTime()-observed<0 || now.getTime()-observed>CURRENT_BALANCE_MAX_AGE_MS) continue;
    if(seen.has(row.basket)) throw new Error('Duplicate stored finalized holder');
    seen.add(row.basket);
    if(row.holder_present===true && (typeof row.shares!=='string' || !/^[1-9]\d{0,19}$/.test(row.shares) || BigInt(row.shares)>(1n<<64n)-1n)) {
      throw new Error('Invalid stored finalized share amount');
    }
    covered.add(row.basket);
    if(row.holder_present!==true) continue;
    rows.push({basket:row.basket,symbol:typeof row.symbol==='string'?row.symbol:null,shares:row.shares as string,
      evidence:{slot,observedAt:new Date(observed).toISOString(),historyComplete:false,costBasisKnown:false}});
  }
  if(result.rows.length>1000) throw new Error('Current balance catalog exceeds bounded portfolio read');
  return {rows,covered,coverage:{indexedBaskets,verifiedBaskets:covered.size,complete:indexedBaskets>0&&indexedBaskets===covered.size}};
}
export const balanceCoverageNote = (complete:boolean) => complete
  ? 'Current raw share balances were verified at finalized slots. Historical transactions and acquisition costs remain incomplete.'
  : 'Current balance verification is incomplete. An empty list does not establish that this wallet has no holdings; redemption remains available directly on chain.';
