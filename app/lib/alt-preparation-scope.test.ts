import assert from "node:assert/strict";
import test from "node:test";
import { AltPreparationScope } from "./alt-preparation-scope";

test("ALT preparation coalesces exact contexts and cannot carry completion across namespace or RPC changes", async () => {
  const scope = new AltPreparationScope<string>(), connection = {}, otherConnection = {};
  let complete!: (value: string) => void, calls = 0;
  scope.select("legacy:factory:basket:share:wallet", connection);
  const old = scope.run("legacy:factory:basket:share:wallet", connection, () => { calls++; return new Promise(resolve => { complete = resolve; }); });
  assert.equal(scope.run("legacy:factory:basket:share:wallet", connection, async () => "duplicate"), old);
  scope.select("clean:factory:basket:share:wallet", connection);
  assert.equal(await scope.run("clean:factory:basket:share:wallet", connection, async () => { calls++; return "clean-table"; }), "clean-table");
  complete("legacy-table"); await assert.rejects(old, /context changed/);
  assert.equal(await scope.run("clean:factory:basket:share:wallet", connection, async () => "duplicate"), "clean-table");
  scope.select("clean:factory:basket:share:wallet", otherConnection);
  assert.equal(await scope.run("clean:factory:basket:share:wallet", otherConnection, async () => { calls++; return "other-rpc-table"; }), "other-rpc-table");
  assert.equal(calls, 3);
});

test("late preparation callbacks lose permission to publish status after a context switch", async () => {
  const scope = new AltPreparationScope<string>(), connection = {};
  let isOldCurrent!: () => boolean, finish!: (value: string) => void;
  scope.select("legacy", connection);
  const old = scope.run("legacy", connection, isCurrent => { isOldCurrent = isCurrent; return new Promise(resolve => { finish = resolve; }); });
  assert.equal(isOldCurrent(), true);
  scope.select("clean", connection); assert.equal(isOldCurrent(), false);
  let stalePreparation = false;
  await assert.rejects(scope.run("legacy", connection, async () => { stalePreparation = true; return "stale"; }), /context changed/);
  assert.equal(stalePreparation, false);
  finish("old"); await assert.rejects(old, /context changed/);
  assert.equal(await scope.run("clean", connection, async () => "new"), "new");
});
