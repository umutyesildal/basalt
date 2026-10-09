import { describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import type { PgLike } from "../src/db/client.js";
import { handleZapIn, handleZapOut, type QuoteResponse } from "../src/api/quotes.js";
import { InMemoryCache } from "../src/workers/navEngine.js";

const key = (byte: number) => new PublicKey(Buffer.alloc(32,byte)).toBase58();
const BASKET = key(41), A = key(42), B = key(43);
const NOW = new Date("2026-10-09T12:00:00Z");
function fixture() {
  const state = {
    nav: {nav:"100.5",supply:"1000000"} as {nav:string;supply:string} | null,
    holdings: [{mint:A,raw_amount:"1000000"},{mint:B,raw_amount:"2000000"}],
    basket: {pubkey:BASKET,share_mint:key(44),constituents:[A,B],weights_bps:[5000,5000],exit_fee_bps:50},
    now: NOW,
  };
  const sql: string[] = [];
  const db = {query:async (statement: string)=>{
    sql.push(statement);
    const rows = statement.includes("FROM baskets WHERE pubkey") ? [state.basket]
      : statement.includes("FROM nav_snapshots") ? (state.nav ? [state.nav] : [])
      : statement.includes("FROM vault_holdings") ? state.holdings : [];
    return {rows,rowCount:rows.length};
  }} as PgLike;
  const fetchImpl = vi.fn(async (input: string | URL | Request)=>{
    const url = new URL(String(input));
    const amount = url.searchParams.get("amount")!;
    return new Response(JSON.stringify({inAmount:amount,outAmount:amount,routePlan:[]}),{status:200});
  }) as unknown as typeof fetch;
  const ctx = {db,cache:new InMemoryCache(),fetchImpl,now:()=>state.now};
  return {state,sql,ctx,fetchImpl};
}
const zapIn = (amountUSDC: string | number = "100") => ({basket:BASKET,amountUSDC,slippageBps:50});
const zapOut = () => ({basket:BASKET,shares:"100000",slippageBps:50});

describe("zap quote cache eligibility", () => {
  it("reuses unchanged zap-out facts after authentication and preserves Jupiter observation time", async () => {
    const f = fixture();
    const first = await handleZapOut(f.ctx,zapOut());
    expect(first.status).toBe(200);
    f.state.now = new Date(NOW.getTime()+1000);
    const second = await handleZapOut(f.ctx,zapOut());
    expect(second.status).toBe(200);
    expect((second.payload as QuoteResponse).provenance).toMatchObject({cached:true,asOf:NOW.toISOString()});
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    expect(f.sql.filter((sql)=>sql.includes("FROM vault_holdings"))).toHaveLength(2);
    expect(f.sql.find((sql)=>sql.includes("FROM vault_holdings"))).toContain("authenticated IS TRUE");
    expect(f.sql.find((sql)=>sql.includes("FROM vault_holdings"))).toContain("interval '5 minutes'");
    expect(f.sql.find((sql)=>sql.includes("FROM nav_snapshots"))).toContain("basket_valuation_state");
  });
  it.each(["invalid-nav","invalid-holdings"])("a cached zap-out cannot bypass %s", async (kind) => {
    const f = fixture();
    expect((await handleZapOut(f.ctx,zapOut())).status).toBe(200);
    if (kind === "invalid-nav") f.state.nav = null;
    else f.state.holdings = [f.state.holdings[0]];
    const rejected = await handleZapOut(f.ctx,zapOut());
    expect(rejected.status).toBe(404);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each(["vault","supply","fee"])("changed %s facts cause a fresh zap-out quote with recomputed entitlement", async (kind) => {
    const f = fixture();
    const first = await handleZapOut(f.ctx,zapOut());
    expect((first.payload as QuoteResponse).redeem?.outs).toEqual(["99500","199000"]);
    let expected: string[];
    if (kind === "vault") { f.state.holdings[0].raw_amount = "1500000"; expected=["149250","199000"]; }
    else if (kind === "supply") { f.state.nav!.supply = "2000000"; expected=["49750","99500"]; }
    else { f.state.basket.exit_fee_bps = 100; expected=["99000","198000"]; }
    const refreshed = await handleZapOut(f.ctx,zapOut());
    expect(refreshed.status).toBe(200);
    const payload = refreshed.payload as QuoteResponse;
    expect(payload.redeem?.outs).toEqual(expected);
    expect(payload.legs.map((leg)=>leg.inAmount)).toEqual(expected);
    expect(payload.provenance.cached).toBeUndefined();
    expect(f.fetchImpl).toHaveBeenCalledTimes(4);
  });
  it("cached zap-in strips an estimate after the current NAV becomes unavailable", async () => {
    const f = fixture();
    const first = await handleZapIn(f.ctx,zapIn());
    expect(first.status).toBe(200);
    expect((first.payload as QuoteResponse).expectedShares).toBe("995024");
    f.state.nav = null;
    f.state.now = new Date(NOW.getTime()+1000);
    const second = await handleZapIn(f.ctx,zapIn());
    expect(second.status).toBe(200);
    expect((second.payload as QuoteResponse).expectedShares).toBeNull();
    expect((second.payload as QuoteResponse).provenance).toMatchObject({cached:true,asOf:NOW.toISOString()});
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("cached zap-in recomputes estimates from a newer eligible NAV without refreshing quote provenance", async () => {
    const f = fixture();
    await handleZapIn(f.ctx,zapIn());
    f.state.nav = {nav:"200",supply:"1000000"};
    f.state.now = new Date(NOW.getTime()+1000);
    const refreshed = await handleZapIn(f.ctx,zapIn());
    expect((refreshed.payload as QuoteResponse).expectedShares).toBe("500000");
    expect((refreshed.payload as QuoteResponse).provenance).toMatchObject({cached:true,asOf:NOW.toISOString()});
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("informational zap-in estimate units", () => {
  it.each([
    {amount:"100",nav:"100",supply:"1000000",expected:"1000000"},
    {amount:"1",nav:"0.5",supply:"1000000",expected:"2000000"},
    {amount:"1.000001",nav:"3.5",supply:"9007199254740993",expected:((1000001n*9007199254740993n)/3500000n).toString()},
  ])("USDC $amount with USD NAV $nav and raw supply $supply estimates $expected raw shares", async ({amount,nav,supply,expected}) => {
    const f = fixture();
    f.state.nav = {nav,supply};
    const out = await handleZapIn(f.ctx,zapIn(amount));
    expect(out.status).toBe(200);
    expect((out.payload as QuoteResponse).expectedShares).toBe(expected);
  });
  it.each(["NaN","0","-1"])("invalid NAV %s leaves only genuine Jupiter legs and no share estimate", async (nav) => {
    const f = fixture();
    f.state.nav = {nav,supply:"1000000"};
    const out = await handleZapIn(f.ctx,zapIn());
    expect(out.status).toBe(200);
    expect((out.payload as QuoteResponse).expectedShares).toBeNull();
  });
});
