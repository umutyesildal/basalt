/**
 * events-route.test.ts — spec §8 GET /events?basket=&type=&limit=.
 *
 * Covers the compliance boundary only: route params (required basket,
 * canonical base58, allowlisted type, clamped integer limit), the
 * NOT_INDEXED / DB_UNAVAILABLE degradation patterns (identical to the other
 * basket routes), and per-row provenance (source/asOf on every row). Runs on
 * a fake PgLike + the real createHandler — no RPC, no real Postgres, and the
 * response never fabricates events.
 */
import { describe, it, expect } from "vitest";
import http from "http";
import { PublicKey } from "@solana/web3.js";

import { basketEvents, createHandler } from "../src/api/server";
import type { PgLike } from "../src/db/client";

// --- fakes -------------------------------------------------------------------

type SqlRoute = { match: string | RegExp; rows: unknown[]; rowCount?: number };

/** PgLike test double that routes canned rows by SQL fragment and records calls. */
function fakeDb(routes: SqlRoute[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    calls,
    query: async (sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> => {
      calls.push({ sql, values });
      for (const r of routes) {
        if (typeof r.match === "string" ? sql.includes(r.match) : r.match.test(sql)) {
          return { rows: r.rows.map((x) => ({ ...x })), rowCount: r.rowCount ?? r.rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PgLike & { calls: Array<{ sql: string; values?: unknown[] }> };
}

const BASKET = new PublicKey(Buffer.alloc(32, 1)).toBase58();
const ALT_BASKET = new PublicKey(Buffer.alloc(32, 21)).toBase58();

/** Two ledger rows exactly as the events table would return them (JSONB parsed). */
const EVENT_ROWS = [
  {
    sig: "SIG-M2",
    slot: "77",
    basket: BASKET,
    type: "Minted",
    data: { grossShares: "1001000", netShares: "1000000", entryFeeShares: "1000" },
    ts: "2026-09-01T12:00:00.000Z",
  },
  {
    sig: "SIG-M1",
    slot: "70",
    basket: BASKET,
    type: "Redeemed",
    data: { sharesBurned: "500000", exitFeeShares: "2500" },
    ts: "2026-09-01T11:00:00.000Z",
  },
];

// ============================================================================
// 1. basketEvents — params, clamp, provenance
// ============================================================================

describe("events route — happy path + provenance", () => {
  it("returns ledger rows with source + asOf on every row and honest metadata", async () => {
    const db = fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [{ "?column?": 1 }] },
      { match: "FROM events WHERE basket", rows: EVENT_ROWS },
    ]);
    const out = await basketEvents(db, BASKET, {});
    expect(out.status).toBe(200);
    const payload = out.payload as Record<string, unknown>;
    const data = payload.data as Array<Record<string, unknown>>;
    expect(payload.count).toBe(2);
    expect(payload.basket).toBe(BASKET);
    expect(payload.source).toBe("onchain-indexed");
    expect(payload.limit).toBe(100); // default
    expect(String(payload.note)).toContain("never fabricated");
    for (const row of data) {
      expect(row.source).toBe("onchain-indexed");
      expect(row.asOf).toBe(row.ts);
    }
    expect(data[0].sig).toBe("SIG-M2");
    expect(data[0].slot).toBe("77"); // BIGINT stays a decimal string (integer-safe)
  });

  it("orders by ts DESC, slot DESC, sig ASC and binds limit as the second param", async () => {
    const db = fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [{ "?column?": 1 }] },
      { match: "FROM events WHERE basket", rows: EVENT_ROWS },
    ]);
    await basketEvents(db, BASKET, { limit: 25 });
    const evCall = db.calls.find((c) => c.sql.includes("FROM events WHERE basket"))!;
    expect(evCall.sql).toContain("ORDER BY ts DESC, slot DESC, sig ASC");
    expect(evCall.values).toEqual([BASKET, 25]);
  });

  it("an indexed basket with zero events answers 200 with an explicit empty list", async () => {
    const db = fakeDb([{ match: "FROM baskets WHERE pubkey", rows: [{ "?column?": 1 }] }]);
    const out = await basketEvents(db, BASKET, {});
    expect(out.status).toBe(200);
    const payload = out.payload as Record<string, unknown>;
    expect(payload.count).toBe(0);
    expect(payload.data).toEqual([]);
    expect(String(payload.note)).toContain("no events indexed");
  });

  it("empty events on a NOT_INDEXED basket still answers 404, not an empty 200", async () => {
    const db = fakeDb(); // no baskets row, no events
    const out = await basketEvents(db, BASKET, {});
    expect(out.status).toBe(404);
    expect((out.payload as { error: { code: string } }).error.code).toBe("NOT_INDEXED");
  });
});

describe("events route — limit clamping", () => {
  const cases: Array<{ raw: number | undefined; clamped: number }> = [
    { raw: undefined, clamped: 100 },
    { raw: 1, clamped: 1 },
    { raw: 0, clamped: 1 },
    { raw: -50, clamped: 1 },
    { raw: 499, clamped: 499 },
    { raw: 500, clamped: 500 },
    { raw: 99999, clamped: 500 },
  ];
  for (const { raw, clamped } of cases) {
    it(`limit ${raw === undefined ? "(absent)" : raw} clamps to ${clamped} in the bound param`, async () => {
      const db = fakeDb([{ match: "FROM baskets WHERE pubkey", rows: [{ "?column?": 1 }] }]);
      const out = await basketEvents(db, BASKET, { limit: raw });
      expect(out.status).toBe(200);
      const evCall = db.calls.find((c) => c.sql.includes("FROM events WHERE basket"))!;
      expect(evCall.values![1]).toBe(clamped);
      expect((out.payload as Record<string, unknown>).limit).toBe(clamped);
    });
  }

  it("non-finite and fractional limits answer 400 INVALID_LIMIT and never reach the DB", async () => {
    for (const bad of [Number.NaN, 10.5, Number.POSITIVE_INFINITY]) {
      const db = fakeDb();
      const out = await basketEvents(db, BASKET, { limit: bad });
      expect(out.status).toBe(400);
      expect((out.payload as { error: { code: string } }).error.code).toBe("INVALID_LIMIT");
      expect(db.calls.length).toBe(0);
    }
  });
});

describe("events route — type filter", () => {
  it("allowlisted type routes to the type SQL with the type bound as $2", async () => {
    const db = fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [{ "?column?": 1 }] },
      { match: "AND type = $2", rows: [EVENT_ROWS[1]] },
    ]);
    const out = await basketEvents(db, BASKET, { type: "Redeemed", limit: 10 });
    expect(out.status).toBe(200);
    const evCall = db.calls.find((c) => c.sql.includes("FROM events WHERE basket"))!;
    expect(evCall.sql).toContain("AND type = $2");
    expect(evCall.values).toEqual([BASKET, "Redeemed", 10]);
    expect((out.payload as Record<string, unknown>).type).toBe("Redeemed");
    expect(((out.payload as Record<string, unknown>).data as unknown[]).length).toBe(1);
  });

  for (const bad of ["minted", "Transfer", "DROP TABLE events"]) {
    it(`rejects type ${JSON.stringify(bad)} with 400 INVALID_TYPE before any query`, async () => {
      const db = fakeDb();
      const out = await basketEvents(db, BASKET, { type: bad });
      expect(out.status).toBe(400);
      expect((out.payload as { error: { code: string } }).error.code).toBe("INVALID_TYPE");
      expect(db.calls.length).toBe(0);
    });
  }

  it("empty-string type means 'no filter' (falls through to the unfiltered query)", async () => {
    const db = fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [{ "?column?": 1 }] },
      { match: "FROM events WHERE basket", rows: EVENT_ROWS },
    ]);
    const out = await basketEvents(db, BASKET, { type: "" });
    expect(out.status).toBe(200);
    const evCall = db.calls.find((c) => c.sql.includes("FROM events WHERE basket"))!;
    expect(evCall.sql).not.toContain("AND type");
    expect((out.payload as Record<string, unknown>).type).toBeUndefined();
  });

  it("covers every event type the events-table CHECK allows", async () => {
    const db = fakeDb([{ match: "FROM baskets WHERE pubkey", rows: [{ "?column?": 1 }] }]);
    for (const type of ["BasketCreated", "Minted", "Redeemed", "FeeAccrued"]) {
      const out = await basketEvents(db, BASKET, { type });
      expect(out.status).toBe(200);
    }
  });
});

// ============================================================================
// 2. handler-level — query-string plumbing, canonicalization, degradation
// ============================================================================

function makeReq(method: string, url: string): http.IncomingMessage {
  const req = {
    method,
    url,
    headers: { host: "localhost:3001" },
    on: (_event: string, cb: (chunk?: Buffer) => void) => {
      if (_event === "end") cb();
    },
  };
  return req as unknown as http.IncomingMessage;
}

interface ResState {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

function makeRes(): { res: http.ServerResponse; state: ResState } {
  const state: ResState = { statusCode: 200, body: "", headers: {} };
  const res = {
    setHeader: (k: string, v: string) => {
      state.headers[k] = v;
    },
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(v: number) {
      state.statusCode = v;
    },
    end: (payload?: string | Buffer) => {
      state.body = payload ? payload.toString() : "";
    },
  };
  return { res: res as unknown as http.ServerResponse, state };
}

describe("events route — handler plumbing", () => {
  const handlerDb = () =>
    fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [{ "?column?": 1 }] },
      { match: "FROM events WHERE basket", rows: EVENT_ROWS },
    ]);

  it("serves GET /api/v1/events?basket= end-to-end with clamped query limit", async () => {
    const db = handlerDb();
    const handler = createHandler({ db });
    const { res, state } = makeRes();
    await handler(makeReq("GET", `/api/v1/events?basket=${BASKET}&limit=1000`), res);
    expect(state.statusCode).toBe(200);
    const payload = JSON.parse(state.body) as Record<string, unknown>;
    expect(payload.limit).toBe(500);
    expect((payload.data as unknown[]).length).toBe(2);
    const evCall = db.calls.find((c) => c.sql.includes("FROM events WHERE basket"))!;
    expect(evCall.values![1]).toBe(500);
  });

  it("missing basket query answers 400 INVALID_PUBKEY without touching the DB", async () => {
    const db = handlerDb();
    const handler = createHandler({ db });
    const { res, state } = makeRes();
    await handler(makeReq("GET", "/api/v1/events"), res);
    expect(state.statusCode).toBe(400);
    expect(JSON.parse(state.body).error.code).toBe("INVALID_PUBKEY");
    expect(db.calls.filter((c) => c.sql.includes("FROM events")).length).toBe(0);
  });

  it("non-base58 basket answers 400 INVALID_PUBKEY (urlencoded garbage included)", async () => {
    const db = handlerDb();
    const handler = createHandler({ db });
    for (const bad of ["not-a-pubkey", "%00%01%02", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"]) {
      const { res, state } = makeRes();
      await handler(makeReq("GET", `/api/v1/events?basket=${bad}`), res);
      expect(state.statusCode).toBe(400);
      expect(JSON.parse(state.body).error.code).toBe("INVALID_PUBKEY");
    }
    expect(db.calls.filter((c) => c.sql.includes("FROM events")).length).toBe(0);
  });

  it("non-base58-safe characters in a pubkey-shaped string answer 400 (trust boundary)", async () => {
    const db = handlerDb();
    const handler = createHandler({ db });
    const { res, state } = makeRes();
    await handler(makeReq("GET", `/api/v1/events?basket=${encodeURIComponent("' OR 1=1 --")}`), res);
    expect(state.statusCode).toBe(400);
    expect(JSON.parse(state.body).error.code).toBe("INVALID_PUBKEY");
    expect(db.calls.length).toBe(0);
  });

  it("query-string limit=abc answers 400 INVALID_LIMIT through the handler", async () => {
    const db = handlerDb();
    const handler = createHandler({ db });
    const { res, state } = makeRes();
    await handler(makeReq("GET", `/api/v1/events?basket=${BASKET}&limit=abc`), res);
    expect(state.statusCode).toBe(400);
    expect(JSON.parse(state.body).error.code).toBe("INVALID_LIMIT");
  });

  it("query-string type=bonus answers 400 INVALID_TYPE through the handler", async () => {
    const db = handlerDb();
    const handler = createHandler({ db });
    const { res, state } = makeRes();
    await handler(makeReq("GET", `/api/v1/events?basket=${BASKET}&type=bonus`), res);
    expect(state.statusCode).toBe(400);
    expect(JSON.parse(state.body).error.code).toBe("INVALID_TYPE");
  });

  it("NOT_INDEXED passes through the handler untouched (404, exact error shape)", async () => {
    const handler = createHandler({ db: fakeDb() });
    const { res, state } = makeRes();
    await handler(makeReq("GET", `/api/v1/events?basket=${ALT_BASKET}`), res);
    expect(state.statusCode).toBe(404);
    const err = JSON.parse(state.body).error;
    expect(err.code).toBe("NOT_INDEXED");
    expect(err.message).toContain(ALT_BASKET);
  });

  it("DB-less mode answers 503 DB_UNAVAILABLE (same pattern as the other routes)", async () => {
    const handler = createHandler({ db: null });
    const { res, state } = makeRes();
    await handler(makeReq("GET", `/api/v1/events?basket=${BASKET}`), res);
    expect(state.statusCode).toBe(503);
    expect(JSON.parse(state.body).error.code).toBe("DB_UNAVAILABLE");
  });

  it("CORS headers are set on events responses", async () => {
    const handler = createHandler({ db: handlerDb() });
    const { res, state } = makeRes();
    await handler(makeReq("GET", `/api/v1/events?basket=${BASKET}`), res);
    expect(state.headers["Access-Control-Allow-Origin"]).toBe("*");
  });
});
