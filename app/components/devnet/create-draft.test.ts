import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDraftNonce, getDraftNonce, type DraftNonceStorage } from "./create-draft";

let fingerprintId = 0;
function fingerprint() { return (++fingerprintId).toString(16).padStart(64, "0"); }
function storage() {
  const values = new Map<string, string>();
  const api: DraftNonceStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  return { values, api };
}

afterEach(() => { vi.useRealTimers(); });

describe("immutable create draft retries", () => {
  it("reuses one nonce after setup interruption instead of deriving a second basket", () => {
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
    const f = fingerprint(), { values, api } = storage();
    const nonce = getDraftNonce(f, api);
    vi.setSystemTime(1_800_000_050_000);
    expect(getDraftNonce(f, api)).toBe(nonce);
    expect([...values]).toEqual([[`basalt:create-draft:v1:${f}`, String(nonce)]]);
  });

  it("restores a public nonce from storage before an in-memory draft exists", () => {
    const f = fingerprint(), { values, api } = storage();
    values.set(`basalt:create-draft:v1:${f}`, "1800000000123");
    expect(getDraftNonce(f, api)).toBe(1_800_000_000_123);
  });

  it("separates changed owner, chain or basket contents through their fingerprints", () => {
    vi.useFakeTimers();
    const { api } = storage();
    const unchanged = fingerprint(), changedOwner = fingerprint(), editedMix = fingerprint(), changedChain = fingerprint();
    vi.setSystemTime(1_800_000_000_000); const original = getDraftNonce(unchanged, api);
    vi.setSystemTime(1_800_000_000_001); expect(getDraftNonce(changedOwner, api)).not.toBe(original);
    vi.setSystemTime(1_800_000_000_002); expect(getDraftNonce(editedMix, api)).not.toBe(original);
    vi.setSystemTime(1_800_000_000_003); expect(getDraftNonce(changedChain, api)).not.toBe(original);
    expect(getDraftNonce(unchanged, api)).toBe(original);
  });

  it.each(["NaN", "0", "-1", "1.1", "01", " 1000", "9007199254740992", '{"nonce":1}'])("ignores a malformed stored nonce %s", (saved) => {
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
    const f = fingerprint(), { values, api } = storage();
    values.set(`basalt:create-draft:v1:${f}`, saved);
    expect(getDraftNonce(f, api)).toBe(1_800_000_000_000);
    expect(values.get(`basalt:create-draft:v1:${f}`)).toBe("1800000000000");
  });

  it("retains in-tab retries and permits confirmation cleanup when storage is denied", () => {
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
    const f = fingerprint();
    const denied: DraftNonceStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    const nonce = getDraftNonce(f, denied);
    vi.setSystemTime(1_800_000_005_000); expect(getDraftNonce(f, denied)).toBe(nonce);
    expect(() => clearDraftNonce(f, denied)).not.toThrow();
    expect(getDraftNonce(f, denied)).toBe(1_800_000_005_000);
  });

  it("starts a new basket after confirmed creation clears the old draft", () => {
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
    const f = fingerprint(), { values, api } = storage();
    getDraftNonce(f, api); clearDraftNonce(f, api);
    expect(values.size).toBe(0);
    vi.setSystemTime(1_800_000_001_000);
    expect(getDraftNonce(f, api)).toBe(1_800_000_001_000);
  });

  it("can clear adapters which expose only getItem and setItem", () => {
    const f = fingerprint(), { values, api } = storage();
    const minimal = { getItem: api.getItem, setItem: api.setItem };
    getDraftNonce(f, minimal); clearDraftNonce(f, minimal);
    expect(values.get(`basalt:create-draft:v1:${f}`)).toBe("");
  });

  it("rejects unhashed named data so stored keys cannot expose a user's thesis", () => {
    const { values, api } = storage();
    expect(() => getDraftNonce("My basket, my thesis", api)).toThrow("fingerprint");
    expect(() => clearDraftNonce("owner:wallet:name:basket", api)).toThrow("fingerprint");
    expect(values.size).toBe(0);
  });
});
