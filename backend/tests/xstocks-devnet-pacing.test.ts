import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevnetConnection, createPacedDevnetFetch } from "../../scripts/xstocks-devnet/runtime";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const url = "https://api.devnet.solana.com";

describe("isolated devnet RPC HTTP pacing", () => {
  it("serializes requests, waits for the complete body, and spaces starts at least400ms", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0); const starts: number[] = []; let body!: ReadableStreamDefaultController<Uint8Array>;
    const fetchImpl = vi.fn(async () => { starts.push(Date.now()); return starts.length === 1 ? new Response(new ReadableStream<Uint8Array>({ start(controller) { body=controller; } })) : new Response("second"); });
    const transport=createPacedDevnetFetch({ fetchImpl }); const first=transport.fetch(url), second=transport.fetch(url);
    await vi.advanceTimersByTimeAsync(1000); expect(starts).toEqual([0]);
    body.enqueue(new TextEncoder().encode("first")); body.close(); await vi.advanceTimersByTimeAsync(0);
    expect(await (await first).text()).toBe("first"); expect(await (await second).text()).toBe("second"); expect(starts).toEqual([0,1000]);
    const third=transport.fetch(url); await vi.advanceTimersByTimeAsync(399); expect(starts).toHaveLength(2); await vi.advanceTimersByTimeAsync(1); await third; expect(starts).toEqual([0,1000,1400]); transport.close();
  });
  it("passes429 status, headers and body through without retrying or breaking the queue", async () => {
    vi.useFakeTimers(); const fetchImpl=vi.fn().mockResolvedValueOnce(new Response("limited",{status:429,headers:{"retry-after":"1"}})).mockResolvedValueOnce(new Response("ok"));
    const transport=createPacedDevnetFetch({fetchImpl}); const a=await transport.fetch(url); expect(a.status).toBe(429); expect(a.headers.get("retry-after")).toBe("1"); expect(await a.text()).toBe("limited"); expect(fetchImpl).toHaveBeenCalledTimes(1);
    const b=transport.fetch(url); await vi.advanceTimersByTimeAsync(400); expect(await (await b).text()).toBe("ok"); expect(fetchImpl).toHaveBeenCalledTimes(2); transport.close();
  });
  it("lets the next queued request proceed after a network rejection without resubmitting the failed request", async () => {
    vi.useFakeTimers(); const fetchImpl=vi.fn().mockRejectedValueOnce(new Error("network failure")).mockResolvedValueOnce(new Response("ok"));
    const transport=createPacedDevnetFetch({fetchImpl}); const rejected=expect(transport.fetch(url)).rejects.toThrow("network failure"), next=transport.fetch(url); await rejected; await vi.advanceTimersByTimeAsync(400); expect(await (await next).text()).toBe("ok"); expect(fetchImpl).toHaveBeenCalledTimes(2); transport.close();
  });
  it("shutdown aborts active and queued callers and prevents later HTTP requests", async () => {
    vi.useFakeTimers(); let activeSignal!:AbortSignal; const fetchImpl=vi.fn((_url:any,init:any)=>new Promise<Response>((_resolve,reject)=>{activeSignal=init.signal;activeSignal.addEventListener("abort",()=>reject(activeSignal.reason),{once:true});}));
    const transport=createPacedDevnetFetch({fetchImpl}); const active=expect(transport.fetch(url)).rejects.toThrow("transport closed"), queued=expect(transport.fetch(url)).rejects.toThrow("transport closed"); await vi.advanceTimersByTimeAsync(0); transport.close(); await Promise.all([active,queued]); expect(activeSignal.aborted).toBe(true); await expect(transport.fetch(url)).rejects.toThrow("transport closed"); await vi.runAllTimersAsync(); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("cancels a queued caller without sending it, while other callers keep their place", async () => {
    vi.useFakeTimers(); const fetchImpl=vi.fn(async()=>new Response("ok")),transport=createPacedDevnetFetch({fetchImpl}),controller=new AbortController();
    await transport.fetch(url); const canceled=expect(transport.fetch(url,{signal:controller.signal})).rejects.toThrow("cancel fixture read"); const next=transport.fetch(url); controller.abort(new Error("cancel fixture read")); await canceled; await vi.advanceTimersByTimeAsync(400); await next; expect(fetchImpl).toHaveBeenCalledTimes(2); transport.close();
  });
  it("retains web3's own429 retry semantics through the devnet-only factory", async () => {
    vi.useFakeTimers(); vi.spyOn(console,"error").mockImplementation(()=>{}); const requests:any[]=[];
    const fetchImpl=vi.fn(async(_url:any,init:any)=>{ const request=JSON.parse(init.body); requests.push(request); return requests.length===1 ? new Response("limited",{status:429}) : new Response(JSON.stringify({jsonrpc:"2.0",id:request.id,result:"devnet-genesis"})); });
    const conn=createDevnetConnection({fetchImpl}); expect(conn.rpcEndpoint).toBe(url); const request=conn.getGenesisHash(); await vi.runAllTimersAsync(); expect(await request).toBe("devnet-genesis"); expect(requests.map(r=>r.method)).toEqual(["getGenesisHash","getGenesisHash"]); expect(requests[0].id).toBe(requests[1].id); conn.closeRpc();
  });
});
