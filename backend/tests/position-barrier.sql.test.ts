/** Approved source tests: isolated PostgreSQL schemas, never application DATABASE_URL. */
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import pg from "pg";
import { applySchema } from "../src/db/init";
import type { PgLike } from "../src/db/client";
import { applyMinted, applyRedeemed, applyFeeAccrued, PositionRebuildRequiredError } from "../src/indexer/positions";
import { positionProjectionReadySql } from "../src/api/valuation-quality";
import { userPortfolio, healthReport } from "../src/api/server";
import { syncPositionsFromChain } from "../src/indexer/positionsSync";
import { decodeBasketState } from "../src/indexer/basketState";
import { positionRecoveryFixture, recoveryKey } from "./fixtures/position-recovery";

const url=process.env.POSITION_EVENTS_TEST_DATABASE_URL ?? process.env.BASKET_RETURNS_TEST_DATABASE_URL;
const fixture=positionRecoveryFixture({slot:100,holders:[{user:recoveryKey(20),amount:100n},{user:recoveryKey(201),amount:10n},{user:recoveryKey(202),amount:20n}]});
const basket=fixture.basket.toBase58(),otherBasket="other-basket",user=recoveryKey(20).toBase58(),creator=fixture.creator.toBase58(),treasury=fixture.treasury.toBase58();
const minted={type:"Minted" as const,basket,user,netShares:"100",grossShares:"110",entryFeeShares:"10"};
let admin:pg.Client,pool:pg.Pool,db:PgLike,schema:string,counter=0;

describe.skipIf(!url)("snapshot-covered position claims against disposable PostgreSQL",()=>{
  beforeAll(async()=>{admin=new pg.Client({connectionString:url});await admin.connect();});
  afterAll(async()=>{await admin?.end();});
  beforeEach(async()=>{
    schema=`position_barrier_${process.pid}_${Date.now()}_${counter++}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`,max:8});db=pool as unknown as PgLike;
    expect(await applySchema(db)).toBe(true);
    for(const key of [basket,otherBasket]) await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,'factory',$2,$3,$4,1,NOW(),'hash',2,ARRAY['m1','m2'],ARRAY[5000,5000],100,50,200,NOW())`,[key,creator,treasury,`share-${key}`]);
    await pool.query(`INSERT INTO user_positions("user",basket,share_balance,cost_basis,cost_basis_source) VALUES($1,$4,100,7,'reference'),($2,$4,10,NULL,NULL),($3,$4,20,NULL,NULL)`,[user,creator,treasury,basket]);
    await pool.query(`INSERT INTO nav_snapshots(basket,nav,supply,share_price,price_source,valuation_eligible,valuation_status) VALUES($1,100,100,1,'{}',true,'complete')`,[basket]);
    await pool.query(`INSERT INTO position_reconciliation_state(basket,snapshot_slot) VALUES($1,100)`,[basket]);
  },30_000);
  afterEach(async()=>{await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);});
  const balances=async()=> (await pool.query(`SELECT "user",share_balance::text AS balance,cost_basis::text AS cost,cost_basis_source,updated_at FROM user_positions WHERE basket=$1 ORDER BY "user"`,[basket])).rows;
  const ready=async()=> (await pool.query(`SELECT ${positionProjectionReadySql("b.pubkey")} AS ready FROM baskets b WHERE b.pubkey=$1`,[basket])).rows[0].ready;
  async function run(id:string,key=basket,status="staged-pending-review"){
    await pool.query(`INSERT INTO position_rebuild_runs(run_id,basket,chain_slot,chain_supply,event_count,history_hash,program_ids,status,activated_at,activated_slot) VALUES($1,$2,100,130,0,$3,ARRAY['program'],$4,CASE WHEN $4='activated' THEN NOW() END,CASE WHEN $4='activated' THEN 100 END)`,[id,key,"a".repeat(64),status]);
  }

  it("claims covered mint/redeem/fee identities without changing balances, recipients or cost fields",async()=>{
    const before=await balances();
    expect(await applyMinted(db,"covered-mint",minted,1,99)).toBe(true);
    expect(await applyRedeemed(db,"covered-redeem",{type:"Redeemed",basket,user,sharesBurned:"10000",exitFeeShares:"100"},2,100)).toBe(true);
    expect(await applyFeeAccrued(db,"covered-fee",{type:"FeeAccrued",basket,sharesMinted:"1000",elapsedSec:"1"},3,100)).toBe(true);
    expect(await balances()).toEqual(before);
    expect(await applyMinted(db,"covered-mint",minted,1,99)).toBe(false);
    expect((await pool.query("SELECT sig,slot::text AS slot FROM position_events ORDER BY sig")).rows).toEqual([{sig:"covered-fee",slot:"100"},{sig:"covered-mint",slot:"99"},{sig:"covered-redeem",slot:"100"}]);
  });
  it("applies a newer event once and retains the slot in the same atomic claim",async()=>{
    expect(await applyMinted(db,"new-mint",minted,1,101)).toBe(true);
    expect(await applyMinted(db,"new-mint",minted,1,101)).toBe(false);
    const rows=await balances();
    expect(rows.find(row=>row.user===user)).toMatchObject({balance:"200",cost:"107",cost_basis_source:"reference"});
    expect(rows.find(row=>row.user===creator)).toMatchObject({balance:"19"});
    expect(rows.find(row=>row.user===treasury)).toMatchObject({balance:"21"});
    expect((await pool.query("SELECT slot::text AS slot FROM position_events WHERE sig='new-mint'")).rows[0].slot).toBe("101");
  });
  it("keeps a recovered unknown aggregate basis unknown after a priced purchase",async()=>{
    await pool.query(`UPDATE user_positions SET cost_basis=NULL,cost_basis_source=NULL WHERE "user"=$1 AND basket=$2`,[user,basket]);
    expect(await applyMinted(db,"priced-after-unknown",minted,1,101)).toBe(true);
    expect(await applyMinted(db,"priced-after-unknown",minted,1,101)).toBe(false);
    expect((await balances()).find(row=>row.user===user)).toMatchObject({balance:"200",cost:null,cost_basis_source:null});
    expect((await balances()).find(row=>row.user===creator)).toMatchObject({balance:"19",cost:null,cost_basis_source:null});
  });
  it("invalidates a known aggregate basis when new purchased shares have no price",async()=>{
    await pool.query(`UPDATE user_positions SET cost_basis=50,cost_basis_source='reference' WHERE "user"=$1 AND basket=$2`,[user,basket]);
    await pool.query("DELETE FROM nav_snapshots WHERE basket=$1",[basket]);
    expect(await applyMinted(db,"unpriced-after-known",minted,1,101)).toBe(true);
    expect(await applyMinted(db,"unpriced-after-known",minted,1,101)).toBe(false);
    expect((await balances()).find(row=>row.user===user)).toMatchObject({balance:"200",cost:null,cost_basis_source:null});
  });
  it("rejects missing or invalid finalized slots before committing any claim/effect",async()=>{
    const before=await balances();
    for(const [i,slot] of [undefined,-1,0.5,Number.MAX_SAFE_INTEGER+1].entries()) await expect(applyMinted(db,`no-slot-${i}`,minted,1,slot)).rejects.toThrow(/finalized runtime slot/);
    expect(await balances()).toEqual(before);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM position_events")).rows[0].n).toBe(0);
  });
  it("keeps the guard unresolved for pending and wrong-basket activated runs",async()=>{
    await run("pending"); await run("wrong",otherBasket,"activated");
    await pool.query("INSERT INTO position_rebuild_required(basket,reason,activated_run_id) VALUES($1,'test',$2)",[basket,"pending"]);
    expect(await ready()).toBe(false);
    await expect(applyMinted(db,"blocked-pending",minted,1,101)).rejects.toBeInstanceOf(PositionRebuildRequiredError);
    await pool.query("UPDATE position_rebuild_required SET activated_run_id='wrong' WHERE basket=$1",[basket]);
    expect(await ready()).toBe(false);
    await expect(applyMinted(db,"blocked-wrong",minted,1,101)).rejects.toBeInstanceOf(PositionRebuildRequiredError);
    expect((await userPortfolio(db,user)).payload).toMatchObject({data:[{projectionStatus:"rebuild-required",estimatedValue:null}]});
  });
  it("resolves API/event guards only after the matching activation transaction commits",async()=>{
    await run("matching");
    await pool.query("INSERT INTO position_rebuild_required(basket,reason,activated_run_id) VALUES($1,'test','matching')",[basket]);
    const transaction=await pool.connect();
    try {
      await transaction.query("BEGIN");
      await transaction.query("UPDATE position_rebuild_runs SET status='activated',activated_at=NOW(),activated_slot=100 WHERE run_id='matching'");
      expect(await ready()).toBe(false);
      expect((await userPortfolio(db,user)).payload).toMatchObject({data:[{projectionStatus:"rebuild-required"}]});
      await transaction.query("COMMIT");
    } finally {await transaction.query("ROLLBACK");transaction.release();}
    expect(await ready()).toBe(true);
    expect((await userPortfolio(db,user)).payload).toMatchObject({data:[{projectionStatus:"indexed"}]});
    expect(await applyMinted(db,"after-commit",minted,1,101)).toBe(true);
    const result=await healthReport(db,()=>({db:{enabled:true,connected:true},indexer:{enabled:true,running:true},navEngine:{enabled:false,running:false},feeCrank:{enabled:false,running:false},userSnapshot:{enabled:false,running:false}}));
    expect(result.payload).toMatchObject({db:{history:{rebuildRequiredBaskets:0,activatedRecoveryRuns:1,reconciliationWritesEnabled:true,reconciliationGuarded:true,automaticActivationEnabled:false}}});
  });

  async function prepareReconciliation() {
    await pool.query("DELETE FROM baskets WHERE pubkey=$1",[otherBasket]);
    const state=decodeBasketState(basket,fixture.basketAccount,fixture.programs);
    await pool.query(`UPDATE baskets SET factory=$2,creator=$3,treasury=$4,share_mint=$5,nonce=$6,created_at=$7,metadata_hash=$8,num_constituents=$9,constituents=$10,weights_bps=$11,entry_fee_bps=$12,exit_fee_bps=$13,management_fee_bps=$14 WHERE pubkey=$1`,[basket,state.factory,state.creator,state.treasury,state.shareMint,state.nonce,state.createdAt,state.metadataHash,state.numConstituents,state.constituents,state.weightsBps,state.entryFeeBps,state.exitFeeBps,state.managementFeeBps]);
    for(const program of fixture.programs.ids) await pool.query("INSERT INTO indexer_program_state(program_id,history_complete,finalized_through_slot) VALUES($1,true,200)",[program]);
  }
  it("preserves a newer direct event applied after snapshot read and before reconciliation locks",async()=>{
    await prepareReconciliation();
    const result=await syncPositionsFromChain(fixture.rpc,db,{spacingMs:0,programs:fixture.programs,catchUpThroughSlot:async(slot)=>{
      expect(slot).toBe(100);await applyMinted(db,"after-snapshot",minted,1,101);
    }});
    expect(result).toMatchObject({basketsScanned:0,basketsFailed:1});
    expect((await balances()).find(row=>row.user===user)).toMatchObject({balance:"200",cost:"107"});
    expect((await pool.query("SELECT snapshot_slot::text AS slot FROM position_reconciliation_state WHERE basket=$1",[basket])).rows[0].slot).toBe("100");
    expect(await applyMinted(db,"after-snapshot",minted,1,101)).toBe(false);
  });
  it("applies a newer event waiting behind actual reconciliation without losing the update",async()=>{
    await prepareReconciliation();
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const held:PgLike={query:db.query.bind(db),connect:async()=>{
      const client=await pool.connect();return {release:()=>client.release(),query:async(sql,values)=>{
        const result=await client.query(sql,values);
        if(sql.includes('COALESCE(MAX(slot)')) {entered();await gate;}
        return result;
      }};
    }};
    const reconcile=syncPositionsFromChain(fixture.rpc,held,{spacingMs:0,programs:fixture.programs,catchUpThroughSlot:async()=>{}});
    await started;
    const event=applyMinted(db,"after-reconcile",minted,1,101);
    release();expect(await reconcile).toMatchObject({basketsScanned:1,basketsFailed:0});expect(await event).toBe(true);
    expect((await balances()).find(row=>row.user===user)).toMatchObject({balance:"200",cost:"107"});
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM position_events WHERE sig='after-reconcile'")).rows[0].n).toBe(1);
  });

  it("serializes concurrent covered and newer effects under the basket barrier",async()=>{
    await Promise.all([
      applyFeeAccrued(db,"parallel-covered",{type:"FeeAccrued",basket,sharesMinted:"1000",elapsedSec:"1"},1,100),
      ...Array.from({length:8},(_,i)=>applyMinted(db,`parallel-new-${i}`,minted,2,101+i)),
    ]);
    const rows=await balances();
    expect(rows.find(row=>row.user===user)).toMatchObject({balance:"900",cost:"807"});
    expect(rows.find(row=>row.user===creator)).toMatchObject({balance:"82"});
    expect(rows.find(row=>row.user===treasury)).toMatchObject({balance:"28"});
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM position_events")).rows[0].n).toBe(9);
  });
});
