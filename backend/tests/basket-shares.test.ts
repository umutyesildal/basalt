import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { PassThrough } from "node:stream";
import { createHandler } from "../src/api/server";
import { basketShareIdentity, createBasketShare, getBasketShare, isValidBasketShareEncoded, MAX_BASKET_SHARE_ROWS } from "../src/api/basket-shares";
import { ApiResourceLimits } from "../src/api/resource-limits";
import { readJsonBody } from "../src/api/json-body";
import type { PgLike } from "../src/db/client";

const payload = () => [4, "My stock basket", 1000, ["NVDA", 5000, null, "GLD", 5000, null], "A thesis 🪨", [0, 0, 200], "moon-shot"];
const encode = (value: unknown = payload()) => `4.${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
function fakeDb() {
  const rows = new Map<string, {id:string; content_hash:string; encoded:string}>();
  const calls: {sql:string; values?:unknown[]}[] = [];
  let count: number | undefined;
  let releases = 0;
  const query = async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    let found: unknown[] = [];
    if (sql.startsWith("SELECT id,")) found = [...rows.values()].filter(row => row.id === values?.[0] || (sql.includes(" OR ") && row.content_hash === values?.[1]));
    else if (sql.includes("COUNT(*)")) found = [{ count: count ?? rows.size }];
    else if (sql.startsWith("INSERT INTO basket_shares")) {
      const [id, content_hash, encoded] = values as string[];
      rows.set(id, {id, content_hash, encoded});
    }
    return { rows: found, rowCount: found.length };
  };
  const db = { query, connect: async () => ({ query, release: () => { releases++; } }) } as unknown as PgLike;
  return { db, rows, calls, setCount: (value:number) => {count=value;}, releases:()=>releases };
}
const servers: http.Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(()=>resolve()); }))); });
async function start(db: PgLike | null, resourceLimits = new ApiResourceLimits()) {
  const server = http.createServer(createHandler({ db, resourceLimits, authSecret:"isolated-test-secret" }));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test listener");
  return `http://127.0.0.1:${address.port}/api/v1/basket-shares`;
}
const post = (url:string, value:unknown, headers:Record<string,string>={}) => fetch(url, {method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(value)});

describe("durable basket snapshot validation", () => {
  it("accepts bounded exact v4 Unicode snapshots and valid mint identities", () => {
    expect(isValidBasketShareEncoded(encode())).toBe(true);
    const value = payload(); (value[3] as unknown[])[2] = "11111111111111111111111111111112";
    expect(isValidBasketShareEncoded(encode(value))).toBe(true);
  });
  it("rejects old versions, trailing bits, malformed UTF-8, oversized and non-v4 values", () => {
    for (const value of [null, 5, "2.abc", encode().replace(/^4/,"3"), "4._w", "4.AB", "4."+"a".repeat(4096), "https://example.com", encode({v:1})])
      expect(isValidBasketShareEncoded(value),String(value).slice(0,50)).toBe(false);
  });
  it.each(["name", "amount", "thesis", "cover", "weights", "duplicate", "count", "mint", "fees", "extra"])("rejects malformed %s", field => {
    const value=payload();
    switch(field) {
      case "name": value[1]=" ";break;
      case "amount":value[2]=1_000_001;break;
      case "thesis":value[4]="t".repeat(241);break;
      case "cover":value[6]="https://evil.test/image";break;
      case "weights":(value[3] as unknown[])[1]=4999;break;
      case "duplicate":(value[3] as unknown[])[3]="NVDA";break;
      case "count":value[3]=["NVDA",10000,null];break;
      case "mint":(value[3] as unknown[])[2]="not-a-mint";break;
      case "fees":value[5]=[301,0,200];break;
      case "extra":value.push("arbitrary-url");break;
    }
    expect(isValidBasketShareEncoded(encode(value))).toBe(false);
  });
});

describe("immutable content-addressed storage", () => {
  it("deduplicates retries with exact bytes and preserves all draft fields", async () => {
    const store=fakeDb(), encoded=encode();
    const first=await createBasketShare(store.db,encoded);
    expect(first.id).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(await createBasketShare(store.db,encoded)).toEqual(first);
    expect(await getBasketShare(store.db,first.id)).toEqual({...first,encoded});
    expect(store.rows.size).toBe(1);
    expect(store.calls.filter(call=>call.sql.startsWith("INSERT")).length).toBe(1);
    expect(store.releases()).toBe(2);
    expect(store.calls.some(call=>/UPDATE|DELETE|TRUNCATE/.test(call.sql))).toBe(false);
  });
  it("different thesis, cover, fees and asset order produce different immutable links", () => {
    const values=[payload(),payload(),payload(),payload(),payload()];
    values[1][4]="Changed thesis";values[2][6]="diamond-hands";values[3][5]=[0,0,100];
    values[4][3]=["GLD",5000,null,"NVDA",5000,null];
    expect(new Set(values.map(value=>basketShareIdentity(encode(value)).id)).size).toBe(5);
  });
  it("never overwrites a colliding id or full hash and rolls back", async () => {
    const store=fakeDb(),encoded=encode(),identity=basketShareIdentity(encoded);
    store.rows.set(identity.id,{id:identity.id,content_hash:"f".repeat(64),encoded:encode([4,"Other",1000,["NVDA",5000,null,"GLD",5000,null],"",[0,0,0],"moon-shot"])});
    const before=[...store.rows];
    await expect(createBasketShare(store.db,encoded)).rejects.toMatchObject({status:409,code:"SHARE_COLLISION"});
    expect([...store.rows]).toEqual(before);
    expect(store.calls.at(-1)?.sql).toBe("ROLLBACK");
    expect(store.releases()).toBe(1);
  });
  it("fails closed on corrupt stored content rather than resolving another basket", async () => {
    const store=fakeDb(),identity=basketShareIdentity(encode());
    store.rows.set(identity.id,{id:identity.id,content_hash:identity.contentHash,encoded:encode().slice(0,-1)});
    await expect(getBasketShare(store.db,identity.id)).rejects.toMatchObject({status:503});
  });
  it("enforces finite storage admission while permitting already stored duplicate reads", async () => {
    const store=fakeDb(),encoded=encode(),first=await createBasketShare(store.db,encoded);
    store.setCount(MAX_BASKET_SHARE_ROWS);
    expect(await createBasketShare(store.db,encoded)).toEqual(first);
    const changed=payload();changed[1]="Changed";
    await expect(createBasketShare(store.db,encode(changed))).rejects.toMatchObject({status:429,code:"SHARE_CAPACITY"});
    expect(store.rows.size).toBe(1);
  });
});

describe("basket share HTTP contract and resource boundaries", () => {
  it("creates and resolves inert snapshots using the public contract", async () => {
    const store=fakeDb(),url=await start(store.db),encoded=encode();
    const created=await post(url,{encoded});expect(created.status).toBe(200);
    const {data}=await created.json();
    const found=await fetch(`${url}/${data.id}`);expect(found.status).toBe(200);
    expect(await found.json()).toEqual({data:{id:data.id,encoded}});
    expect(found.headers.get("cache-control")).toContain("immutable");
    expect(found.headers.get("access-control-allow-origin")).toBe("*");
  });
  it("returns400 invalid,404 unknown,503 without a DB and405 on unsupported writes", async () => {
    const url=await start(null);
    expect((await post(url,{encoded:encode()})).status).toBe(503);
    expect((await post(url,{encoded:"bad"})).status).toBe(400);
    expect((await post(url,{encoded:encode(),redirect:"https://evil.test"})).status).toBe(400);
    expect((await fetch(`${url}/../basket-shares/x`)).status).toBe(400);
    expect((await fetch(url,{method:"DELETE"})).status).toBe(405);
    const dbUrl=await start(fakeDb().db);
    expect((await fetch(`${dbUrl}/${"A".repeat(20)}`)).status).toBe(404);
    expect((await fetch(`${dbUrl}/${"A".repeat(20)}?url=evil`)).status).toBe(400);
  });
  it("applies the8KiB declared and streamed body bound before storage", async () => {
    const store=fakeDb(),url=await start(store.db);
    expect((await post(url,{encoded:"a".repeat(9000)})).status).toBe(413);
    const streamed=await new Promise<number>((resolve,reject)=>{
      const request=http.request(url,{method:"POST",headers:{"content-type":"application/json","transfer-encoding":"chunked"}},res=>{res.resume();resolve(res.statusCode!);});
      request.on("error",reject);request.write("{"+"a".repeat(8200));request.end();
    });
    expect(streamed).toBe(413);expect(store.calls).toEqual([]);
  });
  it("limits socket peers before reading a body, ignoring forged forwarded identities", async () => {
    const store=fakeDb(),limits=new ApiResourceLimits({ipLimits:{"share-create":1}}),url=await start(store.db,limits);
    expect((await post(url,{encoded:encode()},{"x-forwarded-for":"client-one"})).status).toBe(200);
    const denied=await post(url,{encoded:encode()},{"x-forwarded-for":"client-two"});
    expect(denied.status).toBe(429);expect(denied.headers.get("retry-after")).toBeTruthy();
    expect(store.rows.size).toBe(1);
  });
  it("enforces a global write budget and bounded concurrency independently of peers", async () => {
    const limits=new ApiResourceLimits({maxBasketShareWrites:1,maxConcurrentBasketShares:1});
    limits.consumeBasketShareWrite();expect(()=>limits.consumeBasketShareWrite()).toThrow();
    const release=limits.acquireBasketShareWrite();expect(()=>limits.acquireBasketShareWrite()).toThrow();
    release();release();expect(()=>limits.acquireBasketShareWrite()).not.toThrow();
    const store=fakeDb(),busy=new ApiResourceLimits({maxConcurrentBasketShares:1}),url=await start(store.db,busy);
    const held=busy.acquireBasketShareWrite();expect((await post(url,{encoded:encode()})).status).toBe(429);held();
    expect(store.calls).toEqual([]);
    expect((await post(url,{encoded:encode()})).status).toBe(200);
  });
  it("bounds the body reader timeout with unchanged default callers", async () => {
    const req=new PassThrough() as unknown as http.IncomingMessage;Object.assign(req,{headers:{}});
    await expect(readJsonBody(req,{maxBytes:8192,timeoutMs:5})).rejects.toMatchObject({status:408,code:"BODY_TIMEOUT"});
    expect(()=>readJsonBody(req,{maxBytes:65537})).toThrow();
  });
});
