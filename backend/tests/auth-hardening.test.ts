import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type http from "node:http";
import bs58 from "bs58";
import {
  AuthRateLimitError,
  clearNonces,
  consumeNonce,
  issueNonce,
  MAX_PENDING_NONCES,
  MAX_PENDING_NONCES_PER_WALLET,
  NONCE_TTL_MS,
  signToken,
  socialAuthSecret,
  verifyToken,
} from "../src/api/auth";
import { tryHandleSocialRoute } from "../src/api/social";

const KNOWN_OLD_SECRET = "basalt-dev-social-secret-do-not-use-in-prod";
const GENERATED_SECRET = crypto.randomBytes(32).toString("hex");
const T0 = 1_700_000_000_000;

function wallet(index = 0): string {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(index + 1);
  return bs58.encode(bytes);
}

beforeEach(() => {
  clearNonces();
  vi.stubEnv("SOCIAL_AUTH_ALLOW_DEV_SECRET", "");
});

afterEach(() => {
  clearNonces();
  vi.unstubAllEnvs();
});

describe("auth startup configuration", () => {
  it.each([
    "",
    "short-secret",
    "change-me-in-production",
    "CHANGE_ME_WITH_A_GENERATED_PRODUCTION_SECRET",
    "replace_me_with_a_secure_random_secret",
    "basalt-test-only-7dfe258b90264aa19c0345e6a8c1fe70",
    "THIS_IS_A_LONG_PLACEHOLDER_NOT_A_GENERATED_SECRET",
    KNOWN_OLD_SECRET,
  ])("rejects missing, short and placeholder production secrets (%s)", (secret) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SOCIAL_AUTH_SECRET", secret);
    expect(() => socialAuthSecret()).toThrow(/SOCIAL_AUTH_SECRET/);
  });

  it("does not allow development opt-in to bypass production validation", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SOCIAL_AUTH_SECRET", "");
    vi.stubEnv("SOCIAL_AUTH_ALLOW_DEV_SECRET", "1");
    expect(() => socialAuthSecret()).toThrow(/SOCIAL_AUTH_SECRET/);
  });

  it("requires explicit opt-in without a development secret", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SOCIAL_AUTH_SECRET", "");
    expect(() => socialAuthSecret()).toThrow(/SOCIAL_AUTH_SECRET/);
  });

  it("accepts a generated production secret and rejects old fallback tokens", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SOCIAL_AUTH_SECRET", GENERATED_SECRET);
    const secret = socialAuthSecret();
    expect(secret).toBe(GENERATED_SECRET);
    const forged = signToken(wallet(), KNOWN_OLD_SECRET, T0);
    expect(verifyToken(forged.token, secret, T0)).toBeNull();
    expect(verifyToken(signToken(wallet(), secret, T0).token, secret, T0)?.wallet).toBe(wallet());
  });

  it("creates a stable process-random local secret only after explicit opt-in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SOCIAL_AUTH_SECRET", "");
    vi.stubEnv("SOCIAL_AUTH_ALLOW_DEV_SECRET", "1");
    const secret = socialAuthSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(socialAuthSecret()).toBe(secret);
    expect(secret).not.toBe(KNOWN_OLD_SECRET);
    expect(verifyToken(signToken(wallet(), KNOWN_OLD_SECRET, T0).token, secret, T0)).toBeNull();
  });

  it("rejects an explicitly configured weak local secret even with opt-in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SOCIAL_AUTH_SECRET", "weak");
    vi.stubEnv("SOCIAL_AUTH_ALLOW_DEV_SECRET", "1");
    expect(() => socialAuthSecret()).toThrow(/SOCIAL_AUTH_SECRET/);
  });

  it.each(["", "CHANGE_ME"])("fails the real entrypoint before workers or HTTP startup", (secret) => {
    const child = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, NODE_ENV: "production", SOCIAL_AUTH_SECRET: secret, SOCIAL_AUTH_ALLOW_DEV_SECRET: "1" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stderr).toContain("SOCIAL_AUTH_SECRET");
    expect(child.stdout).toBe("");
  }, 20_000);
});

describe("bounded authentication nonce storage", () => {
  it("limits outstanding nonces per wallet without revoking earlier challenges", () => {
    const issued = Array.from({ length: MAX_PENDING_NONCES_PER_WALLET }, () => issueNonce(wallet(), T0));
    expect(() => issueNonce(wallet(), T0)).toThrow(AuthRateLimitError);
    try {
      issueNonce(wallet(), T0);
    } catch (error) {
      expect(error).toMatchObject({ status: 429, code: "AUTH_RATE_LIMITED", retryAfterSeconds: NONCE_TTL_MS / 1000 });
    }
    expect(consumeNonce(wallet(), issued[0].nonce, T0)).toBe(true);
    expect(consumeNonce(wallet(), issued[0].nonce, T0)).toBe(false);
    expect(() => issueNonce(wallet(), T0)).not.toThrow();
  });

  it("enforces a global hard cap, preserves existing nonces and releases consumed capacity", () => {
    const first = issueNonce(wallet(), T0);
    for (let i = 1; i < MAX_PENDING_NONCES; i++) issueNonce(wallet(i), T0);
    expect(() => issueNonce(wallet(MAX_PENDING_NONCES), T0)).toThrow(AuthRateLimitError);
    expect(consumeNonce(wallet(), first.nonce, T0)).toBe(true);
    expect(() => issueNonce(wallet(MAX_PENDING_NONCES), T0)).not.toThrow();
    expect(() => issueNonce(wallet(MAX_PENDING_NONCES + 1), T0)).toThrow(AuthRateLimitError);
  });

  it("reclaims expired global capacity at the TTL boundary", () => {
    const first = issueNonce(wallet(), T0);
    for (let i = 1; i < MAX_PENDING_NONCES; i++) issueNonce(wallet(i), T0);
    expect(() => issueNonce(wallet(MAX_PENDING_NONCES), T0 + NONCE_TTL_MS - 1)).toThrow(AuthRateLimitError);
    expect(() => issueNonce(wallet(MAX_PENDING_NONCES), T0 + NONCE_TTL_MS)).not.toThrow();
    expect(consumeNonce(wallet(), first.nonce, T0 + NONCE_TTL_MS)).toBe(false);
    expect(() => issueNonce(wallet(), T0 + NONCE_TTL_MS)).not.toThrow();
  });

  it("keeps fresh challenges valid when older challenges expire", () => {
    const expired = issueNonce(wallet(), T0);
    const fresh = issueNonce(wallet(1), T0 + 1_000);
    expect(consumeNonce(wallet(), expired.nonce, T0 + NONCE_TTL_MS)).toBe(false);
    expect(consumeNonce(wallet(1), fresh.nonce, T0 + NONCE_TTL_MS)).toBe(true);
  });

  it("cannot consume another wallet's challenge", () => {
    const { nonce } = issueNonce(wallet(), T0);
    expect(consumeNonce(wallet(1), nonce, T0)).toBe(false);
    expect(consumeNonce(wallet(), nonce, T0)).toBe(true);
  });

  it("preserves expiry ordering if the wall clock moves backward", () => {
    const first = issueNonce(wallet(), T0 + 1_000);
    const second = issueNonce(wallet(1), T0);
    expect(second.expiresAt).toBe(first.expiresAt);
    expect(consumeNonce(wallet(1), second.nonce, T0 + NONCE_TTL_MS)).toBe(true);
    expect(consumeNonce(wallet(), first.nonce, T0 + NONCE_TTL_MS + 1_000)).toBe(false);
  });

  it("returns 429 and Retry-After through the social nonce route", async () => {
    for (let i = 0; i < MAX_PENDING_NONCES_PER_WALLET; i++) issueNonce(wallet());
    const headers = new Map<string, string>();
    const state = { statusCode: 0, body: "" };
    const res = {
      setHeader: (name: string, value: string) => headers.set(name, value),
      end: (body: string) => { state.body = body; },
      get statusCode() { return state.statusCode; },
      set statusCode(value: number) { state.statusCode = value; },
    } as unknown as http.ServerResponse;
    const req = { method: "POST", headers: {} } as http.IncomingMessage;
    expect(await tryHandleSocialRoute(
      { authSecret: GENERATED_SECRET, getDb: async () => null, readJsonBody: async () => ({ wallet: wallet() }) },
      req,
      res,
      new URL("http://localhost/api/v1/auth/nonce"),
    )).toBe(true);
    expect(state.statusCode).toBe(429);
    expect(JSON.parse(state.body).error.code).toBe("AUTH_RATE_LIMITED");
    expect(Number(headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(headers.get("Retry-After"))).toBeLessThanOrEqual(NONCE_TTL_MS / 1000);
  });
});
