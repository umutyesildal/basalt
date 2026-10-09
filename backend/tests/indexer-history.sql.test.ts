/** Explicit disposable database only; never DATABASE_URL or production. */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import pg from "pg";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { applySchema } from "../src/db/init";
import { EventIndexer, type SolanaRpc } from "../src/indexer/listener";
import { getFeed, getUserHistory, getFollowList, getUserProfile } from "../src/api/social";
import { DurableHistory } from "../src/indexer/history";
import { ANCHOR_EVENT_DISCRIMINATORS } from "../src/indexer/events";
import type { PgLike } from "../src/db/client";

const url = process.env.INDEXER_HISTORY_TEST_DATABASE_URL ?? process.env.BASKET_RETURNS_TEST_DATABASE_URL;
const schema = `indexer_history_${process.pid}_${Date.now()}`;
const program = new PublicKey(Buffer.alloc(32, 90)).toBase58();
let admin: pg.Client, pool: pg.Pool, db: PgLike;
const signature = (slot: number) => ({ signature: `signature-${slot}`, slot, err: null, blockTime: 1700000000 + slot });
const tx = { transaction: { message: { instructions: [] } }, meta: { err: null, logMessages: [], innerInstructions: [] } } as unknown as ParsedTransactionWithMeta;
const config = { programIds: [program], pollIntervalMs: 1, signaturesPerPoll: 2, maxSeenCache: 2, transactionSpacingMs: 0, durableHistory: true, historyPagesPerPoll: 2 };

describe.skipIf(!url)("durable finalized indexer history", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url }); await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` }); db = pool as unknown as PgLike;
    expect(await applySchema(db)).toBe(true);
  });
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); } });
  beforeEach(async () => {
    // A fresh disposable schema preserves production backup immutability.
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    expect(await applySchema(db)).toBe(true);
  });
  function rpc(slots: number[], reads: string[], fail?: Set<string>): SolanaRpc {
    return {
      async getSignaturesForAddress(_address, options, commitment) {
        expect(commitment).toBe("finalized"); expect(options?.minContextSlot).toBe(Math.max(0,...slots));
        const until = options?.until ? Number(options.until.split("-")[1]) : 0;
        const before = options?.before ? Number(options.before.split("-")[1]) : Infinity;
        return slots.filter((s) => s > until && s < before).sort((a,b) => b-a).slice(0, options?.limit).map(signature);
      },
      async getParsedTransaction(sig, cfg) { expect(cfg?.commitment).toBe("finalized"); reads.push(sig); return fail?.has(sig) ? null : {...tx,transaction:{...tx.transaction,signatures:[sig]},slot:Number(sig.split('-')[1])}; },
      async getAccountInfo() { return null; },
      async getSlot(commitment) { expect(commitment).toBe("finalized"); return Math.max(0,...slots); },
      async getBlockSignatures(slot,commitment) { expect(commitment).toBe("finalized"); return {signatures:[signature(slot).signature]}; },
    };
  }
  it("paginates beyond latest page, resumes persisted scan after restart, processes oldest first", async () => {
    const reads: string[] = [], chain = [1,2,3,4,5];
    await new EventIndexer(rpc(chain,reads),config,db).pollOnce();
    expect(reads).toEqual([]);
    expect((await pool.query("SELECT COUNT(*) AS n FROM indexer_signature_queue")).rows[0].n).toBe("4");
    const resumed = new EventIndexer(rpc(chain,reads),config,db);
    await resumed.pollOnce(); expect(reads).toEqual(["signature-1","signature-2"]);
    await resumed.pollOnce(); await resumed.pollOnce();
    expect(reads).toEqual(["signature-1","signature-2","signature-3","signature-4","signature-5"]);
    chain.push(6,7,8); await resumed.pollOnce(); await resumed.pollOnce(); await resumed.pollOnce();
    expect(new Set(reads).size).toBe(8);
    expect((await pool.query("SELECT head_signature FROM indexer_program_state")).rows[0].head_signature).toBe("signature-8");
  });
  it("retains a failed transaction across restart and pages, then retries without losing cursor", async () => {
    const reads: string[] = [], failed = new Set(["signature-1"]), chain = [1,2,3];
    const indexer = new EventIndexer(rpc(chain,reads,failed),config,db);
    await indexer.pollOnce(); await indexer.pollOnce();
    expect((await pool.query("SELECT status,attempts FROM indexer_signature_queue WHERE sig='signature-1'")).rows[0]).toEqual({status:"pending",attempts:1});
    failed.clear();
    await new EventIndexer(rpc(chain,reads,failed),config,db).pollOnce();
    expect(reads.filter((s) => s === "signature-1")).toHaveLength(2);
    expect((await pool.query("SELECT status FROM indexer_signature_queue WHERE sig='signature-1'")).rows[0].status).toBe("processed");
  });

  function orderedRpc(programs: Record<string, Array<{signature:string; slot:number}>>, canonical: Record<number,string[]>, reads: string[], transactions: Record<string,ParsedTransactionWithMeta> = {}, failed = new Set<string>()): SolanaRpc {
    return {
      async getSlot(commitment) { expect(commitment).toBe("finalized"); return Math.max(0,...Object.keys(canonical).map(Number)); },
      async getSignaturesForAddress(address, options, commitment) {
        expect(commitment).toBe("finalized");
        expect(options?.minContextSlot).toBeTypeOf('number');
        const all = programs[address.toBase58()] ?? [];
        const start = options?.before ? all.findIndex(s => s.signature === options.before)+1 : 0;
        const end = options?.until ? all.findIndex(s => s.signature === options.until) : all.length;
        return all.slice(start,end < 0 ? all.length : end).slice(0,options?.limit).map(s => ({...s,err:null,blockTime:1700000000+s.slot}));
      },
      async getBlockSignatures(slot,commitment) { expect(commitment).toBe("finalized"); if (!canonical[slot]) throw new Error("block unavailable"); return {signatures:canonical[slot]}; },
      async getParsedTransaction(sig,cfg) { expect(cfg?.commitment).toBe("finalized"); reads.push(sig); return failed.has(sig) ? null : {...(transactions[sig] ?? tx),transaction:{...(transactions[sig] ?? tx).transaction,signatures:[sig]},slot:Object.entries(canonical).find(([,sigs])=>sigs.includes(sig)) ? Number(Object.entries(canonical).find(([,sigs])=>sigs.includes(sig))![0]) : -1}; },
      async getAccountInfo() { return null; },
    };
  }
  it("applies same-slot mint then redeem by finalized block order, despite reversed lexical signatures", async () => {
    const key = (n:number) => new PublicKey(Buffer.alloc(32,n)), basket=key(20), user=key(21), owner=key(22), share=key(23), ts=new Date();
    await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,$2,$2,$2,$3,1,$4,'test',2,$5,ARRAY[5000,5000],0,0,0,$4)`,[basket.toBase58(),owner.toBase58(),share.toBase58(),ts,[key(24).toBase58(),key(25).toBase58()]]);
    await pool.query(`INSERT INTO nav_snapshots(basket,ts,nav,supply,share_price,price_source,valuation_eligible,valuation_status) VALUES($1,$2,1,1,2,'{}',true,'complete')`,[basket.toBase58(),ts]);
    const u64=(n:bigint) => {const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(n);return bytes;};
    const eventTx=(kind:'Minted'|'Redeemed') => {
      const amounts=kind==='Minted' ? [u64(100n),u64(100n),u64(0n)] : [u64(40n),u64(0n)];
      const bytes=Buffer.concat([ANCHOR_EVENT_DISCRIMINATORS[kind],basket.toBuffer(),user.toBuffer(),...amounts]);
      return {...tx,meta:{...tx.meta!,logMessages:[`Program ${program} invoke [1]`,`Program data: ${bytes.toString('base64')}`,`Program ${program} success`]}};
    };
    const reads:string[]=[];
    const source=orderedRpc({[program]:[{signature:'a-redeem',slot:7},{signature:'z-mint',slot:7}]},{7:['z-mint','a-redeem']},reads,{'z-mint':eventTx('Minted'),'a-redeem':eventTx('Redeemed')});
    await new EventIndexer(source,{...config,signaturesPerPoll:4},db).pollOnce();
    expect(reads).toEqual(['z-mint','a-redeem']);
    expect((await pool.query('SELECT share_balance::text,cost_basis::text FROM user_positions WHERE "user"=$1',[user.toBase58()])).rows[0]).toEqual({share_balance:'60',cost_basis:'120'});
    expect((await pool.query('SELECT sig,tx_index,status FROM indexer_signature_queue ORDER BY tx_index')).rows).toEqual([{sig:'z-mint',tx_index:0,status:'processed'},{sig:'a-redeem',tx_index:1,status:'processed'}]);
    await new EventIndexer(source,{...config,signaturesPerPoll:4},db).pollOnce();
    expect(reads).toHaveLength(2);
  });
  it("persists a projection-gap guard after rollback, then permits history-only replay without financial effects",async()=>{
    const key=(n:number)=>new PublicKey(Buffer.alloc(32,n)),basket=key(40),user=key(41),owner=key(42),share=key(43),ts=new Date();
    await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,$2,$2,$2,$3,1,$4,'test',2,$5,ARRAY[5000,5000],0,0,0,$4)`,[basket.toBase58(),owner.toBase58(),share.toBase58(),ts,[key(44).toBase58(),key(45).toBase58()]]);
    await pool.query(`INSERT INTO position_rebuild_runs(run_id,basket,chain_slot,chain_supply,event_count,history_hash,program_ids,status,activated_at,activated_slot)
      VALUES('prior-recovery',$1,6,100,0,$2,$3,'activated',NOW(),6)`,[basket.toBase58(),'a'.repeat(64),[program]]);
    await pool.query(`INSERT INTO position_rebuild_required(basket,reason,activated_run_id) VALUES($1,'prior-gap','prior-recovery')`,[basket.toBase58()]);
    const u64=(amount:bigint)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(amount);return bytes;};
    const payload=Buffer.concat([ANCHOR_EVENT_DISCRIMINATORS.Redeemed,basket.toBuffer(),user.toBuffer(),u64(40n),u64(0n)]);
    const eventTx={...tx,meta:{...tx.meta!,logMessages:[`Program ${program} invoke [1]`,`Program data: ${payload.toString('base64')}`,`Program ${program} success`]}};
    const reads:string[]=[],source=orderedRpc({[program]:[{signature:'later-after-gap',slot:8},{signature:'gap-redeem',slot:7}]},{7:['gap-redeem'],8:['later-after-gap']},reads,{'gap-redeem':eventTx});
    const cfg={...config,signaturesPerPoll:4};
    await new EventIndexer(source,cfg,db).pollOnce();
    expect(reads).toEqual(['gap-redeem','later-after-gap']);
    expect((await pool.query('SELECT reason,activated_run_id FROM position_rebuild_required WHERE basket=$1',[basket.toBase58()])).rows[0]).toEqual({reason:'position-projection-gap',activated_run_id:null});
    expect((await pool.query("SELECT status,last_error FROM indexer_signature_queue WHERE sig='gap-redeem'")).rows[0]).toMatchObject({status:'pending',last_error:expect.stringMatching(/position-projection-gap:missing-position/)});
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM position_events')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM user_positions')).rows[0].n).toBe(0);
    await new EventIndexer(source,{...cfg,replayOnly:true},db).pollOnce();
    expect(reads).toEqual(['gap-redeem','later-after-gap','gap-redeem','later-after-gap']);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM indexer_signature_queue WHERE status<>'processed'")).rows[0].n).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM events')).rows[0].n).toBe(1);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM position_events')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM user_positions')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT activated_run_id FROM position_rebuild_required WHERE basket=$1',[basket.toBase58()])).rows[0].activated_run_id).toBeNull();
  });
  it("blocks all programs behind a failed shared signature and deduplicates it across restart", async () => {
    const other=new PublicKey(Buffer.alloc(32,91)).toBase58(), reads:string[]=[], failed=new Set(['old-shared']);
    const source=orderedRpc({[program]:[{signature:'last',slot:3},{signature:'old-shared',slot:1}],[other]:[{signature:'middle',slot:2},{signature:'old-shared',slot:1}]},{1:['old-shared'],2:['middle'],3:['last']},reads,{},failed);
    const cfg={...config,programIds:[program,other],signaturesPerPoll:10};
    await new EventIndexer(source,cfg,db).pollOnce();
    expect(reads).toEqual(['old-shared']);
    expect((await pool.query("SELECT attempts,status FROM indexer_signature_queue WHERE sig='old-shared'")).rows).toEqual([{attempts:1,status:'pending'},{attempts:1,status:'pending'}]);
    failed.clear(); await new EventIndexer(source,cfg,db).pollOnce();
    expect(reads).toEqual(['old-shared','old-shared','middle','last']);
    expect((await pool.query("SELECT COUNT(*) AS n FROM indexer_signature_queue WHERE status<>'processed'")).rows[0].n).toBe('0');
  });
  it("retains an unavailable or incomplete finalized block without later effects", async () => {
    const reads:string[]=[], canonical:Record<number,string[]>={1:['other-signature'],2:['later']};
    const source=orderedRpc({[program]:[{signature:'later',slot:2},{signature:'missing-from-block',slot:1}]},canonical,reads);
    await new EventIndexer(source,{...config,signaturesPerPoll:4},db).pollOnce();
    expect(reads).toEqual([]);
    expect((await pool.query("SELECT tx_index,status FROM indexer_signature_queue WHERE sig='missing-from-block'")).rows[0]).toEqual({tx_index:null,status:'pending'});
    source.getBlockSignatures=async()=>{throw new Error('block pruned');};
    await new EventIndexer(source,{...config,signaturesPerPoll:4},db).pollOnce(); expect(reads).toEqual([]);
    canonical[1]=['missing-from-block'];
    source.getBlockSignatures=async slot=>({signatures:canonical[slot]});
    await new EventIndexer(source,{...config,signaturesPerPoll:4},db).pollOnce();
    expect(reads).toEqual(['missing-from-block','later']);
  });

  it("catches up a resumed scan to the current watermark before releasing any effects", async () => {
    const reads:string[]=[], pages=[4,3,2,1].map(slot=>({signature:`s-${slot}`,slot})), canonical:Record<number,string[]>={1:['s-1'],2:['s-2'],3:['s-3'],4:['s-4']};
    const source=orderedRpc({[program]:pages},canonical,reads), cfg={...config,historyPagesPerPoll:1};
    const indexer=new EventIndexer(source,cfg,db);
    await indexer.pollOnce(); expect(reads).toEqual([]);
    expect((await new DurableHistory(db).state(program)).finalized_through_slot).toBeNull();
    expect(indexer.lastCompletedDiscoverySlot).toBeNull();
    pages.unshift({signature:'s-5',slot:5}); canonical[5]=['s-5'];
    await indexer.pollOnce(); await indexer.pollOnce(); expect(reads).toEqual([]);
    expect((await new DurableHistory(db).state(program)).finalized_through_slot).toBeNull();
    expect(indexer.lastCompletedDiscoverySlot).toBeNull();
    for(let i=0;i<4;i++) await indexer.pollOnce();
    expect(reads).toEqual(['s-1','s-2','s-3','s-4','s-5']);
    expect((await new DurableHistory(db).state(program)).finalized_through_slot).toBe('5');
    expect(indexer.lastCompletedDiscoverySlot).toBe(5);
  });



  it.each(['wrong-same-slot',undefined])("retains a same-slot response with wrong or missing transaction identity (%s)", async actual => {
    const reads:string[]=[], source=orderedRpc({[program]:[{signature:'queued-second',slot:1},{signature:'queued-first',slot:1}]},{1:['queued-first','queued-second']},reads);
    source.getParsedTransaction=async sig=>{reads.push(sig);return {...tx,slot:1,transaction:{...tx.transaction,signatures:actual?[actual]:[]}};};
    await new EventIndexer(source,{...config,signaturesPerPoll:4},db).pollOnce();
    expect(reads).toEqual(['queued-first']);
    expect((await pool.query("SELECT sig,status,last_error FROM indexer_signature_queue ORDER BY tx_index")).rows).toEqual([
      {sig:'queued-first',status:'pending',last_error:expect.stringMatching(/transaction signature disagrees/)},
      {sig:'queued-second',status:'pending',last_error:null},
    ]);
    expect((await pool.query('SELECT COUNT(*) AS n FROM events')).rows[0].n).toBe('0');
    expect((await pool.query("SELECT COUNT(*) AS n FROM position_events WHERE sig IN ('queued-first','queued-second')")).rows[0].n).toBe('0');
  });

  it("retains a slot-mismatched finalized transaction and blocks later signatures", async () => {
    const reads:string[]=[], source=orderedRpc({[program]:[{signature:'later',slot:2},{signature:'mismatch',slot:1}]},{1:['mismatch'],2:['later']},reads);
    source.getParsedTransaction=async sig=>{reads.push(sig);return {...tx,transaction:{...tx.transaction,signatures:[sig]},slot:99};};
    await new EventIndexer(source,{...config,signaturesPerPoll:4},db).pollOnce();
    expect(reads).toEqual(['mismatch']);
    expect((await pool.query("SELECT status,last_error FROM indexer_signature_queue WHERE sig='mismatch'")).rows[0]).toMatchObject({status:'pending',last_error:expect.stringMatching(/slot disagrees/)});
  });
  it("retains an event with no canonical block time instead of using local wall time", async () => {
    const reads:string[]=[], source=orderedRpc({[program]:[{signature:'later',slot:2},{signature:'no-time',slot:1}]},{1:['no-time'],2:['later']},reads);
    const original=source.getSignaturesForAddress.bind(source);
    source.getSignaturesForAddress=async(...args)=>(await original(...args)).map(row=>({...row,blockTime:null}));
    const key=(n:number)=>new PublicKey(Buffer.alloc(32,n)), bytes=Buffer.alloc(8); bytes.writeBigUInt64LE(100n);
    const payload=Buffer.concat([ANCHOR_EVENT_DISCRIMINATORS.Minted,key(30).toBuffer(),key(31).toBuffer(),bytes,bytes,Buffer.alloc(8)]);
    source.getParsedTransaction=async sig=>{reads.push(sig);return {...tx,transaction:{...tx.transaction,signatures:[sig]},slot:1,blockTime:null,meta:{...tx.meta!,logMessages:[`Program ${program} invoke [1]`,`Program data: ${payload.toString('base64')}`,`Program ${program} success`]}};};
    await new EventIndexer(source,{...config,signaturesPerPoll:4},db).pollOnce();
    expect(reads).toEqual(['no-time']);
    expect((await pool.query("SELECT status,last_error FROM indexer_signature_queue WHERE sig='no-time'")).rows[0]).toMatchObject({status:'pending',last_error:expect.stringMatching(/timestamp unavailable/)});
    expect((await pool.query('SELECT COUNT(*) AS n FROM events')).rows[0].n).toBe('0');
  });

  it("retains a matched trusted event whose payload is malformed and blocks later signatures", async () => {
    const reads:string[]=[], source=orderedRpc({[program]:[{signature:'later',slot:2},{signature:'malformed',slot:1}]},{1:['malformed'],2:['later']},reads);
    source.getParsedTransaction=async sig=>{reads.push(sig);return {...tx,transaction:{...tx.transaction,signatures:[sig]},slot:1,meta:{...tx.meta!,logMessages:[`Program ${program} invoke [1]`,`Program data: ${ANCHOR_EVENT_DISCRIMINATORS.Minted.toString('base64')}`,`Program ${program} success`]}};};
    await new EventIndexer(source,{...config,signaturesPerPoll:4},db).pollOnce();
    expect(reads).toEqual(['malformed']);
    expect((await pool.query("SELECT status,last_error FROM indexer_signature_queue WHERE sig='malformed'")).rows[0]).toMatchObject({status:'pending',last_error:expect.stringMatching(/Malformed trusted Minted/)});
    expect((await pool.query('SELECT COUNT(*) AS n FROM events')).rows[0].n).toBe('0');
  });
  it("captures a finalized watermark before discovery and defers a newer observed signature", async () => {
    const reads:string[]=[];
    const source=orderedRpc({[program]:[{signature:'newer',slot:2},{signature:'older',slot:1}]},{1:['older'],2:['newer']},reads);
    source.getSlot=async()=>1;
    const indexer=new EventIndexer(source,{...config,signaturesPerPoll:4},db);
    await indexer.pollOnce(); expect(reads).toEqual(['older']);
    source.getSlot=async()=>2; await indexer.pollOnce(); expect(reads).toEqual(['older','newer']);
  });
  it("serializes competing durable pollers before any later effects", async () => {
    const reads:string[]=[];
    const source=orderedRpc({[program]:[{signature:'second',slot:2},{signature:'first',slot:1}]},{1:['first'],2:['second']},reads);
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;}), gate=new Promise<void>(resolve=>{release=resolve;});
    source.getParsedTransaction=async sig=>{reads.push(sig); if(sig==='first'){entered();await gate;} return {...tx,transaction:{...tx.transaction,signatures:[sig]},slot:sig==='first'?1:2};};
    const cfg={...config,signaturesPerPoll:4};
    const first=new EventIndexer(source,cfg,db).pollOnce(); await started;
    const competing=new EventIndexer(source,cfg,db);
    await competing.pollOnce(); expect(reads).toEqual(['first']); expect(competing.lastCompletedDiscoverySlot).toBeNull();
    release(); await first; expect(reads).toEqual(['first','second']);
  });


  it("attests a fresh empty scan but never advances the attestation after a failed or busy poll", async () => {
    const reads:string[]=[], source=orderedRpc({[program]:[]},{},reads); source.getSlot=async()=>10;
    const indexer=new EventIndexer(source,config,db); await indexer.pollOnce();
    expect((await new DurableHistory(db).state(program)).finalized_through_slot).toBe('10');
    expect(indexer.lastCompletedDiscoverySlot).toBe(10);
    source.getSlot=async()=>11; source.getSignaturesForAddress=async()=>{throw new Error('stale RPC below minContextSlot');};
    await indexer.pollOnce();
    expect((await new DurableHistory(db).state(program)).finalized_through_slot).toBe('10'); expect(indexer.lastCompletedDiscoverySlot).toBeNull();
    const blocker=await pool.connect();
    try {
      await blocker.query('BEGIN'); await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('indexer-global-finalized-poll',0))");
      await indexer.pollOnce(); expect(indexer.lastCompletedDiscoverySlot).toBeNull();
      expect((await new DurableHistory(db).state(program)).finalized_through_slot).toBe('10');
    } finally {await blocker.query('ROLLBACK');blocker.release();}
  });

  it("never publishes an older attempt's transient proof after a newer same-instance busy poll",async()=>{
    const reads:string[]=[], source=orderedRpc({[program]:[]},{},reads);
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    source.getSlot=async()=>{entered();await gate;return 10;};
    const indexer=new EventIndexer(source,config,db),older=indexer.pollOnce();
    await started;await indexer.pollOnce();expect(indexer.lastCompletedDiscoverySlot).toBeNull();
    release();await older;
    expect((await new DurableHistory(db).state(program)).finalized_through_slot).toBe('10');
    expect(indexer.lastCompletedDiscoverySlot).toBeNull();
  });

  it("refuses watermark attestation for an incomplete scan", async () => {
    const history=new DurableHistory(db), state=await history.state(program);
    await expect(history.markVerifiedThrough(program,1)).rejects.toThrow(/Incomplete scan/);
    await history.savePage(state,[signature(2),signature(1)],2);
    await expect(history.markVerifiedThrough(program,2)).rejects.toThrow(/Incomplete scan/);
    expect((await history.state(program)).finalized_through_slot).toBeNull();
  });

  it("rolls back enqueued signatures when cursor write fails", async () => {
    const history = new DurableHistory(db); const state = await history.state(program);
    const broken: PgLike = { query: db.query.bind(db), async connect() {
      const client = await pool.connect();
      return { release: () => client.release(), async query(sql,values) { if (sql.startsWith("UPDATE indexer_program_state")) throw new Error("injected checkpoint failure"); return client.query(sql,values); } };
    } };
    await expect(new DurableHistory(broken).savePage(state,[signature(1)],2)).rejects.toThrow("injected checkpoint failure");
    expect((await pool.query("SELECT COUNT(*) AS n FROM indexer_signature_queue")).rows[0].n).toBe("0");
    expect((await history.state(program)).head_signature).toBeNull();
  });
  it("rejects stale concurrent scanner state without regressing committed history", async () => {
    const history = new DurableHistory(db), state = await history.state(program);
    const results = await Promise.all([history.savePage(state,[signature(1)],2),history.savePage(state,[signature(1)],2)]);
    expect(results.sort()).toEqual([false,true]);
    expect((await history.state(program)).head_signature).toBe("signature-1");
  });
  it("history and feed preserve repeated same-signature events across a page boundary", async () => {
    const key = (n: number) => new PublicKey(Buffer.alloc(32,n)).toBase58();
    const basket = key(1), user = key(2), ts = new Date();
    await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,$2,$2,$2,$3,1,$4,'test',2,$5,ARRAY[5000,5000],0,0,0,$4)`,[basket,user,key(3),ts,[key(4),key(5)]]);
    for (const index of [-1,2,9]) await pool.query(`INSERT INTO events(sig,log_index,slot,basket,type,data,ts) VALUES('same-signature',$1,1,$2,'Minted',$3,$4)`,[index,basket,{basket,user,netShares:'1000000'},ts]);
    const profile = (await getUserProfile(db,user,null)).payload as any;
    expect(profile.stats.tradeCount).toBe(2);
    const first = (await getUserHistory(db,user,{limit:1})).payload as any;
    const second = (await getUserHistory(db,user,{limit:1,cursor:first.nextCursor})).payload as any;
    expect(first.items[0]).toMatchObject({sig:'same-signature',logIndex:9,eventId:'same-signature:9'});
    expect(second.items[0].logIndex).toBe(2);
    const empty = (await getUserHistory(db,user,{limit:1,cursor:second.nextCursor})).payload as any;
    expect(empty.items).toEqual([]);
    const params = {scope:'all' as const,type:'trades' as const,limit:1,viewerWallet:null};
    const feed1 = (await getFeed(db,params)).payload as any;
    const feed2 = (await getFeed(db,{...params,cursor:feed1.nextCursor})).payload as any;
    expect(feed1.items[0]).toMatchObject({sig:'same-signature',logIndex:9});
    expect(feed2.items[0]).toMatchObject({sig:'same-signature',logIndex:2});
  });
  it("follow-list pagination keeps same-time rows with correct bound cursor keys", async () => {
    const key = (n:number) => new PublicKey(Buffer.alloc(32,n)).toBase58();
    const ts = new Date();
    await pool.query(`INSERT INTO profiles(wallet,handle,display_name,is_public) VALUES($1,'followee','test',true)`,[key(13)]);
    for (const follower of [key(10),key(11),key(12)]) {
      await pool.query(`INSERT INTO profiles(wallet,handle,display_name,is_public) VALUES($1,$2,'test',true)`,[follower,'user'+follower.slice(0,8).toLowerCase()]);
      await pool.query(`INSERT INTO follows(follower,followee,created_at) VALUES($1,$2,$3)`,[follower,key(13),ts]);
    }
    let cursor: string | null = null; const wallets: string[] = [];
    for (let i=0;i<3;i++) {
      const page = (await getFollowList(db,key(13),'followers',{limit:1,cursor})).payload as any;
      wallets.push(page.items[0].wallet); cursor=page.nextCursor;
    }
    expect(new Set(wallets).size).toBe(3);
  });
  it("quarantines truncated logs without applying a partial event set", async () => {
    const reads: string[] = [], source = rpc([1],reads);
    source.getParsedTransaction = async sig => ({ ...tx, transaction:{...tx.transaction,signatures:[sig]}, slot:1, meta: { ...tx.meta!, logMessages: ["Log truncated"] } });
    await new EventIndexer(source,config,db).pollOnce();
    const row = (await pool.query("SELECT status,last_error FROM indexer_signature_queue")).rows[0];
    expect(row.status).toBe("quarantined"); expect(row.last_error).toMatch(/truncated/);
  });
  async function evidenceBasket(id=120) {
    const key=(n:number)=>new PublicKey(Buffer.alloc(32,n)),basket=key(id),user=key(id+1),owner=key(id+2),ts=new Date();
    await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,$2,$2,$2,$3,1,$4,'test',2,$5,ARRAY[5000,5000],0,0,0,$4)`,[basket.toBase58(),owner.toBase58(),key(id+3).toBase58(),ts,[key(id+4).toBase58(),key(id+5).toBase58()]]);
    const u64=(n:bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b;};
    const payload=Buffer.concat([ANCHOR_EVENT_DISCRIMINATORS.Minted,basket.toBuffer(),user.toBuffer(),u64(100n),u64(100n),u64(0n)]);
    const minted={...tx,meta:{...tx.meta!,logMessages:[`Program ${program} invoke [1]`,`Program data: ${payload.toString('base64')}`,`Program ${program} success`]}};
    return {basket:basket.toBase58(),user:user.toBase58(),minted};
  }

  it("collects later canonical facts without processing a blocked ledger or retrying its RPC head",async()=>{
    const f=await evidenceBasket();
    await pool.query("INSERT INTO position_rebuild_required(basket,reason) VALUES($1,'legacy-ledger')",[f.basket]);
    await pool.query('INSERT INTO user_positions("user",basket,share_balance,cost_basis) VALUES($1,$2,777,12)',[f.user,f.basket]);
    const reads:string[]=[],source=orderedRpc({[program]:[{signature:'later',slot:2},{signature:'blocked',slot:1}]},{1:['blocked'],2:['later']},reads,{blocked:f.minted,later:f.minted});
    const indexer=new EventIndexer(source,{...config,signaturesPerPoll:4},db);
    await indexer.pollOnce();await indexer.pollOnce();
    expect(reads).toEqual(['blocked','later']);
    expect((await pool.query('SELECT sig,status,canonical_event_count,canonical_collected_at IS NOT NULL AS collected FROM indexer_signature_queue ORDER BY slot')).rows)
      .toEqual([{sig:'blocked',status:'pending',canonical_event_count:1,collected:true},{sig:'later',status:'pending',canonical_event_count:1,collected:true}]);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM events')).rows[0].n).toBe(2);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM position_events')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT share_balance::text,cost_basis::text FROM user_positions')).rows).toEqual([{share_balance:'777',cost_basis:'12'}]);
    expect((await pool.query('SELECT activated_run_id FROM position_rebuild_required')).rows[0].activated_run_id).toBeNull();
  });

  it("collects evidence past a truncated predecessor without clearing its quarantine or publishing later positions",async()=>{
    const f=await evidenceBasket(),reads:string[]=[];
    const truncated={...tx,meta:{...tx.meta!,logMessages:['Log truncated']}};
    const source=orderedRpc({[program]:[{signature:'later',slot:2},{signature:'truncated',slot:1}]},{1:['truncated'],2:['later']},reads,{truncated,later:f.minted});
    const indexer=new EventIndexer(source,{...config,signaturesPerPoll:4},db);
    await indexer.pollOnce();await indexer.pollOnce();
    expect(reads).toEqual(['truncated','later']);
    expect((await pool.query('SELECT sig,status,canonical_event_count FROM indexer_signature_queue ORDER BY slot')).rows)
      .toEqual([{sig:'truncated',status:'quarantined',canonical_event_count:null},{sig:'later',status:'pending',canonical_event_count:1}]);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM user_positions')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM position_events')).rows[0].n).toBe(0);
  });

  it("does not label a signature with mismatching RPC identity as collected",async()=>{
    const f=await evidenceBasket(),reads:string[]=[];
    const truncated={...tx,meta:{...tx.meta!,logMessages:['Log truncated']}};
    const source=orderedRpc({[program]:[{signature:'later',slot:2},{signature:'truncated',slot:1}]},{1:['truncated'],2:['later']},reads,{truncated,later:f.minted});
    const read=source.getParsedTransaction.bind(source);
    source.getParsedTransaction=async(sig,cfg)=>{const value=await read(sig,cfg);return sig==='later'?{...value!,transaction:{...value!.transaction,signatures:['wrong-signature']}}:value;};
    const indexer=new EventIndexer(source,{...config,signaturesPerPoll:4},db);
    await indexer.pollOnce();await indexer.pollOnce();
    expect(reads).toContain('later');
    expect((await pool.query("SELECT canonical_collected_at,status FROM indexer_signature_queue WHERE sig='later'")).rows[0]).toEqual({canonical_collected_at:null,status:'pending'});
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM events')).rows[0].n).toBe(0);
  });

  it("commits no canonical facts when their collection marker fails, then retries once",async()=>{
    const f=await evidenceBasket(),reads:string[]=[];
    const source=orderedRpc({[program]:[{signature:'mint',slot:1}]},{1:['mint']},reads,{mint:f.minted});
    const broken:PgLike={query:db.query.bind(db),async connect(){const client=await pool.connect();return {release:()=>client.release(),async query(sql,values){if(sql.includes('SET canonical_collected_at='))throw new Error('injected marker fault');return client.query(sql,values);}};}};
    await new EventIndexer(source,{...config,signaturesPerPoll:4},broken).pollOnce();
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM events')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT canonical_collected_at FROM indexer_signature_queue')).rows[0].canonical_collected_at).toBeNull();
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM position_events')).rows[0].n).toBe(0);
    await new EventIndexer(source,{...config,signaturesPerPoll:4},db).pollOnce();
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM events')).rows[0].n).toBe(1);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM position_events')).rows[0].n).toBe(1);
  });

  it("records genuine zero-event and failed transactions as evidence without processing them past quarantine",async()=>{
    const reads:string[]=[],truncated={...tx,meta:{...tx.meta!,logMessages:['Log truncated']}},failed={...tx,meta:{...tx.meta!,err:{InstructionError:[0,'Custom']}}};
    const source=orderedRpc({[program]:[{signature:'failed',slot:3},{signature:'empty',slot:2},{signature:'truncated',slot:1}]},{1:['truncated'],2:['empty'],3:['failed']},reads,{truncated,failed});
    const indexer=new EventIndexer(source,{...config,signaturesPerPoll:5},db);
    await indexer.pollOnce();await indexer.pollOnce();
    expect(reads).toEqual(['truncated','empty','failed']);
    expect((await pool.query('SELECT sig,status,canonical_event_count FROM indexer_signature_queue ORDER BY slot')).rows)
      .toEqual([{sig:'truncated',status:'quarantined',canonical_event_count:null},{sig:'empty',status:'pending',canonical_event_count:0},{sig:'failed',status:'pending',canonical_event_count:0}]);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM events')).rows[0].n).toBe(0);
  });

});
