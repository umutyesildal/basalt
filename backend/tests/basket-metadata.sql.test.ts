import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { applySchema } from "../src/db/init";
import { metadataHash, publishBasketMetadata, publicBasketMetadata } from "../src/api/basket-metadata";
import { PROGRAM_NAMESPACES } from "../src/config/programNamespaces";
const url=process.env.BASKET_RETURNS_TEST_DATABASE_URL;
const schema=`basket_metadata_${process.pid}_${Date.now()}`;
let admin:pg.Pool,pool:pg.Pool;
const address="14dbVJmT5Ja9iLnAHETB4N17ukAYMjLsdPDx1hdiCXxx";
const document='{ "name": "My actual basket", "description": "My original thesis.", "coverId": "orbit" }';
describe.skipIf(!url)("immutable creator metadata on PostgreSQL",()=>{
  beforeAll(async()=>{admin=new pg.Pool({connectionString:url});await admin.query(`CREATE SCHEMA "${schema}"`);pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});await applySchema(pool);},30000);
  afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}});
  beforeEach(async()=>{
    await pool.query("DELETE FROM baskets");
    await pool.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,$2,'creator','treasury','share',1,NOW(),$3,2,ARRAY['a','b'],ARRAY[5000,5000],0,0,200,NOW())`,[address,PROGRAM_NAMESPACES[1].factoryConfig,metadataHash(document)]);
  });
  it("concurrent publication preserves exact whitespace and serves a fresh connection",async()=>{
    const before=(await pool.query("SELECT * FROM baskets")).rows[0];
    await Promise.all(Array.from({length:6},()=>publishBasketMetadata(pool,address,document)));
    const fresh=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});
    try {
      const after=(await fresh.query("SELECT * FROM baskets")).rows[0];
      expect(publicBasketMetadata(after)).toEqual({metadata_document:document,metadata_json:JSON.parse(document)});
      delete before.metadata_json;delete before.metadata_document;
      delete after.metadata_json;delete after.metadata_document;
      expect(after).toEqual(before);
    }finally{await fresh.end();}
  });
  it.each([JSON.stringify(JSON.parse(document)),document.replace('actual','fake'),'{"name":"A different name"}'])("rejects a different preimage without writes",async wrong=>{
    const before=(await pool.query("SELECT * FROM baskets")).rows;
    await expect(publishBasketMetadata(pool,address,wrong)).rejects.toMatchObject({status:409,code:"METADATA_HASH_MISMATCH"});
    expect((await pool.query("SELECT * FROM baskets")).rows).toEqual(before);
  });
  it("does not create unindexed baskets or admit foreign factories",async()=>{
    await expect(publishBasketMetadata(pool,'not-indexed',document)).rejects.toMatchObject({status:404});
    await pool.query("UPDATE baskets SET factory='unsupported'");
    await expect(publishBasketMetadata(pool,address,document)).rejects.toMatchObject({status:409,code:"UNSUPPORTED_BASKET"});
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM baskets")).rows[0].count).toBe(1);
  });
  it("does not overwrite a conflicting stored document and hides corrupted reads",async()=>{
    await pool.query("UPDATE baskets SET metadata_document='corrupted',metadata_json=$1",[JSON.stringify({name:'fake'})]);
    await expect(publishBasketMetadata(pool,address,document)).rejects.toMatchObject({status:409,code:"METADATA_CONFLICT"});
    expect(publicBasketMetadata((await pool.query("SELECT * FROM baskets")).rows[0])).toEqual({metadata_json:null,metadata_document:null});
  });
  it("migration is idempotent and enforces a byte bound",async()=>{
    await expect(applySchema(pool)).resolves.toBe(true);
    await expect(pool.query("UPDATE baskets SET metadata_document=$1",['🌍'.repeat(5000)])).rejects.toThrow();
  });
});
