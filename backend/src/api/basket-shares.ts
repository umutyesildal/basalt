import { createHash } from "node:crypto";
import type http from "node:http";
import bs58 from "bs58";
import { withTransaction, type PgLike } from "../db/client.js";
import { readJsonBody } from "./json-body.js";
import { ApiResourceLimits } from "./resource-limits.js";

export const MAX_BASKET_SHARE_ROWS = 25_000;
export const MAX_BASKET_SHARE_ENCODED_BYTES = 4096;
export const BASKET_SHARE_ID_RE = /^[A-Za-z0-9_-]{20}$/;
const ROOT_PATH = "/api/v1/basket-shares";

export class BasketShareError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** Storage validates inert v4 snapshot structure. The frontend also checks its issuer/cover catalog. */
export function isValidBasketShareEncoded(encoded: unknown): encoded is string {
  if (typeof encoded !== "string" || encoded.length > MAX_BASKET_SHARE_ENCODED_BYTES || !/^4\.[A-Za-z0-9_-]+$/.test(encoded)) return false;
  try {
    const bytes = Buffer.from(encoded.slice(2), "base64url");
    if (bytes.length > 3072 || bytes.toString("base64url") !== encoded.slice(2)) return false;
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!Array.isArray(value) || value.length !== 7 || value[0] !== 4) return false;
    const [ , name, amount, flat, thesis, fees, cover] = value;
    const cleanText = (text: unknown, limit: number): text is string => typeof text === "string" && text.length <= limit &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text);
    if (!cleanText(name, 60) || !name.trim() || !cleanText(thesis, 240) ||
      typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000 ||
      typeof cover !== "string" || cover.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cover) ||
      !Array.isArray(flat) || flat.length < 6 || flat.length > 60 || flat.length % 3 !== 0 ||
      !Array.isArray(fees) || fees.length !== 3 || fees.some((fee, i) => !Number.isInteger(fee) || fee < 0 || fee > [300, 100, 300][i])) return false;
    const symbols = new Set<string>(), mints = new Set<string>();
    let weight = 0;
    for (let i = 0; i < flat.length; i += 3) {
      const [symbol, bps, mint] = flat.slice(i, i + 3);
      if (typeof symbol !== "string" || !/^[A-Z0-9][A-Z0-9.:-]{0,24}$/.test(symbol) || symbols.has(symbol) ||
        !Number.isInteger(bps) || bps <= 0 || bps > 10_000) return false;
      if (mint !== null) {
        if (typeof mint !== "string" || mint.length < 32 || mint.length > 44 ||
          !/^[1-9A-HJ-NP-Za-km-z]+$/.test(mint) || bs58.decode(mint).length !== 32 || mints.has(mint)) return false;
        mints.add(mint);
      }
      symbols.add(symbol); weight += bps;
    }
    return weight === 10_000;
  } catch { return false; }
}

export function basketShareIdentity(encoded: string): { id: string; contentHash: string } {
  const hash = createHash("sha256").update(encoded, "utf8").digest();
  return { id: hash.subarray(0, 15).toString("base64url"), contentHash: hash.toString("hex") };
}

function verifyStored(row: Record<string, unknown>, expectedId: string): { id: string; encoded: string } {
  if (row.id !== expectedId || !isValidBasketShareEncoded(row.encoded))
    throw new BasketShareError(503, "SHARE_UNAVAILABLE", "This basket link is unavailable.");
  const identity = basketShareIdentity(row.encoded);
  if (identity.id !== row.id || identity.contentHash !== row.content_hash)
    throw new BasketShareError(503, "SHARE_UNAVAILABLE", "This basket link is unavailable.");
  return { id: row.id, encoded: row.encoded };
}

/** Dedicated immutable table only. An advisory lock makes admission atomic across API processes. */
export async function createBasketShare(db: PgLike | null, encoded: string): Promise<{ id: string }> {
  if (!isValidBasketShareEncoded(encoded)) throw new BasketShareError(400, "INVALID_SHARE", "The basket snapshot is invalid.");
  if (!db) throw new BasketShareError(503, "DB_UNAVAILABLE", "Basket links are unavailable right now.");
  const identity = basketShareIdentity(encoded);
  return withTransaction(db, async (client) => {
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SELECT pg_advisory_xact_lock(1489658434)");
    const existing = await client.query("SELECT id, content_hash, encoded FROM basket_shares WHERE id = $1 OR content_hash = $2", [identity.id, identity.contentHash]);
    if (existing.rows.length) {
      if (existing.rows.length !== 1 || existing.rows[0].id !== identity.id || existing.rows[0].content_hash !== identity.contentHash || existing.rows[0].encoded !== encoded)
        throw new BasketShareError(409, "SHARE_COLLISION", "This basket link could not be stored.");
      return { id: identity.id };
    }
    const count = await client.query("SELECT COUNT(*)::int AS count FROM basket_shares");
    const storedCount = Number(count.rows[0]?.count);
    if (!Number.isSafeInteger(storedCount) || storedCount < 0)
      throw new BasketShareError(503, "SHARE_UNAVAILABLE", "Basket links are unavailable right now.");
    if (storedCount >= MAX_BASKET_SHARE_ROWS)
      throw new BasketShareError(429, "SHARE_CAPACITY", "Basket link storage is full.");
    await client.query("INSERT INTO basket_shares (id, content_hash, encoded) VALUES ($1, $2, $3)", [identity.id, identity.contentHash, encoded]);
    return { id: identity.id };
  });
}

export async function getBasketShare(db: PgLike | null, id: string): Promise<{ id: string; encoded: string }> {
  if (!BASKET_SHARE_ID_RE.test(id)) throw new BasketShareError(400, "INVALID_SHARE_ID", "The basket link is invalid.");
  if (!db) throw new BasketShareError(503, "DB_UNAVAILABLE", "Basket links are unavailable right now.");
  const found = await db.query("SELECT id, content_hash, encoded FROM basket_shares WHERE id = $1", [id]);
  if (!found.rows.length) throw new BasketShareError(404, "SHARE_NOT_FOUND", "This basket link was not found.");
  return verifyStored(found.rows[0], id);
}

export async function tryHandleBasketShareRoute(
  deps: { getDb: () => Promise<PgLike | null>; limits: ApiResourceLimits },
  req: http.IncomingMessage, res: http.ServerResponse, url: URL,
): Promise<boolean> {
  if (url.pathname !== ROOT_PATH && !url.pathname.startsWith(`${ROOT_PATH}/`)) return false;
  const write = url.pathname === ROOT_PATH && req.method === "POST";
  res.setHeader("Cache-Control", "no-store");
  deps.limits.consumeIp(write ? "share-create" : "share-read", req.socket?.remoteAddress ?? "unknown-peer");
  if (write) deps.limits.consumeBasketShareWrite();
  const send = (status: number, payload: unknown) => { res.statusCode = status; res.end(JSON.stringify(payload)); };
  if (url.search) { send(400, { error: { code: "INVALID_SHARE", message: "Basket links do not accept query parameters." } }); return true; }
  let release: (() => void) | undefined;
  try {
    if (write) {
      release = deps.limits.acquireBasketShareWrite();
      const body = await readJsonBody(req, { maxBytes: 8 * 1024 });
      if (!body || Object.keys(body).length !== 1 || !isValidBasketShareEncoded(body.encoded))
        throw new BasketShareError(400, "INVALID_SHARE", "The basket snapshot is invalid.");
      const data = await createBasketShare(await deps.getDb(), body.encoded);
      send(200, { data });
    } else if (req.method === "GET" && url.pathname.startsWith(`${ROOT_PATH}/`)) {
      const id = url.pathname.slice(ROOT_PATH.length + 1);
      if (!BASKET_SHARE_ID_RE.test(id)) throw new BasketShareError(400, "INVALID_SHARE_ID", "The basket link is invalid.");
      const data = await getBasketShare(await deps.getDb(), id);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      send(200, { data });
    } else {
      res.setHeader("Allow", url.pathname === ROOT_PATH ? "POST, OPTIONS" : "GET, OPTIONS");
      send(405, { error: { code: "METHOD_NOT_ALLOWED", message: "This method is not available." } });
    }
  } catch (error) {
    if (!(error instanceof BasketShareError)) throw error;
    if (error.status === 429) res.setHeader("Retry-After", "3600");
    send(error.status, { error: { code: error.code, message: error.message } });
  } finally { release?.(); }
  return true;
}
