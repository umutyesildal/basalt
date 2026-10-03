import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Connection, PublicKey, type AccountInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { EventIndexer, type IndexerConfig, type SolanaRpc } from "../src/indexer/listener";
import bs58 from "bs58";
import { ANCHOR_EVENT_DISCRIMINATORS, CREATE_BASKET_IX_DISCRIMINATOR } from "../src/indexer/events";
import { withRpcBackoff } from "../src/rpc/backoff";
import type { PgLike } from "../src/db/client";

const pk = (n: number) => new PublicKey(Buffer.alloc(32, n));
const factoryProgram = pk(90);
const basketProgram = pk(91);
const whitelistProgram = pk(92);
const creator = pk(11), treasury = pk(12), user = pk(13);
const [factory, factoryBump] = PublicKey.findProgramAddressSync([Buffer.from("factory")], factoryProgram);
const nonce = Buffer.alloc(8); nonce.writeBigUInt64LE(7n);
const [basket, basketBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), factory.toBuffer(), creator.toBuffer(), nonce], factoryProgram);
const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), basket.toBuffer()], factoryProgram);
const [, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), basket.toBuffer()], basketProgram);
const createdAt = 1725148800n, lastAccrual = createdAt + 120n;
const disc = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
const u64 = (value: bigint) => { const result = Buffer.alloc(8); result.writeBigUInt64LE(value); return result; };

function basketAccount(): AccountInfo<Buffer> {
  const data = Buffer.alloc(888); disc("Basket").copy(data);
  factory.toBuffer().copy(data, 8); creator.toBuffer().copy(data, 40);
  treasury.toBuffer().copy(data, 72); shareMint.toBuffer().copy(data, 104);
  nonce.copy(data, 136); data.writeBigInt64LE(createdAt, 144); data.writeBigInt64LE(lastAccrual, 152);
  Buffer.alloc(32, 7).copy(data, 160); data[192] = 2;
  pk(1).toBuffer().copy(data, 193); pk(2).toBuffer().copy(data, 225);
  data.writeUInt16LE(6000, 833); data.writeUInt16LE(4000, 835);
  data.writeUInt16LE(100, 873); data.writeUInt16LE(50, 875); data.writeUInt16LE(200, 877);
  data[879] = basketBump; data[880] = vaultBump;
  return { data, owner: basketProgram, executable: false, lamports: 1, rentEpoch: 0 };
}
function factoryAccount(): AccountInfo<Buffer> {
  const data = Buffer.alloc(89); disc("FactoryConfig").copy(data);
  pk(10).toBuffer().copy(data, 8); treasury.toBuffer().copy(data, 40);
  [9000, 300, 100, 300].forEach((value, i) => data.writeUInt16LE(value, 72 + i * 2));
  data[88] = factoryBump;
  return { data, owner: factoryProgram, executable: false, lamports: 1, rentEpoch: 0 };
}
function mintTx(emitter = basketProgram): ParsedTransactionWithMeta {
  const payload = Buffer.concat([ANCHOR_EVENT_DISCRIMINATORS.Minted, basket.toBuffer(), user.toBuffer(), u64(100n), u64(100n), u64(0n)]);
  return {
    transaction: { message: { instructions: [] } },
    meta: { err: null, innerInstructions: [], logMessages: [
      `Program ${emitter} invoke [1]`, `Program data: ${payload.toString("base64")}`, `Program ${emitter} success`,
    ] },
  } as unknown as ParsedTransactionWithMeta;
}
function fkDb() {
  const parents = new Set<string>(), events = new Set<string>(), claims = new Set<string>();
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    parents, events, calls,
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT pubkey FROM baskets WHERE")) return { rows: parents.has(String(values[0])) ? [{ pubkey: values[0] }] : [], rowCount: 0 };
      if (sql.includes("INSERT INTO baskets")) { const fresh = !parents.has(String(values[0])); parents.add(String(values[0])); return { rows: [], rowCount: fresh ? 1 : 0 }; }
      if (sql.includes("INSERT INTO events")) {
        if (!parents.has(String(values[2]))) throw new Error("events_basket_fkey");
        const fresh = !events.has(String(values[0])); events.add(String(values[0])); return { rows: [], rowCount: fresh ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO position_events")) { const key = `${values[0]}:${values[1]}`; const fresh = !claims.has(key); claims.add(key); return { rows: [], rowCount: fresh ? 1 : 0 }; }
      return { rows: [], rowCount: 0 };
    },
  };
  return db;
}
const signature = { signature: "missing-creation-in-window", slot: 42, blockTime: 1725149900, err: null };
const cfg: IndexerConfig = { programIds: [basketProgram.toBase58()], factoryProgramId: factoryProgram.toBase58(), basketProgramId: basketProgram.toBase58(), pollIntervalMs: 1000, signaturesPerPoll: 1, maxSeenCache: 100, transactionSpacingMs: 0, backoffSleep: async () => {} };
function rpcFor(options: { transaction?: () => Promise<ParsedTransactionWithMeta | null>; account?: () => AccountInfo<Buffer> | null } = {}): SolanaRpc {
  return {
    async getSignaturesForAddress() { return [signature]; },
    async getParsedTransaction() { return options.transaction ? options.transaction() : mintTx(); },
    async getAccountInfo(address) { return address.equals(factory) ? factoryAccount() : options.account ? options.account() : basketAccount(); },
  };
}

describe("indexer authenticated parent recovery", () => {
  it("recovers a creation outside the history window before an FK event, preserving chain timestamps and no synthetic stats", async () => {
    const db = fkDb();
    const indexer = new EventIndexer(rpcFor(), cfg, db as PgLike);
    await indexer.pollOnce();
    const parent = db.calls.find((call) => call.sql.includes("INSERT INTO baskets"))!;
    expect(parent.values[0]).toBe(basket.toBase58());
    expect(parent.values[6]).toEqual(new Date(Number(createdAt) * 1000));
    expect(parent.values[14]).toEqual(new Date(Number(lastAccrual) * 1000));
    expect(db.calls.findIndex((call) => call === parent)).toBeLessThan(db.calls.findIndex((call) => call.sql.includes("INSERT INTO events")));
    expect(db.events.size).toBe(1);
    expect(db.calls.some((call) => call.sql.includes("creator_stats"))).toBe(false);
    await indexer.pollOnce();
    await new EventIndexer(rpcFor(), cfg, db as PgLike).pollOnce();
    expect(db.calls.filter((call) => call.sql.includes("INSERT INTO baskets"))).toHaveLength(1);
    expect(db.events.size).toBe(1);
  });

  it("quarantines a wrong-owner account and never inserts an FK event", async () => {
    const db = fkDb(); const info = basketAccount(); info.owner = pk(99);
    const rpc = rpcFor({ account: () => info }); const fetch = vi.spyOn(rpc, "getParsedTransaction");
    const indexer = new EventIndexer(rpc, cfg, db as PgLike);
    await indexer.pollOnce(); await indexer.pollOnce();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.events.size).toBe(0);
    expect(db.parents.size).toBe(0);
  });

  it("keeps a temporarily missing account retryable beyond five polls", async () => {
    const db = fkDb(); let reads = 0;
    const indexer = new EventIndexer(rpcFor({ account: () => ++reads <= 6 ? null : basketAccount() }), cfg, db as PgLike);
    for (let i = 0; i < 7; i++) await indexer.pollOnce();
    expect(reads).toBe(7);
    expect(db.events.size).toBe(1);
  });

  it("retains a temporary null transaction when it leaves the latest page", async () => {
    const db = fkDb(); let fetches = 0, pages = 0;
    const rpc = rpcFor({ transaction: async () => ++fetches <= 6 ? null : mintTx() });
    rpc.getSignaturesForAddress = async () => ++pages === 1 ? [signature] : [];
    const indexer = new EventIndexer(rpc, cfg, db as PgLike);
    for (let i = 0; i < 7; i++) await indexer.pollOnce();
    expect(fetches).toBe(7);
    expect(db.events.size).toBe(1);
  });

  it("indexes trusted basket CPI events even when the whitelist sweep sees the transaction first", async () => {
    const db = fkDb(); const rpc = rpcFor();
    const fetch = vi.spyOn(rpc, "getParsedTransaction");
    const indexer = new EventIndexer(rpc, { ...cfg, programIds: [whitelistProgram.toBase58(), basketProgram.toBase58()] }, db as PgLike);
    const result = await indexer.pollOnce();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result[0].events).toHaveLength(1);
    const row = db.calls.find((call) => call.sql.includes("INSERT INTO events"))!;
    expect(JSON.parse(String(row.values[4])).programId).toBe(basketProgram.toBase58());
    expect(db.events.size).toBe(1);
  });

  it("ignores a foreign program with a matching Anchor event discriminator", async () => {
    const db = fkDb();
    await new EventIndexer(rpcFor({ transaction: async () => mintTx(pk(99)) }), cfg, db as PgLike).pollOnce();
    expect(db.events.size).toBe(0); expect(db.parents.size).toBe(0);
  });

  it("retries temporary FK/DB failures beyond five polls without duplicating the immutable parent", async () => {
    const db = fkDb(); const originalQuery = db.query.bind(db); let eventAttempts = 0;
    db.query = async (sql, values) => {
      if (sql.includes("INSERT INTO events") && ++eventAttempts <= 6) throw new Error("temporary events_basket_fkey constraint wait");
      return originalQuery(sql, values);
    };
    const indexer = new EventIndexer(rpcFor(), cfg, db as PgLike);
    for (let i = 0; i < 7; i++) await indexer.pollOnce();
    expect(eventAttempts).toBe(7); expect(db.events.size).toBe(1);
    expect(db.calls.filter((call) => call.sql.includes("INSERT INTO baskets"))).toHaveLength(1);
  });

  it("resolves creation against the factory emitter when a whitelist sweep sees a factory-to-basket CPI first", async () => {
    const db = fkDb();
    const uint32 = (value: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
    const uint16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
    const args = Buffer.concat([CREATE_BASKET_IX_DISCRIMINATOR, nonce, uint32(2), pk(1).toBuffer(), pk(2).toBuffer(), uint32(2), uint16(6000), uint16(4000), uint16(100), uint16(50), uint16(200), Buffer.alloc(32, 7), uint32(2), u64(500n), u64(300n)]);
    const eventTime = Buffer.alloc(8); eventTime.writeBigInt64LE(createdAt);
    const created = Buffer.concat([ANCHOR_EVENT_DISCRIMINATORS.BasketCreated, basket.toBuffer(), creator.toBuffer(), Buffer.from([2]), shareMint.toBuffer(), eventTime]);
    const tx = {
      transaction: { message: { instructions: [{ programId: factoryProgram, accounts: [factory, basket, shareMint, creator], data: bs58.encode(args) }] } },
      meta: { err: null, innerInstructions: [], logMessages: [
        `Program ${factoryProgram} invoke [1]`, `Program ${basketProgram} invoke [2]`, `Program ${basketProgram} success`,
        `Program data: ${created.toString("base64")}`, `Program ${factoryProgram} success`,
      ] },
    } as unknown as ParsedTransactionWithMeta;
    const rpc = rpcFor({ transaction: async () => tx }); const fetch = vi.spyOn(rpc, "getParsedTransaction");
    await new EventIndexer(rpc, { ...cfg, programIds: [whitelistProgram.toBase58(), basketProgram.toBase58(), factoryProgram.toBase58()] }, db as PgLike).pollOnce();
    expect(fetch).toHaveBeenCalledTimes(1); expect(db.events.size).toBe(1);
    expect(db.calls.filter((call) => call.sql.includes("creator_stats"))).toHaveLength(1);
    const event = db.calls.find((call) => call.sql.includes("INSERT INTO events"))!;
    expect(JSON.parse(String(event.values[4])).programId).toBe(factoryProgram.toBase58());
    expect(JSON.parse(String(event.values[4])).createBasket.nonce).toBe("7");
  });

  it("does not turn an exhausted treasury RPC read into a fabricated parent", async () => {
    const db = fkDb(); const rpc = rpcFor();
    let factoryReads = 0;
    rpc.getAccountInfo = async (address) => {
      if (!address.equals(factory)) return basketAccount();
      if (++factoryReads <= 6) throw new Error("429 Too Many Requests");
      return factoryAccount();
    };
    const indexer = new EventIndexer(rpc, cfg, db as PgLike);
    await indexer.pollOnce(); await indexer.pollOnce();
    expect(db.events.size).toBe(0); expect(db.parents.size).toBe(0);
    await indexer.pollOnce();
    expect(factoryReads).toBe(7); expect(db.events.size).toBe(1);
  });
});

it("web3 with retries disabled makes exactly three HTTP reads under the shared 429 backoff", async () => {
  const fetchRead = vi.fn(async () => new Response("Too Many Requests", { status: 429 }));
  const connection = new Connection("https://rpc.example.invalid", { disableRetryOnRateLimit: true, fetch: fetchRead as typeof fetch });
  await expect(withRpcBackoff(() => connection.getSlot(), { sleep: async () => {}, logKey: "test:single-retry-layer" })).rejects.toThrow(/429/);
  expect(fetchRead).toHaveBeenCalledTimes(3);
});
