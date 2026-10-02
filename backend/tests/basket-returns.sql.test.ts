/**
 * Real SQL regressions, opt-in only against an explicitly supplied disposable
 * database. Never fall back to DATABASE_URL. Each run owns a unique schema.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { PublicKey } from "@solana/web3.js";
import { applySchema } from "../src/db/init";
import type { PgLike } from "../src/db/client";
import { basketPerformance, listBaskets } from "../src/api/server";
import { getBasketLeaderboard, getFeed, getUserHistory } from "../src/api/social";

const url = process.env.BASKET_RETURNS_TEST_DATABASE_URL;
const schema = `basket_returns_${process.pid}_${Date.now()}`;
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const WEEK = 7 * 24 * 60 * 60_000;
let client: pg.Client;
let db: PgLike;
let now: Date;
let latestTs: Date;

describe.skipIf(!url)("basket returns against disposable PostgreSQL", () => {
  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    db = client as unknown as PgLike;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    expect(await applySchema(db)).toBe(true);
    now = (await client.query("SELECT NOW() AS ts")).rows[0].ts;
    latestTs = new Date(now.getTime() - 60_000);
  }, 30_000);
  afterAll(async () => {
    if (client) {
      await client.query("ROLLBACK");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
  beforeEach(async () => {
    await client.query("TRUNCATE baskets CASCADE");
    await client.query("REFRESH MATERIALIZED VIEW basket_rankings");
  });

  async function basket(id: number) {
    const pubkey = key(id);
    await client.query(`INSERT INTO baskets(
      pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,
      metadata_json,num_constituents,constituents,weights_bps,
      entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,$2,$3,$4,$5,$6,$7,'test',$8,2,$9,$10,0,0,0,$7)`,
      [pubkey,key(220),key(221),key(222),key(id + 100),String(id),now,
        {name: `Basket ${id}`,symbol:`B${id}`},[key(223),key(224)],[5000,5000]]);
    return pubkey;
  }
  async function snapshot(pubkey: string, ts: Date, nav: string, supply: string, price: string) {
    await client.query(`INSERT INTO nav_snapshots(basket,ts,nav,supply,share_price,price_source)
      VALUES($1,$2,$3,$4,$5,'{}')`, [pubkey,ts,nav,supply,price]);
  }
  async function pair(id: number, nav = "100", supply = "1000000", price = "0.0001",
      baseNav = "100", baseSupply = "1000000", basePrice = "0.0001",
      curTs = latestTs, baseTs = new Date(curTs.getTime() - WEEK)) {
    const pubkey = await basket(id);
    await snapshot(pubkey, baseTs, baseNav, baseSupply, basePrice);
    await snapshot(pubkey, curTs, nav, supply, price);
    await client.query("REFRESH MATERIALIZED VIEW basket_rankings");
    return pubkey;
  }
  const ranked = async (window = "7d") => (await getBasketLeaderboard(db, window)).payload as any;
  const listed = async (sort = "return_7d") => (await listBaskets(db, {sort})).payload as any;
  const performance = async (pubkey: string) => (await basketPerformance(db, pubkey)).payload as any;

  it("deposit doubles NAV/supply while all API 7d returns stay zero", async () => {
    const pubkey = await pair(1, "200", "2000000");
    expect(Number((await listed()).data[0].return_7d)).toBe(0);
    expect((await ranked()).items[0].returnPct).toBe(0);
    const data = (await performance(pubkey)).data;
    expect(data.windows["7d"].pct).toBe("0");
    expect(data.latest).toEqual({nav:"200",supply:"2000000",sharePrice:"0.0001",ts:latestTs.toISOString()});
  });
  it("proportional withdrawal has no impact on return", async () => {
    const pubkey = await pair(2, "50", "500000");
    expect((await ranked()).items[0].returnPct).toBe(0);
    expect((await performance(pubkey)).data.windows["7d"].pct).toBe("0");
  });
  it("genuine price movement ranks numerically with compatible ratio/percent units", async () => {
    await pair(3, "190", "1000000", "0.00019");
    await pair(4, "200", "1000000", "0.0002");
    const items = (await ranked()).items;
    expect(items.map((item: any) => item.returnPct)).toEqual([100,90]);
    expect((await listed()).data.map((item: any) => Number(item.return_7d))).toEqual([1,0.9]);
  });
  it("reads latest NAV/price/timestamp together even when materialized NAV is old", async () => {
    const pubkey = await basket(5);
    await snapshot(pubkey,new Date(latestTs.getTime()-WEEK),"100","1000000","0.0001");
    await client.query("REFRESH MATERIALIZED VIEW basket_rankings");
    await snapshot(pubkey,latestTs,"208.42","2000000","0.00010421");
    const row = (await listed()).data[0];
    expect(row.nav).toBe("208.42");
    expect(row.share_price).toBe("0.00010421");
    expect(row.asOf).toBe(latestTs.toISOString());
    expect(Number(row.return_7d)).toBeCloseTo(0.0421,12);
    expect((await ranked()).items[0]).toMatchObject({nav:"208.42",returnPct:4.21,asOf:latestTs.toISOString()});
  });
  it("single snapshot gives null windows and no invented leaderboard place", async () => {
    const pubkey = await basket(6);
    await snapshot(pubkey,latestTs,"100","1000000","0.0001");
    await client.query("REFRESH MATERIALIZED VIEW basket_rankings");
    const windows = (await performance(pubkey)).data.windows;
    expect(Object.values(windows).every((w: any) => w.pct === null)).toBe(true);
    expect((await listed()).data[0]).toMatchObject({return_24h:null,return_7d:null,return_30d:null});
    expect((await ranked()).items).toEqual([]);
    expect((await ranked("all")).items).toEqual([]);
  });
  it.each(["zero-price","zero-supply","stale","future","partial","old-baseline"])(
    "excludes %s history from the 7d ranking and leaves return null", async (kind) => {
      let curTs = latestTs;
      let baseTs = new Date(curTs.getTime()-WEEK);
      if (kind === "stale") curTs = new Date(now.getTime()-16*60_000);
      if (kind === "future") curTs = new Date(now.getTime()+60_000);
      baseTs = new Date(curTs.getTime()-WEEK);
      if (kind === "partial") baseTs = new Date(baseTs.getTime()+1);
      if (kind === "old-baseline") baseTs = new Date(baseTs.getTime()-60*60_000-1);
      const pubkey = await pair(7,"100","1000000","0.0001","100",
        kind === "zero-supply" ? "0" : "1000000",
        kind === "zero-price" ? "0" : "0.0001",curTs,baseTs);
      expect((await listed()).data[0].return_7d).toBeNull();
      expect((await performance(pubkey)).data.windows["7d"].pct).toBeNull();
      expect((await ranked()).items).toEqual([]);
    },
  );
  it("earliest invalid inception rows are skipped in performance and all ranking", async () => {
    const pubkey = await basket(8);
    await snapshot(pubkey,new Date(latestTs.getTime()-10*WEEK),"0","0","0");
    await snapshot(pubkey,new Date(latestTs.getTime()-2*WEEK),"100","1000000","0.0001");
    await snapshot(pubkey,latestTs,"110","1000000","0.00011");
    await client.query("REFRESH MATERIALIZED VIEW basket_rankings");
    expect((await performance(pubkey)).data.windows.inception.pct).toBe("10");
    expect((await ranked("all")).items[0].returnPct).toBe(10);
  });
  it("NUMERIC NaN/Infinity never take a rank or consume the SQL LIMIT", async () => {
    for (let id = 10; id < 62; id++) {
      await pair(id,"100","1000000",id % 2 ? "NaN" : "Infinity");
    }
    await pair(63,"104.21","1000000","0.00010421");
    expect((await ranked()).items.map((item: any) => item.basket)).toEqual([key(63)]);
    const rows = (await listed()).data;
    expect(rows[0].pubkey).toBe(key(63));
    expect(rows.filter((item: any) => item.pubkey !== key(63)).every((item: any) => item.return_7d === null)).toBe(true);
  });
  it("baseline non-finite share prices are unavailable", async () => {
    await pair(64,"100","1000000","0.0001","100","1000000","NaN");
    expect((await ranked()).items).toEqual([]);
    expect((await listed()).data[0].return_7d).toBeNull();
  });
  it("huge NUMERIC values preserve return precision and raw supply text", async () => {
    const pubkey = await pair(65,"1100000000000000000000000000","1000000",
      "1100000000000000000000","1000000000000000000000000000","1000000","1000000000000000000000");
    const data = (await performance(pubkey)).data;
    expect(data.latest.nav).toBe("1100000000000000000000000000");
    expect(data.windows["7d"].pct).toBe("10");
    expect((await ranked()).items[0].returnPct).toBe(10);
  });
  it("raw shares × stored raw-unit price gives trade value; whole-share display scales once", async () => {
    const pubkey = await pair(66);
    await client.query(`INSERT INTO events(sig,slot,basket,type,data,ts)
      VALUES('mint-test','1',$1,'Minted',$2,$3)`,
      [pubkey,{user:key(221),netShares:"1000000"},latestTs]);
    const payload = (await getUserHistory(db,key(221),{})).payload as any;
    expect(payload.items[0]).toMatchObject({shares:"1",sharePrice:100,usdValue:100});
  });
  it("trade feed uses the same raw-share USD value as history", async () => {
    const pubkey = await pair(68);
    await client.query(`INSERT INTO events(sig,slot,basket,type,data,ts)
      VALUES('feed-test','1',$1,'Minted',$2,$3)`,
      [pubkey,{user:key(221),netShares:"1000000"},latestTs]);
    const payload = (await getFeed(db,{
      scope:"all",type:"trades",viewerWallet:null,
    })).payload as any;
    expect(payload.items[0]).toMatchObject({shares:"1",usdValue:100});
  });
  it("30d view/API uses complete share-price history and upgrades the old derived view once", async () => {
    const pubkey = await pair(67,"200","2000000");
    await snapshot(pubkey,new Date(latestTs.getTime()-30*24*60*60_000),"100","1000000","0.0001");
    await client.query("DROP MATERIALIZED VIEW basket_rankings");
    await client.query(`CREATE MATERIALIZED VIEW basket_rankings AS
      SELECT b.pubkey, b.creator, b.share_mint, 100::numeric AS nav,
      1000000::bigint AS supply, 0.0001::numeric AS share_price,
      1::numeric AS return_30d, 0::bigint AS mint_count, NOW() AS refreshed_at
      FROM baskets b`);
    await applySchema(db);
    const row = (await client.query("SELECT * FROM basket_rankings")).rows[0];
    expect(Number(row.return_30d)).toBe(0);
    const oid = (await client.query("SELECT 'basket_rankings'::regclass::oid AS oid")).rows[0].oid;
    await applySchema(db);
    expect((await client.query("SELECT 'basket_rankings'::regclass::oid AS oid")).rows[0].oid).toBe(oid);
    expect((await ranked("30d")).items[0].returnPct).toBe(0);
    expect(Number((await listed("return_30d")).data[0].return_30d)).toBe(0);
  });
});
