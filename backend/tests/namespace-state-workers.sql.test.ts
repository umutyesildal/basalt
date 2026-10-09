/** Namespace isolation on real disposable PostgreSQL, never application DATABASE_URL. */
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import pg from "pg";
import {PublicKey,type AccountInfo} from "@solana/web3.js";
import {TOKEN_2022_PROGRAM_ID} from "@solana/spl-token";
import {applySchema} from "../src/db/init";
import type {PgLike} from "../src/db/client";
import {decodeBasketState} from "../src/indexer/basketState";
import {syncWhitelistedMints,whitelistedMintDiscriminator,type WhitelistRpc} from "../src/indexer/whitelistSync";
import {getVaultAtas,syncIndexedBaskets,type SolanaRpc} from "../src/indexer/holdingsSync";
import {persistCurrentBalanceSnapshot,readCurrentBalanceSnapshot,syncCurrentBalanceSnapshots,type CurrentBalanceRpc} from "../src/indexer/currentBalanceSnapshot";
import {syncPositionsFromChain} from "../src/indexer/positionsSync";
import {namespaceFixtures,namespaceRecoveryPrograms} from "./fixtures/program-namespaces";
import {positionRecoveryFixture,recoveryKey} from "./fixtures/position-recovery";
import {DEVNET_GENESIS_HASH,type ProgramNamespace} from "../src/config/programNamespaces";
const url=process.env.BASKET_RETURNS_TEST_DATABASE_URL,schema=`namespace_workers_${process.pid}_${Date.now()}`;
let admin:pg.Pool,pool:pg.Pool;const db=()=>pool as unknown as PgLike;
const f=(index:number)=>positionRecoveryFixture({programs:namespaceRecoveryPrograms(index)});
const info=(data:Buffer,owner=TOKEN_2022_PROGRAM_ID):AccountInfo<Buffer>=>({data,owner,executable:false,lamports:1});
function whitelist(namespace:ProgramNamespace,mint=recoveryKey(1),status=0){
 const owner=new PublicKey(namespace.programs.whitelist),[pubkey,bump]=PublicKey.findProgramAddressSync([Buffer.from("mint"),mint.toBuffer()],owner),source=Buffer.from("mock:isolated");
 const data=Buffer.alloc(55+source.length);whitelistedMintDiscriminator().copy(data);mint.toBuffer().copy(data,8);data[40]=8;data.writeBigUInt64LE(1_000_000n,41);data[49]=status;data.writeUInt32LE(source.length,50);source.copy(data,54);data[data.length-1]=bump;
 return{pubkey,account:info(data,owner)};
}
const whitelistRpc=(accounts:ReturnType<typeof whitelist>[]):WhitelistRpc=>({getProgramAccounts:async()=>accounts});
async function seed(fixture:ReturnType<typeof f>){
 const s=decodeBasketState(fixture.basket.toBase58(),fixture.basketAccount,fixture.programs);
 await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[s.pubkey,s.factory,s.creator,s.treasury,s.shareMint,s.nonce,s.createdAt,s.metadataHash,s.numConstituents,s.constituents,s.weightsBps,s.entryFeeBps,s.exitFeeBps,s.managementFeeBps,s.lastFeeAccrualTs]);
 await pool.query(`INSERT INTO user_positions("user",basket,share_balance,cost_basis,cost_basis_source) VALUES($1,$2,44,12,'prior-reference')`,[recoveryKey(20).toBase58(),s.pubkey]);
 for(const program of fixture.programs.ids)await pool.query("INSERT INTO indexer_program_state(program_id,history_complete,finalized_through_slot) VALUES($1,true,100)",[program]);
}
async function ledger(){return{positions:(await pool.query('SELECT * FROM user_positions ORDER BY basket,"user"')).rows,claims:(await pool.query('SELECT * FROM position_events ORDER BY sig,log_index')).rows,guards:(await pool.query('SELECT * FROM position_rebuild_required ORDER BY basket')).rows,queue:(await pool.query('SELECT * FROM indexer_signature_queue ORDER BY program_id,sig')).rows,events:(await pool.query('SELECT * FROM events ORDER BY sig,log_index')).rows};}
function rawRpc(fixtures:ReturnType<typeof f>[]){
 const reads:string[]=[];
 const rpc:CurrentBalanceRpc={getGenesisHash:async()=>DEVNET_GENESIS_HASH,
 async getAccountInfoAndContext(address,config){reads.push(address.toBase58());const match=fixtures.find(f=>f.basket.equals(address));if(!match)throw new Error("Cross namespace basket read");return match.rpc.getAccountInfoAndContext(address,config);},
 async getMultipleAccountsInfoAndContext(addresses){const match=fixtures.find(f=>f.basket.equals(addresses[0]));if(!match)throw new Error("Cross namespace bank read");return{context:{slot:100},value:addresses.map(address=>address.equals(match.basket)?match.basketAccount:address.equals(match.shareMint)?match.mintAccount:match.accounts.find(row=>row.pubkey.equals(address))?.account??null)};},getParsedTransaction:async()=>null};
 return{rpc,reads};
}
describe.skipIf(!url)("authenticated namespace state workers",()=>{
 beforeAll(async()=>{admin=new pg.Pool({connectionString:url});await admin.query(`CREATE SCHEMA "${schema}"`);pool=new pg.Pool({connectionString:url,max:8,options:`-c search_path=${schema}`});await applySchema(db());},30_000);
 beforeEach(async()=>{await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.query(`CREATE SCHEMA "${schema}"`);await applySchema(db());});
 afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}});
 it("keeps different admission states for the same mint without overwriting legacy global status",async()=>{
  const mint=recoveryKey(1).toBase58();await pool.query("INSERT INTO whitelisted_mints(mint,decimals,status,price_source,multiplier) VALUES($1,8,'PausedNewMints','legacy-label',2)",[mint]);
  for(const [index,status]of [[0,0],[1,1]])await syncWhitelistedMints(whitelistRpc([whitelist(namespaceFixtures[index],recoveryKey(1),status)]),namespaceFixtures[index].programs.whitelist,db(),{namespaces:namespaceFixtures});
  const rows=(await pool.query("SELECT namespace_id,status,authenticated,reason FROM namespace_whitelisted_mints ORDER BY namespace_id")).rows;
  expect(rows).toEqual([{namespace_id:namespaceFixtures[0].id,status:"Active",authenticated:true,reason:null},{namespace_id:namespaceFixtures[1].id,status:"PausedNewMints",authenticated:true,reason:null}]);
  expect((await pool.query("SELECT status,price_source,multiplier::text FROM whitelisted_mints")).rows[0]).toEqual({status:"PausedNewMints",price_source:"legacy-label",multiplier:"2"});
 });
 it.each(["owner","pda","bump","decimals","unknown-status","invalid-utf8","executable"])("invalid %s proof invalidates only its namespace and preserves financial state",async kind=>{
  for(const ns of namespaceFixtures)await syncWhitelistedMints(whitelistRpc([whitelist(ns)]),ns.programs.whitelist,db(),{namespaces:namespaceFixtures,now:()=>new Date(Date.now()-1000)});
  const bad=whitelist(namespaceFixtures[0]),before=await ledger();
  if(kind==="owner")bad.account.owner=new PublicKey(namespaceFixtures[1].programs.whitelist);if(kind==="pda")bad.pubkey=recoveryKey(22);if(kind==="bump")bad.account.data[bad.account.data.length-1]^=1;
  if(kind==="decimals")bad.account.data[40]=13;if(kind==="unknown-status")bad.account.data[49]=99;if(kind==="invalid-utf8")bad.account.data[54]=255;if(kind==="executable")bad.account.executable=true;
  await expect(syncWhitelistedMints(whitelistRpc([bad]),namespaceFixtures[0].programs.whitelist,db(),{namespaces:namespaceFixtures})).rejects.toThrow("whitelist-authentication-failed");
  expect((await pool.query("SELECT namespace_id,authenticated,reason FROM namespace_whitelisted_mints ORDER BY namespace_id")).rows).toEqual([{namespace_id:namespaceFixtures[0].id,authenticated:false,reason:"whitelist-authentication-failed"},{namespace_id:namespaceFixtures[1].id,authenticated:true,reason:null}]);expect(await ledger()).toEqual(before);
 });
 it("a namespace sweep cannot preserve an absent old Active membership",async()=>{
  const ns=namespaceFixtures[0];await syncWhitelistedMints(whitelistRpc([whitelist(ns)]),ns.programs.whitelist,db(),{namespaces:namespaceFixtures,now:()=>new Date(Date.now()-1000)});
  expect(await syncWhitelistedMints(whitelistRpc([]),ns.programs.whitelist,db(),{namespaces:namespaceFixtures})).toBe(0);
  expect((await pool.query("SELECT authenticated,reason FROM namespace_whitelisted_mints")).rows[0]).toEqual({authenticated:false,reason:"not-observed-in-current-sweep"});
 });
 it("a failed first refresh prevents an older pending success from publishing afterward",async()=>{
  const ns=namespaceFixtures[0];let release!:(rows:ReturnType<typeof whitelist>[])=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
  const pending=syncWhitelistedMints({getProgramAccounts:()=>{started();return new Promise(resolve=>{release=resolve;});}},ns.programs.whitelist,db(),{namespaces:namespaceFixtures,now:()=>new Date(Date.now()-1000)});await began;
  await expect(syncWhitelistedMints({getProgramAccounts:async()=>{throw new Error("private provider detail");}},ns.programs.whitelist,db(),{namespaces:namespaceFixtures})).rejects.toThrow("whitelist-rpc-unavailable");
  release([whitelist(ns)]);expect(await pending).toBe(0);expect((await pool.query("SELECT * FROM namespace_whitelisted_mints")).rows).toEqual([]);expect((await pool.query("SELECT status,reason FROM namespace_whitelist_state")).rows[0]).toEqual({status:"incomplete",reason:"whitelist-rpc-unavailable"});
 });
 it("never registers an arbitrary whitelist program or configured trio",async()=>{
  const a=f(0),{rpc,reads}=rawRpc([a]);let calls=0;await expect(syncWhitelistedMints({getProgramAccounts:async()=>{calls++;return[];}},namespaceFixtures[0].programs.basket,db(),{namespaces:namespaceFixtures})).rejects.toThrow("Unregistered");
  await expect(syncCurrentBalanceSnapshots(rpc,db(),a.programs)).rejects.toThrow("unregistered");await expect(syncPositionsFromChain(a.rpc,db(),{programs:a.programs})).rejects.toThrow("Unregistered");expect(reads).toEqual([]);expect(calls).toBe(0);
 });
 it("current snapshot scans only its canonical factory, preserving the other namespace and ledger",async()=>{
  const a=f(0),b=f(1);await seed(a);await seed(b);const {rpc,reads}=rawRpc([a,b]),before=await ledger();
  const s=await readCurrentBalanceSnapshot(rpc,a.basket.toBase58(),a.programs,a.accounts.map(row=>row.pubkey.toBase58()));await persistCurrentBalanceSnapshot(db(),s,a.programs,new Date(Date.now()-1000),undefined,namespaceFixtures);reads.length=0;
  expect(await syncCurrentBalanceSnapshots(rpc,db(),a.programs,{namespaces:namespaceFixtures})).toEqual({attempted:1,verified:1,incomplete:0,deferred:0});expect(reads).toEqual([a.basket.toBase58()]);
  expect((await pool.query("SELECT basket FROM current_balance_snapshots")).rows).toEqual([{basket:a.basket.toBase58()}]);expect(await ledger()).toEqual(before);
 });
 it("snapshot publication rejects mixed roles or a factory from another registered namespace",async()=>{
  const a=f(0);await seed(a);const {rpc}=rawRpc([a]),s=await readCurrentBalanceSnapshot(rpc,a.basket.toBase58(),a.programs,a.accounts.map(row=>row.pubkey.toBase58()));
  await expect(persistCurrentBalanceSnapshot(db(),s,{...a.programs,factory:namespaceRecoveryPrograms(1).factory},new Date(),undefined,namespaceFixtures)).rejects.toThrow("invalid-program-roles");
  s.basketState.factory=namespaceFixtures[1].factoryConfig;await expect(persistCurrentBalanceSnapshot(db(),s,a.programs,new Date(),undefined,namespaceFixtures)).rejects.toThrow("unregistered-snapshot-namespace");expect((await pool.query("SELECT * FROM current_balance_snapshots")).rows).toEqual([]);
 });
 it("positions reconciliation applies only its exact namespace and leaves foreign positions untouched",async()=>{
  const a=f(0),b=f(1);await seed(a);await seed(b);const before=(await pool.query("SELECT * FROM user_positions WHERE basket=$1",[b.basket.toBase58()])).rows;
  expect(await syncPositionsFromChain(a.rpc,db(),{programs:a.programs,namespaces:namespaceFixtures,spacingMs:0})).toMatchObject({basketsScanned:1,basketsFailed:0});expect((await pool.query("SELECT * FROM user_positions WHERE basket=$1",[b.basket.toBase58()])).rows).toEqual(before);expect(a.calls.every(row=>row.address!==b.basket.toBase58())).toBe(true);
 });
 it("holds correct program-derived vaults in both namespaces without inventing Active admission",async()=>{
  const fixtures=[f(0),f(1)];for(const fixture of fixtures)await seed(fixture);const before=await ledger(),accounts=new Map<string,AccountInfo<Buffer>>();
  const mint=Buffer.alloc(82);mint[44]=8;mint[45]=1;
  for(const fixture of fixtures){accounts.set(fixture.basket.toBase58(),fixture.basketAccount);for(const mintKey of [recoveryKey(1),recoveryKey(2)])accounts.set(mintKey.toBase58(),info(mint));
   for(const [i,address]of getVaultAtas(fixture.basket,[recoveryKey(1),recoveryKey(2)],fixture.programs.basket).entries()){const data=Buffer.alloc(165);recoveryKey(i+1).toBuffer().copy(data);fixture.vaultAuthority.toBuffer().copy(data,32);data.writeBigUInt64LE(BigInt(1000+i),64);data[108]=1;accounts.set(address.toBase58(),info(data));}}
  const rpc:SolanaRpc={getAccountInfo:async address=>accounts.get(address.toBase58())??null,getMultipleAccountsInfo:async addresses=>addresses.map(address=>accounts.get(address.toBase58())??null)};
  expect(await syncIndexedBaskets(rpc,db(),{namespaces:namespaceFixtures})).toBe(2);expect((await pool.query("SELECT COUNT(*)::int AS count FROM vault_holdings WHERE authenticated")).rows[0].count).toBe(4);expect((await pool.query("SELECT DISTINCT status FROM whitelisted_mints")).rows).toEqual([{status:"PausedNewMints"}]);expect((await pool.query("SELECT * FROM namespace_whitelisted_mints")).rows).toEqual([]);expect(await ledger()).toEqual(before);
  const bad=fixtures[0];accounts.set(bad.basket.toBase58(),{...bad.basketAccount,owner:fixtures[1].programs.basket});expect(await syncIndexedBaskets(rpc,db(),{namespaces:namespaceFixtures})).toBe(1);
  expect((await pool.query("SELECT authenticated FROM vault_holdings WHERE basket=$1",[bad.basket.toBase58()])).rows.every(row=>!row.authenticated)).toBe(true);expect((await pool.query("SELECT authenticated FROM vault_holdings WHERE basket=$1",[fixtures[1].basket.toBase58()])).rows.every(row=>row.authenticated)).toBe(true);
 });
 it("an older failed refresh cannot invalidate a newer successful namespace snapshot",async()=>{
  const ns=namespaceFixtures[0];let rejectRead!:(error:Error)=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
  const pending=syncWhitelistedMints({getProgramAccounts:()=>{started();return new Promise((_,reject)=>{rejectRead=reject;});}},ns.programs.whitelist,db(),{namespaces:namespaceFixtures,now:()=>new Date(Date.now()-1000)}),rejected=expect(pending).rejects.toThrow("whitelist-rpc-unavailable");await began;
  await syncWhitelistedMints(whitelistRpc([whitelist(ns)]),ns.programs.whitelist,db(),{namespaces:namespaceFixtures});rejectRead(new Error("old private transport failure"));await rejected;
  expect((await pool.query("SELECT authenticated,reason FROM namespace_whitelisted_mints")).rows).toEqual([{authenticated:true,reason:null}]);expect((await pool.query("SELECT status,reason FROM namespace_whitelist_state")).rows).toEqual([{status:"complete",reason:null}]);
 });
 it("equal-time failure wins and the same-time success cannot revive admission",async()=>{
  const ns=namespaceFixtures[0],now=new Date();await syncWhitelistedMints(whitelistRpc([whitelist(ns)]),ns.programs.whitelist,db(),{namespaces:namespaceFixtures,now:()=>now});
  await expect(syncWhitelistedMints({getProgramAccounts:async()=>{throw new Error("offline");}},ns.programs.whitelist,db(),{namespaces:namespaceFixtures,now:()=>now})).rejects.toThrow("unavailable");
  expect(await syncWhitelistedMints(whitelistRpc([whitelist(ns)]),ns.programs.whitelist,db(),{namespaces:namespaceFixtures,now:()=>now})).toBe(0);expect((await pool.query("SELECT authenticated FROM namespace_whitelisted_mints")).rows).toEqual([{authenticated:false}]);
 });
 it("a midway admission write fault rolls back new rows then invalidates old scope facts",async()=>{
  const ns=namespaceFixtures[0];await syncWhitelistedMints(whitelistRpc([whitelist(ns)]),ns.programs.whitelist,db(),{namespaces:namespaceFixtures,now:()=>new Date(Date.now()-1000)});const before=await ledger();
  await pool.query(`CREATE FUNCTION reject_new_membership() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.mint='${recoveryKey(2).toBase58()}' THEN RAISE EXCEPTION 'test midway admission fault'; END IF; RETURN NEW; END$$`);
  await pool.query("CREATE TRIGGER reject_new_membership BEFORE INSERT ON namespace_whitelisted_mints FOR EACH ROW EXECUTE FUNCTION reject_new_membership()");
  await expect(syncWhitelistedMints(whitelistRpc([whitelist(ns),whitelist(ns,recoveryKey(2))]),ns.programs.whitelist,db(),{namespaces:namespaceFixtures})).rejects.toThrow("whitelist-persist-failed");
  expect((await pool.query("SELECT mint,authenticated,reason FROM namespace_whitelisted_mints")).rows).toEqual([{mint:recoveryKey(1).toBase58(),authenticated:false,reason:"whitelist-persist-failed"}]);expect((await pool.query("SELECT mint FROM whitelisted_mints")).rows).toEqual([{mint:recoveryKey(1).toBase58()}]);expect(await ledger()).toEqual(before);
 });

});
