/** Real isolated PostgreSQL: one namespace must not certify another's state. */
import {afterAll,beforeAll,beforeEach,describe,it,expect} from "vitest";
import pg from "pg";
import {applySchema} from "../src/db/init";
import {listWhitelist} from "../src/api/server";
import {positionProjectionReadySql} from "../src/api/valuation-quality";
import {namespaceProgramIds} from "../src/config/programNamespaces";
import {namespaceFixtures} from "./fixtures/program-namespaces";
const url=process.env.BASKET_RETURNS_TEST_DATABASE_URL;
const schema=`namespace_api_${process.pid}_${Date.now()}`;
let db:pg.Client;
describe.skipIf(!url)("namespace API evidence boundaries on PostgreSQL",()=>{
 beforeAll(async()=>{db=new pg.Client({connectionString:url});await db.connect();await db.query(`CREATE SCHEMA "${schema}"`);await db.query(`SET search_path TO "${schema}"`);},30000);
 afterAll(async()=>{if(db){await db.query(`DROP SCHEMA "${schema}" CASCADE`);await db.end();}});
 beforeEach(async()=>{
  await db.query(`DROP SCHEMA "${schema}" CASCADE`);await db.query(`CREATE SCHEMA "${schema}"`);await applySchema(db);
  for(const [index,namespace] of namespaceFixtures.entries()){
   await db.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
    VALUES($1,$2,'creator','treasury',$3,1,NOW(),'hash',2,ARRAY['a','b'],ARRAY[5000,5000],0,0,0,NOW())`,[`basket-${index}`,namespace.factoryConfig,`share-${index}`]);
   for(const program of namespaceProgramIds(namespace))await db.query("INSERT INTO indexer_program_state(program_id,history_complete,finalized_through_slot) VALUES($1,true,200)",[program]);
  }
 });
 const ready=async()=> (await db.query(`SELECT pubkey,${positionProjectionReadySql("b.pubkey",namespaceFixtures)} AS ready FROM baskets b ORDER BY pubkey`)).rows;
 it("keeps legacy quarantine blocked without blocking an unrelated complete namespace",async()=>{
  await db.query("INSERT INTO indexer_signature_queue(program_id,sig,slot,status,last_error) VALUES($1,'bad-history',100,'quarantined','truncated')",[namespaceFixtures[0].programs.basket]);
  expect(await ready()).toEqual([{pubkey:"basket-0",ready:false},{pubkey:"basket-1",ready:true}]);
  await db.query("INSERT INTO position_rebuild_required(basket,reason) VALUES('basket-1','independent-gap')");
  expect(await ready()).toEqual([{pubkey:"basket-0",ready:false},{pubkey:"basket-1",ready:false}]);
 });
 it("fails closed for missing state, unfinished scan and unsupported factory",async()=>{
  await db.query("DELETE FROM indexer_program_state WHERE program_id=$1",[namespaceFixtures[1].programs.factory]);
  expect((await ready())[1].ready).toBe(false);
  await db.query("UPDATE indexer_program_state SET history_complete=false WHERE program_id=$1",[namespaceFixtures[0].programs.whitelist]);
  expect((await ready())[0].ready).toBe(false);
  await db.query("UPDATE baskets SET factory='unsupported'");expect((await ready()).every(row=>!row.ready)).toBe(true);
 });
 async function admissions(){
  await db.query("INSERT INTO whitelisted_mints(mint,decimals,status,price_source,multiplier) VALUES('mint',6,'Active','legacy:price',1)");
  for(const [index,namespace] of namespaceFixtures.entries())await db.query(`INSERT INTO namespace_whitelisted_mints(namespace_id,mint,whitelist_program,account_pubkey,decimals,status,price_source,authenticated,observed_at,attempted_at,reason)
   VALUES($1,'mint',$2,$3,6,$4,$5,true,NOW(),NOW(),NULL)`,[namespace.id,namespace.programs.whitelist,namespace.whitelistConfig,index===0?"Active":"PausedNewMints",`namespace:${index}`]);
 }
 it("reports separate admissions for the same mint without reusing global Active status",async()=>{
  await admissions();
  expect((await listWhitelist(db,namespaceFixtures[0].id,namespaceFixtures)).payload).toMatchObject({data:[{status:"Active",price_source:"namespace:0"}]});
  expect((await listWhitelist(db,namespaceFixtures[1].id,namespaceFixtures)).payload).toMatchObject({data:[{status:"PausedNewMints",price_source:"namespace:1"}]});
  await db.query("DELETE FROM namespace_whitelisted_mints");
  expect((await listWhitelist(db,namespaceFixtures[1].id,namespaceFixtures)).payload).toMatchObject({data:[],count:0});
 });
 it.each(["failed","stale","future","wrong-program"])("withholds %s scoped admission",async kind=>{
  await admissions();
  if(kind==="failed")await db.query("UPDATE namespace_whitelisted_mints SET authenticated=false,reason='failed'");
  if(kind==="stale")await db.query("UPDATE namespace_whitelisted_mints SET observed_at=NOW()-interval '6 minutes'");
  if(kind==="future")await db.query("UPDATE namespace_whitelisted_mints SET observed_at=NOW()+interval '6 minutes'");
  if(kind==="wrong-program")await db.query("UPDATE namespace_whitelisted_mints SET whitelist_program=$1",[namespaceFixtures[1].programs.whitelist]);
  expect((await listWhitelist(db,namespaceFixtures[0].id,namespaceFixtures)).payload).toMatchObject({data:[],count:0});
 });
 it("rejects unregistered namespace requests before querying the database",async()=>{
  const fake={query:async()=>{throw new Error("must not query");}};
  expect((await listWhitelist(fake,"devnet-unregistered")).status).toBe(400);
 });
});
