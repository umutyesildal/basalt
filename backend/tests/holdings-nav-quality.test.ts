import { describe, expect, it } from "vitest";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { ExtensionType, ScaledUiAmountConfigLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { deriveVaultAuthority, fetchMintFacts, getVaultAtas, syncHoldings, type SolanaRpc } from "../src/indexer/holdingsSync.js";
import { fetchSupplyRawFromRpc, InMemoryCache, NavEngine, type SupplyFetch } from "../src/workers/navEngine.js";
import { navEligibilitySql, NAV_INPUT_MAX_AGE_MS, valuationQuality } from "../src/api/valuation-quality.js";
import { indexedShareReturnPct, returnSnapshot } from "../src/api/basket-returns.js";
import type { PgLike } from "../src/db/client.js";
import type { PriceQuoteMap } from "../src/workers/priceFetch.js";

const NOW = new Date("2026-10-09T12:00:00Z");
const pk = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
const basket = pk(20);
const mint = pk(21);
const ata = getVaultAtas(basket, [mint])[0];
const info = (data: Buffer, owner = TOKEN_2022_PROGRAM_ID): AccountInfo<Buffer> => ({ data, owner, lamports: 1, executable: false });
function mintBytes(multiplier?: number): Buffer {
  const data = Buffer.alloc(multiplier === undefined ? 82 : 166 + 4 + ScaledUiAmountConfigLayout.span);
  data[44] = 8;
  data[45] = 1;
  if (multiplier !== undefined) {
    data[165] = 1;
    data.writeUInt16LE(ExtensionType.ScaledUiAmountConfig, 166);
    data.writeUInt16LE(ScaledUiAmountConfigLayout.span, 168);
    ScaledUiAmountConfigLayout.encode({ authority: PublicKey.default, multiplier, newMultiplier: multiplier, newMultiplierEffectiveTimestamp: 0n }, data, 170);
  }
  return data;
}
function vaultBytes(amount = 123_000_000n): Buffer {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  deriveVaultAuthority(basket).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}
function recordingDb() {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return { calls, query: async (sql: string, values?: unknown[]) => { calls.push({ sql, values }); return { rows: [], rowCount: 1 }; } };
}

describe("authenticated mint and vault observations", () => {
  it("accepts a real initialized plain Token-2022 mint at multiplier one", async () => {
    const rpc: SolanaRpc = { getAccountInfo: async () => info(mintBytes()), getMultipleAccountsInfo: async () => [info(vaultBytes())] };
    expect(await fetchMintFacts(rpc, mint)).toEqual({ decimals: 8, multiplier: 1 });
    const db = recordingDb();
    const [row] = await syncHoldings(rpc, basket, [ata], [mint], { db, now: () => NOW });
    expect(row).toMatchObject({ rawAmount: "123000000", multiplier: 1, decimals: 8, scaledAmount: "1.23", authenticated: true, observedAt: NOW.toISOString() });
    expect(db.calls.find((call) => call.sql.includes("INSERT INTO vault_holdings"))?.values?.[6]).toEqual(NOW);
  });

  it.each(["missing", "rpc-failure", "legacy-owner", "wrong-owner", "short", "uninitialized", "decimals", "tlv-truncated", "invalid-multiplier", "tiny-multiplier", "huge-multiplier", "duplicate-tlv"])(
    "%s mint facts cannot overwrite last-good facts with defaults", async (kind) => {
      let data = mintBytes(2);
      let account: AccountInfo<Buffer> | null = info(data);
      if (kind === "missing") account = null;
      if (kind === "legacy-owner") account = info(data, TOKEN_PROGRAM_ID);
      if (kind === "wrong-owner") account = info(data, PublicKey.default);
      if (kind === "short") account = info(Buffer.alloc(44));
      if (kind === "uninitialized") data[45] = 0;
      if (kind === "decimals") data[44] = 13;
      if (kind === "tlv-truncated") data.writeUInt16LE(1000, 168);
      if (kind === "invalid-multiplier") account = info(mintBytes(0));
      if (kind === "tiny-multiplier") account = info(mintBytes(1e-12));
      if (kind === "huge-multiplier") account = info(mintBytes(1e308));
      if (kind === "duplicate-tlv") account = info(Buffer.concat([data, data.subarray(166)]));
      const rpc: SolanaRpc = { getAccountInfo: async () => { if (kind === "rpc-failure") throw new Error("RPC unavailable"); return account; },
        getMultipleAccountsInfo: async () => [info(vaultBytes())] };
      expect(await fetchMintFacts(rpc, mint)).toBeNull();
      const db = recordingDb();
      expect(await syncHoldings(rpc, basket, [ata], [mint], { db, now: () => NOW })).toEqual([]);
      expect(db.calls).toHaveLength(2);
      expect(db.calls[0].sql).toBe("UPDATE vault_holdings SET authenticated = false WHERE basket = $1 AND mint = ANY($2::text[])");
      expect(db.calls[0].values).toEqual([basket.toBase58(), [mint.toBase58()]]);
      expect(db.calls[0].sql).not.toContain("updated_at");
      expect(db.calls[0].sql).not.toContain("raw_amount");
    },
  );

  it.each(["missing", "rpc-failure", "legacy-owner", "wrong-mint", "wrong-authority", "wrong-ata", "uninitialized", "malformed"])(
    "%s vault cannot be published as a fresh authenticated balance", async (kind) => {
      const data = vaultBytes();
      let account: AccountInfo<Buffer> | null = info(data);
      if (kind === "missing") account = null;
      if (kind === "legacy-owner") account = info(data, TOKEN_PROGRAM_ID);
      if (kind === "wrong-mint") pk(22).toBuffer().copy(data, 0);
      if (kind === "wrong-authority") pk(22).toBuffer().copy(data, 32);
      if (kind === "uninitialized") data[108] = 0;
      if (kind === "malformed") account = info(Buffer.alloc(90));
      const rpc: SolanaRpc = { getAccountInfo: async () => info(mintBytes(2)), getMultipleAccountsInfo: async () => {
        if (kind === "rpc-failure") throw new Error("RPC unavailable"); return [account];
      } };
      const db = recordingDb();
      expect(await syncHoldings(rpc, basket, [kind === "wrong-ata" ? pk(23) : ata], [mint], { db, now: () => NOW })).toEqual([]);
      expect(db.calls).toHaveLength(2);
      expect(db.calls[0].sql).toContain("SET authenticated = false");
    },
  );

  it("a holdings write failure invalidates old authenticated facts without refreshing their values or timestamps", async () => {
    const rpc: SolanaRpc = {getAccountInfo:async()=>info(mintBytes()),getMultipleAccountsInfo:async()=>[info(vaultBytes(18_446_744_073_709_551_615n))]};
    const calls: Array<{sql:string;values?:unknown[]}> = [];
    const db = {query:async(sql:string,values?:unknown[])=>{
      calls.push({sql,values});
      if (sql.includes("INSERT INTO vault_holdings")) throw new Error("bigint out of range");
      return {rows:[],rowCount:1};
    }};
    await expect(syncHoldings(rpc,basket,[ata],[mint],{db,now:()=>NOW})).rejects.toThrow("bigint out of range");
    const invalidation = calls.find((call)=>call.sql.includes("SET authenticated = false"))!;
    expect(invalidation.values).toEqual([basket.toBase58(),[mint.toBase58()]]);
    expect(invalidation.sql).not.toContain("updated_at");
    expect(invalidation.sql).not.toContain("raw_amount");
    expect(calls.find((call)=>call.sql.includes("INSERT INTO basket_valuation_state"))?.values?.[2]).toBe("holdings-persist-failed");
  });
  it("preserves a verified actual zero vault balance as an authenticated fact", async () => {
    const rpc: SolanaRpc = { getAccountInfo: async () => info(mintBytes()), getMultipleAccountsInfo: async () => [info(vaultBytes(0n))] };
    const [row] = await syncHoldings(rpc, basket, [ata], [mint]);
    expect(row.rawAmount).toBe("0");
    expect(row.authenticated).toBe(true);
  });
});

describe("authenticated raw share supply", () => {
  const shareMint = pk(24);
  function supplyInfo(): AccountInfo<Buffer> {
    const data = mintBytes();
    data.writeUInt32LE(1, 0);
    deriveVaultAuthority(basket).toBuffer().copy(data, 4);
    data.writeBigUInt64LE(18_446_744_073_709_551_615n, 36);
    data[44] = 6;
    return info(data);
  }
  it("reads the u64 supply from the authenticated Token-2022 mint without a Number round-trip", async () => {
    const commitments: unknown[] = [];
    expect(await fetchSupplyRawFromRpc({ getAccountInfo: async (_mint, commitment) => { commitments.push(commitment); return supplyInfo(); } }, shareMint.toBase58(), basket.toBase58()))
      .toEqual({ supply: "18446744073709551615", source: "rpc", authenticated: true });
    expect(commitments).toEqual(["finalized"]);
  });
  it.each(["wrong-owner", "wrong-authority", "wrong-decimals", "uninitialized", "missing"])("rejects %s share mint", async (kind) => {
    const account = supplyInfo();
    if (kind === "wrong-owner") account.owner = TOKEN_PROGRAM_ID;
    if (kind === "wrong-authority") pk(25).toBuffer().copy(account.data, 4);
    if (kind === "wrong-decimals") account.data[44] = 8;
    if (kind === "uninitialized") account.data[45] = 0;
    expect(await fetchSupplyRawFromRpc({ getAccountInfo: async () => kind === "missing" ? null : account }, shareMint.toBase58(), basket.toBase58())).toBeNull();
  });
});

const basketRow = { pubkey: "basket", share_mint: "share", constituents: ["mint-a", "mint-b"], weights_bps: [5000, 5000] };
type Holding = { mint: string; scaled_amount: string; authenticated: boolean; updated_at: Date };
const holdings = (): Holding[] => [{ mint: "mint-a", scaled_amount: "2", authenticated: true, updated_at: NOW }, { mint: "mint-b", scaled_amount: "3", authenticated: true, updated_at: NOW }];
const quotes = (): PriceQuoteMap => Object.fromEntries(basketRow.constituents.map((mint, i) => [mint, { mint, price: i === 0 ? 20 : 30, source: "jupiter", unit: "scaled-ui", asOf: NOW.toISOString() }]));
function navDb(rows: Holding[]) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return { calls, query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rows: sql.includes("FROM baskets") ? [basketRow] : sql.includes("FROM vault_holdings") ? rows : [], rowCount: 1 };
  } } as unknown as PgLike & { calls: Array<{ sql: string; values?: unknown[] }> };
}

describe("complete, current, exact-mint NAV", () => {
  it("orders authenticated rows by constituents and persists explicit eligibility plus provenance", async () => {
    const db = navDb(holdings().reverse());
    const engine = new NavEngine({ db, fetchQuotes: async () => quotes(), fetchSupply: async () => ({ supply: "1000000", source: "rpc", authenticated: true }), now: () => NOW });
    const summary = await engine.runOnce();
    expect(summary.snapshotsPersisted).toBe(1);
    expect(summary.computations[0]).toMatchObject({ nav: "130", sharePrice: "0.00013", driftBps: [-1000, 1000], quality: { eligible: true, complete: true, authenticatedHoldings: 2, validQuotes: 2, supplyAuthenticated: true } });
    const insert = db.calls.find((call) => call.sql.includes("INSERT INTO nav_snapshots"))!;
    expect(insert.sql).toContain("valuation_eligible, valuation_status");
    expect(JSON.parse(insert.values![5] as string).__valuation.supplyAuthenticated).toBe(true);
  });

  it.each(["missing", "unauthenticated", "stale", "future", "negative", "malformed", "duplicate", "extra"])(
    "%s holdings prevent persistence and leave last-good cache untouched", async (kind) => {
      const rows = holdings();
      if (kind === "missing") rows.pop();
      if (kind === "unauthenticated") rows[1].authenticated = false;
      if (kind === "stale") rows[1].updated_at = new Date(NOW.getTime() - NAV_INPUT_MAX_AGE_MS - 1);
      if (kind === "future") rows[1].updated_at = new Date(NOW.getTime() + 1);
      if (kind === "negative") rows[1].scaled_amount = "-1";
      if (kind === "malformed") rows[1].scaled_amount = "NaN";
      if (kind === "duplicate") rows.push(rows[0]);
      if (kind === "extra") rows.push({ ...rows[0], mint: "other" });
      const db = navDb(rows);
      const cache = new InMemoryCache();
      await cache.set("nav:basket", "last-good", 60);
      const engine = new NavEngine({ db, cache, fetchQuotes: async () => quotes(), fetchSupply: async () => ({ supply: "1000000", source: "rpc", authenticated: true }), now: () => NOW });
      const summary = await engine.runOnce();
      expect(summary.snapshotsPersisted).toBe(0);
      expect(summary.cacheWrites).toBe(0);
      expect(summary.computations[0].quality.eligible).toBe(false);
      expect(await cache.get("nav:basket")).toBe("last-good");
    },
  );

  it.each(["missing", "wrong-mint", "yahoo", "mock", "wrong-unit", "zero", "negative", "nan", "stale", "future"])(
    "%s quote cannot become a fresh partial snapshot", async (kind) => {
      const map = quotes();
      const quote = map["mint-b"];
      if (kind === "missing") delete map["mint-b"];
      if (kind === "wrong-mint") quote.mint = "mint-a";
      if (kind === "yahoo" || kind === "mock") quote.source = kind;
      if (kind === "wrong-unit") delete quote.unit;
      if (kind === "zero") quote.price = 0;
      if (kind === "negative") quote.price = -1;
      if (kind === "nan") quote.price = NaN;
      if (kind === "stale") quote.asOf = new Date(NOW.getTime() - NAV_INPUT_MAX_AGE_MS - 1).toISOString();
      if (kind === "future") quote.asOf = new Date(NOW.getTime() + 1).toISOString();
      const engine = new NavEngine({ db: navDb(holdings()), fetchQuotes: async () => map, fetchSupply: async () => ({ supply: "1000000", source: "rpc", authenticated: true }), now: () => NOW });
      const summary = await engine.runOnce();
      expect(summary.snapshotsPersisted).toBe(0);
      expect(summary.computations[0].skipReason).toBe("incomplete-prices");
      expect(summary.computations[0].quality.invalidQuotes).toEqual(["mint-b"]);
    },
  );

  it.each([null, { supply: "1000000", source: "events-derived" }, { supply: "1000000", source: "rpc" }, { supply: "0", source: "rpc", authenticated: true }, { supply: "18446744073709551616", source: "rpc", authenticated: true }] as Array<SupplyFetch | null>)(
    "rejects unauthenticated or invalid supply %j", async (supply) => {
      const engine = new NavEngine({ db: navDb(holdings()), fetchQuotes: async () => quotes(), fetchSupply: async () => supply, now: () => NOW });
      const summary = await engine.runOnce();
      expect(summary.snapshotsPersisted).toBe(0);
      expect(summary.computations[0].skipReason).toBe("unauthenticated-supply");
    },
  );

  it("accepts newly fetched quote timestamps after the pass begins, then rechecks input age after supply", async () => {
    let now = NOW.getTime();
    const engine = new NavEngine({ db: navDb(holdings()), now: () => new Date(now),
      fetchQuotes: async () => { now += 100; const map = quotes(); for (const quote of Object.values(map)) quote.asOf = new Date(now).toISOString(); return map; },
      fetchSupply: async () => ({ supply: "1000000", source: "rpc", authenticated: true }) });
    const valid = await engine.runOnce();
    expect(valid.snapshotsPersisted).toBe(1);
    expect(valid.computations[0].asOf).toBe(new Date(NOW.getTime() + 100).toISOString());
    const expired = new NavEngine({ db: navDb(holdings()), now: () => new Date(now), fetchQuotes: async () => quotes(),
      fetchSupply: async () => { now += NAV_INPUT_MAX_AGE_MS + 1; return { supply: "1000000", source: "rpc", authenticated: true }; } });
    expect((await expired.runOnce()).computations[0].skipReason).toBe("inputs-expired-during-read");
  });
});

describe("snapshot eligibility and historical quarantine", () => {
  it("retains last-good timestamps while exposing stale eligibility", () => {
    const old = new Date(NOW.getTime() - 16 * 60_000);
    expect(valuationQuality({ ts: old, valuation_eligible: true, valuation_status: "complete" }, NOW))
      .toEqual({ eligible: false, complete: true, stale: true, status: "stale", asOf: old.toISOString() });
    expect(valuationQuality({ ts: NOW }, NOW)).toMatchObject({ eligible: false, complete: false, stale: true, status: "legacy-unverified" });
  });
  it("labels a timestamp-mismatched current state as ineligible even if the state row says complete", () => {
    expect(valuationQuality({ts:NOW,valuation_eligible:true,valuation_status:"complete",current_status:"complete",current_eligible:false,current_reason:null},NOW))
      .toEqual({eligible:false,complete:false,stale:true,status:"current-ineligible",asOf:NOW.toISOString()});
  });
  it("never upgrades missing/legacy/partial provenance merely because the timestamp is recent", () => {
    const snapshot = { nav: "100", supply: "1000000", share_price: "0.0001", ts: NOW };
    const cur = returnSnapshot({ ...snapshot, valuation_eligible: true, valuation_status: "complete" }, "");
    for (const fields of [{}, { valuation_eligible: false, valuation_status: "legacy-unverified" }, { valuation_eligible: true, valuation_status: "partial" }]) {
      const base = returnSnapshot({ ...snapshot, ts: new Date(NOW.getTime() - 86_400_000), ...fields }, "");
      expect(indexedShareReturnPct(cur, base, NOW, 86_400_000)).toBeNull();
    }
    expect(navEligibilitySql("cur")).toBe("cur.valuation_eligible IS TRUE AND cur.valuation_status = 'complete'");
    expect(() => navEligibilitySql("cur; DROP TABLE baskets")).toThrow("Invalid valuation SQL alias");
  });
});
