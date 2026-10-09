/**
 * positionsSync.test.ts — chain-truth user_positions reconciliation
 * (indexer/positionsSync.ts), the listener ERR GUARD (failed transactions
 * never contribute events), and the GET /api/v1/positions?wallet= route.
 *
 * RPC is entirely fake. Snapshot tests use canonical raw account bytes; atomic
 * reconciliation is exercised separately in positions-reconciliation.sql.test.ts.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import http from "http";
import { PublicKey, type AccountInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import type { PgLike } from "../src/db/client";
import { ANCHOR_EVENT_DISCRIMINATORS, type MintedEvent } from "../src/indexer/events";
import { EventIndexer, type SolanaRpc } from "../src/indexer/listener";
import {
  fetchFinalizedPositionSnapshot,
  fetchShareHolders,
  parseShareHolders,
  parseTokenAccountOwnerAmount,
  syncPositionsFromChain,
  type PositionsSyncRpc,
} from "../src/indexer/positionsSync";
import { createHandler, userPositionsByWallet } from "../src/api/server";
import { positionRecoveryFixture, recoveryKey } from "./fixtures/position-recovery";

// --- fixtures ------------------------------------------------------------------

const pk = (n: number) => new PublicKey(Buffer.alloc(32, n));
const BASKET = pk(10).toBase58();
const SHARE_MINT = pk(11).toBase58();
const USER = pk(20).toBase58();
const USER2 = pk(21).toBase58();
const USER3 = pk(22).toBase58();

/** Hand-built SPL token / Token-2022 token account (mint|owner|amount u64 LE). */
function tokenAccount(
  owner: PublicKey | string,
  mint: PublicKey | string,
  amount: bigint,
): { pubkey: PublicKey; account: AccountInfo<Buffer> } {
  const data = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(data, 0);
  new PublicKey(owner).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt8(1, 108); // AccountState::Initialized
  return { pubkey: pk((new PublicKey(owner).toBuffer()[0] + 100) % 250), account: { data, executable: false, owner: TOKEN_2022_PROGRAM_ID, lamports: 1 } };
}

/**
 * Fake RPC: answers getProgramAccounts per the mint in the memcmp filter
 * (mirrors production), with an optional set of mints that always 429 —
 * pass an instant `backoffSleep` so exhausting the shared backoff is free.
 */
function gpaRpcByMint(
  perMint: Record<string, Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>>,
  opts: { failMints?: Set<string> } = {},
): PositionsSyncRpc & { calls: number } {
  const rpc = {
    calls: 0,
    async getAccountInfoAndContext() { throw new Error("Unexpected account read"); },
    async getProgramAccounts(_pid: PublicKey, cfg?: { filters?: Array<{ memcmp?: { bytes: string } }> }) {
      rpc.calls++;
      const mint = cfg?.filters?.[0]?.memcmp?.bytes ?? "?";
      if (opts.failMints?.has(mint)) throw new Error("429 Too Many Requests");
      return { context: { slot: 100 }, value: perMint[mint] ?? [] };
    },
  };
  return rpc;
}

interface SyncRow {
  user: string;
  basket: string;
  share_balance: string;
  cost_basis: string | null;
  cost_basis_source: string | null;
}

type SyncDb = PgLike & {
  rows: Map<string, SyncRow>;
  calls: Array<{ sql: string; values?: unknown[] }>;
  /** users that have a Minted/Redeemed events row per basket. */
  eventUsers: Map<string, Set<string>>;
};

/**
 * Stateful fake: actually mutates a (user|basket → row) map for the four
 * sync write shapes, and answers the baskets / user_positions / events
 * reads from state.
 */
function syncDb(
  baskets: Array<{ pubkey: string; share_mint: string }>,
  eventUsers: Map<string, Set<string>> = new Map(),
): SyncDb {
  const rows = new Map<string, SyncRow>();
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const key = (u: unknown, b: unknown) => `${u}|${b}`;
  const db = {
    rows,
    calls,
    eventUsers,
    query: async (sql: string, values: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
      calls.push({ sql, values });
      if (sql.includes("FROM baskets")) {
        return { rows: baskets.map((b) => ({ ...b })), rowCount: baskets.length };
      }
      if (sql.includes("FROM events")) {
        const basket = values[0] as string;
        const users = (values[1] as string[]) ?? [];
        const withEvents = eventUsers.get(basket) ?? new Set<string>();
        const hit = users.filter((u) => withEvents.has(u)).map((user) => ({ user }));
        return { rows: hit, rowCount: hit.length };
      }
      if (sql.startsWith("SELECT")) {
        // SELECT "user", basket FROM user_positions
        return { rows: [...rows.values()].map((r) => ({ user: r.user, basket: r.basket })), rowCount: rows.size };
      }
      if (sql.startsWith("UPDATE user_positions") && sql.includes("cost_basis_source = 'balance-sync'")) {
        const row = rows.get(key(values[0], values[1]));
        if (!row) return { rows: [], rowCount: 0 };
        row.share_balance = values[2] as string;
        row.cost_basis_source = "balance-sync"; // cost_basis intentionally untouched
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE user_positions")) {
        const row = rows.get(key(values[0], values[1]));
        if (!row) return { rows: [], rowCount: 0 };
        row.share_balance = values[2] as string; // cost_basis + source kept
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO user_positions")) {
        const balanceSync = sql.includes("'balance-sync'");
        rows.set(key(values[0], values[1]), {
          user: values[0] as string,
          basket: values[1] as string,
          share_balance: values[2] as string,
          cost_basis: null,
          cost_basis_source: balanceSync ? "balance-sync" : null,
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("DELETE FROM user_positions")) {
        const basket = values[0] as string;
        const users = (values[1] as string[]) ?? [];
        let removed = 0;
        for (const u of users) if (rows.delete(key(u, basket))) removed++;
        return { rows: [], rowCount: removed };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return db as unknown as SyncDb;
}

// ============================================================================
// 1. token account parsing (pure)
// ============================================================================

describe("positionsSync — token account parsing", () => {
  it("parses owner + amount from a raw token account buffer", () => {
    const parsed = parseTokenAccountOwnerAmount(tokenAccount(USER, SHARE_MINT, 123456n).account.data);
    expect(parsed).toEqual({ owner: USER, amount: 123456n });
  });

  it("rejects short/malformed buffers (never invents a position)", () => {
    expect(parseTokenAccountOwnerAmount(Buffer.alloc(10))).toBeNull();
    expect(parseTokenAccountOwnerAmount(Buffer.alloc(0))).toBeNull();
  });

  it("parseShareHolders sums multiple accounts per owner and drops zero balances", () => {
    const accounts = [
      tokenAccount(USER, SHARE_MINT, 1000n),
      tokenAccount(USER2, SHARE_MINT, 7n),
      { ...tokenAccount(USER, SHARE_MINT, 500n), pubkey: pk(199) }, // distinct account, same owner
      tokenAccount(USER3, SHARE_MINT, 0n), // drained → not a holder
    ];
    const holders = parseShareHolders(accounts, SHARE_MINT);
    expect(holders).toHaveLength(2);
    const byUser = new Map(holders.map((h) => [h.user, h.amount]));
    expect(byUser.get(USER)).toBe("1500"); // u64 sum, decimal string
    expect(byUser.get(USER2)).toBe("7");
  });

  it("fetchShareHolders passes the mint memcmp filter through the backoff pacer", async () => {
    const rpc = gpaRpcByMint({ [SHARE_MINT]: [tokenAccount(USER, SHARE_MINT, 42n)] });
    let seenCfg: unknown;
    const spy: PositionsSyncRpc = {
      getAccountInfoAndContext: rpc.getAccountInfoAndContext,
      getProgramAccounts: async (_pid, cfg) => {
        seenCfg = cfg;
        return rpc.getProgramAccounts(_pid, cfg);
      },
    };
    const holders = await fetchShareHolders(spy, SHARE_MINT);
    expect(holders).toEqual([{ user: USER, mint: SHARE_MINT, amount: "42" }]);
    const cfg = seenCfg as { filters: Array<{ memcmp?: { offset: number; bytes: string } }> };
    expect(cfg.filters[0].memcmp).toEqual({ offset: 0, bytes: SHARE_MINT });
  });

  it("never falls back to unauthenticated enhanced-provider balances", async () => {
    const invoke = vi.fn(async () => ({ token_accounts: [{ mint: SHARE_MINT, amount: 4000, owner: USER }] }));
    const blockedRpc = gpaRpcByMint({});
    blockedRpc.getProgramAccounts = async () => { throw new Error("excluded from account secondary indexes"); };
    await expect(fetchShareHolders(blockedRpc, SHARE_MINT, { jsonRpcInvoke: invoke })).rejects.toThrow("excluded");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("no fallback on 429s: a rate-limited gPA propagates after backoff (contained per basket)", async () => {
    let gpaCalls = 0;
    const limitedRpc: PositionsSyncRpc = {
      async getAccountInfoAndContext() { throw new Error("Unexpected account read"); },
      getProgramAccounts: async () => {
        gpaCalls++;
        throw new Error("429 Too Many Requests");
      },
    };
    let invocations = 0;
    await expect(fetchShareHolders(limitedRpc, SHARE_MINT, {
      backoffSleep: async () => {},
      jsonRpcInvoke: async () => {
        invocations++;
        return {};
      },
    })).rejects.toThrow("429");
    expect(gpaCalls).toBe(3); // 1 initial + 2 backoff retries (the ONE retry layer)
    expect(invocations).toBe(0); // 429s never trigger the provider fallback
  });
});

// ============================================================================
// Strict finalized snapshots; projection writes are verified against real SQL below.
// ============================================================================

describe("positionsSync — authenticated finalized snapshots", () => {
  afterEach(() => vi.useRealTimers());
  const fetch = (f: ReturnType<typeof positionRecoveryFixture>, rpc = f.rpc) =>
    fetchFinalizedPositionSnapshot(rpc, f.basket.toBase58(), f.programs, async () => {});

  it("authenticates canonical basket, share authority, exact raw supply and all finalized contexts", async () => {
    const f = positionRecoveryFixture({ holders: [{user:recoveryKey(20),amount:9_007_199_254_740_993n}, {user:recoveryKey(21),amount:7n}] });
    const snapshot = await fetch(f);
    expect(snapshot).toMatchObject({slot:100,supply:"9007199254741000",balances:[{user:USER,shares:"9007199254740993"},{user:USER2,shares:"7"}]});
    expect(f.calls.map(call => call.config)).toEqual([
      {commitment:"finalized",minContextSlot:0},
      {commitment:"finalized",encoding:"base64",withContext:true,minContextSlot:100,filters:[{memcmp:{offset:0,bytes:f.shareMint.toBase58()}}]},
      {commitment:"finalized",minContextSlot:100},
    ]);
  });

  it.each([0n, 1000n])("requires complete enumeration even for supply %s", async supply => {
    const f = positionRecoveryFixture({holders:[],supply});
    if (supply === 0n) expect(await fetch(f)).toMatchObject({slot:100,supply:"0",balances:[]});
    else await expect(fetch(f)).rejects.toThrow("reconcile");
  });

  it.each([
    ["owner", (f: ReturnType<typeof positionRecoveryFixture>) => {f.accounts[0].account.owner=recoveryKey(1);}],
    ["mint", (f: ReturnType<typeof positionRecoveryFixture>) => {recoveryKey(1).toBuffer().copy(f.accounts[0].account.data,0);}],
    ["uninitialized", (f: ReturnType<typeof positionRecoveryFixture>) => {f.accounts[0].account.data[108]=0;}],
    ["invalid state", (f: ReturnType<typeof positionRecoveryFixture>) => {f.accounts[0].account.data[108]=3;}],
    ["executable", (f: ReturnType<typeof positionRecoveryFixture>) => {f.accounts[0].account.executable=true;}],
    ["truncated", (f: ReturnType<typeof positionRecoveryFixture>) => {f.accounts[0].account.data=Buffer.alloc(164);}],
    ["invalid option", (f: ReturnType<typeof positionRecoveryFixture>) => {f.accounts[0].account.data.writeUInt32LE(2,72);}],
    ["native share account", (f: ReturnType<typeof positionRecoveryFixture>) => {f.accounts[0].account.data.writeUInt32LE(1,109);}],
    ["duplicate", (f: ReturnType<typeof positionRecoveryFixture>) => {f.accounts.push(f.accounts[0]);}],
    ["malformed extension", (f: ReturnType<typeof positionRecoveryFixture>) => {const data=Buffer.alloc(170);f.accounts[0].account.data.copy(data);data[165]=2;data.writeUInt16LE(7,166);data.writeUInt16LE(100,168);f.accounts[0].account.data=data;}],
  ] as const)("rejects %s holder evidence", async (_name, mutate) => {
    const f=positionRecoveryFixture(); mutate(f); await expect(fetch(f)).rejects.toThrow();
  });

  it.each([
    ["basket owner", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.basketAccount.owner=recoveryKey(1);}],
    ["basket executable", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.basketAccount.executable=true;}],
    ["basket discriminator", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.basketAccount.data[0]^=1;}],
    ["factory PDA", (f: ReturnType<typeof positionRecoveryFixture>)=>{recoveryKey(1).toBuffer().copy(f.basketAccount.data,8);}],
    ["share PDA", (f: ReturnType<typeof positionRecoveryFixture>)=>{recoveryKey(1).toBuffer().copy(f.basketAccount.data,104);}],
    ["vault bump", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.basketAccount.data[880]^=1;}],
    ["mint owner", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.mintAccount.owner=recoveryKey(1);}],
    ["mint executable", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.mintAccount.executable=true;}],
    ["mint uninitialized", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.mintAccount.data[45]=0;}],
    ["mint malformed bool", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.mintAccount.data[45]=2;}],
    ["mint decimals", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.mintAccount.data[44]=9;}],
    ["mint authority", (f: ReturnType<typeof positionRecoveryFixture>)=>{recoveryKey(1).toBuffer().copy(f.mintAccount.data,4);}],
    ["mint authority option", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.mintAccount.data.writeUInt32LE(2,0);}],
    ["mint freeze authority", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.mintAccount.data.writeUInt32LE(1,46);}],
    ["mint extension", (f: ReturnType<typeof positionRecoveryFixture>)=>{f.mintAccount.data=Buffer.concat([f.mintAccount.data,Buffer.alloc(84)]);}],
  ] as const)("rejects malformed or substituted %s", async (_name, mutate)=>{
    const f=positionRecoveryFixture();mutate(f);await expect(fetch(f)).rejects.toThrow();
  });

  it("allows earlier immutable basket state, with exactly matching holder and mint slots",async()=>{
    const f=positionRecoveryFixture(); const original=f.rpc.getAccountInfoAndContext;
    f.rpc.getAccountInfoAndContext=async(address,cfg)=>{const row=await original(address,cfg);return {...row,context:{slot:address.equals(f.basket)?99:100}};};
    expect((await fetch(f)).slot).toBe(100);
  });
  it.each([NaN,-1,1.5,Number.MAX_SAFE_INTEGER+1])("rejects invalid context %s",async slot=>{
    const f=positionRecoveryFixture();f.rpc.getAccountInfoAndContext=async()=>({context:{slot},value:f.basketAccount});
    await expect(fetch(f)).rejects.toThrow("context");expect(f.calls).toHaveLength(0);
  });
  it("rejects a provider returning a holder slot earlier than its basket",async()=>{
    const f=positionRecoveryFixture();f.rpc.getProgramAccounts=async()=>({context:{slot:99},value:f.accounts});
    await expect(fetch(f)).rejects.toThrow("regressing");
  });
  it("retries at most three drifted contexts while increasing every minimum slot",async()=>{
    const f=positionRecoveryFixture();let round=0;const minima:number[]=[];
    f.rpc.getAccountInfoAndContext=async(address,cfg)=>{minima.push(cfg.minContextSlot!);if(address.equals(f.basket)){round++;return{context:{slot:100+round},value:f.basketAccount};}return{context:{slot:101+round},value:f.mintAccount};};
    f.rpc.getProgramAccounts=async(_pid,cfg)=>{minima.push(cfg.minContextSlot!);return{context:{slot:100+round},value:f.accounts};};
    await expect(fetch(f)).rejects.toThrow("contexts differ");expect(round).toBe(3);expect(minima).toEqual([0,101,101,102,102,102,103,103,103]);
  });
  it("accepts a second coherent context without ever regressing the previous minimum",async()=>{
    const f=positionRecoveryFixture();let round=0;
    f.rpc.getAccountInfoAndContext=async(address,cfg)=>{if(address.equals(f.basket)){round++;expect(cfg.minContextSlot).toBe(round===1?0:101);return{context:{slot:round===1?100:101},value:f.basketAccount};}return{context:{slot:101},value:f.mintAccount};};
    f.rpc.getProgramAccounts=async()=>({context:{slot:round===1?100:101},value:f.accounts});
    expect((await fetch(f)).slot).toBe(101);expect(round).toBe(2);
  });
  it("enforces one ten-second deadline across a stalled read and ignores its late result",async()=>{
    vi.useFakeTimers();const f=positionRecoveryFixture();let resolve!: (value:any)=>void;
    f.rpc.getAccountInfoAndContext=()=>new Promise(done=>{resolve=done;});
    const pending=fetch(f);const rejected=expect(pending).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(10_000);await rejected;
    resolve({context:{slot:100},value:f.basketAccount});await Promise.resolve();
    expect(f.calls).toHaveLength(0);
  });
  it("enforces the same deadline during a stalled rate-limit backoff",async()=>{
    vi.useFakeTimers();const f=positionRecoveryFixture();f.rpc.getAccountInfoAndContext=async()=>{throw new Error("429 Too Many Requests");};
    const pending=fetchFinalizedPositionSnapshot(f.rpc,f.basket.toBase58(),f.programs,()=>new Promise(()=>{}));
    const rejected=expect(pending).rejects.toThrow("deadline");await vi.advanceTimersByTimeAsync(10_000);await rejected;
  });
  it("rejects a regressing context on a retry instead of accepting an older coherent view",async()=>{
    const f=positionRecoveryFixture();let round=0;
    f.rpc.getAccountInfoAndContext=async(address)=>{if(address.equals(f.basket)){round++;return{context:{slot:100},value:f.basketAccount};}return{context:{slot:101},value:f.mintAccount};};
    f.rpc.getProgramAccounts=async()=>({context:{slot:100},value:f.accounts});
    await expect(fetch(f)).rejects.toThrow("regressing");expect(round).toBe(2);
  });
  it("does not retry a missing mint as though it were harmless context drift",async()=>{
    const f=positionRecoveryFixture();const original=f.rpc.getAccountInfoAndContext;let reads=0;
    f.rpc.getAccountInfoAndContext=async(address,cfg)=>{reads++;return address.equals(f.shareMint)?{context:{slot:100},value:null}:original(address,cfg);};
    await expect(fetch(f)).rejects.toThrow("mint unavailable");expect(reads).toBe(2);
  });
  it("accepts authenticated frozen share accounts and sums distinct accounts for one holder",async()=>{
    const f=positionRecoveryFixture({holders:[{user:recoveryKey(20),amount:3n},{user:recoveryKey(20),amount:7n}]});
    f.accounts[0].account.data[108]=2;
    expect((await fetch(f)).balances).toEqual([{user:USER,shares:"10"}]);
  });
  it("bounds stalled catch-up and issues no projection transaction",async()=>{
    vi.useFakeTimers();const f=positionRecoveryFixture();const db=syncDb([{pubkey:f.basket.toBase58(),share_mint:f.shareMint.toBase58()}]);
    const pending=syncPositionsFromChain(f.rpc,db,{programs:f.programs,spacingMs:0,catchUpThroughSlot:()=>new Promise(()=>{})});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({basketsScanned:0,basketsFailed:1});
    expect(db.calls.map(call=>call.sql)).toEqual(["SELECT pubkey FROM baskets ORDER BY pubkey"]);
  });
  it("a stalled snapshot never acquires a database transaction or mutates existing balances",async()=>{
    vi.useFakeTimers();const f=positionRecoveryFixture();const db=syncDb([{pubkey:f.basket.toBase58(),share_mint:f.shareMint.toBase58()}]);
    f.rpc.getAccountInfoAndContext=()=>new Promise(()=>{});
    const pending=syncPositionsFromChain(f.rpc,db,{programs:f.programs,spacingMs:0});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({basketsScanned:0,basketsFailed:1});
    expect(db.calls.map(call=>call.sql)).toEqual(["SELECT pubkey FROM baskets ORDER BY pubkey"]);expect(db.rows.size).toBe(0);
  });
  it("requires explicit distinct canonical program roles",async()=>{
    const f=positionRecoveryFixture();await expect(fetchFinalizedPositionSnapshot(f.rpc,f.basket.toBase58(),{...f.programs,ids:[f.programs.basket.toBase58()]})).rejects.toThrow("program IDs");
    expect(f.calls).toHaveLength(0);
  });
  it("refuses configured persistence without authenticated program roles before any SQL/RPC",async()=>{
    const db=syncDb([{pubkey:BASKET,share_mint:SHARE_MINT}]);const f=positionRecoveryFixture();
    await expect(syncPositionsFromChain(f.rpc,db)).rejects.toThrow("programs");expect(db.calls).toEqual([]);expect(f.calls).toEqual([]);
  });
  it("null DB returns honest empty statistics without RPC",async()=>{
    const f=positionRecoveryFixture();expect(await syncPositionsFromChain(f.rpc,null)).toEqual({basketsScanned:0,basketsFailed:0,holders:0,balanceSynced:0,eventKept:0,zeroed:0});expect(f.calls).toEqual([]);
  });
});

// ============================================================================
// 3. listener ERR GUARD — failed transactions never contribute events
// ============================================================================

describe("listener — err guard (failed txs are never indexed)", () => {
  function u64le(v: bigint): Buffer {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v);
    return b;
  }

  function mintedLogPayload(ev: MintedEvent): Buffer {
    return Buffer.concat([
      ANCHOR_EVENT_DISCRIMINATORS.Minted,
      new PublicKey(ev.basket).toBuffer(),
      new PublicKey(ev.user).toBuffer(),
      u64le(BigInt(ev.grossShares)),
      u64le(BigInt(ev.netShares)),
      u64le(BigInt(ev.entryFeeShares)),
    ]);
  }

  const MINTED: MintedEvent = {
    type: "Minted",
    basket: BASKET,
    user: USER,
    grossShares: "1001000",
    netShares: "1000000",
    entryFeeShares: "1000",
  };

  function fakeTx(logs: string[], err: unknown = null): ParsedTransactionWithMeta {
    return {
      transaction: { message: { instructions: [] } },
      meta: { logMessages: [`Program ${pk(99)} invoke [1]`, ...logs, `Program ${pk(99)} ${err ? "failed: fixture error" : "success"}`], innerInstructions: [], slot: 42, err },
    } as unknown as ParsedTransactionWithMeta;
  }

  function rpcFor(
    sigErr: unknown,
    tx: ParsedTransactionWithMeta,
    fetched: string[] = [],
  ): SolanaRpc {
    return {
      async getSignaturesForAddress() {
        return [{ signature: "FAILED-SIG", slot: 42, err: sigErr, blockTime: 1725148800 }];
      },
      async getParsedTransaction(sig: string) {
        fetched.push(sig);
        return tx;
      },
      async getAccountInfo() {
        return null;
      },
    };
  }

  const CFG = { programIds: [pk(99).toBase58()], pollIntervalMs: 1000, signaturesPerPoll: 10, maxSeenCache: 100 };
  const log = [`Program data: ${mintedLogPayload(MINTED).toString("base64")}`];

  it("meta.err non-null: the Minted log in the tx is NOT indexed — no events, no position, counter increments", async () => {
    const db = syncDb([{ pubkey: BASKET, share_mint: SHARE_MINT }]);
    const fetched: string[] = [];
    const indexer = new EventIndexer(rpcFor(null, fakeTx(log, { InstructionError: [0, "custom"] }), fetched), CFG, db);
    await indexer.pollOnce();
    expect(indexer.failedTxSkipCount).toBe(1);
    expect(fetched).toEqual(["FAILED-SIG"]); // tx WAS fetched (meta-level guard)
    // nothing written: no events row, no position_events claim, no balance
    expect(db.calls.filter((c) => c.sql.includes("INSERT INTO events")).length).toBe(0);
    expect(db.calls.filter((c) => c.sql.includes("INSERT INTO position_events")).length).toBe(0);
    expect(db.rows.size).toBe(0);
  });

  it("sig-level err non-null: counted and skipped, tx never even fetched", async () => {
    const db = syncDb([]);
    const fetched: string[] = [];
    const indexer = new EventIndexer(rpcFor("AccountInUse", fakeTx(log), fetched), CFG, db);
    await indexer.pollOnce();
    expect(indexer.failedTxSkipCount).toBe(1);
    expect(fetched).toEqual([]); // getParsedTransaction never called
    expect(db.calls.filter((c) => c.sql.includes("INSERT INTO events")).length).toBe(0);
  });

  it("healthy tx with meta.err null reaches event persistence (guard does not over-skip)", async () => {
    const db = syncDb([{ pubkey: BASKET, share_mint: SHARE_MINT }], new Map([[BASKET, new Set([USER])]]));
    // This fixture only tests the err guard reaching event persistence.
    // Its empty claim result represents a duplicate position event.
    db.connect = async () => ({ query: db.query.bind(db), release() {} });
    const indexer = new EventIndexer(rpcFor(null, fakeTx(log)), CFG, db);
    await indexer.pollOnce();
    expect(indexer.failedTxSkipCount).toBe(0);
    expect(db.calls.filter((c) => c.sql.includes("INSERT INTO events")).length).toBe(1);
  });
});

// ============================================================================
// 4. GET /api/v1/positions?wallet= — shape + validation
// ============================================================================

describe("positions API — userPositionsByWallet + route", () => {
  const WALLET = USER;

  const POSITION_ROW = {
    basket: BASKET,
    basket_symbol: null,
    share_balance: "3860",
    cost_basis: "1403.69898413704",
    cost_basis_source: "reference",
    share_price: "0.363654972942",
    share_price_as_of: "2026-09-05T19:00:00.000Z",
    valuation_eligible: true,
    valuation_status: "complete",
    projection_pending: false,
    value_usd: "1403.708195555812",
    updated_at: "2026-09-05T19:30:00.000Z",
  };

  function makeFakeDb(rows: unknown[]) {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const db = {
      calls,
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
      },
    };
    return db as unknown as PgLike & { calls: Array<{ sql: string; values?: unknown[] }> };
  }
  const fakeDb = makeFakeDb;

  it("returns the documented shape: basket/symbol/balance/price/value/costBasis/source + wallet + asOf", async () => {
    const db = fakeDb([POSITION_ROW]);
    const out = await userPositionsByWallet(db, WALLET);
    expect(out.status).toBe(200);
    const payload = out.payload as {
      data: Array<Record<string, unknown>>;
      wallet: string;
      asOf: string;
      count: number;
      source: string;
    };
    expect(payload.wallet).toBe(WALLET);
    expect(payload.count).toBe(1);
    expect(typeof payload.asOf).toBe("string");
    expect(payload.source).toBe("onchain-indexed");
    expect(payload.data[0]).toEqual({
      basket: BASKET,
      basketSymbol: null,
      shareBalance: "3860",
      sharePrice: "0.363654972942",
      valueUsd: "1403.708195555812",
      costBasis: "1403.69898413704",
      source: "reference",
      sharePriceAsOf: "2026-09-05T19:00:00.000Z",
      quality: {asOf:"2026-09-05T19:00:00.000Z",eligible:false,complete:true,status:"stale",stale:true},
      projectionStatus: "indexed",
    });
  });

  it("survives NULL nav/price columns (no NAV snapshots yet → nulls, never fabricated)", async () => {
    const db = fakeDb([{ ...POSITION_ROW, share_price: null, value_usd: null, share_price_as_of: null, cost_basis: null, cost_basis_source: null }]);
    const out = await userPositionsByWallet(db, WALLET);
    const item = (out.payload as { data: Array<Record<string, unknown>> }).data[0];
    expect(item.sharePrice).toBeNull();
    expect(item.valueUsd).toBeNull();
    expect(item.costBasis).toBeNull();
    expect(item.source).toBeNull();
  });

  it("empty wallet → 200 with an empty data list (never fabricated)", async () => {
    const out = await userPositionsByWallet(fakeDb([]), WALLET);
    expect(out.status).toBe(200);
    expect((out.payload as { data: unknown[] }).data).toEqual([]);
  });

  // --- handler-level: validation + trust boundary ----------------------------

  function makeReq(url: string): http.IncomingMessage {
    return {
      method: "GET",
      url,
      headers: { host: "localhost:3001" },
      on: (event: string, cb: (chunk?: Buffer) => void) => {
        if (event === "end") cb();
      },
    } as unknown as http.IncomingMessage;
  }

  function makeRes(): { res: http.ServerResponse; state: { statusCode: number; body: string } } {
    const state = { statusCode: 200, body: "" };
    const res = {
      setHeader: () => {},
      get statusCode() { return state.statusCode; },
      set statusCode(v: number) { state.statusCode = v; },
      end: (payload?: string | Buffer) => { state.body = payload ? payload.toString() : ""; },
    };
    return { res: res as unknown as http.ServerResponse, state };
  }

  it("handler: valid wallet answers 200 with the position payload", async () => {
    const handler = createHandler({ db: fakeDb([POSITION_ROW]) });
    const { res, state } = makeRes();
    await handler(makeReq(`/api/v1/positions?wallet=${WALLET}`), res);
    expect(state.statusCode).toBe(200);
    const payload = JSON.parse(state.body) as { wallet: string; data: Array<{ shareBalance: string }> };
    expect(payload.wallet).toBe(WALLET);
    expect(payload.data[0].shareBalance).toBe("3860");
  });

  it("handler: invalid wallet → 400 INVALID_PUBKEY (never reaches the DB layer)", async () => {
    const db = fakeDb([]);
    const handler = createHandler({ db });
    const { res, state } = makeRes();
    await handler(makeReq("/api/v1/positions?wallet=not-a-pubkey!"), res);
    expect(state.statusCode).toBe(400);
    expect(JSON.parse(state.body).error.code).toBe("INVALID_PUBKEY");
    expect(db.calls.length).toBe(0); // validation rejected before any query
  });

  it("handler: missing wallet param → 400 INVALID_PUBKEY", async () => {
    const handler = createHandler({ db: fakeDb([]) });
    const { res, state } = makeRes();
    await handler(makeReq("/api/v1/positions"), res);
    expect(state.statusCode).toBe(400);
    expect(JSON.parse(state.body).error.code).toBe("INVALID_PUBKEY");
  });

  it("handler: DB-less mode → 503 DB_UNAVAILABLE", async () => {
    const handler = createHandler({ db: null });
    const { res, state } = makeRes();
    await handler(makeReq(`/api/v1/positions?wallet=${WALLET}`), res);
    expect(state.statusCode).toBe(503);
    expect(JSON.parse(state.body).error.code).toBe("DB_UNAVAILABLE");
  });

  it("env wiring: POSITIONS_SYNC_MS overrides the default cadence", async () => {
    const { indexerConfigFromEnv } = await import("../src/indexer/listener");
    const cfg = indexerConfigFromEnv({
      RPC_URL: "http://localhost:8899",
      PROGRAM_BASKET: pk(99).toBase58(),
      PROGRAM_FACTORY: pk(98).toBase58(),
      PROGRAM_WHITELIST: pk(97).toBase58(),
      POSITIONS_SYNC_MS: "45000",
    });
    expect(cfg?.positionsSyncIntervalMs).toBe(45000);
    const cfgDefault = indexerConfigFromEnv({
      RPC_URL: "http://localhost:8899",
      PROGRAM_BASKET: pk(99).toBase58(),
      PROGRAM_FACTORY: pk(98).toBase58(),
      PROGRAM_WHITELIST: pk(97).toBase58(),
    });
    expect(cfgDefault?.positionsSyncIntervalMs).toBe(120000);
  });
});
