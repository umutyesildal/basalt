import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { DEVNET_RPC_GENESIS } from "../src/rpc/positionsProvider";
import { discoverCurrentBalanceCandidates, persistCurrentBalanceSnapshot, readCurrentBalanceSnapshot, type CurrentBalanceRpc } from "../src/indexer/currentBalanceSnapshot";
import { namespaceRecoveryPrograms, namespaceForRecoveryFixture } from "./fixtures/program-namespaces";
import type { PgLike } from "../src/db/client";
import { positionRecoveryFixture as rawPositionRecoveryFixture, recoveryKey } from "./fixtures/position-recovery";
const positionRecoveryFixture=(options:Parameters<typeof rawPositionRecoveryFixture>[0]={})=>rawPositionRecoveryFixture({programs:namespaceRecoveryPrograms(0),...options});

function fixture(count=1) {
  const f=positionRecoveryFixture({holders:Array.from({length:count},(_,i)=>({user:recoveryKey(20+i),amount:10n}))});
  const reads:Array<{addresses:string[];config:unknown}>=[];
  const rpc:CurrentBalanceRpc={
    getGenesisHash:vi.fn(async()=>DEVNET_RPC_GENESIS),
    getAccountInfoAndContext:f.rpc.getAccountInfoAndContext,
    async getMultipleAccountsInfoAndContext(addresses,config){
      reads.push({addresses:addresses.map(address=>address.toBase58()),config});
      return {context:{slot:f.slot},value:addresses.map(address=>address.equals(f.basket)?f.basketAccount:address.equals(f.shareMint)?f.mintAccount:f.accounts.find(row=>row.pubkey.equals(address))?.account??null)};
    },
    getParsedTransaction:vi.fn(async()=>null),
  };
  return {...f,rpc,reads,candidates:f.accounts.map(row=>row.pubkey.toBase58())};
}
const fetchSnapshot=(f:ReturnType<typeof fixture>,candidates=f.candidates,options:Parameters<typeof readCurrentBalanceSnapshot>[4]={})=>readCurrentBalanceSnapshot(f.rpc,f.basket.toBase58(),f.programs,candidates,options);
afterEach(()=>vi.useRealTimers());
describe("independent authenticated finalized current balances",()=>{
  it("proves exact holders from raw same-bank accounts without GPA, events or cost basis",async()=>{
    const f=fixture();const result=await fetchSnapshot(f);
    expect(result).toMatchObject({slot:100,supply:"10",balances:[{user:recoveryKey(20).toBase58(),shares:"10"}],accountCount:1,historyComplete:false});
    expect(result.observedAt).toBeInstanceOf(Date);expect(Math.abs(Date.now()-result.observedAt.getTime())).toBeLessThan(1_000);
    expect(result.accountsDigest).toMatch(/^[a-f0-9]{64}$/);expect(result.programIds).toEqual([...f.programs.ids].sort());
    expect(f.reads).toHaveLength(1);expect(f.reads[0]).toEqual({addresses:[f.basket.toBase58(),f.shareMint.toBase58(),f.candidates[0]],config:{commitment:"finalized",minContextSlot:100}});
    expect(f.rpc.getParsedTransaction).not.toHaveBeenCalled();expect(result).not.toHaveProperty("costBasis");
  });
  it("deduplicates hints and tolerates unrelated transaction accounts without counting them",async()=>{
    const f=fixture();const result=await fetchSnapshot(f,[...f.candidates,...f.candidates,PublicKey.default.toBase58(),recoveryKey(90).toBase58()]);
    expect(result.supply).toBe("10");expect(result.accountCount).toBe(1);expect(f.reads[0].addresses).toHaveLength(5);
  });
  it("rejects absent positive holders instead of treating a candidate list as exhaustive",async()=>{
    const f=fixture(2);await expect(fetchSnapshot(f,[f.candidates[0]])).rejects.toThrow("coverage-incomplete");
  });
  it("accepts an authenticated zero supply with no token-account hints",async()=>{
    const f=fixture(0);expect(await fetchSnapshot(f)).toMatchObject({supply:"0",balances:[],accountCount:0});expect(f.reads[0].addresses).toHaveLength(2);
  });
  it("rejects wrong devnet identity before any account read",async()=>{
    const f=fixture();f.rpc.getGenesisHash=async()=>"wrong-chain";await expect(fetchSnapshot(f)).rejects.toThrow("wrong-network");expect(f.calls).toEqual([]);expect(f.reads).toEqual([]);
  });
  it.each(["decimals","freeze","authority","owner","extension"])("rejects unauthenticated share mint %s",async mode=>{
    const f=fixture();
    if(mode==="decimals")f.mintAccount.data[44]=9;
    if(mode==="freeze")f.mintAccount.data.writeUInt32LE(1,46);
    if(mode==="authority")recoveryKey(99).toBuffer().copy(f.mintAccount.data,4);
    if(mode==="owner")f.mintAccount.owner=recoveryKey(99);
    if(mode==="extension")f.mintAccount.data=Buffer.concat([f.mintAccount.data,Buffer.alloc(84)]);
    await expect(fetchSnapshot(f)).rejects.toThrow("unauthenticated-share-mint");
  });
  it.each(["state","bytes","native","executable"])("rejects matching share account %s corruption",async mode=>{
    const f=fixture();
    if(mode==="state")f.accounts[0].account.data[108]=0;
    if(mode==="bytes")f.accounts[0].account.data=f.accounts[0].account.data.subarray(0,100);
    if(mode==="native")f.accounts[0].account.data.writeUInt32LE(1,109);
    if(mode==="executable")f.accounts[0].account.executable=true;
    await expect(fetchSnapshot(f)).rejects.toThrow("unauthenticated-share-account");
  });
  it("a replaced token program owner cannot satisfy supply conservation",async()=>{
    const f=fixture();f.accounts[0].account.owner=recoveryKey(90);await expect(fetchSnapshot(f)).rejects.toThrow("coverage-incomplete");
  });
  it("authenticates more than98 candidates only when all batches share the exact finalized context",async()=>{
    const f=fixture(100),result=await fetchSnapshot(f);expect(result.balances).toHaveLength(100);expect(result.supply).toBe("1000");expect(f.reads).toHaveLength(2);
    expect(f.reads.every(read=>read.addresses.length<=100)).toBe(true);
  });
  it("discards prior batches and retries an advancing finalized context",async()=>{
    const f=fixture(100),original=f.rpc.getMultipleAccountsInfoAndContext;let calls=0;
    f.rpc.getMultipleAccountsInfoAndContext=async(addresses,config)=>{const response=await original(addresses,config);response.context.slot=++calls===1?100:101;return response;};
    expect((await fetchSnapshot(f)).slot).toBe(101);expect(calls).toBe(4);
  });
  it("fails closed after three attempts when contexts never agree",async()=>{
    const f=fixture(100),original=f.rpc.getMultipleAccountsInfoAndContext;let calls=0;
    f.rpc.getMultipleAccountsInfoAndContext=async(addresses,config)=>{const response=await original(addresses,config);response.context.slot=100+calls++;return response;};
    await expect(fetchSnapshot(f)).rejects.toThrow("equal-context-retry-exhausted");expect(calls).toBe(6);
  });
  it("rejects contradictory same-slot mint bytes across account batches",async()=>{
    const f=fixture(100),original=f.rpc.getMultipleAccountsInfoAndContext;let calls=0;
    f.rpc.getMultipleAccountsInfoAndContext=async(addresses,config)=>{const response=await original(addresses,config);if(++calls===2){response.value[1]={...f.mintAccount,data:Buffer.from(f.mintAccount.data)};response.value[1]!.data.writeBigUInt64LE(999n,36);}return response;};
    await expect(fetchSnapshot(f)).rejects.toThrow("same-slot-account-disagreement");
  });
  it("rejects regressing contexts rather than lowering the verified slot",async()=>{
    const f=fixture(),original=f.rpc.getMultipleAccountsInfoAndContext;f.rpc.getMultipleAccountsInfoAndContext=async(addresses,config)=>({...await original(addresses,config),context:{slot:99}});
    await expect(fetchSnapshot(f)).rejects.toThrow("invalid-finalized-context");
  });
  it("bounds a stalled raw account read",async()=>{
    vi.useFakeTimers();const f=fixture();f.rpc.getMultipleAccountsInfoAndContext=()=>new Promise(()=>{});
    const pending=fetchSnapshot(f,undefined,{deadlineMs:20}),rejected=expect(pending).rejects.toThrow("deadline");await vi.advanceTimersByTimeAsync(20);await rejected;
  });
  it("enforces the candidate cap without truncating a purported complete set",async()=>{
    const f=fixture();await expect(fetchSnapshot(f,Array(1001).fill(f.candidates[0]))).rejects.toThrow("candidate-limit");expect(f.calls).toEqual([]);expect(f.reads).toEqual([]);
  });
  it("rejects malformed/missing account results",async()=>{
    const f=fixture();f.rpc.getMultipleAccountsInfoAndContext=async()=>({context:{slot:100},value:[f.basketAccount,f.mintAccount]});await expect(fetchSnapshot(f)).rejects.toThrow("missing-account-results");
  });
  it("raw owner/mint account authentication does not depend on ATA-shaped addresses",async()=>{
    const f=fixture();f.accounts[0].pubkey=recoveryKey(91);const result=await fetchSnapshot(f,[recoveryKey(91).toBase58()]);expect(result.accountCount).toBe(1);expect(result.balances[0].shares).toBe("10");expect(f.accounts[0].account.owner.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  });
  it("supports full rawu64 balances independently of legacyBIGINT financial storage",async()=>{
    const f=fixture(),amount=(1n<<64n)-1n;f.accounts[0].account.data.writeBigUInt64LE(amount,64);f.mintAccount.data.writeBigUInt64LE(amount,36);
    const result=await fetchSnapshot(f);expect(result.supply).toBe(amount.toString());expect(result.balances[0].shares).toBe(amount.toString());
  });

  it("releases a late pool acquisition after publication deadline without ever starting a transaction",async()=>{
    const f=fixture(),s=await fetchSnapshot(f);vi.useFakeTimers();let acquire!:(client:unknown)=>void;
    const client={query:vi.fn(),release:vi.fn()},db={query:vi.fn(),connect:()=>new Promise(resolve=>{acquire=resolve;})} as unknown as PgLike;
    const pending=persistCurrentBalanceSnapshot(db,s,f.programs,new Date(),Date.now()+20,[namespaceForRecoveryFixture(f.programs)]),rejected=expect(pending).rejects.toThrow("snapshot-deadline");
    await vi.advanceTimersByTimeAsync(20);await rejected;acquire(client);await Promise.resolve();await Promise.resolve();
    expect(client.release).toHaveBeenCalledTimes(1);expect(client.query).not.toHaveBeenCalled();
  });

  it.each(["begin","configuration","read","commit","rollback"])("discards a transport-stalled %s connection without continuing after deadline",async phase=>{
    const f=fixture(),s=await fetchSnapshot(f);vi.useFakeTimers();let finishStalled!:(value:unknown)=>void;
    const client={release:vi.fn(),query:vi.fn(async(sql:string)=>{
      const read=sql.includes("SELECT owner");
      if(phase==="rollback" && read)throw new Error("original read failure");
      const stalls=phase==="begin"&&sql==="BEGIN" || phase==="configuration"&&sql.includes("set_config") || phase==="read"&&read || phase==="commit"&&sql==="COMMIT" || phase==="rollback"&&sql==="ROLLBACK";
      if(stalls)return new Promise(resolve=>{finishStalled=resolve;});
      return{rows:[]};
    })};
    const db={query:vi.fn(),connect:async()=>client} as unknown as PgLike;
    const pending=discoverCurrentBalanceCandidates(db,f.basket.toBase58(),s.basketState,Date.now()+20);
    const rejected=expect(pending).rejects.toThrow(phase==="rollback"?"original read failure":"snapshot-deadline");
    await vi.advanceTimersByTimeAsync(20);await rejected;
    expect(client.release).toHaveBeenCalledTimes(1);expect(client.release).toHaveBeenCalledWith(true);
    const calls=client.query.mock.calls.length;finishStalled({rows:[]});await Promise.resolve();await Promise.resolve();
    expect(client.query).toHaveBeenCalledTimes(calls);
  });

  it("prepared basket hints avoid another initial RPC read while raw batch authentication remains mandatory",async()=>{
    const f=fixture();const prior=await f.rpc.getAccountInfoAndContext(f.basket,{commitment:"finalized"});
    expect(await fetchSnapshot(f,undefined,{preparedBasket:prior})).toMatchObject({supply:"10",slot:100});expect(f.calls).toHaveLength(1);expect(f.reads).toHaveLength(1);
    const original=f.rpc.getMultipleAccountsInfoAndContext;f.rpc.getMultipleAccountsInfoAndContext=async(...args)=>{const response=await original(...args),bad={...f.basketAccount,data:Buffer.from(f.basketAccount.data)};bad.data[0]^=255;response.value[0]=bad;return response;};
    await expect(fetchSnapshot(f,undefined,{preparedBasket:prior})).rejects.toThrow("discriminator");expect(f.calls).toHaveLength(1);expect(f.reads).toHaveLength(2);
  });

});
