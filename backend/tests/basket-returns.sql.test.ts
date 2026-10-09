import {PROGRAM_NAMESPACES,registeredProgramIds} from "../src/config/programNamespaces";
/**
 * Real SQL regressions, opt-in only against an explicitly supplied disposable
 * database. Never fall back to DATABASE_URL. Each run owns a unique schema.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { PublicKey } from "@solana/web3.js";
import { applySchema } from "../src/db/init";
import type { PgLike } from "../src/db/client";
import { basketDetail, basketPerformance, listBaskets, navHistory, userPortfolio, userPositionsByWallet, creatorDetail } from "../src/api/server";
import { getBasketLeaderboard, getFeed, getUserHistory, getLeaderboard } from "../src/api/social";
import { USER_SNAPSHOT_SQL } from "../src/workers/userSnapshot";
import { recordValuationAttempt } from "../src/api/valuation-quality";
import { NavEngine } from "../src/workers/navEngine";

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
    db = { query: (sql: string, values?: unknown[]) => client.query(sql, values) } as PgLike;
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
    // Recreate only this test-owned schema; immutable recovery backups stay guarded.
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${schema}"`);
    expect(await applySchema(db)).toBe(true);
    for(const program of registeredProgramIds())await client.query("INSERT INTO indexer_program_state(program_id,history_complete,finalized_through_slot) VALUES($1,true,200)",[program]);
  });

  async function basket(id: number) {
    const pubkey = key(id);
    await client.query(`INSERT INTO baskets(
      pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,
      metadata_json,num_constituents,constituents,weights_bps,
      entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
      VALUES($1,$2,$3,$4,$5,$6,$7,'test',$8,2,$9,$10,0,0,0,$7)`,
      [pubkey,PROGRAM_NAMESPACES[0].factoryConfig,key(221),key(222),key(id + 100),String(id),now,
        {name: `Basket ${id}`,symbol:`B${id}`},[key(223),key(224)],[5000,5000]]);
    return pubkey;
  }
  async function snapshot(pubkey: string, ts: Date, nav: string, supply: string, price: string) {
    await client.query(`INSERT INTO nav_snapshots(basket,ts,nav,supply,share_price,price_source,valuation_eligible,valuation_status)
      VALUES($1,$2,$3,$4,$5,'{}',true,'complete')`, [pubkey,ts,nav,supply,price]);
    await client.query(`INSERT INTO basket_valuation_state(basket,status,reason,attempted_at,last_complete_at)
      VALUES($1,'complete',NULL,NOW(),$2)
      ON CONFLICT(basket) DO UPDATE SET status='complete',reason=NULL,attempted_at=NOW(),
        last_complete_at=GREATEST(basket_valuation_state.last_complete_at,EXCLUDED.last_complete_at)`,[pubkey,ts]);
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
  async function eligibleWallet(id = 74) {
    const pubkey = await pair(id,"200","1000000","0.0002");
    const wallet = key(218);
    await client.query(`INSERT INTO user_positions("user",basket,share_balance,cost_basis)
      VALUES($1,$2,1000000,100)`, [wallet,pubkey]);
    await client.query(`INSERT INTO events(sig,slot,basket,type,data,ts,log_index)
      VALUES('eligible-wallet-mint-1',1,$1,'Minted',$2,$3,0),
            ('eligible-wallet-mint-2',2,$1,'Minted',$2,$4,0)`,
      [pubkey,{user:wallet,netShares:"500000"},new Date(now.getTime()-WEEK-60_000),new Date(now.getTime()-WEEK)]);
    return {wallet,pubkey};
  }
  async function walletSnapshot(wallet: string, ts: Date, value: string, eligible = true, status = "complete") {
    await client.query(`INSERT INTO user_value_snapshots(wallet,ts,value_usd,cost_basis,valuation_eligible,valuation_status)
      VALUES($1,$2,$3,100,$4,$5)`,[wallet,ts,value,eligible,status]);
  }
  const walletRanked = async (window = "7d") => (await getLeaderboard(db,window)).payload as any;
  const ranked = async (window = "7d") => (await getBasketLeaderboard(db, window)).payload as any;
  const listed = async (sort = "return_7d") => (await listBaskets(db, {sort})).payload as any;
  const performance = async (pubkey: string) => (await basketPerformance(db, pubkey)).payload as any;

  it("counts only positive holdings and sorts baskets correctly when recovery retains zero rows",async()=>{
    const one=await pair(1),two=await pair(2),none=await pair(3);
    for(const pubkey of [one,two,none]) await snapshot(pubkey,new Date(latestTs.getTime()-30*24*60*60_000),"100","1000000","0.0001");
    await client.query(`INSERT INTO user_positions("user",basket,share_balance) VALUES
      ($1,$4,10),($2,$4,0),($3,$4,0),($1,$5,10),($2,$5,20),($1,$6,0)`,[key(210),key(211),key(212),one,two,none]);
    const rows=(await listed("holders")).data;
    expect(rows.map((row:any)=>({basket:row.pubkey,holders:row.holders}))).toEqual([{basket:two,holders:2},{basket:one,holders:1},{basket:none,holders:0}]);
    for(const window of ["7d","30d","all"]) {
      const holders=new Map((await ranked(window)).items.map((row:any)=>[row.basket,row.holders]));
      expect(holders).toEqual(new Map([[one,1],[two,2],[none,0]]));
    }
    expect((await client.query("SELECT COUNT(*)::int AS n FROM user_positions WHERE share_balance=0")).rows[0].n).toBe(3);
  });
  it("returns live wallet positions while preserving zeroed recovery evidence in storage",async()=>{
    const closed=await pair(1),live=await pair(2),wallet=key(210),emptyWallet=key(211);
    await client.query(`INSERT INTO user_positions("user",basket,share_balance) VALUES($1,$3,0),($1,$4,100),($2,$3,0)`,[wallet,emptyWallet,closed,live]);
    expect((await userPortfolio(db,wallet)).payload).toMatchObject({count:1,data:[{basket:live,share_balance:"100"}]});
    expect((await userPositionsByWallet(db,wallet)).payload).toMatchObject({count:1,data:[{basket:live,shareBalance:"100"}]});
    expect((await userPortfolio(db,emptyWallet)).payload).toMatchObject({count:0,data:[]});
    expect((await userPositionsByWallet(db,emptyWallet)).payload).toMatchObject({count:0,data:[]});
    expect((await client.query("SELECT COUNT(*)::int AS n FROM user_positions WHERE share_balance=0")).rows[0].n).toBe(2);
  });
  it("deposit doubles NAV/supply while all API 7d returns stay zero", async () => {
    const pubkey = await pair(1, "200", "2000000");
    expect(Number((await listed()).data[0].return_7d)).toBe(0);
    expect((await ranked()).items[0].returnPct).toBe(0);
    const data = (await performance(pubkey)).data;
    expect(data.windows["7d"].pct).toBe("0");
    expect(data.latest).toMatchObject({nav:"200",supply:"2000000",sharePrice:"0.0001",ts:latestTs.toISOString(),valuationEligible:true});
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
    await client.query(`INSERT INTO events(sig,slot,basket,type,data,ts,log_index)
      VALUES('mint-test','1',$1,'Minted',$2,$3,0)`,
      [pubkey,{user:key(221),netShares:"1000000"},latestTs]);
    const payload = (await getUserHistory(db,key(221),{})).payload as any;
    expect(payload.items[0]).toMatchObject({shares:"1",sharePrice:100,usdValue:100});
  });
  it("trade feed uses the same raw-share USD value as history", async () => {
    const pubkey = await pair(68);
    await client.query(`INSERT INTO events(sig,slot,basket,type,data,ts,log_index)
      VALUES('feed-test','1',$1,'Minted',$2,$3,0)`,
      [pubkey,{user:key(221),netShares:"1000000"},latestTs]);
    const payload = (await getFeed(db,{
      scope:"all",type:"trades",viewerWallet:null,
    })).payload as any;
    expect(payload.items[0]).toMatchObject({shares:"1",usdValue:100});
  });
  it("quarantines legacy/partial NAV rows in place without changing the last-good timestamp", async () => {
    const pubkey = await pair(69);
    await client.query(`INSERT INTO nav_snapshots(basket,ts,nav,supply,share_price,price_source)
      VALUES($1,$2,999999,1000000,0.999999,'{}')`, [pubkey, now]);
    await client.query("REFRESH MATERIALIZED VIEW basket_rankings");
    const rawRows = (await client.query("SELECT valuation_eligible FROM nav_snapshots WHERE basket=$1", [pubkey])).rows;
    expect(rawRows).toHaveLength(3);
    expect(rawRows.filter((row) => row.valuation_eligible === false)).toHaveLength(1);
    expect((await performance(pubkey)).data.latest.ts).toBe(latestTs.toISOString());
    expect((await listed()).data[0].nav).toBe("100");
    expect((await ranked()).items[0].returnPct).toBe(0);
    expect((await navHistory(db,pubkey,{})).payload).toMatchObject({count:2});
    await client.query("UPDATE nav_snapshots SET valuation_status='partial' WHERE basket=$1 AND ts<$2", [pubkey,latestTs]);
    await client.query("REFRESH MATERIALIZED VIEW basket_rankings");
    expect((await performance(pubkey)).data.windows["7d"].pct).toBeNull();
    expect((await ranked()).items).toEqual([]);
    const latest = (await client.query("SELECT * FROM basket_latest_nav WHERE basket=$1", [pubkey])).rows[0];
    expect(latest.ts.toISOString()).toBe(latestTs.toISOString());
  });
  it("a failed current valuation disqualifies returns while retaining immutable last-good NAV", async () => {
    const pubkey = await pair(72);
    const failureTime = new Date((await client.query("SELECT clock_timestamp() AS ts")).rows[0].ts.getTime()+1000);
    expect(await recordValuationAttempt(db,pubkey,{complete:false,reason:"incomplete-prices",attemptedAt:failureTime.toISOString()})).toBe(true);
    await client.query("REFRESH MATERIALIZED VIEW basket_rankings");
    expect((await performance(pubkey)).data.windows["7d"].pct).toBeNull();
    expect((await listed()).data[0]).toMatchObject({nav:"100",return_7d:null});
    expect((await ranked()).items).toEqual([]);
    const history = (await client.query("SELECT * FROM nav_snapshots WHERE basket=$1 ORDER BY ts DESC",[pubkey])).rows;
    expect(history).toHaveLength(2);
    expect(history.every((row) => row.valuation_eligible === true)).toBe(true);
    expect(history[0].ts.toISOString()).toBe(latestTs.toISOString());
    // An older successful attempt cannot erase a more recent known failure.
    expect(await recordValuationAttempt(db,pubkey,{complete:true,reason:null,attemptedAt:latestTs.toISOString()})).toBe(false);
    expect((await client.query("SELECT * FROM basket_valuation_state WHERE basket=$1",[pubkey])).rows[0])
      .toMatchObject({status:"incomplete",reason:"incomplete-prices",last_complete_at:latestTs});
  });
  it("rejects a NAV insert when the holdings authentication changes during valuation", async () => {
    const pubkey = await basket(73);
    const mints = [key(223),key(224)];
    for (const mint of mints) {
      await client.query(`INSERT INTO whitelisted_mints(mint,decimals,status,multiplier) VALUES($1,6,'Active',1)`,[mint]);
      await client.query(`INSERT INTO vault_holdings(basket,mint,raw_amount,multiplier,scaled_amount,decimals,updated_at,authenticated)
        VALUES($1,$2,1000000,1,1,6,$3,true)`,[pubkey,mint,latestTs]);
    }
    let changed = false;
    const racingDb = { query: async (sql: string, values?: unknown[]) => {
      const result = await client.query(sql,values);
      if (!changed && sql.includes("FROM vault_holdings WHERE basket")) {
        changed = true;
        await client.query("UPDATE vault_holdings SET authenticated=false WHERE basket=$1 AND mint=$2",[pubkey,mints[1]]);
      }
      return result;
    } } as PgLike;
    const engine = new NavEngine({ db:racingDb, now:()=>now,
      fetchQuotes:async()=>Object.fromEntries(mints.map((mint)=>[mint,{mint,price:100,source:"jupiter" as const,unit:"scaled-ui" as const,asOf:now.toISOString()}])),
      fetchSupply:async()=>({supply:"1000000",source:"rpc",authenticated:true}) });
    const summary = await engine.runOnce();
    expect(summary.snapshotsPersisted).toBe(0);
    expect(summary.computations[0].skipReason).toBe("snapshot-persist-failed");
    expect((await client.query("SELECT * FROM nav_snapshots WHERE basket=$1",[pubkey])).rows).toEqual([]);
    expect((await client.query("SELECT * FROM basket_valuation_state WHERE basket=$1",[pubkey])).rows[0].status).toBe("incomplete");
  });
  it("wallet snapshots require an eligible fresh valuation for every positive position", async () => {
    const first = await pair(70);
    const second = await basket(71);
    const wallet = key(219);
    await client.query(`INSERT INTO user_positions("user",basket,share_balance,cost_basis)
      VALUES($1,$2,1000000,100),($1,$3,1000000,100)`, [wallet,first,second]);
    expect((await client.query(USER_SNAPSHOT_SQL)).rowCount).toBe(0);
    expect((await client.query("SELECT * FROM user_value_snapshots WHERE wallet=$1",[wallet])).rows).toEqual([]);
    await client.query(`INSERT INTO nav_snapshots(basket,ts,nav,supply,share_price,price_source)
      VALUES($1,$2,100,1000000,0.0001,'{}')`,[second,latestTs]);
    expect((await client.query(USER_SNAPSHOT_SQL)).rowCount).toBe(0);
    await snapshot(second,latestTs,"100","1000000","0.0001");
    expect((await client.query(USER_SNAPSHOT_SQL)).rowCount).toBe(1);
    expect((await client.query("SELECT * FROM user_value_snapshots WHERE wallet=$1",[wallet])).rows[0])
      .toMatchObject({value_usd:"200.0000",valuation_eligible:true,valuation_status:"complete"});
  });
  it.each(["7d","30d"])("wallet %s ROI uses a complete baseline at the requested window", async (window) => {
    const {wallet} = await eligibleWallet();
    const days = window === "7d" ? 7 : 30;
    await walletSnapshot(wallet,new Date(latestTs.getTime()-days*24*60*60_000),"100");
    await walletSnapshot(wallet,latestTs,"200");
    expect((await walletRanked(window)).items).toMatchObject([{wallet,roiPct:100,valueUsd:200,costBasisUsd:100,positionCount:1}]);
  });
  it.each(["missing-baseline","short-window","old-baseline","stale-current","future-current","legacy-baseline","partial-baseline"])(
    "wallet 7d ROI is unavailable for %s snapshots", async (kind) => {
      const {wallet} = await eligibleWallet();
      let current = latestTs;
      if (kind === "stale-current") current = new Date(now.getTime()-16*60_000);
      if (kind === "future-current") current = new Date(now.getTime()+60_000);
      let baseline = new Date(current.getTime()-WEEK);
      if (kind === "short-window") baseline = new Date(baseline.getTime()+1);
      if (kind === "old-baseline") baseline = new Date(baseline.getTime()-60*60_000-1);
      if (kind !== "missing-baseline") await walletSnapshot(wallet,baseline,"100",kind !== "legacy-baseline",kind === "partial-baseline" ? "partial" : "complete");
      await walletSnapshot(wallet,current,"200");
      expect((await walletRanked()).items).toEqual([]);
    },
  );
  it.each(["missing-position-nav","rebuild-pending","failed-current","unknown-current","mismatched-current"])(
    "wallet ROI and fresh snapshots exclude %s projections", async (kind) => {
      const {wallet,pubkey} = await eligibleWallet();
      await walletSnapshot(wallet,new Date(latestTs.getTime()-WEEK),"100");
      await walletSnapshot(wallet,latestTs,"200");
      if (kind === "missing-position-nav") {
        const missing = await basket(75);
        await client.query(`INSERT INTO user_positions("user",basket,share_balance,cost_basis) VALUES($1,$2,1000000,100)`,[wallet,missing]);
      }
      if (kind === "rebuild-pending") await client.query("INSERT INTO position_rebuild_required(basket,reason) VALUES($1,'test-unverified-ledger')",[pubkey]);
      if (kind === "failed-current") await client.query("UPDATE basket_valuation_state SET status='incomplete',reason='incomplete-prices' WHERE basket=$1",[pubkey]);
      if (kind === "unknown-current") await client.query("DELETE FROM basket_valuation_state WHERE basket=$1",[pubkey]);
      if (kind === "mismatched-current") await client.query("UPDATE basket_valuation_state SET last_complete_at=last_complete_at-interval '1 second' WHERE basket=$1",[pubkey]);
      expect((await walletRanked()).items).toEqual([]);
      expect((await walletRanked("all")).items).toEqual([]);
      expect((await client.query(USER_SNAPSHOT_SQL)).rowCount).toBe(0);
      if (kind === "failed-current") {
        const portfolio = (await userPortfolio(db,wallet)).payload as any;
        expect(portfolio.data[0]).toMatchObject({estimatedValue:"200",quality:{eligible:false,complete:false,stale:true,status:"incomplete-prices",asOf:latestTs.toISOString()}});
      }
    },
  );
  it.each(["complete-first","incomplete-first"])("incomplete current state wins equal-millisecond attempts: %s", async (order) => {
    const pubkey = await basket(76);
    const attemptedAt = now.toISOString();
    const success = {complete:true,reason:null,attemptedAt};
    const failure = {complete:false,reason:"incomplete-prices",attemptedAt};
    expect(await recordValuationAttempt(db,pubkey,order === "complete-first" ? success : failure)).toBe(true);
    expect(await recordValuationAttempt(db,pubkey,order === "complete-first" ? failure : success)).toBe(order === "complete-first");
    expect((await client.query("SELECT status,reason FROM basket_valuation_state WHERE basket=$1",[pubkey])).rows[0])
      .toEqual({status:"incomplete",reason:"incomplete-prices"});
    // A strictly newer complete observation can restore eligibility.
    expect(await recordValuationAttempt(db,pubkey,{...success,attemptedAt:new Date(now.getTime()+1).toISOString()})).toBe(true);
  });
  it("creator detail uses actual complete NAV time, not materialized-view refresh time", async () => {
    const pubkey = await pair(77);
    await client.query(`INSERT INTO nav_snapshots(basket,ts,nav,supply,share_price,price_source)
      VALUES($1,$2,999999,1000000,0.999999,'{}')`,[pubkey,now]);
    await client.query("REFRESH MATERIALIZED VIEW basket_rankings");
    const detail = (await creatorDetail(db,key(221))).payload as any;
    expect(detail.data.asOf).toBe(latestTs.toISOString());
    expect(detail.data.baskets[0]).toMatchObject({nav:"100",asOf:latestTs.toISOString(),quality:{eligible:true,complete:true,stale:false,status:"complete"}});
  });
  it("creator detail preserves last-good NAV with failed-current quality and marks aggregate AUM unverified", async () => {
    const pubkey = await pair(78);
    await client.query(`INSERT INTO creator_stats(creator,basket_count,total_aum,total_fees_earned,updated_at)
      VALUES($1,1,100,1,$2)`,[key(221),now]);
    await client.query("UPDATE basket_valuation_state SET status='incomplete',reason='incomplete-prices' WHERE basket=$1",[pubkey]);
    await client.query("REFRESH MATERIALIZED VIEW basket_rankings");
    const detail = (await creatorDetail(db,key(221))).payload as any;
    expect(detail.data.asOf).toBe(latestTs.toISOString());
    expect(detail.data.baskets[0]).toMatchObject({nav:"100",asOf:latestTs.toISOString(),quality:{eligible:false,complete:false,stale:true,status:"incomplete-prices"}});
    expect(detail.data.stats).toMatchObject({total_aum:"100",asOf:now.toISOString(),quality:{eligible:false,complete:false,stale:true,status:"aggregate-unverified"}});
  });
  it("creator baskets with only legacy NAV remain visible with unknown valuation time and ineligible quality", async () => {
    const pubkey = await basket(79);
    await client.query(`INSERT INTO nav_snapshots(basket,ts,nav,supply,share_price,price_source)
      VALUES($1,$2,100,1000000,0.0001,'{}')`,[pubkey,latestTs]);
    const detail = (await creatorDetail(db,key(221))).payload as any;
    expect(detail.data.asOf).toBeNull();
    expect(detail.data.baskets[0]).toMatchObject({pubkey,nav:null,asOf:null,quality:{eligible:false,complete:false,stale:true}});
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
  it("keeps an unpriced indexed basket visible before rankings refresh and explains missing prices",async()=>{
    const pubkey=await basket(170);
    await recordValuationAttempt(db,pubkey,{complete:false,reason:'no-prices',attemptedAt:new Date().toISOString(),missingPriceMints:[key(172)]});
    const result=(await listBaskets(db,{})).payload as any;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({pubkey,nav:null,share_price:null,return_7d:null,holders:0,dataQuality:{status:'unavailable',valuation:{eligible:false,reason:'no-prices',missingPriceMints:[key(172)]}}});
    expect(((await listBaskets(db,{minAUM:'1'})).payload as any).data).toEqual([]);
    const detail=(await basketDetail(db,pubkey)).payload as any;
    expect(detail.data.nav).toBeNull();
    expect(detail.data.dataQuality.valuation).toMatchObject({eligible:false,reason:'no-prices',missingPriceMints:[key(172)]});
  });
  it("does not present retained holder counts as verified during recovery",async()=>{
    const pubkey=await basket(171),wallet=key(175);
    await client.query('INSERT INTO user_positions("user",basket,share_balance) VALUES($1,$2,100)',[wallet,pubkey]);
    await client.query("INSERT INTO position_rebuild_required(basket,reason) VALUES($1,'legacy')",[pubkey]);
    const row=((await listBaskets(db,{})).payload as any).data[0];
    expect(row.holders).toBeNull();expect(row.dataQuality.recovery.required).toBe(true);
  });

});
