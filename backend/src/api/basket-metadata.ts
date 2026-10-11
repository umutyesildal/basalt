import { createHash } from "node:crypto";
import type http from "node:http";
import { PublicKey } from "@solana/web3.js";
import type { PgLike } from "../db/client.js";
import { PROGRAM_NAMESPACES, type ProgramNamespace } from "../config/programNamespaces.js";
import { readJsonBody } from "./json-body.js";
import type { ApiResourceLimits } from "./resource-limits.js";

export class BasketMetadataError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const MAX_METADATA_BYTES = 16_384;
export function parseBasketMetadata(document: unknown): Record<string, unknown> {
  if (typeof document !== "string" || Buffer.byteLength(document, "utf8") > MAX_METADATA_BYTES)
    throw new BasketMetadataError(400, "INVALID_METADATA", "Basket details are invalid.");
  let value: unknown;
  try { value = JSON.parse(document); } catch { throw new BasketMetadataError(400, "INVALID_METADATA", "Basket details are invalid."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BasketMetadataError(400, "INVALID_METADATA", "Basket details are invalid.");
  const metadata = value as Record<string, unknown>;
  for (const [key, limit] of [["name",64],["description",400],["thesis",400],["coverId",64]] as const) {
    if (metadata[key] !== undefined && (typeof metadata[key] !== "string" || (metadata[key] as string).length > limit))
      throw new BasketMetadataError(400, "INVALID_METADATA", "Basket details are invalid.");
  }
  if (typeof metadata.name !== "string" || !metadata.name.trim()) throw new BasketMetadataError(400, "INVALID_METADATA", "A basket name is required.");
  if (metadata.coverId !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.coverId as string))
    throw new BasketMetadataError(400, "INVALID_METADATA", "Basket image is invalid.");
  return metadata;
}
export const metadataHash = (document: string): string => createHash("sha256").update(document,"utf8").digest("hex");

/** Only exact bytes matching the indexed immutable chain commitment can be published.
 * No wallet signature is needed: a different preimage cannot replace creator content.
 * This route never inserts baskets, alters chain fields or applies financial history.
 */
export async function publishBasketMetadata(db: PgLike | null, pubkey: string, document: unknown, namespaces: readonly ProgramNamespace[] = PROGRAM_NAMESPACES) {
  const metadata = parseBasketMetadata(document);
  if (!db) throw new BasketMetadataError(503,"DB_UNAVAILABLE","Basket details could not be published yet.");
  const found = await db.query("SELECT factory, metadata_hash, metadata_document FROM baskets WHERE pubkey=$1",[pubkey]);
  const basket = found.rows[0];
  if (!basket) throw new BasketMetadataError(404,"NOT_INDEXED","Your basket is confirmed. Its listing is still being prepared.");
  if (!namespaces.some(namespace => namespace.factoryConfig === basket.factory)) throw new BasketMetadataError(409,"UNSUPPORTED_BASKET","This basket cannot publish details.");
  const hash = metadataHash(document as string);
  if (!/^[a-f0-9]{64}$/.test(basket.metadata_hash) || hash !== basket.metadata_hash)
    throw new BasketMetadataError(409,"METADATA_HASH_MISMATCH","These details do not match the basket created onchain.");
  const updated = await db.query(`UPDATE baskets SET metadata_document=$2, metadata_json=$3::jsonb
    WHERE pubkey=$1 AND factory=$4 AND metadata_hash=$5
      AND (metadata_document IS NULL OR metadata_document=$2)
    RETURNING pubkey`,[pubkey,document,JSON.stringify(metadata),basket.factory,hash]);
  if (updated.rows.length !== 1) throw new BasketMetadataError(409,"METADATA_CONFLICT","The original basket details are preserved.");
  return { pubkey, metadata_hash:hash, metadata_document:document, metadata_json:metadata };
}

/** Recheck exact bytes on every read; corrupt or unavailable content stays unnamed. */
export function publicBasketMetadata(row: Record<string,unknown>) {
  try {
    if (typeof row.metadata_document !== "string" || metadataHash(row.metadata_document) !== row.metadata_hash) throw new Error("unverified");
    return { metadata_json:parseBasketMetadata(row.metadata_document), metadata_document:row.metadata_document };
  } catch { return {metadata_json:null,metadata_document:null}; }
}
export async function tryHandleBasketMetadataRoute(deps:{getDb:()=>Promise<PgLike|null>;limits:ApiResourceLimits},req:http.IncomingMessage,res:http.ServerResponse,url:URL):Promise<boolean> {
  const match=/^\/api\/v1\/baskets\/([^/]+)\/metadata$/.exec(url.pathname);
  if (!match) return false;
  res.setHeader("Cache-Control","no-store");
  const send=(status:number,payload:unknown)=>{res.statusCode=status;res.end(JSON.stringify(payload));};
  if(req.method!=="POST") {res.setHeader("Allow","POST, OPTIONS");send(405,{error:{code:"METHOD_NOT_ALLOWED",message:"Use POST to publish basket details."}});return true;}
  deps.limits.consumeIp("metadata-create",req.socket?.remoteAddress??"unknown-peer");
  deps.limits.consumeBasketShareWrite();
  const release=deps.limits.acquireBasketShareWrite();
  try {
    let pubkey:string;
    try {pubkey=new PublicKey(decodeURIComponent(match[1])).toBase58();}catch{throw new BasketMetadataError(400,"INVALID_PUBKEY","The basket address is invalid.");}
    if(url.search) throw new BasketMetadataError(400,"INVALID_METADATA","Basket details do not accept query parameters.");
    const body=await readJsonBody(req,{maxBytes:32*1024});
    if(!body || Object.keys(body).length!==1 || typeof body.document!=="string") throw new BasketMetadataError(400,"INVALID_METADATA","Basket details are invalid.");
    send(200,{data:await publishBasketMetadata(await deps.getDb(),pubkey,body.document)});
  } catch(error) {
    if(!(error instanceof BasketMetadataError)) throw error;
    send(error.status,{error:{code:error.code,message:error.message}});
  }finally{release();}
  return true;
}
