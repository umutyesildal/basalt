/** Opt-in actual PostgreSQL in a unique test-owned schema; never application DATABASE_URL. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { applySchema } from "../src/db/init";
import type { PgLike } from "../src/db/client";
import { basketShareIdentity, createBasketShare, getBasketShare, MAX_BASKET_SHARE_ROWS } from "../src/api/basket-shares";

const url = process.env.BASKET_SHARES_TEST_DATABASE_URL ?? process.env.BASKET_RETURNS_TEST_DATABASE_URL;
const schema = `basket_shares_${process.pid}_${Date.now()}`;
let admin: pg.Pool, pool: pg.Pool;
const encoded = (name = "A public basket") => "4." + Buffer.from(JSON.stringify([4,name,1000,["NVDA",5000,null,"GLD",5000,null],"An immutable thesis.",[0,0,200],"moon-shot"])).toString("base64url");
const db = () => pool as unknown as PgLike;

describe.skipIf(!url)("basket links against disposable PostgreSQL", () => {
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({connectionString:url,max:8,options:`-c search_path=${schema}`,application_name:schema});
    expect(await applySchema(db())).toBe(true);
  },30_000);
  afterAll(async () => {
    if(pool) await pool.end();
    if(admin) {await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}
  });
  beforeEach(async () => {await pool.query("DELETE FROM basket_shares");});

  it("concurrent retries persist one exact snapshot and resolve from a fresh connection",async()=>{
    const snapshot=encoded();
    const results=await Promise.all(Array.from({length:12},()=>createBasketShare(db(),snapshot)));
    expect(new Set(results.map(row=>row.id)).size).toBe(1);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM basket_shares")).rows[0].count).toBe(1);
    const fresh=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});
    try { expect(await getBasketShare(fresh as unknown as PgLike,results[0].id)).toEqual({id:results[0].id,encoded:snapshot}); }
    finally {await fresh.end();}
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM baskets")).rows[0].count).toBe(0);
  });

  it("collision rejection leaves the original row and creation time untouched",async()=>{
    const snapshot=encoded(),identity=basketShareIdentity(snapshot);
    await pool.query("INSERT INTO basket_shares(id,content_hash,encoded) VALUES($1,$2,$3)",[identity.id,"f".repeat(64),encoded("Original")]);
    const before=(await pool.query("SELECT * FROM basket_shares")).rows;
    await expect(createBasketShare(db(),snapshot)).rejects.toMatchObject({status:409,code:"SHARE_COLLISION"});
    expect((await pool.query("SELECT * FROM basket_shares")).rows).toEqual(before);
    await expect(getBasketShare(db(),identity.id)).rejects.toMatchObject({status:503,code:"SHARE_UNAVAILABLE"});
  });

  it("atomic admission cannot exceed the hard row cap under concurrent creation",async()=>{
    await pool.query(`INSERT INTO basket_shares(id,content_hash,encoded)
      SELECT 'fake_' || lpad(n::text,15,'0'),md5(n::text)||md5('test-'||n::text),$1
      FROM generate_series(1,$2) n`,[encoded(),MAX_BASKET_SHARE_ROWS-1]);
    const results=await Promise.allSettled([createBasketShare(db(),encoded("Final slot one")),createBasketShare(db(),encoded("Final slot two"))]);
    expect(results.filter(row=>row.status==="fulfilled").length).toBe(1);
    const rejected=results.find(row=>row.status==="rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({status:429,code:"SHARE_CAPACITY"});
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM basket_shares")).rows[0].count).toBe(MAX_BASKET_SHARE_ROWS);
  });

  it("an identical retry succeeds at capacity and id/bytes cannot be mixed",async()=>{
    const snapshot=encoded(),stored=await createBasketShare(db(),snapshot);
    await pool.query(`INSERT INTO basket_shares(id,content_hash,encoded)
      SELECT 'fake_' || lpad(n::text,15,'0'),md5(n::text)||md5('test-'||n::text),$1
      FROM generate_series(1,$2) n`,[snapshot,MAX_BASKET_SHARE_ROWS-1]);
    expect(await createBasketShare(db(),snapshot)).toEqual(stored);
    expect(await getBasketShare(db(),stored.id)).toEqual({...stored,encoded:snapshot});
    await expect(createBasketShare(db(),encoded("At capacity"))).rejects.toMatchObject({status:429});
  });
});
