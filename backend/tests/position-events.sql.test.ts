/** Actual PostgreSQL crash/replay/parallel regressions. Explicit disposable DB only. */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import pg from "pg";
import { PublicKey } from "@solana/web3.js";
import { applySchema } from "../src/db/init";
import type { PgLike } from "../src/db/client";
import { applyMinted, applyRedeemed, applyFeeAccrued, stagePositionRebuild, PositionRebuildRequiredError, PositionProjectionGapError } from "../src/indexer/positions";
import { insertEvents } from "../src/indexer/listener";
import { replayThroughFinalizedSlot } from "../src/maintenance/historyReadiness";
import type { MintedEvent } from "../src/indexer/events";

const url = process.env.POSITION_EVENTS_TEST_DATABASE_URL ?? process.env.BASKET_RETURNS_TEST_DATABASE_URL;
const schema = `position_events_${process.pid}_${Date.now()}`;
let admin: pg.Client;
let pool: pg.Pool;
let db: PgLike;
const key=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58();
const basket=key(1),creator=key(2),treasury=key(3),user=key(4),basketTwo=key(7),shareMint=key(8);
const programs=[key(240),key(241),key(242)];
const mint: MintedEvent = { type: "Minted", basket, user, netShares: "1000", grossShares: "1100", entryFeeShares: "100" };

describe.skipIf(!url)("atomic position effects against disposable PostgreSQL", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 8 });
    db = pool as unknown as PgLike;
    await applySchema(db);
  }, 30_000);
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });
  beforeEach(async () => {
    // Never disable product backup guards for fixture cleanup.
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    expect(await applySchema(db)).toBe(true);
    await createBasket(basket);
    await pool.query(`INSERT INTO nav_snapshots(basket,nav,supply,share_price,price_source,valuation_eligible,valuation_status)
      VALUES($1,100,1000000,0.1,'{}',true,'complete')`, [basket]);
  });
  async function createBasket(key: string) {
    await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,
      num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,'factory',$2,$3,$4,1,NOW(),'hash',2,ARRAY['m1','m2'],ARRAY[5000,5000],100,50,200,NOW())`,
      [key,creator,treasury,`share-${key}`]);
  }
  const balances = async () => (await pool.query('SELECT "user",share_balance::text AS balance FROM user_positions ORDER BY "user"')).rows;

  function failingPool(match: (sql: string) => boolean, occurrence = 1): PgLike {
    let matches = 0;
    return {
      query: (sql, args) => db.query(sql,args),
      connect: async () => {
        const client = await pool.connect();
        return {
          release: () => client.release(),
          query: async (sql, args) => {
            const result = await client.query(sql,args);
            if (match(sql) && ++matches === occurrence) throw new Error("injected failure after SQL effect");
            return result;
          },
        };
      },
    };
  }

  it.each([
    ["claim", "INSERT INTO position_events", 1],
    ["NAV read", "FROM nav_snapshots", 1],
    ["user credit", "INSERT INTO user_positions", 1],
    ["creator credit", "INSERT INTO user_positions", 2],
    ["treasury credit", "INSERT INTO user_positions", 3],
  ] as const)("rolls back %s and all earlier writes; retry applies exactly once", async (_, fragment, occurrence) => {
    await expect(applyMinted(failingPool(sql => sql.includes(fragment), occurrence),"fault",mint,7)).rejects.toThrow("injected failure");
    expect((await pool.query("SELECT * FROM position_events")).rows).toEqual([]);
    expect(await balances()).toEqual([]);
    expect(await applyMinted(db,"fault",mint,7)).toBe(true);
    expect(await applyMinted(db,"fault",mint,7)).toBe(false);
    expect(await balances()).toEqual([{user:creator,balance:"90"},{user:treasury,balance:"10"},{user,balance:"1000"}]);
  });

  it("keeps two same-kind events and fee accrual in one signature with exactly-once replay", async () => {
    await applyFeeAccrued(db,"multi",{type:"FeeAccrued",basket,sharesMinted:"100",elapsedSec:"1"},3);
    await applyMinted(db,"multi",mint,8);
    await applyMinted(db,"multi",mint,15);
    expect(await applyMinted(db,"multi",mint,15)).toBe(false);
    expect((await pool.query("SELECT log_index FROM position_events ORDER BY log_index")).rows).toEqual([{log_index:3},{log_index:8},{log_index:15}]);
    expect(await balances()).toEqual([{user:creator,balance:"270"},{user:treasury,balance:"30"},{user,balance:"2000"}]);
  });

  it("serializes parallel same-position credits on separate connections without lost updates", async () => {
    await Promise.all(Array.from({length:20},(_,i) => applyMinted(db,`parallel-${i}`,mint,2)));
    expect(await balances()).toEqual([{user:creator,balance:"1800"},{user:treasury,balance:"200"},{user,balance:"20000"}]);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM position_events")).rows[0].count).toBe(20);
  });

  it("rolls back a full redemption deletion together with its claim, then retries exactly once", async () => {
    await applyMinted(db,"original",mint,3);
    const redeemed = {type:"Redeemed" as const,basket,user,sharesBurned:"1000",exitFeeShares:"0"};
    await expect(applyRedeemed(failingPool(sql => sql.startsWith("DELETE FROM user_positions")),"redeem",redeemed,7)).rejects.toThrow(/injected failure/);
    expect((await pool.query("SELECT * FROM position_events WHERE sig='redeem'")).rows).toEqual([]);
    expect(await balances()).toContainEqual({user,balance:"1000"});
    expect(await applyRedeemed(db,"redeem",redeemed,7)).toBe(true);
    expect(await applyRedeemed(db,"redeem",redeemed,7)).toBe(false);
    expect(await balances()).toEqual([{user:creator,balance:"90"},{user:treasury,balance:"10"}]);
  });

  it.each(["missing", "insufficient"])("rolls back a %s projection gap before fees and permits exact retry after repair", async mode => {
    if (mode === "insufficient") await pool.query('INSERT INTO user_positions("user",basket,share_balance,cost_basis) VALUES($1,$2,500,50)',[user,basket]);
    const before = await balances();
    const redeemed = {type:"Redeemed" as const,basket,user,sharesBurned:"900",exitFeeShares:"100"};
    await expect(applyRedeemed(db,"gap",redeemed,7)).rejects.toBeInstanceOf(PositionProjectionGapError);
    expect(await balances()).toEqual(before);
    expect((await pool.query("SELECT * FROM position_events WHERE sig='gap'")).rows).toEqual([]);
    // Disposable fixture repair stands in for separately reviewed finalized recovery.
    await pool.query('INSERT INTO user_positions("user",basket,share_balance) VALUES($1,$2,1000) ON CONFLICT("user",basket) DO UPDATE SET share_balance=1000',[user,basket]);
    expect(await applyRedeemed(db,"gap",redeemed,7)).toBe(true);
    expect(await applyRedeemed(db,"gap",redeemed,7)).toBe(false);
    expect(await balances()).toEqual([{user:creator,balance:"90"},{user:treasury,balance:"10"}]);
  });

  it("supports same-kind events for two baskets in one signature", async () => {
    await createBasket(basketTwo);
    await applyMinted(db,"two-baskets",mint,5);
    await applyMinted(db,"two-baskets",{...mint,basket:basketTwo},12);
    expect((await pool.query('SELECT basket,share_balance::text AS balance FROM user_positions WHERE "user"=$1 ORDER BY basket',[user])).rows)
      .toEqual([{basket,balance:"1000"},{basket:basketTwo,balance:"1000"}]);
  });

  it("refuses identity-less or query-only position persistence", async () => {
    await expect(applyMinted(db,"missing-index",mint)).rejects.toThrow(/runtime logIndex/);
    await expect(applyMinted({query:db.query.bind(db)},"shared-client",mint,4)).rejects.toThrow(/connection pool/);
    await expect(applyMinted(admin as unknown as PgLike,"connected-shared-client",mint,4)).rejects.toThrow(/connection pool/);
    expect(await balances()).toEqual([]);
  });

  it("preserves all event rows when one signature emits fee+mint+redeem+two mints", async () => {
    const rows = ["FeeAccrued","Minted","Redeemed","Minted"].map((type,i) => ({sig:"all-events",logIndex:i*4+2,slot:1,basket,type,data:{},ts:new Date()}));
    expect(await insertEvents(db,rows as Parameters<typeof insertEvents>[1])).toBe(4);
    expect(await insertEvents(db,rows as Parameters<typeof insertEvents>[1])).toBe(0);
    expect((await pool.query("SELECT log_index FROM events ORDER BY log_index")).rows).toHaveLength(4);
  });

  it("migrates all legacy kind markers without trusting them or duplicating financial effects", async () => {
    await pool.query("DROP MATERIALIZED VIEW basket_rankings");
    await pool.query("ALTER TABLE events DROP CONSTRAINT events_pkey; ALTER TABLE events DROP COLUMN log_index; ALTER TABLE events ADD PRIMARY KEY(sig)");
    await pool.query("ALTER TABLE position_events DROP CONSTRAINT position_events_pkey; ALTER TABLE position_events DROP COLUMN log_index; ALTER TABLE position_events ADD PRIMARY KEY(sig,kind)");
    await pool.query("INSERT INTO events(sig,slot,basket,type,data) VALUES('legacy',1,$1,'FeeAccrued','{}')",[basket]);
    await pool.query("INSERT INTO position_events(sig,kind,basket) VALUES('legacy','Minted',$1),('legacy','FeeAccrued',$1)",[basket]);
    await pool.query('INSERT INTO user_positions("user",basket,share_balance) VALUES($1,$2,999)',[user,basket]);
    await applySchema(db);
    await applySchema(db); // migration remains idempotent
    expect((await pool.query("SELECT log_index FROM position_events ORDER BY log_index")).rows).toEqual([{log_index:-2},{log_index:-1}]);
    await expect(applyMinted(db,"legacy",mint,8)).rejects.toBeInstanceOf(PositionRebuildRequiredError);
    await expect(applyMinted(db,"new-signature",mint,2)).rejects.toBeInstanceOf(PositionRebuildRequiredError);
    expect(await balances()).toEqual([{user,balance:"999"}]);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM position_events")).rows[0].count).toBe(2);
  });
  async function replayReady() {
    for(const program of programs) await pool.query("INSERT INTO indexer_program_state(program_id,history_complete,finalized_through_slot) VALUES($1,true,3)",[program]);
    await pool.query("INSERT INTO events(sig,log_index,slot,basket,type,data) VALUES('creation',1,1,$1,'BasketCreated',$2),('trade',3,2,$1,'Minted',$3)",
      [basket,{type:"BasketCreated",basket,creator,shareMint,numConstituents:2,ts:1725148800,programId:programs[1]},{...mint,programId:programs[2]}]);
    await pool.query("INSERT INTO position_rebuild_required(basket,reason) VALUES($1,'legacy')",[basket]);
    await pool.query('INSERT INTO user_positions("user",basket,share_balance) VALUES($1,$2,999)',[user,basket]);
  }
  const snapshot = {slot:3,supply:"1001100",balances:[{user,shares:"1000"},{user:creator,shares:"1000090"},{user:treasury,shares:"10"}]};

  it("rejects noncanonical public inputs and out-of-range raw amounts without creating a staged run",async()=>{
    await replayReady();
    const cases:Array<{ids?:string[];basket?:string;snapshot?:typeof snapshot}>=[
      {ids:programs.slice(0,2)},{ids:[programs[0],programs[0],programs[2]]},{ids:[programs[0],programs[1],'invalid']},
      {basket:'invalid-basket'},{snapshot:{...snapshot,balances:[{user:'invalid-user',shares:snapshot.supply}]}},
      {snapshot:{...snapshot,supply:'18446744073709551616'}},
      {snapshot:{...snapshot,balances:[{user,shares:'18446744073709551616'}]}},
      {snapshot:{...snapshot,supply:'01001100'}},
    ];
    for(const entry of cases) await expect(stagePositionRebuild(db,entry.basket??basket,entry.ids??programs,entry.snapshot??snapshot)).rejects.toThrow();
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM position_rebuild_runs')).rows[0].n).toBe(0);
    expect(await balances()).toEqual([{user,balance:'999'}]);
  });
  it.each(['emitter','creation-count','mint-conservation','u64','type','duplicate-creation'])('rejects malformed canonical %s evidence before staging',async fault=>{
    await replayReady();
    if(fault==='duplicate-creation') await pool.query("INSERT INTO events(sig,log_index,slot,basket,type,data) SELECT 'second-creation',log_index,slot,basket,type,data FROM events WHERE sig='creation'");
    else if(fault==='type') await pool.query("UPDATE events SET data=data-'type' WHERE sig='trade'");
    else {
      const [sig,path,value]=fault==='emitter'?['trade','programId',key(100)]:fault==='creation-count'?['creation','numConstituents',21]:fault==='mint-conservation'?['trade','netShares','1001']:['trade','grossShares','18446744073709551616'];
      await pool.query('UPDATE events SET data=jsonb_set(data,$2::text[],$3::jsonb) WHERE sig=$1',[sig,[path],JSON.stringify(value)]);
    }
    await expect(stagePositionRebuild(db,basket,programs,snapshot)).rejects.toThrow(/Canonical|Exactly one|Invalid raw u64/);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM position_rebuild_runs')).rows[0].n).toBe(0);
    expect(await balances()).toEqual([{user,balance:'999'}]);
  });

  it("requires complete durable history and exact finalized supply reconciliation before staging", async () => {
    await expect(stagePositionRebuild(db,basket,programs,snapshot)).rejects.toThrow(/backfill is incomplete/);
    await replayReady();
    await expect(stagePositionRebuild(db,basket,programs,{...snapshot,supply:"1001101"})).rejects.toThrow(/holder balances/);
    await expect(stagePositionRebuild(db,basket,programs,{...snapshot,supply:"1001101",balances:[{user,shares:"1001101"}]})).rejects.toThrow(/events do not reconcile/);
    await pool.query("INSERT INTO indexer_signature_queue(program_id,sig,slot,status) VALUES('HDXwMGmSvaHNUj2oghHWq6E5b7VJeFmo6vxUzDknJxQf','pending',3,'quarantined')");
    await expect(stagePositionRebuild(db,basket,programs,snapshot)).rejects.toThrow(/pending or quarantined/);
  });
  it.each(["scan_before", "scan_head"])("rejects an in-progress %s even after the initial history completed", async (field) => {
    await replayReady();
    await pool.query(`UPDATE indexer_program_state SET ${field}='scanning' WHERE program_id='HDXwMGmSvaHNUj2oghHWq6E5b7VJeFmo6vxUzDknJxQf'`);
    await expect(stagePositionRebuild(db,basket,programs,snapshot)).rejects.toThrow(/backfill is incomplete/);
    expect((await pool.query("SELECT * FROM position_rebuild_runs")).rows).toEqual([]);
    expect(await balances()).toEqual([{user,balance:"999"}]);
  });

  it("rejects stale complete history even when undiscovered mint/redeem events net to zero supply", async () => {
    await replayReady();
    await pool.query("UPDATE indexer_program_state SET finalized_through_slot=2 WHERE program_id='HDXwMGmSvaHNUj2oghHWq6E5b7VJeFmo6vxUzDknJxQf'");
    await expect(stagePositionRebuild(db,basket,programs,snapshot)).rejects.toThrow(/through the finalized snapshot slot/);
    expect((await pool.query("SELECT * FROM position_rebuild_runs")).rows).toEqual([]);
    expect(await balances()).toEqual([{user,balance:"999"}]);
    await pool.query("INSERT INTO events(sig,log_index,slot,basket,type,data) VALUES('zero-net',4,3,$1,'Minted',$2),('zero-net',8,3,$1,'Redeemed',$3)",
      [basket,{type:"Minted",basket,user,grossShares:"100",netShares:"100",entryFeeShares:"0",programId:programs[2]},{type:"Redeemed",basket,user,sharesBurned:"100",exitFeeShares:"0",programId:programs[2]}]);
    await pool.query("UPDATE indexer_program_state SET finalized_through_slot=3 WHERE program_id='HDXwMGmSvaHNUj2oghHWq6E5b7VJeFmo6vxUzDknJxQf'");
    const staged=await stagePositionRebuild(db,basket,programs,snapshot);
    expect(staged.eventCount).toBe(4);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM position_rebuild_claims WHERE run_id=$1",[staged.runId])).rows[0].count).toBe(3);
    expect(await balances()).toEqual([{user,balance:"999"}]);
  });

  it.each(["failed", "busy"])("does not authorize staging from stale completed state after a %s replay poll", async () => {
    await replayReady();
    await pool.query("UPDATE indexer_program_state SET finalized_through_slot=100 WHERE program_id='HDXwMGmSvaHNUj2oghHWq6E5b7VJeFmo6vxUzDknJxQf'");
    const poller={lastCompletedDiscoverySlot:null,pollOnce:async()=>[]};
    await expect(replayThroughFinalizedSlot(poller,db,programs,{remaining:1,polls:0},3)).rejects.toThrow(/verified catch-up/);
    expect((await pool.query("SELECT * FROM position_rebuild_runs")).rows).toEqual([]);
    expect(await balances()).toEqual([{user,balance:"999"}]);
  });

  it("requires current-poll and persisted finalized coverage together within the shared budget", async () => {
    await replayReady();
    await pool.query("UPDATE indexer_program_state SET finalized_through_slot=2 WHERE program_id='HDXwMGmSvaHNUj2oghHWq6E5b7VJeFmo6vxUzDknJxQf'");
    let polls=0;
    const poller={lastCompletedDiscoverySlot:3,pollOnce:async()=>{
      polls++;
      if(polls===2) await pool.query("UPDATE indexer_program_state SET finalized_through_slot=3 WHERE program_id='HDXwMGmSvaHNUj2oghHWq6E5b7VJeFmo6vxUzDknJxQf'");
      return [];
    }};
    const budget={remaining:2,polls:0};
    await replayThroughFinalizedSlot(poller,db,programs,budget,3);
    expect(polls).toBe(2);
    expect(budget).toEqual({remaining:0,polls:2});
  });

  it("fresh replay evidence never overrides a quarantined signature", async () => {
    await replayReady();
    await pool.query("INSERT INTO indexer_signature_queue(program_id,sig,slot,status) VALUES('HDXwMGmSvaHNUj2oghHWq6E5b7VJeFmo6vxUzDknJxQf','bad',3,'quarantined')");
    await expect(replayThroughFinalizedSlot({lastCompletedDiscoverySlot:3,pollOnce:async()=>[]},db,programs,{remaining:1,polls:0},3)).rejects.toThrow(/quarantined transactions/);
    expect((await pool.query("SELECT * FROM position_rebuild_runs")).rows).toEqual([]);
  });

  it("stages reconciled holders/claims without replacing legacy positions or clearing quarantine", async () => {
    await replayReady();
    const staged = await stagePositionRebuild(db,basket,programs,snapshot);
    expect(staged.eventCount).toBe(2);
    expect(staged.historyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await balances()).toEqual([{user,balance:"999"}]);
    expect((await pool.query('SELECT "user",share_balance::text AS balance,cost_basis FROM position_rebuild_staging WHERE run_id=$1 ORDER BY "user"',[staged.runId])).rows)
      .toEqual([{user:creator,balance:"1000090",cost_basis:null},{user:treasury,balance:"10",cost_basis:null},{user,balance:"1000",cost_basis:null}]);
    expect((await pool.query("SELECT sig,log_index FROM position_rebuild_claims WHERE run_id=$1",[staged.runId])).rows).toEqual([{sig:"trade",log_index:3}]);
    await expect(applyMinted(db,"new",mint,7)).rejects.toBeInstanceOf(PositionRebuildRequiredError);
  });
  it("waits for the shared global poll lock before reading staging history", async () => {
    await replayReady();
    const blocker = await pool.connect();
    let waiting: ReturnType<typeof stagePositionRebuild> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["indexer-global-finalized-poll"]);
      let finished = false;
      waiting = stagePositionRebuild(db,basket,programs,snapshot).then(result=>{finished=true;return result;});
      // Actual pg_locks evidence confirms the second transaction has reached and waits on this lock.
      let blocked = false;
      for (let attempt=0;attempt<50 && !blocked;attempt++) {
        const locks = await pool.query("SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted");
        blocked = locks.rows[0].count>0;
        if (!blocked) await new Promise(resolve=>setTimeout(resolve,5));
      }
      expect(blocked).toBe(true);
      expect(finished).toBe(false);
      expect((await pool.query("SELECT * FROM position_rebuild_runs")).rows).toEqual([]);
      await blocker.query("COMMIT");
      expect((await waiting).eventCount).toBe(2);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (waiting) await waiting;
    }
  });

  it("rolls back a failed staging run while preserving all existing projection data", async () => {
    await replayReady();
    await expect(stagePositionRebuild(failingPool(sql => sql.includes("INSERT INTO position_rebuild_staging")),basket,programs,snapshot)).rejects.toThrow(/injected failure/);
    expect((await pool.query("SELECT * FROM position_rebuild_runs")).rows).toEqual([]);
    expect(await balances()).toEqual([{user,balance:"999"}]);
  });

});
