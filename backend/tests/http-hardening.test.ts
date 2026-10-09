import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { PassThrough } from "node:stream";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { createHandler, type ApiContext } from "../src/api/server";
import { clearNonces, buildAuthMessage, signToken } from "../src/api/auth";
import { readJsonBody, MAX_JSON_BODY_BYTES, JSON_BODY_TIMEOUT_MS } from "../src/api/json-body";
import { ApiResourceLimits } from "../src/api/resource-limits";
import type { PgLike } from "../src/db/client";

const key = (n: number): string => bs58.encode(Buffer.alloc(32, n));
const noncePath = "/api/v1/auth/nonce";
const quotePath = "/api/v1/quotes/zap-in";
const quoteBody = JSON.stringify({ basket: key(9), amountUSDC: "10" });

beforeEach(clearNonces);
afterEach(() => { clearNonces(); vi.useRealTimers(); });

function requestStream(headers: Record<string, string> = {}): http.IncomingMessage & PassThrough {
  return Object.assign(new PassThrough(), { headers, aborted: false }) as unknown as http.IncomingMessage & PassThrough;
}

function quoteDb(): PgLike {
  return {
    async query(sql: string) {
      if (sql.includes("FROM baskets WHERE")) return { rows: [{ pubkey: key(9), share_mint: key(8), constituents: [key(5), key(6)], weights_bps: [5000, 5000], exit_fee_bps: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PgLike;
}

function quoteResponse(): Response {
  return new Response(JSON.stringify({ inAmount: "5000000", outAmount: "100", otherAmountThreshold: "99", routePlan: [] }), { status: 200 });
}

interface HttpResult { status: number; payload: any; headers: http.IncomingHttpHeaders }
async function withApi(ctx: Partial<ApiContext>, run: (port: number) => Promise<void>): Promise<void> {
  const server = http.createServer(createHandler({ db: null, ...ctx }));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await run((server.address() as { port: number }).port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function request(port: number, path: string, body?: string | Buffer, options: { chunked?: boolean; headers?: Record<string, string>; method?: string } = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", ...options.headers };
    if (body !== undefined && !options.chunked) Object.assign(headers, { "Content-Length": String(Buffer.byteLength(body)) });
    const req = http.request({ host: "127.0.0.1", port, path, method: options.method ?? (body === undefined ? "GET" : "POST"), headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, payload: JSON.parse(Buffer.concat(chunks).toString()), headers: res.headers }); }
        catch (error) { reject(error); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body !== undefined) {
      if (options.chunked) { req.write(body); req.end(); }
      else req.end(body);
    } else req.end();
  });
}

describe("bounded JSON request reader", () => {
  it("accepts exactly 64 KiB and preserves UTF-8 characters split across chunks", async () => {
    const body = Buffer.from(JSON.stringify({ text: "🪨", pad: " " .repeat(MAX_JSON_BODY_BYTES - Buffer.byteLength(JSON.stringify({ text: "🪨", pad: "" }))) }));
    expect(body.length).toBe(MAX_JSON_BODY_BYTES);
    const req = requestStream();
    const parsed = readJsonBody(req);
    const split = body.indexOf(Buffer.from("🪨")) + 1;
    req.write(body.subarray(0, split));
    req.end(body.subarray(split));
    expect((await parsed)?.text).toBe("🪨");
  });

  it("counts bytes rather than UTF-16 characters for streamed bodies", async () => {
    const req = requestStream();
    const parsed = readJsonBody(req);
    const rejected = expect(parsed).rejects.toMatchObject({ status: 413, code: "BODY_TOO_LARGE" });
    req.end(JSON.stringify({ text: "🪨".repeat(MAX_JSON_BODY_BYTES / 4) }));
    await rejected;
    expect(req.listenerCount("data")).toBe(0);
    req.destroy();
  });

  it("does not trust a small declared Content-Length when more bytes arrive", async () => {
    const req = requestStream({ "content-length": "2" });
    const parsed = readJsonBody(req);
    const rejected = expect(parsed).rejects.toMatchObject({ status: 413 });
    req.end(" ".repeat(MAX_JSON_BODY_BYTES + 1));
    await rejected;
    req.destroy();
  });

  it("rejects early oversized declared bodies before attaching a data listener", async () => {
    const req = requestStream({ "content-length": String(MAX_JSON_BODY_BYTES + 1) });
    await expect(readJsonBody(req)).rejects.toMatchObject({ status: 413 });
    expect(req.listenerCount("data")).toBe(0);
    req.destroy();
  });

  it("settles aborted reads and removes retained body listeners", async () => {
    const req = requestStream();
    const parsed = readJsonBody(req);
    const rejected = expect(parsed).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    req.write('{"unfinished":');
    req.emit("aborted");
    await rejected;
    expect(req.listenerCount("data")).toBe(0);
    req.emit("error", new Error("late reset"));
    req.destroy();
  });

  it("times out an unfinished body and clears its timer/listeners", async () => {
    vi.useFakeTimers();
    const req = requestStream();
    const parsed = readJsonBody(req);
    const rejected = expect(parsed).rejects.toMatchObject({ status: 408, code: "BODY_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(JSON_BODY_TIMEOUT_MS);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(req.listenerCount("data")).toBe(0);
    req.destroy();
  });

  it.each(["[]", "null", "42", "{"])("rejects non-object/invalid JSON: %s", async (body) => {
    const req = requestStream();
    const parsed = readJsonBody(req);
    req.end(body);
    expect(await parsed).toBeNull();
  });
});

describe("HTTP auth and resource-limit integration", () => {
  it.each([false, true])("returns 413 for oversized nonce/quote bodies (chunked=%s) and stays responsive", async (chunked) => {
    await withApi({}, async (port) => {
      for (const path of [noncePath, quotePath]) {
        const out = await request(port, path, " ".repeat(MAX_JSON_BODY_BYTES + 1), { chunked });
        expect(out.status).toBe(413);
        expect(out.payload.error.code).toBe("BODY_TOO_LARGE");
        expect(out.headers.connection).toBe("close");
      }
      expect((await request(port, "/api/v1/health")).status).toBe(200);
      expect((await request(port, noncePath, JSON.stringify({ wallet: key(1) }))).status).toBe(200);
    });
  });

  it.each([
    ["PUT", "/api/v1/me/profile"],
    ["POST", "/api/v1/posts"],
    ["POST", "/api/v1/posts/1/comments"],
  ])("preserves 413 and closes oversized authenticated %s %s requests", async (method, path) => {
    const secret = "test-only-http-social-auth-4d3e761baf5190f2";
    const token = signToken(key(1), secret).token;
    await withApi({ db: quoteDb(), authSecret: secret }, async (port) => {
      const out = await request(port, path, " ".repeat(MAX_JSON_BODY_BYTES + 1), { method, chunked: true, headers: { Authorization: `Bearer ${token}` } });
      expect(out.status).toBe(413);
      expect(out.payload.error.code).toBe("BODY_TOO_LARGE");
      expect(out.headers.connection).toBe("close");
      expect((await request(port, "/api/v1/health")).status).toBe(200);
    });
  });

  it("enforces the socket peer quota despite changing spoofed forwarding headers", async () => {
    const resourceLimits = new ApiResourceLimits({ ipLimits: { "auth-nonce": 2 } });
    await withApi({ resourceLimits }, async (port) => {
      for (let i = 1; i <= 3; i++) {
        const out = await request(port, noncePath, JSON.stringify({ wallet: key(i) }), { headers: { "X-Forwarded-For": `192.0.2.${i}` } });
        expect(out.status).toBe(i <= 2 ? 200 : 429);
        if (i === 3) expect(Number(out.headers["retry-after"])).toBeGreaterThan(0);
      }
      expect((await request(port, "/api/v1/health")).status).toBe(200);
    });
  });

  it("enforces wallet quotas and verify-attempt quotas through the dispatcher", async () => {
    const resourceLimits = new ApiResourceLimits({ walletLimits: { "auth-nonce": 1 }, ipLimits: { "auth-verify": 1 } });
    await withApi({ resourceLimits }, async (port) => {
      const body = JSON.stringify({ wallet: key(1) });
      expect((await request(port, noncePath, body)).status).toBe(200);
      expect((await request(port, noncePath, body)).status).toBe(429);
      expect((await request(port, "/api/v1/auth/verify", "{}")).status).toBe(400);
      expect((await request(port, "/api/v1/auth/verify", "{}")).status).toBe(429);
    });
  });

  it("still verifies an actual wallet signature and rejects nonce replay", async () => {
    await withApi({}, async (port) => {
      const pair = nacl.sign.keyPair();
      const wallet = bs58.encode(pair.publicKey);
      const challenge = await request(port, noncePath, JSON.stringify({ wallet }));
      expect(challenge.status).toBe(200);
      const nonce = challenge.payload.nonce;
      const signature = bs58.encode(nacl.sign.detached(Buffer.from(buildAuthMessage(wallet, nonce)), pair.secretKey));
      const signed = JSON.stringify({ wallet, nonce, signature });
      const verified = await request(port, "/api/v1/auth/verify", signed);
      expect(verified.status).toBe(200);
      expect(verified.payload.token).toMatch(/^v1\./);
      expect((await request(port, "/api/v1/auth/verify", signed)).status).toBe(401);
    });
  });

  it("bounds quote concurrency and releases every slot after success", async () => {
    const resourceLimits = new ApiResourceLimits();
    const pending: Array<() => void> = [];
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const fetchImpl: typeof fetch = async () => {
      await new Promise<void>((resolve) => { pending.push(resolve); if (pending.length === 8) ready(); });
      return quoteResponse();
    };
    await withApi({ db: quoteDb(), fetchImpl, resourceLimits }, async (port) => {
      const active = Array.from({ length: 4 }, () => request(port, quotePath, quoteBody));
      try {
        await started;
        expect(resourceLimits.activeQuoteCount).toBe(4);
        const out = await request(port, quotePath, quoteBody);
        expect(out.status).toBe(429);
        expect(out.payload.error.code).toBe("RESOURCE_CAPACITY");
      } finally {
        pending.forEach((resolve) => resolve());
        expect((await Promise.all(active)).map((r) => r.status)).toEqual([200, 200, 200, 200]);
      }
      expect(resourceLimits.activeQuoteCount).toBe(0);
    });
  });

  it("caps real upstream leg fetches and maps exhaustion to 429 without sending a partial quote", async () => {
    const resourceLimits = new ApiResourceLimits({ maxQuoteUpstreamRequests: 2 });
    const fetchImpl = vi.fn(async () => quoteResponse());
    await withApi({ db: quoteDb(), fetchImpl, resourceLimits }, async (port) => {
      expect((await request(port, quotePath, quoteBody)).status).toBe(200);
      const limited = await request(port, quotePath, quoteBody);
      expect(limited.status).toBe(429);
      expect(limited.payload.legs).toBeUndefined();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(resourceLimits.activeQuoteCount).toBe(0);
    });
  });

  it("releases quote capacity when upstream requests fail", async () => {
    const resourceLimits = new ApiResourceLimits();
    await withApi({ db: quoteDb(), resourceLimits, fetchImpl: async () => { throw new Error("test outage"); } }, async (port) => {
      expect((await request(port, quotePath, quoteBody)).status).toBe(503);
      expect(resourceLimits.activeQuoteCount).toBe(0);
      expect((await request(port, "/api/v1/health")).status).toBe(200);
    });
  });
});
