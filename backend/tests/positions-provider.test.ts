import { describe, expect, it, vi } from "vitest";
import { configurePositionsProviderFromEnv, DEVNET_RPC_GENESIS, PositionsRpcRuntime, positionsRpcEvidence } from "../src/rpc/positionsProvider";
import { configureRpcRequestBudgetFromEnv } from "../src/rpc/requestBudget";
import { fetchFinalizedPositionSnapshot } from "../src/indexer/positionsSync";
import { positionRecoveryFixture } from "./fixtures/position-recovery";

describe("finalized holder provider selection",()=>{
  it("uses a verified selected provider for every basket, holder and mint fact",async()=>{
    const primary=positionRecoveryFixture(),secondary=positionRecoveryFixture();
    primary.rpc.getAccountInfoAndContext=async()=>{throw new Error("primary must not supply snapshot facts");};
    const runtime=new PositionsRpcRuntime(secondary.rpc);
    const result=await fetchFinalizedPositionSnapshot(runtime.select(primary.rpc),secondary.basket.toBase58(),secondary.programs);
    expect(result.supply).toBe(secondary.supply.toString());expect(primary.calls).toEqual([]);
    expect(secondary.calls.map(call=>call.method)).toEqual(["account","holders","account"]);
  });
  it("cools down permanent unsupported queries before any subsequent account reads",async()=>{
    const fixture=positionRecoveryFixture();let now=1000;const runtime=new PositionsRpcRuntime(undefined,100,()=>now);
    const original=fixture.rpc.getProgramAccounts;fixture.rpc.getProgramAccounts=vi.fn(async()=>{throw new Error("Token-2022 excluded from account secondary indexes");});
    await expect(fetchFinalizedPositionSnapshot(runtime.select(fixture.rpc),fixture.basket.toBase58(),fixture.programs)).rejects.toThrow("unsupported");
    expect(fixture.calls).toHaveLength(1);expect(()=>runtime.select(fixture.rpc)).toThrow("cooldown");expect(fixture.calls).toHaveLength(1);
    expect(runtime.evidence().primary).toMatchObject({capability:"unsupported-cooldown",unsupportedFailures:1,skippedDuringCooldown:1});
    now+=101;fixture.rpc.getProgramAccounts=original;
    await fetchFinalizedPositionSnapshot(runtime.select(fixture.rpc),fixture.basket.toBase58(),fixture.programs);
    expect(runtime.evidence().primary.capability).toBe("supported");
  });
  it("switches only between complete snapshots when secondary capability is unavailable",async()=>{
    const primary=positionRecoveryFixture(),secondary=positionRecoveryFixture(),runtime=new PositionsRpcRuntime(secondary.rpc);
    secondary.rpc.getProgramAccounts=async()=>{throw new Error("this RPC method unavailable for key");};
    await expect(fetchFinalizedPositionSnapshot(runtime.select(primary.rpc),primary.basket.toBase58(),primary.programs)).rejects.toThrow("unsupported");
    await fetchFinalizedPositionSnapshot(runtime.select(primary.rpc),primary.basket.toBase58(),primary.programs);
    expect(primary.calls.map(call=>call.method)).toEqual(["account","holders","account"]);expect(secondary.calls).toHaveLength(1);
  });
  it("does not mark transient failures as permanent unsupported capability",async()=>{
    const fixture=positionRecoveryFixture(),runtime=new PositionsRpcRuntime();fixture.rpc.getProgramAccounts=async()=>{throw new Error("provider unavailable");};
    await expect(runtime.select(fixture.rpc).getProgramAccounts({} as never,{} as never)).rejects.toThrow("unavailable");
    expect(()=>runtime.select(fixture.rpc)).not.toThrow();expect(runtime.evidence().primary.unsupportedFailures).toBe(0);
  });
  it("rejects wrong-network secondary before any application read",async()=>{
    configureRpcRequestBudgetFromEnv({});const fetcher=vi.fn(async()=>new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"})));
    await expect(configurePositionsProviderFromEnv({POSITIONS_RPC_URL:"https://secondary.test/?secret=do-not-emit"},fetcher)).rejects.toThrow("wrong-network");
    expect(fetcher).toHaveBeenCalledTimes(1);expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).method).toBe("getGenesisHash");
  });
  it("requires verified devnet identity and reports no endpoint credentials",async()=>{
    configureRpcRequestBudgetFromEnv({});const fetcher=vi.fn(async()=>new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:DEVNET_RPC_GENESIS})));
    await configurePositionsProviderFromEnv({POSITIONS_RPC_URL:"https://verified.test/?secret=do-not-emit"},fetcher);
    expect(positionsRpcEvidence()).toMatchObject({secondaryConfigured:true,secondaryIdentity:"verified-devnet"});expect(JSON.stringify(positionsRpcEvidence())).not.toContain("do-not-emit");
    await configurePositionsProviderFromEnv({});
  });
  it("keeps absent alternate configuration honest and rejects invalid cooldown",async()=>{
    await configurePositionsProviderFromEnv({});expect(positionsRpcEvidence()).toMatchObject({secondaryConfigured:false,secondaryIdentity:"not-configured"});
    await expect(configurePositionsProviderFromEnv({POSITIONS_RPC_UNSUPPORTED_COOLDOWN_MS:"1"})).rejects.toThrow("invalid");
  });
});
