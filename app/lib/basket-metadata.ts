import { apiFetch } from "./api-client";

export interface BasketMetadataRow {
  pubkey: string;
  metadata_hash?: string | null;
  metadata_document?: unknown;
  metadata_json?: unknown;
}
const localDocuments = new Map<string,string>();
const published = new Set<string>();
const pending = new Map<string,Promise<boolean>>();
const retryAt = new Map<string,number>();
const validAddress = (address:string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
export function rememberBasketMetadata(address:string,document:string):void {
  if(validAddress(address) && new TextEncoder().encode(document).length<=16_384) localDocuments.set(address,document);
}
export function localBasketMetadataDocument(address:string):string|null {
  if(!validAddress(address)) return null;
  try { return typeof window!=="undefined" ? window.localStorage.getItem(`basalt:devnet:metadata:${address}`) ?? localDocuments.get(address) ?? null : localDocuments.get(address) ?? null; }
  catch { return localDocuments.get(address) ?? null; }
}
/** Exact bytes, not reserialized JSON, are compared against the immutable hash. */
export async function verifyBasketMetadataDocument(document:unknown,hash:unknown):Promise<Record<string,unknown>|null> {
  if(typeof document!=="string" || typeof hash!=="string" || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  const bytes=new TextEncoder().encode(document);
  if(bytes.length>16_384) return null;
  try {
    const actual=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");
    if(actual!==hash.toLowerCase()) return null;
    const value:unknown=JSON.parse(document);
    if(!value || typeof value!=="object" || Array.isArray(value)) return null;
    const metadata=value as Record<string,unknown>;
    if(typeof metadata.name!=="string" || !metadata.name.trim() || metadata.name.length>64) return null;
    for(const key of ["description","thesis"] as const) if(metadata[key]!==undefined && (typeof metadata[key]!=="string" || (metadata[key] as string).length>400)) return null;
    return metadata;
  }catch{return null;}
}
/** One bounded, idempotent publication attempt. Failure never changes chain success. */
export async function publishLocalBasketMetadata(row:BasketMetadataRow,fetchImpl:typeof apiFetch=apiFetch):Promise<boolean> {
  if(!validAddress(row.pubkey)) return false;
  const document=localBasketMetadataDocument(row.pubkey);
  if(!document || !await verifyBasketMetadataDocument(document,row.metadata_hash)) return false;
  const key=`${row.pubkey}:${row.metadata_hash}`;
  if(published.has(key)) return true;
  if(pending.has(key)) return pending.get(key)!;
  if((retryAt.get(key)??0)>Date.now()) return false;
  const task=(async()=>{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8_000);
    try {
      const response=await fetchImpl(`/api/v1/baskets/${encodeURIComponent(row.pubkey)}/metadata`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({document}),signal:controller.signal});
      if(!response.ok) return false;
      const payload=await response.json() as {data?:BasketMetadataRow};
      if(payload.data?.pubkey!==row.pubkey || payload.data?.metadata_document!==document || !await verifyBasketMetadataDocument(payload.data?.metadata_document,row.metadata_hash)) return false;
      published.add(key);
      if(typeof window!=="undefined") window.dispatchEvent(new Event("basalt:baskets-updated"));
      return true;
    }catch{return false;}
    finally {clearTimeout(timeout);retryAt.set(key,Date.now()+30_000);pending.delete(key);}
  })();
  pending.set(key,task);
  return task;
}
/** Creation may finish before discovery indexes its account. Retry metadata only,
 * never the signed transaction. The exact local record also remains recoverable later. */
export async function publishBasketMetadataWithRetry(
  row: BasketMetadataRow,
  fetchImpl: typeof apiFetch = apiFetch,
  wait: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
): Promise<boolean> {
  if (!await verifyBasketMetadataDocument(localBasketMetadataDocument(row.pubkey), row.metadata_hash)) return false;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await wait(31_000);
    if (await publishLocalBasketMetadata(row, fetchImpl)) return true;
  }
  return false;
}
/** Local metadata is verified immediately; publishing is independent of display. */
export async function hydrateBasketMetadata<T extends BasketMetadataRow>(row:T):Promise<T> {
  const remote=await verifyBasketMetadataDocument(row.metadata_document,row.metadata_hash);
  if(remote) return {...row,metadata_json:remote};
  const local=await verifyBasketMetadataDocument(localBasketMetadataDocument(row.pubkey),row.metadata_hash);
  if(local) void publishLocalBasketMetadata(row);
  return {...row,metadata_json:local};
}
