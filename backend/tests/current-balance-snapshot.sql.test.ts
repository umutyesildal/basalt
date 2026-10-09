/** Separate snapshot metadata only, tested in unique disposable PostgreSQL schemas. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import bs58 from "bs58";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { applySchema } from "../src/db/init";
import type { PgLike } from "../src/db/client";
import { decodeBasketState } from "../src/indexer/basketState";
import { RpcReadError } from "../src/rpc/requestBudget";
import { DEVNET_RPC_GENESIS } from "../src/rpc/positionsProvider";
import { discoverCurrentBalanceCandidates, persistCurrentBalanceSnapshot, readCurrentBalanceSnapshot, syncCurrentBalanceSnapshots, type CurrentBalanceRpc } from "../src/indexer/currentBalanceSnapshot";
import { positionRecoveryFixture, recoveryKey } from "./fixtures/position-recovery";
const url=process.env.BASKET_RETURNS_TEST_DATABASE_URL,schema=`current_balances_${process.pid}_${Date.now()}`;
let admin:pg.Pool,pool:pg.Pool;const db=()=>pool as unknown as PgLike;
function fixture(nonce=7n){
  const f=positionRecoveryFixture({nonce}),signature=bs58.encode(Buffer.alloc(64,Number(nonce))),reads:string[][]=[];
  const rpc:CurrentBalanceRpc={getGenesisHash:async()=>DEVNET_RPC_GENESIS,getAccountInfoAndContext:f.rpc.getAccountInfoAndContext,
    async getMultipleAccountsInfoAndContext(addresses){reads.push(addresses.map(address=>address.toBase58()));return{context:{slot:f.slot},value:addresses.map(address=>address.equals(f.basket)?f.basketAccount:address.equals(f.shareMint)?f.mintAccount:f.accounts.find(row=>row.pubkey.equals(address))?.account??null)};},
    async getParsedTransaction(sig){return{slot:f.slot,transaction:{signatures:[sig],message:{accountKeys:[...f.accounts.map(row=>({pubkey:row.pubkey,signer:false,writable:true})),{pubkey:PublicKey.default,signer:false,writable:false}]}},meta:{err:null,logMessages:["Log truncated"]}} as ParsedTransactionWithMeta;},
  };
  return{...f,rpc,signature,reads,candidates:f.accounts.map(row=>row.pubkey.toBase58())};
}
const snapshot=(f:ReturnType<typeof fixture>)=>readCurrentBalanceSnapshot(f.rpc,f.basket.toBase58(),f.programs,f.candidates);
async function oldEvidence(){return{
  positions:(await pool.query('SELECT * FROM user_positions ORDER BY basket,"user"')).rows,
  claims:(await pool.query('SELECT * FROM position_events ORDER BY sig,log_index')).rows,
  guards:(await pool.query('SELECT * FROM position_rebuild_required ORDER BY basket')).rows,
  queue:(await pool.query('SELECT * FROM indexer_signature_queue ORDER BY program_id,sig')).rows,
  events:(await pool.query('SELECT * FROM events ORDER BY sig,log_index')).rows,
  barriers:(await pool.query('SELECT * FROM position_reconciliation_state ORDER BY basket')).rows,
  creators:(await pool.query('SELECT * FROM creator_stats ORDER BY creator')).rows,
};}
async function seed(f:ReturnType<typeof fixture>){
  const s=decodeBasketState(f.basket.toBase58(),f.basketAccount,f.programs);
  await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[s.pubkey,s.factory,s.creator,s.treasury,s.shareMint,s.nonce,s.createdAt,s.metadataHash,s.numConstituents,s.constituents,s.weightsBps,s.entryFeeBps,s.exitFeeBps,s.managementFeeBps,s.lastFeeAccrualTs]);
  await pool.query(`INSERT INTO user_positions("user",basket,share_balance,cost_basis,cost_basis_source) VALUES($1,$2,44,12,'old-evidence')`,[recoveryKey(20).toBase58(),s.pubkey]);
  await pool.query("INSERT INTO position_events(sig,log_index,kind,basket,slot) VALUES($1,-1,'Minted',$2,NULL)",[f.signature,s.pubkey]);
  await pool.query("INSERT INTO position_rebuild_required(basket,reason) VALUES($1,'legacy')",[s.pubkey]);
  await pool.query("INSERT INTO indexer_signature_queue(program_id,sig,slot,status,last_error) VALUES($1,$2,$3,'quarantined','original logs truncated')",[f.programs.ids[0],f.signature,f.slot]);
}
describe.skipIf(!url)("current-balance snapshot persistence against disposable PostgreSQL",()=>{
  beforeAll(async()=>{admin=new pg.Pool({connectionString:url});await admin.query(`CREATE SCHEMA "${schema}"`);pool=new pg.Pool({connectionString:url,max:8,options:`-c search_path=${schema}`,application_name:schema});expect(await applySchema(db())).toBe(true);},30_000);
  afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}});
  beforeEach(async()=>{await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.query(`CREATE SCHEMA "${schema}"`);expect(await applySchema(db())).toBe(true);});
  it("publishes independently while every legacy position,claim,guard and quarantine row remains exact",async()=>{
    const f=fixture();await seed(f);const before=await oldEvidence(),s=await snapshot(f);
    expect(await persistCurrentBalanceSnapshot(db(),s,f.programs,new Date())).toBe(true);
    const row=(await pool.query("SELECT * FROM current_balance_snapshots")).rows[0];expect(row).toMatchObject({status:"verified",history_complete:false,supply:"1000000",account_count:1,balances:[{user:recoveryKey(20).toBase58(),shares:"1000000"}]});expect(row.program_ids).toEqual(s.programIds);
    expect(await oldEvidence()).toEqual(before);
  });
  it("recovers a nonATA holder through authenticated transaction-key hints even with original logs truncated",async()=>{
    const f=fixture();await seed(f);const before=await oldEvidence();expect(await syncCurrentBalanceSnapshots(f.rpc,db(),f.programs)).toMatchObject({attempted:1,verified:1,incomplete:0});
    expect((await pool.query("SELECT status,history_complete,account_count FROM current_balance_snapshots")).rows[0]).toEqual({status:"verified",history_complete:false,account_count:1});expect(f.reads).toHaveLength(2);expect(f.calls).toHaveLength(1);expect(await oldEvidence()).toEqual(before);
  });
  it("stores u64MAX exactly in JSONB/NUMERIC without touching legacyBIGINT rows",async()=>{
    const f=fixture(),amount=(1n<<64n)-1n;f.accounts[0].account.data.writeBigUInt64LE(amount,64);f.mintAccount.data.writeBigUInt64LE(amount,36);await seed(f);const before=await oldEvidence();
    expect(await persistCurrentBalanceSnapshot(db(),await snapshot(f),f.programs,new Date())).toBe(true);const row=(await pool.query("SELECT supply::text,balances FROM current_balance_snapshots")).rows[0];expect(row.supply).toBe(amount.toString());expect(row.balances[0].shares).toBe(amount.toString());expect(await oldEvidence()).toEqual(before);
  });
  it("failure preserves prior evidence/asof but invalidates current verification",async()=>{
    const f=fixture();await seed(f);await persistCurrentBalanceSnapshot(db(),await snapshot(f),f.programs,new Date(Date.now()-1000));const before=(await pool.query("SELECT * FROM current_balance_snapshots")).rows[0],old=await oldEvidence();
    f.rpc.getMultipleAccountsInfoAndContext=async()=>{throw new Error("private upstream failure");};expect(await syncCurrentBalanceSnapshots(f.rpc,db(),f.programs)).toMatchObject({incomplete:1});
    const after=(await pool.query("SELECT * FROM current_balance_snapshots")).rows[0];expect(after).toMatchObject({status:"incomplete",reason:"snapshot-read-or-storage-unavailable",slot:before.slot,supply:before.supply,balances:before.balances,accounts_digest:before.accounts_digest,observed_at:before.observed_at});expect(await oldEvidence()).toEqual(old);
  });
  it("a superseded success cannot overwrite a newer failure",async()=>{
    const f=fixture();await seed(f);const s=await snapshot(f),older=new Date(Date.now()-1000);await persistCurrentBalanceSnapshot(db(),s,f.programs,older);
    await pool.query("UPDATE current_balance_snapshots SET status='incomplete',reason='newer-failure',attempted_at=$1",[new Date()]);const before=(await pool.query("SELECT * FROM current_balance_snapshots")).rows;
    expect(await persistCurrentBalanceSnapshot(db(),s,f.programs,older)).toBe(false);expect((await pool.query("SELECT * FROM current_balance_snapshots")).rows).toEqual(before);
  });
  it("a superseded failure cannot invalidate a newer successful attempt",async()=>{
    const f=fixture();await seed(f);let rejectRead!:(error:Error)=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
    f.rpc.getMultipleAccountsInfoAndContext=()=>{started();return new Promise((_,reject)=>{rejectRead=reject;});};
    const pending=syncCurrentBalanceSnapshots(f.rpc,db(),f.programs);await began;
    const valid=fixture();const s=await snapshot(valid);expect(await persistCurrentBalanceSnapshot(db(),s,f.programs,new Date(Date.now()+1000))).toBe(true);
    rejectRead(new Error("old request failed"));await pending;expect((await pool.query("SELECT status,reason FROM current_balance_snapshots")).rows[0]).toEqual({status:"verified",reason:null});
  });
  it("equal-time failure wins over success conservatively",async()=>{
    const f=fixture();await seed(f);const now=new Date();await pool.query("INSERT INTO current_balance_snapshots(basket,program_ids,status,attempted_at,reason) VALUES($1,$2,'incomplete',$3,'failed')",[f.basket.toBase58(),f.programs.ids,now]);
    expect(await persistCurrentBalanceSnapshot(db(),await snapshot(f),f.programs,now)).toBe(false);expect((await pool.query("SELECT status,reason FROM current_balance_snapshots")).rows[0]).toEqual({status:"incomplete",reason:"failed"});
  });
  it("cannot regress the stored finalized slot",async()=>{
    const f=fixture();await seed(f);const s=await snapshot(f);await persistCurrentBalanceSnapshot(db(),s,f.programs,new Date());await pool.query("UPDATE current_balance_snapshots SET slot=101");
    await expect(persistCurrentBalanceSnapshot(db(),s,f.programs,new Date(Date.now()+1000))).rejects.toThrow("slot-regression");
  });
  it("rejects immutable basket mismatches and leaves all evidence unchanged",async()=>{
    const f=fixture();await seed(f);const s=await snapshot(f);await pool.query("UPDATE baskets SET treasury=$1",[recoveryKey(90).toBase58()]);const before=await oldEvidence();await expect(persistCurrentBalanceSnapshot(db(),s,f.programs,new Date())).rejects.toThrow("immutable");expect((await pool.query("SELECT * FROM current_balance_snapshots")).rows).toEqual([]);expect(await oldEvidence()).toEqual(before);
  });
  it.each(["programs","history","balance"])("rejects altered snapshot %s evidence before publication",async mode=>{
    const f=fixture();await seed(f);const s=await snapshot(f);if(mode==="programs")s.programIds=[...s.programIds].reverse();if(mode==="history")s.historyComplete=true as false;if(mode==="balance")s.balances[0].shares="1";
    await expect(persistCurrentBalanceSnapshot(db(),s,f.programs,new Date())).rejects.toThrow("invalid-snapshot-evidence");expect((await pool.query("SELECT * FROM current_balance_snapshots")).rows).toEqual([]);
  });
  it("owner-hint saturation is explicit instead of truncating to a purported complete set",async()=>{
    const f=fixture();await seed(f);await pool.query(`INSERT INTO user_positions("user",basket,share_balance) SELECT 'hint-'||n,$1,0 FROM generate_series(1,1001) n`,[f.basket.toBase58()]);await expect(discoverCurrentBalanceCandidates(db(),f.basket.toBase58(),decodeBasketState(f.basket.toBase58(),f.basketAccount,f.programs))).rejects.toThrow("candidate-limit");
  });
  it("round-robin pass limits defer baskets without starving the next pass",async()=>{
    const a=fixture(7n),b=fixture(8n);await seed(a);await seed(b);await persistCurrentBalanceSnapshot(db(),await snapshot(a),a.programs,new Date(Date.now()-1000));await persistCurrentBalanceSnapshot(db(),await snapshot(b),b.programs,new Date(Date.now()-1000));
    const rpc:CurrentBalanceRpc={...a.rpc,getAccountInfoAndContext:async(address,config)=>address.equals(a.basket)||address.equals(a.shareMint)?a.rpc.getAccountInfoAndContext(address,config):b.rpc.getAccountInfoAndContext(address,config),getMultipleAccountsInfoAndContext:(addresses,config)=>addresses[0].equals(a.basket)?a.rpc.getMultipleAccountsInfoAndContext(addresses,config):b.rpc.getMultipleAccountsInfoAndContext(addresses,config)};
    expect(await syncCurrentBalanceSnapshots(rpc,db(),a.programs,{maxBasketsPerPass:1})).toMatchObject({attempted:1,verified:1,deferred:1});expect(await syncCurrentBalanceSnapshots(rpc,db(),a.programs,{maxBasketsPerPass:1})).toMatchObject({attempted:1,verified:1,deferred:1});expect(a.calls.length).toBeGreaterThan(1);expect(b.calls.length).toBeGreaterThan(1);
  });
  it("preserves the completed-read observation time through delayed publication",async()=>{
    const f=fixture();await seed(f);const s=await snapshot(f);s.observedAt=new Date(Date.now()-60_000);
    await persistCurrentBalanceSnapshot(db(),s,f.programs,new Date());
    expect((await pool.query("SELECT observed_at FROM current_balance_snapshots")).rows[0].observed_at).toEqual(s.observedAt);
  });
  it.each(["stale","future"])("rejects %s observation instead of relabelling old evidence as current",async mode=>{
    const f=fixture();await seed(f);const s=await snapshot(f);s.observedAt=new Date(Date.now()+(mode==="future"?60_000:-300_001));
    await expect(persistCurrentBalanceSnapshot(db(),s,f.programs,new Date())).rejects.toThrow("observation-stale-or-future");
    expect((await pool.query("SELECT * FROM current_balance_snapshots")).rows).toEqual([]);
  });
  it("rechecks observation freshness after the real basket lock wait",async()=>{
    const f=fixture();await seed(f);const s=await snapshot(f),blocker=await pool.connect();let fakeNow=Date.now();s.observedAt=new Date(fakeNow-300_000+100);
    await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`positions:${f.basket.toBase58()}`]);
    let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
    const wrapped={query:pool.query.bind(pool),async connect(){const c=await pool.connect();return{release:()=>c.release(),query(sql:string,values?:unknown[]){if(sql.includes("pg_advisory_xact_lock"))started();return c.query(sql,values);}};}} as unknown as PgLike;
    const clock=vi.spyOn(Date,"now").mockImplementation(()=>fakeNow);
    try{const pending=persistCurrentBalanceSnapshot(wrapped,s,f.programs,new Date()),rejected=expect(pending).rejects.toThrow("observation-stale-or-future");await began;fakeNow+=200;await blocker.query("COMMIT");await rejected;
      expect((await pool.query("SELECT * FROM current_balance_snapshots")).rows).toEqual([]);
    }finally{clock.mockRestore();await blocker.query("ROLLBACK");blocker.release();}
  });
  it("bounds candidate SQL when another database transaction blocks the hints table",async()=>{
    const f=fixture();await seed(f);const blocker=await pool.connect();await blocker.query("BEGIN");await blocker.query("LOCK TABLE user_positions IN ACCESS EXCLUSIVE MODE");
    try{await expect(discoverCurrentBalanceCandidates(db(),f.basket.toBase58(),decodeBasketState(f.basket.toBase58(),f.basketAccount,f.programs),Date.now()+100)).rejects.toThrow(/timeout|deadline/);}
    finally{await blocker.query("ROLLBACK");blocker.release();}
    expect((await pool.query("SELECT * FROM current_balance_snapshots")).rows).toEqual([]);
  });
  it("ends a stalled RPC pass with one bounded failure update and defers remaining baskets",async()=>{
    const a=fixture(7n),b=fixture(8n);await seed(a);await seed(b);const rpc:CurrentBalanceRpc={...a.rpc,getAccountInfoAndContext:()=>new Promise(()=>{})};
    const started=Date.now();expect(await syncCurrentBalanceSnapshots(rpc,db(),a.programs,{passDeadlineMs:100})).toEqual({attempted:1,verified:0,incomplete:1,deferred:1});
    expect(Date.now()-started).toBeLessThan(2_000);expect((await pool.query("SELECT status,reason FROM current_balance_snapshots")).rows).toEqual([{status:"incomplete",reason:"snapshot-deadline"}]);
  });

  it.each(["genesis","basket","transaction"])("retries a transient429 at %s once without changing the financial ledger",async phase=>{
    const f=fixture();await seed(f);const before=await oldEvidence();let attempts=0;
    if(phase==="genesis"){const original=f.rpc.getGenesisHash;f.rpc.getGenesisHash=async()=>{if(++attempts===1)throw new Error("HTTP429");return original();};}
    if(phase==="basket"){const original=f.rpc.getAccountInfoAndContext;f.rpc.getAccountInfoAndContext=async(...args)=>{if(++attempts===1)throw new Error("HTTP429");return original(...args);};}
    if(phase==="transaction"){const original=f.rpc.getParsedTransaction;f.rpc.getParsedTransaction=async(...args)=>{if(++attempts===1)throw new Error("HTTP429");return original(...args);};}
    const sleep=vi.fn(async()=>{});expect(await syncCurrentBalanceSnapshots(f.rpc,db(),f.programs,{backoffSleep:sleep})).toEqual({attempted:1,verified:1,incomplete:0,deferred:0});
    expect(attempts).toBe(2);expect(sleep).toHaveBeenCalledTimes(1);expect(f.calls).toHaveLength(1);expect(await oldEvidence()).toEqual(before);
  });
  it("bounds persistent429 retries and leaves every historical effect unchanged",async()=>{
    const f=fixture();await seed(f);const before=await oldEvidence();let attempts=0;f.rpc.getAccountInfoAndContext=async()=>{attempts++;throw new Error("HTTP429");};
    const sleep=vi.fn(async()=>{});expect(await syncCurrentBalanceSnapshots(f.rpc,db(),f.programs,{backoffSleep:sleep})).toMatchObject({verified:0,incomplete:1});
    expect(attempts).toBe(3);expect(sleep).toHaveBeenCalledTimes(2);expect(f.reads).toEqual([]);expect(await oldEvidence()).toEqual(before);
  });
  it.each(["rpc-queue-deadline","rpc-request-deadline","private-secret=https://private.invalid"])("exposes only known fixed transport reason %s",async code=>{
    const f=fixture();await seed(f);const before=await oldEvidence();f.rpc.getAccountInfoAndContext=async()=>{throw new RpcReadError(code);};
    await syncCurrentBalanceSnapshots(f.rpc,db(),f.programs);
    expect((await pool.query("SELECT status,reason FROM current_balance_snapshots")).rows[0]).toEqual({status:"incomplete",reason:code.startsWith("private")?"snapshot-read-or-storage-unavailable":code});expect(await oldEvidence()).toEqual(before);
  });

});
