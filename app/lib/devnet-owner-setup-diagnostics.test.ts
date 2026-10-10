import assert from "node:assert/strict";
import test from "node:test";
import { clearOwnerSetupDiagnostic, createOwnerSetupDiagnostic, ownerSetupDiagnosticMessage, ownerSetupDiagnosticStorageKey, OWNER_SETUP_PENDING_MESSAGE, readOwnerSetupDiagnostic, saveOwnerSetupDiagnostic } from "./devnet-owner-setup-diagnostics";

const now = Date.parse("2026-10-10T13:00:00.000Z");
const key = ownerSetupDiagnosticStorageKey("TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea");
const known = "The wallet changed the reviewed compute budget. Nothing was broadcast.";
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("reload preserves only the bounded public message, stage, status and time", () => {
  const store = storage(), original = createOwnerSetupDiagnostic("setup", "signing", "failed", known, now);
  assert.equal(saveOwnerSetupDiagnostic(store, key, original, now), true);
  // A new reader after a reload needs no in-memory error, wallet object or receipt.
  assert.deepEqual(readOwnerSetupDiagnostic({ getItem: store.getItem }, key, now + 1_000), original);
  assert.deepEqual(Object.keys(JSON.parse(store.values.get(key)!)).sort(), ["at", "kind", "message", "stage", "status", "version"]);
  assert.equal(original.message, known);
  assert.ok(store.values.get(key)!.length < 1_024);
});

test("a stalled wallet request remains a truthful progress note after reload", () => {
  const store = storage(), entry = createOwnerSetupDiagnostic("setup", "signing", "in-progress", "wallet-private-payload", now);
  assert.equal(entry.message, "The last attempt reached the wallet signature step. Refresh the saved transaction status before starting again.");
  assert.equal(saveOwnerSetupDiagnostic(store, key, entry, now), true);
  const loaded = readOwnerSetupDiagnostic(store, key, now + 1_000)!;
  assert.equal(loaded.status, "in-progress");
  assert.equal(loaded.stage, "signing");
  assert.doesNotMatch(JSON.stringify(loaded), /wallet-private-payload|failed|broadcast/);
});

for (const stage of ["checking", "simulating", "signing", "confirming"] as const) {
  test(`raw wallet/RPC payload is replaced by a fixed fallback at ${stage}`, () => {
    const store = storage();
    for (const payload of ["RPC token=secret signature=abcdef https://private.rpc", new Error("wallet secret"), { message: known }, known + "\nsecret", "<script>alert(1)</script>", "x".repeat(50_000)]) {
      const entry = createOwnerSetupDiagnostic("setup", stage, "failed", payload, now);
      assert.equal(saveOwnerSetupDiagnostic(store, key, entry, now), true);
      assert.equal(readOwnerSetupDiagnostic(store, key, now)?.message, entry.message);
      assert.doesNotMatch(store.values.get(key)!, /secret|private\.rpc|<script>|wallet secret/);
      assert.match(entry.message, /^Setup stopped while /);
    }
  });
}

test("stored message and progress must be an exact allowed source value", () => {
  const store = storage(), base = createOwnerSetupDiagnostic("setup", "signing", "failed", known, now);
  for (const invalid of [
    { ...base, message: "arbitrary wallet payload" },
    { ...base, message: known + " " },
    { ...base, status: "in-progress", message: known },
    { ...createOwnerSetupDiagnostic("setup", "checking", "in-progress", undefined, now), stage: "signing" },
  ]) {
    store.values.set(key, JSON.stringify(invalid));
    assert.equal(readOwnerSetupDiagnostic(store, key, now), null);
    assert.equal(saveOwnerSetupDiagnostic(store, key, invalid as typeof base, now), false);
  }
});

test("malformed, oversized, extended and invalid stored schemas fail closed", () => {
  const store = storage(), base = createOwnerSetupDiagnostic("setup", "signing", "failed", known, now);
  for (const raw of [
    "not-json", "null", "[]", "x".repeat(1_025),
    JSON.stringify({ ...base, secret: "do-not-load" }),
    JSON.stringify({ ...base, signature: "not-a-diagnostic-field" }),
    JSON.stringify({ ...base, version: 2 }),
    JSON.stringify({ ...base, kind: "mainnet" }),
    JSON.stringify({ ...base, stage: "sent" }),
    JSON.stringify({ ...base, status: "finalized" }),
    JSON.stringify({ ...base, at: "yesterday" }),
    JSON.stringify({ ...base, at: "2026-10-10T13:00:00Z" }),
    JSON.stringify({ ...base, at: new Date(now + 60_001).toISOString() }),
    JSON.stringify({ ...base, at: new Date(now - 30 * 24 * 60 * 60 * 1_000 - 1).toISOString() }),
    JSON.stringify({ ...base, message: "x".repeat(257) }),
  ]) {
    store.values.set(key, raw);
    assert.equal(readOwnerSetupDiagnostic(store, key, now), null);
  }
});

test("storage failures are contained and never request a wallet, send or retry", () => {
  const failure = () => { throw new Error("blocked storage"); };
  const broken = { getItem: failure, setItem: failure, removeItem: failure };
  const entry = createOwnerSetupDiagnostic("setup", "signing", "in-progress", undefined, now);
  assert.equal(readOwnerSetupDiagnostic(broken, key, now), null);
  assert.equal(saveOwnerSetupDiagnostic(broken, key, entry, now), false);
  assert.equal(clearOwnerSetupDiagnostic(broken, key), false);
  assert.equal(entry.stage, "signing");
});

test("a saved pending receipt overrides all historical no-broadcast or stalled-wallet notes", () => {
  for (const status of ["failed", "in-progress"] as const) {
    const entry = createOwnerSetupDiagnostic("setup", "signing", status, known, now);
    assert.equal(ownerSetupDiagnosticMessage(entry, { status: "prepared" }), OWNER_SETUP_PENDING_MESSAGE);
    assert.equal(ownerSetupDiagnosticMessage(entry, { status: "finalized" }), null);
    assert.equal(ownerSetupDiagnosticMessage(entry, { status: "failed" }), entry.message);
    assert.equal(ownerSetupDiagnosticMessage(entry, { status: "expired" }), entry.message);
    assert.equal(ownerSetupDiagnosticMessage(entry), entry.message);
  }
});

test("dismiss removes only the diagnostic, preserving independent receipt storage", () => {
  const store = storage(), receiptKey = "basalt:devnet-owner-setup:v1:owner";
  store.setItem(receiptKey, "existing public prepared receipt");
  const entry = createOwnerSetupDiagnostic("handoff", "signing", "failed", known, now);
  assert.equal(saveOwnerSetupDiagnostic(store, key, entry, now), true);
  assert.equal(clearOwnerSetupDiagnostic(store, key), true);
  assert.equal(readOwnerSetupDiagnostic(store, key, now), null);
  assert.equal(store.getItem(receiptKey), "existing public prepared receipt");
});

test("owner diagnostic keys stay separate from receipt keys and other owners", () => {
  assert.notEqual(ownerSetupDiagnosticStorageKey("owner-a"), ownerSetupDiagnosticStorageKey("owner-b"));
  assert.notEqual(key, "basalt:devnet-owner-setup:v1:TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea");
});


test("terminal receipts never mask a newer pre-broadcast error", () => {
  for (const stage of ["checking", "simulating", "signing"] as const) {
    const fresh = createOwnerSetupDiagnostic("setup", stage, "failed", known, now);
    for (const status of ["failed", "expired"] as const) assert.equal(ownerSetupDiagnosticMessage(fresh, { status }), known);
  }
  const submitted = createOwnerSetupDiagnostic("setup", "confirming", "in-progress", undefined, now);
  assert.equal(ownerSetupDiagnosticMessage(submitted, { status: "failed" }), "The transaction finalized with an error. Refresh and review the remaining actions.");
  assert.equal(ownerSetupDiagnosticMessage(submitted, { status: "expired" }), "The saved transaction expired. Refresh finalized status and review the remaining actions.");
});
