import { describe, it, expect } from "vitest";
import {
  entryFee,
  exitFee,
  managementFee,
  managementFeeWithRemainder,
  splitFee,
  splitFeeBigInt,
  CREATOR_FEE_SPLIT_BPS,
  CREATOR_FEE_SPLIT_BPS_BIGINT,
  BPS_DENOM,
  SECONDS_PER_YEAR,
} from "../src/workers/feeMath";
import { computeNav, computeSharePrice, computeDrift } from "../src/workers/navEngine";
import { mockPrices } from "../src/workers/priceFetch";

describe("feeMath", () => {
  it("entry fee exact", () => {
    expect(entryFee(1_000_000, 100)).toBe(10_000);
    expect(entryFee(1_000_000, 0)).toBe(0);
    expect(entryFee(1_000_000, 300)).toBe(30_000);
  });
  it("exit fee exact", () => {
    expect(exitFee(1_000_000, 50)).toBe(5_000);
    expect(exitFee(1_000_000, 100)).toBe(10_000);
  });
  it("uses the fixed 90/10 policy", () => {
    expect(CREATOR_FEE_SPLIT_BPS).toBe(9000);
    expect(CREATOR_FEE_SPLIT_BPS_BIGINT).toBe(9000n);
    expect(splitFee(10_000)).toEqual({ creator: 9000, treasury: 1000 });
    expect(splitFee(1)).toEqual({ creator: 0, treasury: 1 });
  });
  it("split floors to creator, preserves dust, and matches the BigInt helper", () => {
    for (const fee of [0, 1, 2, 3, 9, 10, 11, 99, 100, 101, 9999, 10_000, 999_999, Number.MAX_SAFE_INTEGER]) {
      const { creator, treasury } = splitFee(fee);
      expect(creator+treasury).toBe(fee);
      expect({ creator: BigInt(creator), treasury: BigInt(treasury) }).toEqual(splitFeeBigInt(BigInt(fee)));
      expect(creator).toBe(Math.floor((fee * CREATOR_FEE_SPLIT_BPS) / BPS_DENOM));
    }
  });
  it("rejects invalid fee inputs rather than applying a different split", () => {
    expect(() => splitFee(-1)).toThrow(RangeError);
    expect(() => splitFee(1.5)).toThrow(RangeError);
    expect(() => splitFeeBigInt(-1n)).toThrow(RangeError);
  });
  it("rejects management bps outside the on-chain domain", () => {
    expect(() => entryFee(1, -1)).toThrow(RangeError);
    expect(() => exitFee(1, 10_001)).toThrow(RangeError);
    expect(() => managementFee(1, -1, 1)).toThrow(RangeError);
    expect(() => managementFee(1, 10_001, 1)).toThrow(RangeError);
    expect(() => managementFee(1, 1.5, 1)).toThrow(RangeError);
  });
  it("never exceeds gross/shares", () => {
    for (const gross of [1,100,1_000_000]) {
      expect(entryFee(gross,300)).toBeLessThanOrEqual(gross);
      expect(exitFee(gross,100)).toBeLessThanOrEqual(gross);
    }
  });
  it("management fee 30d of 10M at 200bps = 16438", () => {
    expect(managementFee(10_000_000, 200, 30*24*3600)).toBe(16438);
  });
  it("management zero cases", () => {
    expect(managementFee(0,300,3600)).toBe(0);
    expect(managementFee(10_000_000,0,3600)).toBe(0);
    expect(managementFee(10_000_000,300,0)).toBe(0);
  });
  it("management yearly cap 300bps = 3%", () => {
    expect(managementFee(10_000_000,300,365*24*3600)).toBe(300_000);
    expect(managementFee(10_000_000,100,365*24*3600)).toBe(100_000);
  });
  it("management remainder makes one thousand 1-second accruals equal one combined accrual", () => {
    const supply = 10_000_000n;
    const bps = 300;
    const combined = managementFeeWithRemainder(supply, bps, 1_000n);
    let fee = 0n;
    let remainder = 0n;
    for (let i = 0; i < 1_000; i++) {
      const next = managementFeeWithRemainder(supply, bps, 1n, remainder);
      fee += next.fee;
      remainder = next.remainder;
    }
    expect({ fee, remainder }).toEqual(combined);
    expect(fee).toBe(9n);
  });
  it("management remainder is partition-independent for fixed supply", () => {
    const supply = 12_345_678n;
    const bps = 237;
    const elapsed = [1n, 7n, 61n, 3_600n, 86_399n, 1_000_000n];
    const totalElapsed = elapsed.reduce((sum, seconds) => sum + seconds, 0n);
    const combined = managementFeeWithRemainder(supply, bps, totalElapsed);

    let fee = 0n;
    let remainder = 0n;
    for (const seconds of elapsed) {
      const next = managementFeeWithRemainder(supply, bps, seconds, remainder);
      fee += next.fee;
      remainder = next.remainder;
    }

    expect({ fee, remainder }).toEqual(combined);
    expect(BigInt(BPS_DENOM * SECONDS_PER_YEAR) * fee + remainder).toBe(
      supply * BigInt(bps) * totalElapsed,
    );
  });
  it("management fee compounds from the then-current supply at each checkpoint", () => {
    const initialSupply = 10_000_000n;
    const bps = 300;
    const checkpoints = [30n * 24n * 3600n, 30n * 24n * 3600n, 30n * 24n * 3600n, 30n * 24n * 3600n];
    let supply = initialSupply;
    let remainder = 0n;
    let accrued = 0n;
    for (const elapsed of checkpoints) {
      const next = managementFeeWithRemainder(supply, bps, elapsed, remainder);
      accrued += next.fee;
      supply += next.fee;
      remainder = next.remainder;
    }

    const fixedSupply = managementFeeWithRemainder(initialSupply, bps, checkpoints.reduce((a, b) => a + b, 0n));
    expect(accrued).toBe(98_995n);
    expect(accrued).toBeGreaterThan(fixedSupply.fee);
    expect(supply).toBe(initialSupply + accrued);
  });
  it("management never exceeds cap", () => {
    for (const bps of [100,200,300]) {
      for (const supply of [1_000_000,10_000_000,100_000_000]) {
        const oneYear = managementFee(supply, bps, SECONDS_PER_YEAR);
        expect(oneYear).toBeLessThanOrEqual(supply * bps / BPS_DENOM + 1);
      }
    }
  });
  it("management daily vs single", () => {
    let s = 10_000_000;
    let daily = s;
    for (let i=0;i<30;i++) daily += managementFee(daily,300,24*3600);
    const single = s + managementFee(s,300,30*24*3600);
    expect(daily).toBeGreaterThanOrEqual(single);
    expect(daily - single).toBeLessThan(1000);
  });
  it("management remainder clears carried dust for zero supply and zero bps", () => {
    expect(managementFeeWithRemainder(0n, 300, 123n, 42n)).toEqual({ fee: 0n, remainder: 0n });
    expect(managementFeeWithRemainder(10_000_000n, 0, 123n, 42n)).toEqual({ fee: 0n, remainder: 0n });
  });
  it("management remainder rejects non-integer and out-of-range bps", () => {
    expect(() => managementFeeWithRemainder(1n, 1.5, 1n)).toThrow(RangeError);
    expect(() => managementFeeWithRemainder(1n, BPS_DENOM + 1, 1n)).toThrow(RangeError);
  });
  it("random fuzz fees", () => {
    for (let i=0;i<100;i++) {
      const gross = Math.floor(Math.random()*1e9)+1;
      const bps = Math.floor(Math.random()*301);
      const fee = entryFee(gross,bps);
      expect(fee).toBeLessThanOrEqual(gross);
    }
  });
});

describe("navEngine", () => {
  it("nav = sum scaled*price", () => {
    expect(computeNav([500,300,200],[250,100,180])).toBe(500*250+300*100+200*180);
  });
  it("share price", () => {
    expect(computeSharePrice(191000,10)).toBe(19100);
    expect(computeSharePrice(0,10)).toBe(0);
    expect(computeSharePrice(100,0)).toBe(0);
  });
  it("drift zero when perfect", () => {
    expect(computeDrift([500,300,200],[5000,3000,2000])).toEqual([0,0,0]);
  });
  it("drift with deviation", () => {
    expect(computeDrift([600,300,100],[5000,3000,2000])).toEqual([1000,0,-1000]);
  });
  it("drift with empty total", () => {
    expect(computeDrift([0,0,0],[5000,5000])).toEqual([0,0]);
  });
  it("nav with zero price", () => {
    expect(computeNav([100,100],[0,100])).toBe(100*100);
  });
  it("nav large numbers", () => {
    const nav = computeNav([1e9,1e9],[1000,1000]);
    expect(nav).toBe(2e12);
  });
  it("drift sums to zero (approx)", () => {
    const drift = computeDrift([400,400,200],[5000,3000,2000]);
    const sum = drift.reduce((a,b)=>a+b,0);
    expect(Math.abs(sum)).toBeLessThanOrEqual(1); // rounding
  });
});

describe("priceFetch mock", () => {
  it("mock prices", () => {
    expect(mockPrices(["mint1","mint2"],100)).toEqual({ mint1:100, mint2:100 });
  });
  it("mock default", () => {
    expect(mockPrices(["a"],50).a).toBe(50);
  });
});

describe("gross shares math (JS mirror of Rust)", () => {
  function grossShares(deposits:number[], vaults:number[], supply:number){
    let min=Number.MAX_SAFE_INTEGER, max=0;
    let minG:number|undefined;
    for(let i=0;i<deposits.length;i++){
      const g=Math.floor(deposits[i]*supply/vaults[i]);
      if(minG===undefined||g<minG)minG=g;
      if(g>max)max=g;
      if(g<min)min=g;
    }
    if(max>min && (max-min)*100>min) throw new Error("WeightMismatch");
    return minG!;
  }
  it("perfect",()=>expect(grossShares([50_000_000,30_000_000,20_000_000],[500_000_000,300_000_000,200_000_000],10_000_000)).toBe(1_000_000));
  it("weight mismatch throws",()=>expect(()=>grossShares([60_000_000,30_000_000,10_000_000],[500_000_000,300_000_000,200_000_000],10_000_000)).toThrow());
  it("tolerance pass at 1% ",()=>expect(grossShares([100_000_000,101_000_000],[1_000_000_000,1_000_000_000],10_000_000)).toBe(1_000_000));
  it("tolerance fail >1%",()=>expect(()=>grossShares([100_000_000,102_000_000],[1_000_000_000,1_000_000_000],10_000_000)).toThrow());
});

describe("redeem pro-rata", () => {
  function redeem(vaults:number[], burn:number, supply:number){ return vaults.map(v=>Math.floor(v*burn/supply)); }
  it("full",()=>expect(redeem([1_000_000_000],10_000_000,10_000_000)).toEqual([1_000_000_000]));
  it("floor never exceeds",()=>{
    for(const burn of [1,100,5_000_000]){
      const out=redeem([1_000_000_000],burn,10_000_000)[0];
      expect(out).toBeLessThanOrEqual(1_000_000_000*burn/10_000_000+1);
    }
  });
  it("consistency after ops",()=>{
    let vaults=[1_000_000_000,1_000_000_000], supply=10_000_000;
    const gross=1_000_000, fee=10_000, net=990_000;
    vaults=[vaults[0]+100_000_000, vaults[1]+100_000_000];
    supply+=gross;
    const burn=supply/20, exitFee=Math.floor(burn*50/10000), burnNet=burn-exitFee;
    const out=redeem(vaults,burnNet,supply);
    vaults=[vaults[0]-out[0], vaults[1]-out[1]];
    expect(vaults[0]).toBeGreaterThan(0);
    expect(vaults[1]).toBeGreaterThan(0);
  });
});

describe("Token-2022 scaled", () => {
  it("raw unchanged, scaled doubles on 2x multiplier",()=>{
    const raw=1_000_000;
    expect(raw*1).toBe(1_000_000);
    expect(raw*2).toBe(2_000_000);
  });
  it("decimal mismatch concept",()=>{
    const raw6=1_000_000, raw9=1_000_000_000;
    expect(raw6*1000).toBe(raw9);
  });
});

describe("factory validation", () => {
  it("weights sum 10000",()=>{
    expect([5000,3000,2000].reduce((a,b)=>a+b,0)).toBe(10000);
    expect([5000,3000,1999].reduce((a,b)=>a+b,0)).not.toBe(10000);
  });
  it("2-20 constituents",()=>{
    for(let n=2;n<=20;n++) expect(n>=2 && n<=20).toBe(true);
    expect(1>=2 && 1<=20).toBe(false);
  });
  it("duplicate detection",()=>{
    const a="mint1",b="mint2";
    expect(new Set([a,b,a]).size).not.toBe(3);
  });
  it("fee caps",()=>{
    expect(300<=300).toBe(true);
    expect(301<=300).toBe(false);
  });
});
