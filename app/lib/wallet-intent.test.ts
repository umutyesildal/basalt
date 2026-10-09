import assert from "node:assert/strict";
import test from "node:test";
import { assertWalletIntent, assertWalletIntentNow, sendWithReviewedIntent } from "./wallet-intent";
import { AltPreparationScope } from "./alt-preparation-scope";
import { withRetry } from "./rpc-retry";

for (const phase of ["after-prepare", "during-simulation"]) {
  test(`a namespace change ${phase} prevents the actual guarded wallet send`, async () => {
    const connection = {}, expected = {connection, wallet:"reviewed-wallet"};
    const scope = new AltPreparationScope<string>(); scope.select("legacy-basket", connection);
    await scope.run("legacy-basket", connection, async () => "legacy-table");
    if (phase === "during-simulation") await Promise.resolve();
    scope.select("clean-basket", connection);
    let sends = 0;
    const check = () => assertWalletIntent(expected, () => expected, () => scope.assertCurrent("legacy-basket", connection));
    await assert.rejects(sendWithReviewedIntent(async () => { sends++; return "signed"; }, check, () => scope.assertCurrent("legacy-basket", connection)), /context changed/);
    assert.equal(sends, 0);
  });
}

test("wallet or RPC changes while an asynchronous pre-sign check runs cannot reach wallet signing", async () => {
  for (const change of ["wallet", "rpc"]) {
    const connection = {}, expected = {connection, wallet:"reviewed-wallet"}; let current = expected, sends = 0;
    const check = () => assertWalletIntent(expected, () => current, async () => { current = change === "wallet" ? {...current,wallet:"another-wallet"} : {...current,connection:{}}; });
    await assert.rejects(sendWithReviewedIntent(async () => { sends++; return "signed"; }, check, () => assertWalletIntentNow(expected,current)), /wallet or network changed/);
    assert.equal(sends, 0);
  }
});

test("wallet-send retry rechecks basket intent and never repeats the wallet call after context changes", async () => {
  const connection = {}, expected = {connection,wallet:"reviewed-wallet"}, scope = new AltPreparationScope<string>(); scope.select("legacy",connection);
  let sends = 0;
  const check = () => assertWalletIntent(expected, () => expected, () => scope.assertCurrent("legacy", connection));
  await assert.rejects(withRetry(() => sendWithReviewedIntent(async () => {
    sends++; scope.select("clean",connection); throw new Error("429 Too Many Requests");
  }, check, () => scope.assertCurrent("legacy",connection)), {label:"guarded wallet send", attempts:2, delaysMs:[0]}), /context changed/);
  assert.equal(sends, 1);
});

test("the same reviewed basket, wallet and RPC still reach wallet signing exactly once", async () => {
  const connection = {}, expected = {connection,wallet:"reviewed-wallet"}, scope = new AltPreparationScope<string>(); scope.select("legacy",connection);
  let sends = 0;
  const value = await sendWithReviewedIntent(async () => {sends++; return "signed";}, () => assertWalletIntent(expected, () => expected, () => scope.assertCurrent("legacy",connection)), () => scope.assertCurrent("legacy",connection));
  assert.equal(value,"signed"); assert.equal(sends,1);
});


test("a microtask context switch after the async check cannot enter the actual wallet-send call", async () => {
  const connection = {}, expected = {connection,wallet:"reviewed-wallet"}; let current = expected, sends = 0;
  const prepare = () => assertWalletIntent(expected, () => current, () => {
    queueMicrotask(() => queueMicrotask(() => { current = {...current,wallet:"another-wallet"}; }));
  });
  await assert.rejects(sendWithReviewedIntent(async () => {sends++; return "signed";}, prepare, () => assertWalletIntentNow(expected,current)), /wallet or network changed/);
  assert.equal(sends,0);
});
