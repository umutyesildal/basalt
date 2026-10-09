import { createHash } from "node:crypto";
import bs58 from "bs58";
/** Reviewed recovery publication, exercised only against an explicit disposable PostgreSQL. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_NAMESPACES, namespaceProgramIds } from "../src/config/programNamespaces";
import { applySchema } from "../src/db/init";
import type { PgLike } from "../src/db/client";
import { decodeBasketState } from "../src/indexer/basketState";
import { stagePositionRebuild, applyRedeemed, markPositionRebuildRequired, PositionProjectionGapError } from "../src/indexer/positions";
import { activateStagedPositionRebuild } from "../src/indexer/positionRecovery";
import { assertReviewedStaging, DEVNET_GENESIS, type RecoveryReview } from "../src/maintenance/recovery-operator";
import type { PositionsSyncRpc, RecoveryPrograms } from "../src/indexer/positionsSync";
import { positionRecoveryFixture, recoveryKey, type PositionRecoveryFixture } from "./fixtures/position-recovery";

const url = process.env.POSITION_EVENTS_TEST_DATABASE_URL ?? process.env.BASKET_RETURNS_TEST_DATABASE_URL;
const schema = `position_recovery_${process.pid}_${Date.now()}`;
let admin: pg.Client, pool: pg.Pool, db: PgLike;
let fixture: PositionRecoveryFixture, run: Awaited<ReturnType<typeof stagePositionRebuild>>;
const user = recoveryKey(20).toBase58(), orphan = recoveryKey(21).toBase58();
// RPC/account bytes remain entirely synthetic. Operator fixtures use the same
// source-controlled public trust roots that its production gate authenticates.
const namespace=PROGRAM_NAMESPACES[0];
const fixturePrograms:RecoveryPrograms={basket:new PublicKey(namespace.programs.basket),factory:new PublicKey(namespace.programs.factory),ids:namespaceProgramIds(namespace)};

// Each test recreates its isolated schema; immutable product backups are never disabled.
describe.skipIf(!url)("reviewed position recovery against disposable PostgreSQL", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url }); await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 8 });
    db = pool as unknown as PgLike;
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });
  beforeEach(async () => {
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.query(`CREATE SCHEMA "${schema}"`);
    expect(await applySchema(db)).toBe(true);
    fixture = positionRecoveryFixture({programs:fixturePrograms});
    const state = decodeBasketState(fixture.basket.toBase58(), fixture.basketAccount, fixture.programs);
    await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,
      num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [state.pubkey,state.factory,state.creator,state.treasury,
      state.shareMint,state.nonce,state.createdAt,state.metadataHash,state.numConstituents,state.constituents,state.weightsBps,
      state.entryFeeBps,state.exitFeeBps,state.managementFeeBps,state.lastFeeAccrualTs]);
    for (const id of fixture.programs.ids) await pool.query("INSERT INTO indexer_program_state(program_id,history_complete,finalized_through_slot) VALUES($1,true,100)", [id]);
    const basket = fixture.basket.toBase58();
    const history = [
      { sig: "creation", index: 1, slot: 10, data: { type:"BasketCreated",basket,creator:state.creator,numConstituents:2,shareMint:state.shareMint,ts:state.createdAt.getTime()/1000,programId:fixture.programs.factory.toBase58() } },
      { sig: "Z-mint", index: 2, slot: 20, data: { type:"Minted",basket,user,grossShares:"100",netShares:"100",entryFeeShares:"0",programId:fixture.programs.basket.toBase58() } },
      { sig: "a-fee", index: 4, slot: 30, data: { type:"FeeAccrued",basket,sharesMinted:"10",elapsedSec:"1",programId:fixture.programs.basket.toBase58() } },
      { sig: "0-redeem", index: 8, slot: 40, data: { type:"Redeemed",basket,user,sharesBurned:"110",exitFeeShares:"0",programId:fixture.programs.basket.toBase58() } },
    ];
    for (const row of history) await pool.query("INSERT INTO events(sig,log_index,slot,basket,type,data,ts) VALUES($1,$2,$3,$4,$5,$6,$7)", [row.sig,row.index,row.slot,basket,row.data.type,row.data,state.createdAt]);
    await pool.query('INSERT INTO user_positions("user",basket,share_balance,cost_basis,cost_basis_source) VALUES($1,$3,888,12,\'reference\'),($2,$3,77,5,\'reference\')', [user,orphan,basket]);
    await pool.query("INSERT INTO position_events(sig,log_index,kind,basket,slot) VALUES('legacy',-1,'Minted',$1,NULL),('Z-mint',2,'Minted',$1,NULL)", [basket]);
    await pool.query("INSERT INTO position_rebuild_required(basket,reason) VALUES($1,'legacy-nonatomic-position-ledger')", [basket]);
    run = await stagePositionRebuild(db,basket,fixture.programs.ids,{slot:fixture.slot,supply:fixture.supply.toString(),balances:[{user,shares:"1000000"}],basketState:state});
  });

  const activate = (database = db, rpc: PositionsSyncRpc = fixture.rpc, hash = run.historyHash) => activateStagedPositionRebuild(database,rpc,run.runId,hash,fixture.programs);
  async function projectionState() {
    const queries = [
      'SELECT * FROM user_positions ORDER BY "user" COLLATE "C",basket', 'SELECT * FROM position_events ORDER BY sig COLLATE "C",log_index',
      'SELECT * FROM position_rebuild_required ORDER BY basket', 'SELECT * FROM position_reconciliation_state ORDER BY basket',
      'SELECT * FROM position_rebuild_runs ORDER BY run_id', 'SELECT * FROM position_rebuild_positions_backup ORDER BY run_id,"user" COLLATE "C",basket',
      'SELECT * FROM position_rebuild_claims_backup ORDER BY run_id,sig COLLATE "C",log_index',
    ];
    return Promise.all(queries.map(async sql => (await pool.query(sql)).rows));
  }
  function failingPool(match: (sql: string) => boolean, occurrence = 1): PgLike {
    let matches = 0;
    return { query:(sql,args)=>db.query(sql,args), connect:async () => {
      const client = await pool.connect();
      return { release:()=>client.release(), query:async (sql,args) => {
        const result = await client.query(sql,args);
        if (match(sql) && ++matches === occurrence) throw new Error("injected recovery failure after SQL effect");
        return result;
      } };
    } };
  }
  async function assertPublished() {
    expect((await pool.query('SELECT "user",share_balance::text AS balance,cost_basis,cost_basis_source FROM user_positions ORDER BY "user" COLLATE "C"')).rows)
      .toEqual([{user,balance:"1000000",cost_basis:null,cost_basis_source:null},{user:orphan,balance:"0",cost_basis:null,cost_basis_source:null}].sort((a,b)=>a.user<b.user?-1:1));
    expect((await pool.query("SELECT sig,log_index,slot::text AS slot FROM position_events ORDER BY sig COLLATE \"C\",log_index")).rows)
      .toEqual([{sig:"0-redeem",log_index:8,slot:"40"},{sig:"Z-mint",log_index:2,slot:"20"},{sig:"a-fee",log_index:4,slot:"30"},{sig:"legacy",log_index:-1,slot:null}]);
    expect((await pool.query("SELECT activated_run_id FROM position_rebuild_required")).rows[0].activated_run_id).toBe(run.runId);
    expect((await pool.query("SELECT snapshot_slot::text FROM position_reconciliation_state")).rows[0].snapshot_slot).toBe("100");
    expect((await pool.query("SELECT status,activated_slot::text FROM position_rebuild_runs")).rows[0]).toEqual({status:"activated",activated_slot:"100"});
  }


  async function operatorReviewForCurrentRun(): Promise<RecoveryReview> {
    // Runtime signatures are canonical base58; the older SQL fixture uses readable labels.
    const labels=["creation","Z-mint","a-fee","0-redeem"];
    for (let index=0;index<labels.length;index++) {
      const signature=bs58.encode(Buffer.alloc(64,index+1));
      await pool.query("UPDATE events SET sig=$2 WHERE sig=$1",[labels[index],signature]);
      await pool.query("UPDATE position_events SET sig=$2 WHERE sig=$1",[labels[index],signature]);
    }
    run=await stagePositionRebuild(db,fixture.basket.toBase58(),fixture.programs.ids,{
      slot:fixture.slot,supply:fixture.supply.toString(),balances:[{user,shares:"1000000"}],
    });
    const row=(await pool.query("SELECT * FROM position_rebuild_runs WHERE run_id=$1",[run.runId])).rows[0];
    const holderTuples=(await pool.query('SELECT "user",share_balance::text FROM position_rebuild_staging WHERE run_id=$1 ORDER BY "user" COLLATE "C"',[run.runId]))
      .rows.map(holder=>[holder.user,holder.share_balance]);
    const claimTuples=(await pool.query("SELECT sig,log_index,kind,basket FROM position_rebuild_claims WHERE run_id=$1",[run.runId]))
      .rows.map(claim=>[claim.sig,claim.log_index,claim.kind,claim.basket])
      .sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
    const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
    return {
      schemaVersion:1,kind:"basalt-candidate-position-recovery",createdAt:new Date().toISOString(),
      manifest:{schemaVersion:1,candidateId:"sql_fixture",databaseName:"basalt_candidate_sql_fixture",
        sourceDatabase:"foliox",sourceSha:"a".repeat(40),backupSha256:"b".repeat(64),genesisHash:DEVNET_GENESIS,
        programIds:{basket:fixture.programs.basket.toBase58(),factory:fixture.programs.factory.toBase58(),
          whitelist:fixture.programs.ids.find(id=>id!==fixture.programs.basket.toBase58()&&id!==fixture.programs.factory.toBase58())!}},
      manifestSha256:"c".repeat(64),
      run:{runId:row.run_id,basket:row.basket,historyHash:row.history_hash,programIds:[...row.program_ids].sort(),
        chainSlot:String(row.chain_slot),chainSupply:String(row.chain_supply),eventCount:row.event_count,createdAt:row.created_at.toISOString()},
      staging:{positionCount:holderTuples.length,positionsSha256:hash(holderTuples),claimCount:claimTuples.length,claimsSha256:hash(claimTuples)},
    };
  }

  it("checks operator review inside the locked real transaction before any effects, including exact receipt retry",async()=>{
    const review=await operatorReviewForCurrentRun();
    let validations=0;
    const options={validateReviewedEvidence:async(client:PgLike)=>{validations++;await assertReviewedStaging(client,review);}};
    const receipt=await activateStagedPositionRebuild(db,fixture.rpc,run.runId,run.historyHash,fixture.programs,options);
    const published=await projectionState();
    expect(await activateStagedPositionRebuild(db,fixture.rpc,run.runId,run.historyHash,fixture.programs,options)).toEqual(receipt);
    expect(validations).toBe(2);expect(await projectionState()).toEqual(published);
    expect((await pool.query('SELECT share_balance::text FROM user_positions WHERE "user"=$1',[user])).rows[0].share_balance).toBe("1000000");
  });

  it("rolls back when staged holders change after preflight and before the transactional operator review",async()=>{
    const review=await operatorReviewForCurrentRun();
    const before=await projectionState(),newUser=recoveryKey(22).toBase58();
    const currentChain=positionRecoveryFixture({programs:fixturePrograms,holders:[{user:recoveryKey(22),amount:1000000n}]});
    let reached!:()=>void,resume!:()=>void;
    const locked=new Promise<void>(resolve=>{reached=resolve;});
    const continueActivation=new Promise<void>(resolve=>{resume=resolve;});
    const database:PgLike={query:(sql,args)=>db.query(sql,args),connect:async()=>{
      const client=await pool.connect();
      return {release:()=>client.release(),query:async(sql,args)=>{
        const result=await client.query(sql,args);
        if(sql==="SELECT * FROM position_rebuild_runs WHERE run_id=$1 FOR UPDATE"){
          reached();await continueActivation;
        }
        return result;
      }};
    }};
    const publishing=activateStagedPositionRebuild(database,currentChain.rpc,run.runId,run.historyHash,fixture.programs,{
      validateReviewedEvidence:client=>assertReviewedStaging(client,review),
    });
    // Attach a rejection handler before releasing the paused transaction.
    const rejected=expect(publishing).rejects.toThrow("evidence changed");
    await locked;
    try { await pool.query('UPDATE position_rebuild_staging SET "user"=$2 WHERE run_id=$1',[run.runId,newUser]); }
    finally { resume(); }
    await rejected;
    expect(await projectionState()).toEqual(before);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM position_rebuild_positions_backup WHERE run_id=$1",[run.runId])).rows[0].count).toBe(0);
    // The changed stage matches fresh chain facts and passes the underlying API;
    // rejection above specifically proves the old operator review cannot authorize it.
    await activateStagedPositionRebuild(db,currentChain.rpc,run.runId,run.historyHash,fixture.programs);
    expect((await pool.query('SELECT share_balance::text FROM user_positions WHERE "user"=$1',[newUser])).rows[0].share_balance).toBe("1000000");
  });

  it("quarantines pre-slot atomic claims in place and activation repairs slots with immutable old evidence", async () => {
    await pool.query("DELETE FROM position_events WHERE log_index<0");
    await pool.query("DELETE FROM position_rebuild_required");
    const before=(await pool.query('SELECT * FROM user_positions ORDER BY "user" COLLATE "C"')).rows;
    expect(await applySchema(db)).toBe(true);
    expect((await pool.query("SELECT reason,activated_run_id FROM position_rebuild_required")).rows[0])
      .toEqual({reason:"missing-finalized-position-slot",activated_run_id:null});
    expect((await pool.query('SELECT * FROM user_positions ORDER BY "user" COLLATE "C"')).rows).toEqual(before);
    await activate();
    expect((await pool.query("SELECT slot::text FROM position_events WHERE sig='Z-mint'")).rows[0].slot).toBe("20");
    expect((await pool.query("SELECT slot FROM position_rebuild_claims_backup WHERE sig='Z-mint'")).rows[0].slot).toBe(null);
    expect(await applySchema(db)).toBe(true);
    expect((await pool.query("SELECT activated_run_id FROM position_rebuild_required")).rows[0].activated_run_id).toBe(run.runId);
  });

  it("recovers a real failed redeem through persisted guard, canonical staging and explicit activation", async () => {
    const basket=fixture.basket.toBase58();
    await pool.query("DELETE FROM position_rebuild_required");
    await pool.query('UPDATE user_positions SET share_balance=5 WHERE "user"=$1',[user]);
    const positionsBefore=(await pool.query('SELECT * FROM user_positions ORDER BY "user" COLLATE "C"')).rows;
    const event={type:"Redeemed" as const,basket,user,sharesBurned:"110",exitFeeShares:"0"};
    await expect(applyRedeemed(db,"0-redeem",event,8,40)).rejects.toBeInstanceOf(PositionProjectionGapError);
    expect((await pool.query("SELECT 1 FROM position_events WHERE sig='0-redeem'")).rows).toEqual([]);
    expect((await pool.query('SELECT * FROM user_positions ORDER BY "user" COLLATE "C"')).rows).toEqual(positionsBefore);
    // This is the same exported persistence path the durable listener uses after rollback.
    await markPositionRebuildRequired(db,basket,"position-projection-gap");
    expect((await pool.query("SELECT reason,activated_run_id FROM position_rebuild_required")).rows[0])
      .toEqual({reason:"position-projection-gap",activated_run_id:null});
    // Maintenance replay keeps canonical events but does not apply the broken projection.
    run=await stagePositionRebuild(db,basket,fixture.programs.ids,{slot:fixture.slot,supply:"1000000",balances:[{user,shares:"1000000"}]});
    expect((await pool.query('SELECT * FROM user_positions ORDER BY "user" COLLATE "C"')).rows).toEqual(positionsBefore);
    await activate();
    const published=await projectionState();
    expect(await applyRedeemed(db,"0-redeem",event,8,40)).toBe(false);
    expect(await projectionState()).toEqual(published);
    expect((await pool.query('SELECT share_balance::text,cost_basis FROM user_positions WHERE "user"=$1',[user])).rows[0])
      .toEqual({share_balance:"1000000",cost_basis:null});
  });

  it("publishes exact finalized holders and claims while preserving old values and negative legacy evidence", async () => {
    const receipt = await activate(); await assertPublished();
    expect(receipt).toMatchObject({runId:run.runId,basket:fixture.basket.toBase58(),historyHash:run.historyHash,finalizedSlot:"100"});
    expect((await pool.query('SELECT "user",share_balance::text,cost_basis::text,cost_basis_source FROM position_rebuild_positions_backup ORDER BY "user" COLLATE "C"')).rows)
      .toEqual([{user,share_balance:"888",cost_basis:"12",cost_basis_source:"reference"},{user:orphan,share_balance:"77",cost_basis:"5",cost_basis_source:"reference"}].sort((a,b)=>a.user<b.user?-1:1));
    expect((await pool.query("SELECT sig,log_index,slot FROM position_rebuild_claims_backup ORDER BY sig COLLATE \"C\"")).rows)
      .toEqual([{sig:"Z-mint",log_index:2,slot:null},{sig:"legacy",log_index:-1,slot:null}]);
  });

  it.each([
    ["first backup", "INSERT INTO position_rebuild_positions_backup"],
    ["both backups", "INSERT INTO position_rebuild_claims_backup"],
    ["zeroed position", "UPDATE user_positions SET share_balance=0"],
    ["first position", "INSERT INTO user_positions"],
    ["canonical claim", "INSERT INTO position_events"],
    ["barrier", "INSERT INTO position_reconciliation_state"],
    ["quarantine pointer", "UPDATE position_rebuild_required"],
    ["final status", "UPDATE position_rebuild_runs"],
  ])("rolls back after %s; retry publishes once and committed retry returns the same proof", async (_, fragment) => {
    const before = await projectionState();
    await expect(activate(failingPool(sql=>sql.includes(fragment)))).rejects.toThrow("injected recovery failure");
    expect(await projectionState()).toEqual(before);
    const receipt = await activate(); await assertPublished();
    const published = await projectionState();
    const noRpc: PositionsSyncRpc = {getAccountInfoAndContext:async()=>{throw new Error("must not read RPC on exact retry");},getProgramAccounts:async()=>{throw new Error("must not read RPC on exact retry");}};
    expect(await activate(db,noRpc)).toEqual(receipt);
    expect(await projectionState()).toEqual(published);
  });

  it("serializes parallel activations into one publication and identical receipts", async () => {
    let publications = 0;
    const database: PgLike = {query:(sql,args)=>db.query(sql,args),connect:async()=>{
      const client=await pool.connect(); return {release:()=>client.release(),query:async(sql,args)=>{
        const result=await client.query(sql,args); if(sql.includes("INSERT INTO position_rebuild_positions_backup")) publications++; return result;
      }};
    }};
    const receipts = await Promise.all([activate(database),activate(database)]);
    expect(receipts[0]).toEqual(receipts[1]); expect(publications).toBe(1); await assertPublished();
  });

  it("blocks a concurrent late backup insertion until activation commits, then rejects it", async () => {
    let reached!: () => void, release!: () => void;
    const atBackup = new Promise<void>(resolve => { reached=resolve; });
    const resume = new Promise<void>(resolve => { release=resolve; });
    const database: PgLike = {query:(sql,args)=>db.query(sql,args),connect:async()=>{
      const client=await pool.connect(); return {release:()=>client.release(),query:async(sql,args)=>{
        const result=await client.query(sql,args);
        if(sql.includes("INSERT INTO position_rebuild_claims_backup")) { reached(); await resume; }
        return result;
      }};
    }};
    const activating=activate(database);
    await atBackup;
    let settled=false;
    const late=pool.query(`INSERT INTO position_rebuild_positions_backup(run_id,"user",basket,share_balance,position_updated_at)
      VALUES($1,'late',$2,1,NOW())`,[run.runId,fixture.basket.toBase58()]).then(()=>{settled=true;return null;},error=>{settled=true;return error as Error;});
    await new Promise(resolve=>setTimeout(resolve,30)); expect(settled).toBe(false);
    release(); await activating;
    expect(await late).toMatchObject({message:"Activated position recovery backup cannot grow"});
    expect((await pool.query(`SELECT 1 FROM position_rebuild_positions_backup WHERE "user"='late'`)).rows).toEqual([]);
    await assertPublished();
  });

  it("refuses activation when an earlier concurrent pending backup insertion commits", async () => {
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO position_rebuild_claims_backup(run_id,sig,log_index,kind,basket,claimed_at)
        VALUES($1,'early',1,'Minted',$2,NOW())`,[run.runId,fixture.basket.toBase58()]);
      let settled=false;
      const activating=activate().then(()=>{settled=true;return null;},error=>{settled=true;return error as Error;});
      await new Promise(resolve=>setTimeout(resolve,30)); expect(settled).toBe(false);
      await client.query("COMMIT");
      expect(await activating).toMatchObject({message:"Pending run already contains backup evidence; restage"});
      expect((await pool.query("SELECT status FROM position_rebuild_runs")).rows[0].status).toBe("staged-pending-review");
      expect((await pool.query("SELECT activated_run_id FROM position_rebuild_required")).rows[0].activated_run_id).toBe(null);
      expect((await pool.query('SELECT share_balance::text FROM user_positions WHERE "user"=$1',[user])).rows[0].share_balance).toBe("888");
    } finally { await client.query("ROLLBACK"); client.release(); }
  });

  it.each(["position update","position delete","position truncate","claim update","claim delete","claim truncate","position insert","claim insert"])("rejects %s against an activated immutable backup", async action => {
    await activate(); const before = await projectionState();
    const statements: Record<string,[string,unknown[]]> = {
      "position update":["UPDATE position_rebuild_positions_backup SET share_balance=1",[]],
      "position delete":["DELETE FROM position_rebuild_positions_backup",[]],
      "position truncate":["TRUNCATE position_rebuild_positions_backup",[]],
      "claim update":["UPDATE position_rebuild_claims_backup SET kind='Redeemed'",[]],
      "claim delete":["DELETE FROM position_rebuild_claims_backup",[]],
      "claim truncate":["TRUNCATE position_rebuild_claims_backup",[]],
      "position insert":[`INSERT INTO position_rebuild_positions_backup(run_id,"user",basket,share_balance,position_updated_at) VALUES($1,'new',$2,1,NOW())`,[run.runId,fixture.basket.toBase58()]],
      "claim insert":["INSERT INTO position_rebuild_claims_backup(run_id,sig,log_index,kind,basket,claimed_at) VALUES($1,'new',1,'Minted',$2,NOW())",[run.runId,fixture.basket.toBase58()]],
    };
    await expect(pool.query(...statements[action])).rejects.toThrow(/immutable|cannot grow/);
    expect(await projectionState()).toEqual(before);
  });

  it.each(["history_hash","basket","chain_slot","chain_supply","event_count","program_ids","created_at"])("makes staged %s evidence immutable", async field => {
    const expressions: Record<string,string> = {history_hash:"repeat('0',64)",basket:"'different'",chain_slot:"chain_slot+1",chain_supply:"chain_supply+1",event_count:"event_count+1",program_ids:"ARRAY['other']",created_at:"created_at+interval '1 second'"};
    await expect(pool.query(`UPDATE position_rebuild_runs SET ${field}=${expressions[field]} WHERE run_id=$1`,[run.runId])).rejects.toThrow("evidence is immutable");
  });

  it.each(["staged balance","staged basket","staged cost","staged source","staged missing","staged extra","claim kind","claim basket","claim index","claim missing","claim extra","history payload","history extra","history missing"])("rejects %s tampering without publishing anything", async action => {
    const basket=fixture.basket.toBase58();
    const statements:Record<string,[string,unknown[]]>={
      "staged balance":["UPDATE position_rebuild_staging SET share_balance=share_balance+1 WHERE run_id=$1",[run.runId]],
      "staged basket":["UPDATE position_rebuild_staging SET basket='wrong' WHERE run_id=$1",[run.runId]],
      "staged cost":["UPDATE position_rebuild_staging SET cost_basis=1 WHERE run_id=$1",[run.runId]],
      "staged source":["UPDATE position_rebuild_staging SET cost_basis_source='invented' WHERE run_id=$1",[run.runId]],
      "staged missing":["DELETE FROM position_rebuild_staging WHERE run_id=$1",[run.runId]],
      "staged extra":[`INSERT INTO position_rebuild_staging(run_id,"user",basket,share_balance) VALUES($1,$2,$3,1)`,[run.runId,orphan,basket]],
      "claim kind":["UPDATE position_rebuild_claims SET kind='Redeemed' WHERE run_id=$1 AND sig='Z-mint'",[run.runId]],
      "claim basket":["UPDATE position_rebuild_claims SET basket='wrong' WHERE run_id=$1 AND sig='Z-mint'",[run.runId]],
      "claim index":["UPDATE position_rebuild_claims SET log_index=99 WHERE run_id=$1 AND sig='Z-mint'",[run.runId]],
      "claim missing":["DELETE FROM position_rebuild_claims WHERE run_id=$1 AND sig='Z-mint'",[run.runId]],
      "claim extra":["INSERT INTO position_rebuild_claims(run_id,sig,log_index,kind,basket) VALUES($1,'extra',1,'Minted',$2)",[run.runId,basket]],
      "history payload":[`UPDATE events SET data=jsonb_set(data,'{user}',to_jsonb($1::text)) WHERE sig='Z-mint'`,[orphan]],
      "history extra":["INSERT INTO events(sig,log_index,slot,basket,type,data) SELECT 'extra',log_index,slot,basket,type,data FROM events WHERE sig='Z-mint'",[]],
      "history missing":["DELETE FROM events WHERE sig='Z-mint'",[]],
    };
    await pool.query(...statements[action]); const before=await projectionState();
    await expect(activate()).rejects.toThrow(); expect(await projectionState()).toEqual(before);
  });

  it("rejects moved finalized holder ownership even when supply stays equal", async () => {
    const before=await projectionState();
    const changed=positionRecoveryFixture({programs:fixturePrograms,holders:[{user:recoveryKey(21),amount:1_000_000n}]});
    await expect(activate(db,changed.rpc)).rejects.toThrow("Finalized holders changed"); expect(await projectionState()).toEqual(before);
  });
  it.each(["creator","treasury","share_mint","metadata_hash","weights_bps","entry_fee_bps"])("rejects indexed immutable %s mismatch", async field => {
    const expressions:Record<string,string>={creator:`'${orphan}'`,treasury:`'${orphan}'`,share_mint:`'${orphan}'`,metadata_hash:"'wrong'",weights_bps:"ARRAY[4000,6000]",entry_fee_bps:"1"};
    await pool.query(`UPDATE baskets SET ${field}=${expressions[field]}`); const before=await projectionState();
    await expect(activate()).rejects.toThrow("immutable fields"); expect(await projectionState()).toEqual(before);
  });
  it.each(["pending","quarantined","incomplete","older coverage","newer barrier","unknown claim","claim collision","old backups"])("blocks %s evidence", async action => {
    const basket=fixture.basket.toBase58();
    if(action==='pending'||action==='quarantined') await pool.query("INSERT INTO indexer_signature_queue(program_id,sig,slot,status) VALUES($1,'blocked',1,$2)",[fixture.programs.ids[0],action]);
    if(action==='incomplete') await pool.query("UPDATE indexer_program_state SET scan_head='undiscovered'");
    if(action==='older coverage') await pool.query("UPDATE indexer_program_state SET finalized_through_slot=99");
    if(action==='newer barrier') await pool.query("INSERT INTO position_reconciliation_state(basket,snapshot_slot) VALUES($1,101)",[basket]);
    if(action==='unknown claim') await pool.query("INSERT INTO position_events(sig,log_index,kind,basket,slot) VALUES('unknown',3,'Minted',$1,101)",[basket]);
    if(action==='claim collision') await pool.query("UPDATE position_events SET kind='Redeemed' WHERE sig='Z-mint'");
    if(action==='old backups') await pool.query(`INSERT INTO position_rebuild_positions_backup(run_id,"user",basket,share_balance,position_updated_at) VALUES($1,$2,$3,1,NOW())`,[run.runId,user,basket]);
    const before=await projectionState(); await expect(activate()).rejects.toThrow(); expect(await projectionState()).toEqual(before);
  });
  it("catches canonical discovery up after the snapshot without holding its global lock", async () => {
    await pool.query("UPDATE indexer_program_state SET finalized_through_slot=99");
    let caughtUp=0;
    await activateStagedPositionRebuild(db,fixture.rpc,run.runId,run.historyHash,fixture.programs,{catchUpThroughSlot:async slot=>{
      const client=await pool.connect(); try {
        await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["indexer-global-finalized-poll"]);
        await client.query("UPDATE indexer_program_state SET finalized_through_slot=$1",[slot]); await client.query("COMMIT"); caughtUp++;
      } finally {client.release();}
    }});
    expect(caughtUp).toBe(1); await assertPublished();
  });
  it("rejects failed catch-up before any publication", async () => {
    const before=await projectionState();
    await expect(activateStagedPositionRebuild(db,fixture.rpc,run.runId,run.historyHash,fixture.programs,{catchUpThroughSlot:async()=>{throw new Error("catch-up failed");}})).rejects.toThrow("catch-up failed");
    expect(await projectionState()).toEqual(before);
  });
  it("requires the exact reviewed hash and program IDs on committed retry", async () => {
    await activate(); const before=await projectionState();
    await expect(activate(db,fixture.rpc,'0'.repeat(64))).rejects.toThrow("attestation");
    const wrong={...fixture.programs,ids:[fixture.programs.ids[0],fixture.programs.ids[1],recoveryKey(247).toBase58()]};
    await expect(activateStagedPositionRebuild(db,fixture.rpc,run.runId,run.historyHash,wrong)).rejects.toThrow("attestation");
    expect(await projectionState()).toEqual(before);
  });
  it.each(["pointer","marker"])("rejects a committed retry after current %s no longer proves that activation", async change => {
    await activate();
    if(change==='pointer') await pool.query("UPDATE position_rebuild_required SET activated_run_id=NULL");
    else await pool.query("UPDATE position_reconciliation_state SET snapshot_slot=99");
    const before=await projectionState(); await expect(activate()).rejects.toThrow("no longer the current"); expect(await projectionState()).toEqual(before);
  });
});
