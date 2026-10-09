import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { withRpcBackoff } from "../src/rpc/backoff";
import { createReadOnlyRpcConnection, RpcRequestBudget, configureRpcRequestBudgetFromEnv, guardedRpcFetch, rpcRequestBudgetEvidence } from "../src/rpc/requestBudget";
const options = { concurrency: 1, queueSize: 1, intervalMs: 0, queueTimeoutMs: 100, requestTimeoutMs: 50 };
const request = { method: "POST", body: JSON.stringify({jsonrpc:"2.0",id:1,method:"getSlot",params:[]}) };
afterEach(() => vi.useRealTimers());
describe("bounded shared read-only RPC transport", () => {
  it("keeps an aborted opaque request in its slot until actual settlement", async () => {
    vi.useFakeTimers(); const budget = new RpcRequestBudget(options); let release!: (value:number)=>void;
    const first = budget.run(() => new Promise<number>(resolve => { release=resolve; }));
    const firstRejected = expect(first).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(50); await firstRejected;
    let started = false; const second = budget.run(async()=>{started=true;return 2;});
    await vi.advanceTimersByTimeAsync(40);expect(started).toBe(false);expect(budget.evidence().inFlight).toBe(1);
    await expect(budget.run(async()=>3)).rejects.toThrow("queue-full");
    release(1);await vi.advanceTimersByTimeAsync(0);await expect(second).resolves.toBe(2);
    expect(budget.evidence()).toMatchObject({inFlight:0,queued:0,started:2,timedOut:1});
  });
  it("preserves provider rejection even without an Error payload",async()=>{
    const budget=new RpcRequestBudget(options);
    await expect(budget.run(()=>Promise.reject(undefined))).rejects.toBeUndefined();
  });
  it("expires queued jobs without starting provider requests", async()=>{
    vi.useFakeTimers();const budget=new RpcRequestBudget({...options,requestTimeoutMs:500});let release!:()=>void;
    const first=budget.run(()=>new Promise<void>(resolve=>{release=resolve;}));
    const read=vi.fn(async()=>1);const second=budget.run(read);const rejected=expect(second).rejects.toThrow("queue-deadline");
    await vi.advanceTimersByTimeAsync(100);await rejected;expect(read).not.toHaveBeenCalled();release();await first;
  });
  it("aborted queued work is removed and cannot consume a slot",async()=>{
    const budget=new RpcRequestBudget({...options,requestTimeoutMs:500});let release!:()=>void;
    const first=budget.run(()=>new Promise<void>(resolve=>{release=resolve;}));await Promise.resolve();
    const abort=new AbortController(),read=vi.fn(async()=>1);const second=budget.run(read,abort.signal);
    abort.abort();await expect(second).rejects.toThrow("aborted");expect(read).not.toHaveBeenCalled();release();await first;
  });
  it("honors shared provider cooldown and minimum request spacing",async()=>{
    vi.useFakeTimers();const budget=new RpcRequestBudget({...options,concurrency:2,queueSize:4,intervalMs:20,queueTimeoutMs:500});
    const calls:number[]=[];await budget.run(async()=>{calls.push(Date.now());});budget.defer(100);
    const pending=budget.run(async()=>{calls.push(Date.now());});await vi.advanceTimersByTimeAsync(99);expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);await pending;expect(calls[1]-calls[0]).toBe(100);
  });
  it("rejects writes, endpoint swaps and unsafe endpoint configuration before fetch",async()=>{
    configureRpcRequestBudgetFromEnv({});const fetcher=vi.fn();const read=guardedRpcFetch("https://rpc.test/?api-key=private-value",fetcher);
    await expect(read("https://rpc.test/?api-key=private-value",{...request,body:JSON.stringify({jsonrpc:"2.0",method:"sendTransaction"})})).rejects.toThrow("rejected");
    await expect(read("https://another.test",request)).rejects.toThrow("invalid");expect(fetcher).not.toHaveBeenCalled();
    expect(()=>guardedRpcFetch("http://external.test")).toThrow("unencrypted");
  });
  it("sanitizes transport and provider error payloads, retaining unsupported-index classification",async()=>{
    configureRpcRequestBudgetFromEnv({RPC_MIN_INTERVAL_MS:"100"});const url="https://rpc.test/?api-key=private-value";
    const fetcher=vi.fn().mockRejectedValueOnce(new Error(url)).mockResolvedValueOnce(new Response(JSON.stringify({jsonrpc:"2.0",id:1,error:{code:-32010,message:`${url} excluded from account secondary indexes`,data:url}})));
    const read=guardedRpcFetch(url,fetcher);await expect(read(url,request)).rejects.toThrow("rpc-transport-unavailable");
    const body=await (await read(url,request)).text();expect(body).toContain("excluded from account secondary indexes");expect(body).not.toContain("private-value");
    expect(JSON.stringify(rpcRequestBudgetEvidence())).not.toContain("rpc.test");
  });
  it("bounds streamed responses even without Content-Length",async()=>{
    configureRpcRequestBudgetFromEnv({});const cancel=vi.fn();const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1));},cancel}));
    const read=guardedRpcFetch("https://large.test",async()=>response);await expect(read("https://large.test",request)).rejects.toThrow("too-large");expect(cancel).toHaveBeenCalled();
  });
  it("shares one endpoint budget across independent fetch wrappers",async()=>{
    configureRpcRequestBudgetFromEnv({RPC_MAX_CONCURRENCY:"1",RPC_MIN_INTERVAL_MS:"100"});let release!:(response:Response)=>void;
    const url="https://shared.test";let count=0;const fetcher=vi.fn(async()=>{count++;return count===1?new Promise<Response>(resolve=>{release=resolve;}):new Response('{"jsonrpc":"2.0","id":1,"result":2}');});
    const first=guardedRpcFetch(url,fetcher)(url,request),second=guardedRpcFetch(url,fetcher)(url,request);
    await Promise.resolve();await Promise.resolve();expect(fetcher).toHaveBeenCalledTimes(1);expect(rpcRequestBudgetEvidence()).toMatchObject({inFlight:1,queued:1,endpoints:1});
    release(new Response('{"jsonrpc":"2.0","id":1,"result":1}'));await first;await second;
  });
  it("uses the SDK through the bounded transport and disables hidden 429 retries",async()=>{
    configureRpcRequestBudgetFromEnv({RPC_MIN_INTERVAL_MS:"100"});let requests=0;
    const server=http.createServer((_req,res)=>{requests++;res.writeHead(429,{"content-type":"text/plain","retry-after":"1"});res.end("private upstream details");});
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const address=server.address();if(!address||typeof address==="string")throw new Error("Missing local server port");
    try{
      await expect(createReadOnlyRpcConnection(`http://127.0.0.1:${address.port}`).getSlot("finalized")).rejects.toThrow("429");
      expect(requests).toBe(1);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });

  it.each([2,null,undefined])("rejects an error response with mismatched request id %s before trusting its code",async id=>{
    configureRpcRequestBudgetFromEnv({});
    const read=guardedRpcFetch("https://identity.test",async()=>new Response(JSON.stringify({jsonrpc:"2.0",id,error:{code:429,message:"private"}})));
    await expect(read("https://identity.test",request)).rejects.toThrow("identity-mismatch");
  });
  it("recognizes HTTP200 JSON-RPC429, shares cooldown, and retries only authenticated rate limits",async()=>{
    configureRpcRequestBudgetFromEnv({RPC_MIN_INTERVAL_MS:"100"});let mode:"rate-limit"|"unrelated"="rate-limit";
    const calls:number[]=[], sleeps=vi.fn(async()=>{});
    const server=http.createServer((req,res)=>{
      let body="";req.on("data",chunk=>{body+=chunk;});req.on("end",()=>{
        const id=JSON.parse(body).id;calls.push(Date.now());res.writeHead(200,{"content-type":"application/json"});
        const error=mode==="unrelated"?{code:-32003,message:"private upstream URL contains 429"}:calls.length===1?{code:429,message:"private upstream rate limit"}:null;
        res.end(JSON.stringify(error?{jsonrpc:"2.0",id,error}:{jsonrpc:"2.0",id,result:42}));
      });
    });
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const address=server.address();if(!address||typeof address==="string")throw new Error("Missing local server port");
    try{
      const url=`http://127.0.0.1:${address.port}`;
      // Separate Connection instances must obey the same cooldown.
      const first=createReadOnlyRpcConnection(url),second=createReadOnlyRpcConnection(url);
      let attempt=0;
      await expect(withRpcBackoff(()=>++attempt===1?first.getSlot("finalized"):second.getSlot("finalized"),{sleep:sleeps,rng:()=>0.5})).resolves.toBe(42);
      expect(calls).toHaveLength(2);expect(calls[1]-calls[0]).toBeGreaterThanOrEqual(950);expect(sleeps).toHaveBeenCalledTimes(1);
      mode="unrelated";sleeps.mockClear();
      await expect(withRpcBackoff(()=>first.getSlot("finalized"),{sleep:sleeps})).rejects.toThrow("RPC read failed");
      expect(calls).toHaveLength(3);expect(sleeps).not.toHaveBeenCalled();
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });

});
