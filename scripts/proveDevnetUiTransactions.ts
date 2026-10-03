/** Exercise the shipped UI transaction builders with a funded, isolated devnet proof wallet. */
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { PublicKey, Transaction, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { DEVNET_MOCKS, DEVNET_GENESIS_HASH, readDevnetBasket, readDevnetWallet, invalidateDevnetBasketCache } from "../app/lib/devnet-baskets";
import { buildCreateBasketTransaction, ensureCreateBasketAlt, ensureMintRedeemAlt, buildMintInKindTransaction, buildRedeemInKindTransaction, type BasketCoreKeys } from "../app/lib/transactions";
import { deriveCreateBasketPdas, sha256Hex, type CreateBasketArgs } from "../app/lib/create-basket";
import { budgetDeposits, parseTokenUnits, weightedSeed } from "../app/components/devnet/amounts";
import { checkGrossShares, computeRedeemPreview } from "../app/components/basket/basket-math";
import { managementFeeWithRemainder, splitFeeBigInt } from "../backend/src/workers/feeMath";
import { createDevnetConnection, getRunDir, loadSigner } from "./xstocks-devnet/runtime";

const serialize = (value: unknown) => JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry, 2);
const { values } = parseArgs({ options: { execute: { type: "boolean", default: false } }, strict: true });
async function main() {
  if (!values.execute) { console.log(serialize({ mode: "plan", cluster: "devnet", steps: ["read funded isolated faucet proof wallet", "create basket through UI ALT builder", "mint through UI builder", "redeem through UI builder", "verify exact raw deltas and finalized signatures"], noBackendSigner: true })); return; }
  const dir = getRunDir("ui-faucet-20261003");
  const faucetReport = JSON.parse(await readFile(join(dir, "faucet-proof.json"), "utf8"));
  assert(faucetReport.complete && faucetReport.proof?.wallet, "Faucet runtime proof must complete first");
  const wallet = await loadSigner(join(dir, "faucet-proof-wallet.json"), new PublicKey(faucetReport.proof.wallet));
  const output = resolve("docs/assets/devnet-ui-2026-10-03"); await mkdir(output, { recursive: true });
  const reportPath = join(output, "ui-builders-proof.json");
  try { await readFile(reportPath); throw new Error("A proof report exists. Inspect it rather than replaying transactions."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const conn = createDevnetConnection();
  const report: any = { version: 1, cluster: "devnet", wallet: wallet.publicKey.toBase58(), startedAt: new Date().toISOString(), transactions: [], assertions: [], complete: false };
  const persist = () => writeFile(reportPath, serialize(report));
  const checked = (condition: unknown, message: string) => { assert(condition, message); report.assertions.push(message); };
  try {
    assert.equal(await conn.getGenesisHash(), DEVNET_GENESIS_HASH);
    const initial = await readDevnetWallet(conn, wallet.publicKey); report.initialWallet = initial;
    checked(initial.solBalance > 35_000_000, "Wallet has a bounded devnet rent/fee budget");
    const sender = async <T extends VersionedTransaction>(tx: T) => {
      tx.sign([wallet]);
      const bytes = tx.serialize(); checked(bytes.length <= 1232, "Serialized UI transaction fits the packet limit");
      const simulated = await conn.simulateTransaction(tx, { sigVerify: true });
      assert.equal(simulated.value.err, null, `UI builder simulation failed: ${(simulated.value.logs ?? []).join("\n")}`);
      const signature = await conn.sendRawTransaction(bytes, { skipPreflight: false, maxRetries: 3 });
      const row: any = { signature, bytes: bytes.length, stage: "submitted", programIds: tx.message.staticAccountKeys.map(key => key.toBase58()) }; report.transactions.push(row); await persist();
      const result = await conn.confirmTransaction(signature, "confirmed"); assert.equal(result.value.err, null, "UI transaction execution failed");
      const landed = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      assert(landed?.meta && landed.meta.err === null, "Successful transaction metadata missing");
      row.stage = "confirmed-success"; row.slot = landed.slot; row.computeUnits = landed.meta.computeUnitsConsumed; await persist();
      console.log(serialize({ signature, bytes: bytes.length, slot: landed.slot })); return signature;
    };
    const metadata = JSON.stringify({ name: "UI devnet proof basket", description: "Four test tokens, created with the same builders used by the UI.", network: "devnet" });
    const hash = await sha256Hex(metadata);
    const args: CreateBasketArgs = { nonce: Date.now(), constituents: DEVNET_MOCKS.map(mock => mock.mint), weightsBps: [2500, 2500, 2500, 2500], entryFeeBps: 0, exitFeeBps: 0, managementFeeBps: 200, metadataHash: Uint8Array.from(hash.match(/.{2}/g)!, part => Number.parseInt(part, 16)), seedAmounts: weightedSeed(parseTokenUnits("100", 8)!, [2500, 2500, 2500, 2500]) };
    const pdas = deriveCreateBasketPdas(wallet.publicKey.toBase58(), args);
    report.basket = pdas.basket.toBase58(); report.shareMint = pdas.shareMint.toBase58(); report.metadataHash = hash; await persist();
    const createAlt = await ensureCreateBasketAlt({ connection: conn, creator: wallet.publicKey.toBase58(), args, sendTransaction: sender });
    const created = await buildCreateBasketTransaction({ connection: conn, creator: wallet.publicKey.toBase58(), args, lookupTableAddresses: [createAlt.lookupTableAddress] });
    await sender(created.transaction);
    invalidateDevnetBasketCache(conn);
    let snapshot = await readDevnetBasket(conn, pdas.basket, wallet.publicKey);
    checked(snapshot.supply === "1000000" && snapshot.shareBalance === "1000000", "Genesis creates exactly 1,000,000 raw shares in the wallet");
    checked(snapshot.detail.metadata_hash === hash, "Immutable metadata hash matches the UI draft");
    checked(snapshot.detail.holdings.every((holding, i) => BigInt(holding.raw_amount) === BigInt(args.seedAmounts[i])), "Create vault raw balances match the UI seed vector");
    const keys: BasketCoreKeys = { basket: pdas.basket, factory: new PublicKey(snapshot.detail.factory), creator: new PublicKey(snapshot.detail.creator), treasury: new PublicKey(snapshot.detail.treasury), shareMint: pdas.shareMint, user: wallet.publicKey, constituents: args.constituents };
    const tradeAlt = await ensureMintRedeemAlt({ connection: conn, keys, sendTransaction: sender });
    invalidateDevnetBasketCache(conn); const beforeMint = await readDevnetBasket(conn, pdas.basket, wallet.publicKey);
    const vaults = beforeMint.detail.holdings.map(h => BigInt(h.raw_amount));
    const deposits = budgetDeposits(parseTokenUnits("80", 8)!, vaults);
    const mint = await buildMintInKindTransaction({ connection: conn, keys, amounts: deposits, vaultBalances: vaults, lookupTableAddresses: [tradeAlt.lookupTableAddress] });
    await sender(mint.transaction);
    invalidateDevnetBasketCache(conn); snapshot = await readDevnetBasket(conn, pdas.basket, wallet.publicKey);
    const elapsedMint = BigInt(snapshot.detail.last_fee_accrual_ts!) - BigInt(beforeMint.detail.last_fee_accrual_ts!);
    const feeMint = managementFeeWithRemainder(BigInt(beforeMint.supply), 200, elapsedMint, BigInt(beforeMint.managementFeeRemainder));
    const gross = checkGrossShares(deposits, vaults, BigInt(beforeMint.supply) + feeMint.fee); assert(gross.ok);
    checked(BigInt(snapshot.supply) === BigInt(beforeMint.supply) + feeMint.fee + gross.gross, "Mint supply follows the canonical checkpoint and gross share formula");
    checked(BigInt(snapshot.shareBalance!) === BigInt(beforeMint.shareBalance!) + splitFeeBigInt(feeMint.fee).creator + gross.gross, "Mint credits the reviewed wallet with its net shares and creator fee shares");
    checked(snapshot.detail.holdings.every((holding, i) => BigInt(holding.raw_amount) === vaults[i] + deposits[i]), "Mint credits each vault exactly in raw units");
    checked(snapshot.walletBalances.every((balance, i) => BigInt(balance.rawAmount) === BigInt(beforeMint.walletBalances[i].rawAmount) - deposits[i]), "Mint debits the wallet exactly in raw units");
    const beforeRedeem = snapshot, redeemed = 100_000n;
    const redemption = await buildRedeemInKindTransaction({ connection: conn, keys, sharesToBurn: redeemed, vaultBalances: snapshot.detail.holdings.map(h => BigInt(h.raw_amount)), lookupTableAddresses: [tradeAlt.lookupTableAddress] });
    await sender(redemption.transaction);
    invalidateDevnetBasketCache(conn); snapshot = await readDevnetBasket(conn, pdas.basket, wallet.publicKey);
    const elapsedRedeem = BigInt(snapshot.detail.last_fee_accrual_ts!) - BigInt(beforeRedeem.detail.last_fee_accrual_ts!);
    const feeRedeem = managementFeeWithRemainder(BigInt(beforeRedeem.supply), 200, elapsedRedeem, BigInt(beforeRedeem.managementFeeRemainder));
    const redeemSupply = BigInt(beforeRedeem.supply) + feeRedeem.fee;
    const preview = computeRedeemPreview(beforeRedeem.detail.holdings.map(h => BigInt(h.raw_amount)), redeemSupply, redeemed, 0)!;
    checked(BigInt(snapshot.supply) === redeemSupply - redeemed, "Redeem burns the requested shares after canonical fee checkpoint");
    checked(BigInt(snapshot.shareBalance!) === BigInt(beforeRedeem.shareBalance!) + splitFeeBigInt(feeRedeem.fee).creator - redeemed, "Redeem burns shares from the reviewed wallet and preserves creator fee shares");
    checked(snapshot.detail.holdings.every((holding, i) => BigInt(holding.raw_amount) === BigInt(beforeRedeem.detail.holdings[i].raw_amount) - preview.outs[i]), "Redeem removes exact pro-rata raw assets from every vault");
    checked(snapshot.walletBalances.every((balance, i) => BigInt(balance.rawAmount) === BigInt(beforeRedeem.walletBalances[i].rawAmount) + preview.outs[i]), "Redeem returns exact pro-rata raw assets to the wallet");
    for (let attempt = 0; attempt < 30; attempt++) {
      const statuses = await conn.getSignatureStatuses(report.transactions.map((tx: any) => tx.signature), { searchTransactionHistory: true });
      if (statuses.value.every(status => status?.confirmationStatus === "finalized" && status.err === null)) { report.finalized = statuses; break; }
      await new Promise(resolve => setTimeout(resolve, 3_000));
    }
    checked(!!report.finalized, "All shipped UI builder transactions are finalized");
    report.finalSnapshot = snapshot; report.finalWallet = await readDevnetWallet(conn, wallet.publicKey); report.complete = true; report.completedAt = new Date().toISOString(); await persist();
    console.log(serialize({ complete: true, basket: report.basket, shareMint: report.shareMint, transactions: report.transactions.length, assertions: report.assertions.length, walletRemainingSol: report.finalWallet.solBalance / 1e9 }));
  } finally { await persist(); conn.closeRpc(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "UI builder proof failed"); process.exitCode = 1; });
