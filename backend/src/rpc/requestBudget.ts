/** Shared bounded scheduling and transport for read-only Solana RPC connections. */
import { Connection } from "@solana/web3.js";

export class RpcReadError extends Error {
  constructor(readonly code: string) { super(code); this.name = "RpcReadError"; }
}
export interface RpcBudgetOptions {
  concurrency: number; queueSize: number; intervalMs: number; queueTimeoutMs: number; requestTimeoutMs: number;
}
const DEFAULTS: RpcBudgetOptions = { concurrency:2,queueSize:32,intervalMs:250,queueTimeoutMs:2_000,requestTimeoutMs:8_000 };
type Job = { start():void; reject(error:Error):void; expires:ReturnType<typeof setTimeout>; removeAbort?:()=>void };
export class RpcRequestBudget {
  private active=0;
  private queue:Job[]=[];
  private timer:ReturnType<typeof setTimeout>|null=null;
  private nextStart=0;
  private cooldownUntil=0;
  private counters={started:0,completed:0,rejected:0,timedOut:0};
  constructor(private readonly options:RpcBudgetOptions={...DEFAULTS}) {
    this.options={...options};
    if (!Number.isSafeInteger(options.concurrency)||options.concurrency<1||options.concurrency>8||
      !Number.isSafeInteger(options.queueSize)||options.queueSize<1||options.queueSize>128||
      !Number.isSafeInteger(options.intervalMs)||options.intervalMs<0||options.intervalMs>10_000||
      !Number.isSafeInteger(options.queueTimeoutMs)||options.queueTimeoutMs<1||options.queueTimeoutMs>30_000||
      !Number.isSafeInteger(options.requestTimeoutMs)||options.requestTimeoutMs<1||options.requestTimeoutMs>30_000) throw new RpcReadError("invalid-rpc-budget-configuration");
  }
  evidence() { return {...this.counters,inFlight:this.active,queued:this.queue.length,maximumInFlight:this.options.concurrency,
    maximumQueued:this.options.queueSize,cooldownUntil:this.cooldownUntil>Date.now()?new Date(this.cooldownUntil).toISOString():null}; }
  defer(milliseconds:number):void {
    this.cooldownUntil=Math.max(this.cooldownUntil,Date.now()+Math.max(0,Math.min(60_000,Number.isFinite(milliseconds)?milliseconds:0)));
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    this.drain();
  }
  run<T>(task:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal):Promise<T> {
    if(signal?.aborted)return Promise.reject(new RpcReadError("rpc-request-aborted"));
    if(this.queue.length>=this.options.queueSize){this.counters.rejected++;return Promise.reject(new RpcReadError("rpc-queue-full"));}
    return new Promise<T>((resolve,reject)=>{
      let settled=false;
      const finish=(error:unknown,value?:T,failed=true)=>{
        if(settled)return;settled=true;
        if(failed)reject(error);else resolve(value!);
      };
      const remove=()=>{const index=this.queue.indexOf(job);if(index>=0)this.queue.splice(index,1);clearTimeout(job.expires);job.removeAbort?.();};
      const job:Job={
        expires:setTimeout(()=>{remove();this.counters.rejected++;finish(new RpcReadError("rpc-queue-deadline"));this.drain();},this.options.queueTimeoutMs),
        reject:error=>{remove();finish(error);},
        start:()=>{
          clearTimeout(job.expires);job.removeAbort?.();
          const controller=new AbortController();
          const abort=()=>{controller.abort();finish(new RpcReadError("rpc-request-aborted"));};
          signal?.addEventListener("abort",abort,{once:true});
          const timeout=setTimeout(()=>{this.counters.timedOut++;controller.abort();finish(new RpcReadError("rpc-request-deadline"));},this.options.requestTimeoutMs);
          this.active++;this.counters.started++;
          // An opaque client that ignores abort keeps its slot until it settles.
          // Timed-out callers can never create unbounded abandoned requests.
          Promise.resolve().then(()=>task(controller.signal)).then(value=>finish(null,value,false),error=>finish(error))
            .finally(()=>{clearTimeout(timeout);signal?.removeEventListener("abort",abort);this.active--;this.counters.completed++;this.drain();});
        },
      };
      if(signal){
        const abort=()=>{this.counters.rejected++;job.reject(new RpcReadError("rpc-request-aborted"));this.drain();};
        signal.addEventListener("abort",abort,{once:true});job.removeAbort=()=>signal.removeEventListener("abort",abort);
      }
      this.queue.push(job);
      if(signal?.aborted){job.reject(new RpcReadError("rpc-request-aborted"));return;}
      this.drain();
    });
  }
  private drain():void {
    if(this.timer||this.active>=this.options.concurrency||!this.queue.length)return;
    const wait=Math.max(this.nextStart,this.cooldownUntil)-Date.now();
    if(wait>0){this.timer=setTimeout(()=>{this.timer=null;this.drain();},wait);return;}
    const job=this.queue.shift()!;this.nextStart=Date.now()+this.options.intervalMs;job.start();this.drain();
  }
}
let configuration={...DEFAULTS};
const budgets=new Map<string,RpcRequestBudget>();
const READ_METHODS=new Set(["getGenesisHash","getAccountInfo","getProgramAccounts","getMultipleAccounts","getSignaturesForAddress",
  "getTransaction","getBlock","getSlot","getBlockHeight","getLatestBlockhash","getTokenSupply","getTokenAccountBalance",
  "getBalance","getVersion","getEpochInfo","getSignatureStatuses","getMinimumBalanceForRentExemption","isBlockhashValid"]);
function setting(env:NodeJS.ProcessEnv,name:string,fallback:number,min:number,max:number):number{
  const raw=env[name];if(raw===undefined||raw==="")return fallback;
  const value=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||value<min||value>max)throw new RpcReadError("invalid-rpc-budget-configuration");
  return value;
}
export function configureRpcRequestBudgetFromEnv(env:NodeJS.ProcessEnv=process.env):void {
  if([...budgets.values()].some(budget=>budget.evidence().inFlight||budget.evidence().queued))throw new RpcReadError("rpc-budget-already-running");
  configuration={
    concurrency:setting(env,"RPC_MAX_CONCURRENCY",2,1,4),queueSize:setting(env,"RPC_MAX_QUEUE",32,1,64),
    intervalMs:setting(env,"RPC_MIN_INTERVAL_MS",250,100,2_000),queueTimeoutMs:setting(env,"RPC_QUEUE_TIMEOUT_MS",2_000,500,5_000),
    requestTimeoutMs:setting(env,"RPC_REQUEST_TIMEOUT_MS",8_000,1_000,10_000),
  };
  budgets.clear();
}
function budgetFor(url:string):RpcRequestBudget {
  let budget=budgets.get(url);
  if(!budget){
    if(budgets.size>=8)throw new RpcReadError("rpc-endpoint-capacity");
    budget=new RpcRequestBudget({...configuration});budgets.set(url,budget);
  }
  return budget;
}
export function rpcRequestBudgetEvidence(){
  const snapshots=[...budgets.values()].map(budget=>budget.evidence());
  return {endpoints:snapshots.length,concurrencyPerEndpoint:configuration.concurrency,queueLimitPerEndpoint:configuration.queueSize,
    intervalMs:configuration.intervalMs,requestTimeoutMs:configuration.requestTimeoutMs,
    inFlight:snapshots.reduce((sum,value)=>sum+value.inFlight,0),queued:snapshots.reduce((sum,value)=>sum+value.queued,0),
    started:snapshots.reduce((sum,value)=>sum+value.started,0),completed:snapshots.reduce((sum,value)=>sum+value.completed,0),
    rejected:snapshots.reduce((sum,value)=>sum+value.rejected,0),timedOut:snapshots.reduce((sum,value)=>sum+value.timedOut,0)};
}
export function isUnsupportedHolderQuery(error:unknown):boolean{
  return /excluded from account secondary indexes|this RPC method unavailable for key|holder-query-unsupported/i.test(String(error));
}
function endpoint(value:string):URL{
  let parsed:URL;try{parsed=new URL(value);}catch{throw new RpcReadError("invalid-rpc-endpoint");}
  if(!["https:","http:"].includes(parsed.protocol)||parsed.username||parsed.password||parsed.hash)throw new RpcReadError("invalid-rpc-endpoint");
  if(parsed.protocol==="http:"&&!["localhost","127.0.0.1","[::1]"].includes(parsed.hostname))throw new RpcReadError("unencrypted-rpc-endpoint");
  return parsed;
}
async function boundedBody(response:Response,maximum:number):Promise<string>{
  const reader=response.body?.getReader();if(!reader)throw new RpcReadError("rpc-response-body-unavailable");
  const parts:Uint8Array[]=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>maximum){await reader.cancel();throw new RpcReadError("rpc-response-too-large");}parts.push(value);}
  }finally{reader.releaseLock();}
  return Buffer.concat(parts).toString("utf8");
}
/** Same exact endpoint shares one queue across indexer, NAV and account synchronization. */
export function guardedRpcFetch(url:string,fetchImpl:typeof fetch=fetch):typeof fetch{
  endpoint(url);const budget=budgetFor(url);
  return async(input,init)=>{
    const requested=typeof input==="string"?input:input instanceof URL?input.href:input.url;
    if(requested!==url||init?.method?.toUpperCase()!=="POST"||typeof init.body!=="string"||Buffer.byteLength(init.body)>65_536)throw new RpcReadError("invalid-read-only-rpc-request");
    let body:Record<string,unknown>;try{body=JSON.parse(init.body);}catch{throw new RpcReadError("invalid-read-only-rpc-request");}
    if(!body||Array.isArray(body)||body.jsonrpc!=="2.0"||typeof body.method!=="string"||!READ_METHODS.has(body.method))throw new RpcReadError("rpc-write-or-unsupported-method-rejected");
    if(typeof body.id!=="string"&&!(typeof body.id==="number"&&Number.isSafeInteger(body.id)))throw new RpcReadError("invalid-read-only-rpc-request");
    return budget.run(async signal=>{
      try{
        const response=await fetchImpl(url,{...init,signal,redirect:"error"});
        if(response.status===429){
          const header=response.headers.get("retry-after"),seconds=header?Number(header):NaN;
          budget.defer(Number.isFinite(seconds)?seconds*1_000:1_000);
          await response.body?.cancel();
          return new Response("RPC rate limited",{status:429,headers:{"content-type":"text/plain"}});
        }
        if(!response.ok){await response.body?.cancel();throw new RpcReadError("rpc-http-"+response.status);}
        const text=await boundedBody(response,8*1024*1024);
        let payload:Record<string,unknown>;try{payload=JSON.parse(text);}catch{throw new RpcReadError("rpc-invalid-json");}
        if(!payload||typeof payload!=="object"||Array.isArray(payload)||payload.jsonrpc!=="2.0"||payload.id!==body.id)throw new RpcReadError("rpc-response-identity-mismatch");
        if(payload.error&&typeof payload.error==="object"){
          const error=payload.error as {code?:unknown;message?:unknown};
          if(error.code===429){
            budget.defer(1_000);
            return new Response("RPC rate limited",{status:429,headers:{"content-type":"text/plain"}});
          }
          payload.error={code:typeof error.code==="number"?error.code:-32603,message:isUnsupportedHolderQuery(error.message)?
            "Token-2022 program excluded from account secondary indexes":"RPC read failed"};
          return new Response(JSON.stringify(payload),{status:response.status,headers:{"content-type":"application/json"}});
        }
        return new Response(text,{status:response.status,headers:{"content-type":"application/json"}});
      }catch(error){
        if(error instanceof RpcReadError)throw error;
        throw new RpcReadError(signal.aborted?"rpc-request-deadline":"rpc-transport-unavailable");
      }
    },init.signal??undefined);
  };
}
export function createReadOnlyRpcConnection(url:string):Connection{
  return new Connection(url,{commitment:"finalized",disableRetryOnRateLimit:true,fetch:guardedRpcFetch(url)});
}
