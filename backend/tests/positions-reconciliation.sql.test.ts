/** Actual PostgreSQL transactions in a test-owned schema; never uses DATABASE_URL. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { applySchema } from "../src/db/init";
import type { PgLike } from "../src/db/client";
import { decodeBasketState } from "../src/indexer/basketState";
import { syncPositionsFromChain, type PositionsSyncRpc } from "../src/indexer/positionsSync";
import { namespaceRecoveryPrograms, namespaceForRecoveryFixture } from "./fixtures/program-namespaces";
import { positionRecoveryFixture as rawPositionRecoveryFixture, recoveryKey,  type PositionRecoveryFixture } from "./fixtures/position-recovery";
const positionRecoveryFixture=(options:Parameters<typeof rawPositionRecoveryFixture>[0]={})=>rawPositionRecoveryFixture({programs:namespaceRecoveryPrograms(0),...options});

const recoveryPrograms=namespaceRecoveryPrograms(0);
const url = process.env.BASKET_RETURNS_TEST_DATABASE_URL;
const schema = `position_sync_${process.pid}_${Date.now()}`;
let admin: pg.Pool, pool: pg.Pool;
const sync = (f: PositionRecoveryFixture, options: Parameters<typeof syncPositionsFromChain>[2] = {}) =>
  syncPositionsFromChain(f.rpc, pool as unknown as PgLike, { programs: f.programs, namespaces:[namespaceForRecoveryFixture(f.programs)], spacingMs: 0, backoffSleep: async () => {}, ...options });
const user = (n: number) => recoveryKey(n).toBase58();

describe.skipIf(!url)("position reconciliation against disposable PostgreSQL", () => {
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({connectionString:url,max:8,options:`-c search_path=${schema}`,application_name:schema});
    expect(await applySchema(pool as unknown as PgLike)).toBe(true);
  }, 30_000);
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });
  beforeEach(async () => {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    expect(await applySchema(pool as unknown as PgLike)).toBe(true);
  });

  async function seed(f: PositionRecoveryFixture, coverage = f.slot) {
    const state = decodeBasketState(f.basket.toBase58(), f.basketAccount, f.programs);
    await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,
      num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [
      state.pubkey,state.factory,state.creator,state.treasury,state.shareMint,state.nonce,state.createdAt,state.metadataHash,
      state.numConstituents,state.constituents,state.weightsBps,state.entryFeeBps,state.exitFeeBps,state.managementFeeBps,state.lastFeeAccrualTs,
    ]);
    for (const program of f.programs.ids) await pool.query(`INSERT INTO indexer_program_state(program_id,history_complete,finalized_through_slot)
      VALUES($1,true,$2) ON CONFLICT(program_id) DO UPDATE SET finalized_through_slot=GREATEST(indexer_program_state.finalized_through_slot,EXCLUDED.finalized_through_slot)`,[program,coverage]);
  }
  async function position(f: PositionRecoveryFixture, who = 20, shares = "55", cost: string | null = "12.5") {
    await pool.query(`INSERT INTO user_positions("user",basket,share_balance,cost_basis,cost_basis_source)
      VALUES($1,$2,$3,$4,'reference')`,[user(who),f.basket.toBase58(),shares,cost]);
  }
  async function evidence() {
    return {
      positions:(await pool.query('SELECT "user",basket,share_balance::text,cost_basis::text,cost_basis_source,updated_at FROM user_positions ORDER BY basket,"user"')).rows,
      barriers:(await pool.query("SELECT basket,snapshot_slot::text,updated_at FROM position_reconciliation_state ORDER BY basket")).rows,
    };
  }
  async function expectFailurePreserves(f: PositionRecoveryFixture, options: Parameters<typeof sync>[1] = {}) {
    const before=await evidence();const stats=await sync(f,options);
    expect(stats).toMatchObject({basketsScanned:0,basketsFailed:1,balanceSynced:0,zeroed:0});
    expect(await evidence()).toEqual(before);
  }
  async function waitForBlockedWriters(count = 1) {
    for (let attempt=0;attempt<100;attempt++) {
      const result=await admin.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'",[schema]);
      if (result.rows[0].count>=count) return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw new Error("Reconciliation did not wait on the expected database lock");
  }

  it("publishes exact balances atomically, preserving only unchanged known cost",async()=>{
    const f=positionRecoveryFixture({holders:[{user:recoveryKey(20),amount:100n},{user:recoveryKey(21),amount:200n},{user:recoveryKey(22),amount:50n}]});
    await seed(f);await position(f,20,"100","10");await position(f,21,"99","9");await position(f,23,"55","5");
    expect(await sync(f)).toMatchObject({basketsScanned:1,basketsFailed:0,holders:3,balanceSynced:3,zeroed:1});
    const rows=(await evidence()).positions;
    expect(rows.map(({user:who,share_balance,cost_basis,cost_basis_source})=>({who,share_balance,cost_basis,cost_basis_source}))).toEqual([
      {who:user(20),share_balance:"100",cost_basis:"10",cost_basis_source:"reference"},
      {who:user(21),share_balance:"200",cost_basis:null,cost_basis_source:"balance-sync"},
      {who:user(22),share_balance:"50",cost_basis:null,cost_basis_source:"balance-sync"},
      {who:user(23),share_balance:"0",cost_basis:null,cost_basis_source:null},
    ]);
    expect((await evidence()).barriers[0].snapshot_slot).toBe("100");
  });
  it("accepts authenticated zero supply and clears every obsolete holder",async()=>{
    const f=positionRecoveryFixture({holders:[],supply:0n});await seed(f);await position(f);
    expect(await sync(f)).toMatchObject({basketsScanned:1,holders:0,zeroed:1});
    expect((await evidence()).positions[0]).toMatchObject({share_balance:"0",cost_basis:null,cost_basis_source:null});
  });
  it("preserves all data on incomplete holder enumeration",async()=>{
    const f=positionRecoveryFixture({holders:[],supply:1_000_000n});await seed(f);await position(f);await expectFailurePreserves(f);
  });
  it("preserves all data on RPC failure",async()=>{
    const f=positionRecoveryFixture();await seed(f);await position(f);f.rpc.getProgramAccounts=async()=>{throw new Error("RPC unavailable");};await expectFailurePreserves(f);
  });
  it.each(["history-incomplete","scan-in-progress","pending","quarantined","coverage-missing","coverage-old","legacy-unresolved"])("refuses %s evidence without projection changes",async mode=>{
    const f=positionRecoveryFixture();await seed(f);await position(f);
    if(mode==="history-incomplete") await pool.query("UPDATE indexer_program_state SET history_complete=false WHERE program_id=$1",[f.programs.ids[0]]);
    if(mode==="scan-in-progress") await pool.query("UPDATE indexer_program_state SET scan_head='unresolved' WHERE program_id=$1",[f.programs.ids[0]]);
    if(mode==="pending"||mode==="quarantined") await pool.query("INSERT INTO indexer_signature_queue(program_id,sig,slot,status) VALUES($1,'pending-sig',99,$2)",[f.programs.ids[0],mode]);
    if(mode==="coverage-missing") await pool.query("UPDATE indexer_program_state SET finalized_through_slot=NULL WHERE program_id=$1",[f.programs.ids[0]]);
    if(mode==="coverage-old") await pool.query("UPDATE indexer_program_state SET finalized_through_slot=99 WHERE program_id=$1",[f.programs.ids[0]]);
    if(mode==="legacy-unresolved") await pool.query("INSERT INTO position_rebuild_required(basket,reason) VALUES($1,'legacy')",[f.basket.toBase58()]);
    await expectFailurePreserves(f);
    if (mode !== "coverage-old") expect(f.calls).toEqual([]);
  });
  it("catches canonical discovery up on an advancing chain before taking reconciliation locks",async()=>{
    const f=positionRecoveryFixture({slot:101});await seed(f,100);await position(f);
    const slots:number[]=[];
    const stats=await sync(f,{catchUpThroughSlot:async slot=>{
      slots.push(slot);
      const client=await pool.connect();try{
        await client.query("BEGIN");
        expect((await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",["indexer-global-finalized-poll"])).rows[0].locked).toBe(true);
        await client.query("UPDATE indexer_program_state SET finalized_through_slot=$1",[slot]);await client.query("COMMIT");
      }finally{client.release();}
    }});
    expect(slots).toEqual([101]);expect(stats.basketsScanned).toBe(1);expect((await evidence()).barriers[0].snapshot_slot).toBe("101");
  });
  it("failed catch-up never begins a projection transaction",async()=>{
    const f=positionRecoveryFixture({slot:101});await seed(f,100);await position(f);
    await expectFailurePreserves(f,{catchUpThroughSlot:async()=>{throw new Error("Discovery failed");}});
  });
  it.each(["event-newer","claim-newer","claim-unknown","barrier-newer"])("rejects %s after all locks are acquired",async mode=>{
    const f=positionRecoveryFixture();await seed(f);await position(f);
    if(mode==="event-newer") await pool.query("INSERT INTO events(sig,log_index,slot,basket,type,data,ts) VALUES('newer',0,101,$1,'Minted','{}',NOW())",[f.basket.toBase58()]);
    if(mode.startsWith("claim")) await pool.query("INSERT INTO position_events(sig,log_index,kind,basket,slot) VALUES('claim',0,'Minted',$1,$2)",[f.basket.toBase58(),mode==="claim-newer"?101:null]);
    if(mode==="barrier-newer") await pool.query("INSERT INTO position_reconciliation_state(basket,snapshot_slot) VALUES($1,101)",[f.basket.toBase58()]);
    await expectFailurePreserves(f);
  });
  it.each(["creator","treasury","share_mint","metadata_hash","weights_bps","entry_fee_bps"])("rejects an indexed immutable %s mismatch",async field=>{
    const f=positionRecoveryFixture();await seed(f);await position(f);
    if(field==="weights_bps") await pool.query("UPDATE baskets SET weights_bps=ARRAY[4000,6000] WHERE pubkey=$1",[f.basket.toBase58()]);
    else if(field==="entry_fee_bps") await pool.query("UPDATE baskets SET entry_fee_bps=1 WHERE pubkey=$1",[f.basket.toBase58()]);
    else await pool.query(`UPDATE baskets SET ${field}=$2 WHERE pubkey=$1`,[f.basket.toBase58(),field==="metadata_hash"?"corrupt":user(24)]);
    await expectFailurePreserves(f);
  });
  it("rolls back earlier zeroing and inserts when a later holder write fails",async()=>{
    const f=positionRecoveryFixture({holders:[{user:recoveryKey(20),amount:100n},{user:recoveryKey(21),amount:200n}]});await seed(f);await position(f,23);
    await pool.query(`CREATE FUNCTION reject_test_holder() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."user"='${user(21)}' THEN RAISE EXCEPTION 'test write rejection'; END IF; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER reject_test_holder BEFORE INSERT OR UPDATE ON user_positions FOR EACH ROW EXECUTE FUNCTION reject_test_holder()");
    await expectFailurePreserves(f);
  });
  it("contains one basket's bad snapshot while reconciling another valid basket",async()=>{
    const bad=positionRecoveryFixture({nonce:7n,holders:[],supply:10n}),good=positionRecoveryFixture({nonce:8n,holders:[{user:recoveryKey(21),amount:222n}]});
    await seed(bad);await seed(good);await position(bad);
    const rpc:PositionsSyncRpc={
      getAccountInfoAndContext:(address,cfg)=>(address.equals(bad.basket)||address.equals(bad.shareMint)?bad:good).rpc.getAccountInfoAndContext(address,cfg),
      getProgramAccounts:(pid,cfg)=>(cfg.filters[0].memcmp.bytes===bad.shareMint.toBase58()?bad:good).rpc.getProgramAccounts(pid,cfg),
    };
    const stats=await syncPositionsFromChain(rpc,pool as unknown as PgLike,{programs:recoveryPrograms,namespaces:[namespaceForRecoveryFixture(recoveryPrograms)],spacingMs:0});
    expect(stats).toMatchObject({basketsScanned:1,basketsFailed:1,balanceSynced:1});
    const rows=(await evidence()).positions;
    expect(rows.find(row=>row.basket===bad.basket.toBase58())).toMatchObject({share_balance:"55",cost_basis:"12.5"});
    expect(rows.find(row=>row.basket===good.basket.toBase58())).toMatchObject({share_balance:"222",cost_basis:null});
  });
  it("waits behind a basket writer and serializes global snapshot publication without regressing",async()=>{
    const newer=positionRecoveryFixture({slot:200,holders:[{user:recoveryKey(20),amount:200n}]}),older=positionRecoveryFixture({slot:100,holders:[{user:recoveryKey(20),amount:100n}]});
    await seed(newer);await position(newer);
    const blocker=await pool.connect();await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`positions:${newer.basket.toBase58()}`]);
    let first:ReturnType<typeof sync>|undefined,second:ReturnType<typeof sync>|undefined;
    try{
      first=sync(newer);await waitForBlockedWriters();
      second=sync(older);await waitForBlockedWriters(2);
      expect((await evidence()).positions[0].share_balance).toBe("55");
      await blocker.query("COMMIT");
      expect((await first).basketsScanned).toBe(1);expect((await second).basketsFailed).toBe(1);
      expect((await evidence()).positions[0].share_balance).toBe("200");expect((await evidence()).barriers[0].snapshot_slot).toBe("200");
    }finally{
      await blocker.query("ROLLBACK");blocker.release();await Promise.allSettled([first,second].filter(Boolean) as Promise<unknown>[]);
    }
  },15_000);
});
