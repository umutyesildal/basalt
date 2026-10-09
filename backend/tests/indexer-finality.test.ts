import { describe, expect, it, vi } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { indexerConfigFromEnv } from "../src/indexer/listener";

describe("public web3 finalized block ordering adapter", () => {
  it("requests getBlock signatures mode without the unsupported getBlock full-response parser", async () => {
    const calls: Array<{method:string;params:unknown[]}> = [];
    const rpc = new Connection("http://127.0.0.1:8899",{fetch:async(_url,init)=>{
      const call=JSON.parse(String(init?.body)); calls.push(call);
      return Response.json({jsonrpc:"2.0",id:call.id,result:call.method==='getSignaturesForAddress'?[]:{blockhash:"hash",previousBlockhash:"previous",parentSlot:41,blockTime:1700000000,signatures:["first","second"]}});
    }});
    expect((await rpc.getBlockSignatures(42,"finalized")).signatures).toEqual(["first","second"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({method:"getBlock",params:[42,{commitment:"finalized",transactionDetails:"signatures",rewards:false}]});
    await rpc.getSignaturesForAddress(new PublicKey(Buffer.alloc(32,1)),{limit:10,minContextSlot:42},"finalized");
    expect(calls[1]).toMatchObject({method:"getSignaturesForAddress",params:[expect.any(String),{commitment:"finalized",limit:10,minContextSlot:42}]});
  });
});

describe("durable env role configuration", () => {
  it("requires three distinct canonical public program keys", () => {
    const key=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58();
    const valid={RPC_URL:"http://127.0.0.1:8899",PROGRAM_WHITELIST:key(1),PROGRAM_FACTORY:key(2),PROGRAM_BASKET:key(3)};
    expect(indexerConfigFromEnv(valid)?.durableHistory).toBe(true);
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    try {
      for(const bad of [{...valid,PROGRAM_WHITELIST:undefined},{...valid,PROGRAM_FACTORY:valid.PROGRAM_BASKET},{...valid,PROGRAM_BASKET:'invalid-base58'},{...valid,PROGRAM_BASKET:' '+valid.PROGRAM_BASKET}]) expect(indexerConfigFromEnv(bad)).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/three distinct valid public keys/));
    } finally {warn.mockRestore();}
  });
});
