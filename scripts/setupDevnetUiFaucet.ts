/** Fund the fixed devnet faucet and optionally prove a fresh wallet claim. Default: offline plan. */
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, getAccount, getMint } from "@solana/spl-token";
import { assertFixtureMint } from "./xstocks-devnet/profile.ts";
import { createDevnetConnection, getRunDir, loadSigner, loadOrCreateRunKeypair, prepareRunDir } from "./xstocks-devnet/runtime.ts";
import { DEVNET_FAUCET_PROGRAM_ID, DEVNET_GENESIS_HASH, DEVNET_MOCK_TOKENS, DEVNET_FAUCET_CLAIM_RAW,
  deriveDevnetFaucetAuthority, deriveDevnetFaucetClaim, deriveDevnetFaucetVault, buildDevnetFaucetClaim, assertDevnetFaucetReady, readDevnetFaucetClaimed } from "../app/lib/devnet-faucet.ts";

const EXPECTED_PAYER = new PublicKey("y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE");
const VAULT_TARGET = DEVNET_FAUCET_CLAIM_RAW * 100n;
const MIN_RESERVE = 300_000_000;
const MAX_SPEND = 100_000_000;
const PROOF_SOL = 60_000_000;
const json = (value: unknown) => JSON.stringify(value, (_, entry) => typeof entry === "bigint" ? entry.toString() : entry, 2);
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { execute: { type: "boolean", default: false }, proof: { type: "boolean", default: false }, payer: { type: "string" } }, strict: true });
  const dir = getRunDir("ui-faucet-20261003");
  const plan = { mode: values.execute ? "execute" : "plan", cluster: "devnet", genesisHash: DEVNET_GENESIS_HASH,
    program: DEVNET_FAUCET_PROGRAM_ID.toBase58(), payer: EXPECTED_PAYER.toBase58(), authority: deriveDevnetFaucetAuthority().toBase58(),
    claimRawPerMint: DEVNET_FAUCET_CLAIM_RAW, initialRawPoolPerMint: VAULT_TARGET, initialWalletClaims: 100,
    maximumSetupSpendSol: MAX_SPEND / 1e9, minimumRemainingPayerSol: MIN_RESERVE / 1e9, proof: values.proof,
    mocks: DEVNET_MOCK_TOKENS.map(({ symbol, mint, decimals, multiplier }) => ({ symbol, mint: mint.toBase58(), decimals, multiplier, vault: deriveDevnetFaucetVault(mint).toBase58() })),
    note: "Fixed project-issued devnet mocks. Existing mint authorities are preserved. Deploy reviewed SBF separately before executing this funding script." };
  console.log(json(plan));
  if (!values.execute) return plan;
  const conn = createDevnetConnection();
  try {
    assert.equal(await conn.getGenesisHash(), DEVNET_GENESIS_HASH, "Refusing a non-devnet cluster");
    const program = await conn.getAccountInfo(DEVNET_FAUCET_PROGRAM_ID);
    assert(program?.executable, "Reviewed faucet program must be deployed before funding");
    const payer = await loadSigner(resolve(values.payer ?? join(homedir(), ".config", "solana", "id.json")), EXPECTED_PAYER);
    let originalBalance = await conn.getBalance(payer.publicKey, "confirmed");
    assert(originalBalance >= MIN_RESERVE + MAX_SPEND, "Insufficient bounded setup balance");
    await prepareRunDir(dir);
    const reportFile = join(dir, "faucet-proof.json");
    const report: { version: number; program: string; genesisHash: string; payer: string; startedAt: string; transactions: { label: string; signature: string; stage: string; bytes: number; slot?: number }[]; funding: unknown[]; proof?: unknown; complete?: boolean; payerBalanceBefore: number; payerBalanceAfter?: number } = {
      version: 1, program: DEVNET_FAUCET_PROGRAM_ID.toBase58(), genesisHash: DEVNET_GENESIS_HASH, payer: payer.publicKey.toBase58(), startedAt: new Date().toISOString(), transactions: [], funding: [], payerBalanceBefore: originalBalance,
    };
    // Stop when a previous run submitted without recording confirmation. Never replay uncertain sends.
    try {
      const previous = JSON.parse(await readFile(reportFile, "utf8")) as typeof report;
      assert(previous.program === report.program && previous.genesisHash === report.genesisHash && previous.payer === report.payer, "Previous report identity mismatch");
      assert(!previous.transactions.some(tx => tx.stage === "submitted"), "Resolve the prior submitted signature before retrying setup");
      assert(Number.isSafeInteger(previous.payerBalanceBefore) && previous.payerBalanceBefore >= originalBalance, "Invalid prior spending checkpoint");
      originalBalance = previous.payerBalanceBefore;
      report.payerBalanceBefore = originalBalance; report.startedAt = previous.startedAt;
      report.transactions = previous.transactions; report.funding = previous.funding; report.proof = previous.proof;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const persist = () => writeFile(reportFile, json(report), { mode: 0o600 });
    async function send(label: string, instructions: TransactionInstruction[], signers: Keypair[] = [payer]) {
      const remaining = await conn.getBalance(payer.publicKey);
      assert(remaining >= MIN_RESERVE && originalBalance - remaining <= MAX_SPEND - 5_000_000, "Setup spend bound reached");
      const latest = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: signers[0].publicKey, ...latest }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ...instructions);
      tx.sign(...signers);
      const bytes = tx.serialize(); assert(bytes.length <= 1232, "Faucet transaction exceeds packet size");
      const simulation = await conn.simulateTransaction(tx);
      assert.equal(simulation.value.err, null, `${label}: simulation failed ${(simulation.value.logs ?? []).join("\n")}`);
      const signature = await conn.sendRawTransaction(bytes, { skipPreflight: false, maxRetries: 3 });
      const row = { label, signature, stage: "submitted", bytes: bytes.length }; report.transactions.push(row); await persist();
      // One application send. Persist its signature before waiting; ambiguous status stops execution.
      const confirmation = await conn.confirmTransaction({ ...latest, signature }, "confirmed");
      assert.equal(confirmation.value.err, null, `${label}: transaction failed`);
      const landed = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      assert(landed?.meta && landed.meta.err === null, `${label}: successful transaction metadata unavailable`);
      Object.assign(row, { stage: "confirmed-success", slot: landed.slot }); await persist();
      console.log(json({ label, signature, bytes: bytes.length })); return signature;
    }
    for (const fixture of DEVNET_MOCK_TOKENS) {
      assertFixtureMint(await getMint(conn, fixture.mint, "confirmed", TOKEN_2022_PROGRAM_ID), payer.publicKey);
      const source = getAssociatedTokenAddressSync(fixture.mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const vault = deriveDevnetFaucetVault(fixture.mint);
      const info = await conn.getAccountInfo(vault);
      const before = info ? (await getAccount(conn, vault, "confirmed", TOKEN_2022_PROGRAM_ID)).amount : 0n;
      // Successful previous funding is not refilled by rerunning after public claims.
      if (!report.funding.some(row => (row as { mint?: string }).mint === fixture.mint.toBase58())) {
        const needed = before >= VAULT_TARGET ? 0n : VAULT_TARGET - before;
        if (needed > 0n) {
          assert((await getAccount(conn, source, "confirmed", TOKEN_2022_PROGRAM_ID)).amount >= needed, "Existing fixture supply is insufficient");
          await send(`fund_${fixture.symbol}`, [createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, vault, deriveDevnetFaucetAuthority(), fixture.mint, TOKEN_2022_PROGRAM_ID),
            createTransferCheckedInstruction(source, fixture.mint, vault, payer.publicKey, needed, 8, [], TOKEN_2022_PROGRAM_ID)]);
        }
        const account = await getAccount(conn, vault, "confirmed", TOKEN_2022_PROGRAM_ID);
        assert(account.amount >= VAULT_TARGET && account.owner.equals(deriveDevnetFaucetAuthority()) && account.mint.equals(fixture.mint), "Vault funding verification failed");
        report.funding.push({ mint: fixture.mint.toBase58(), vault: vault.toBase58(), rawAfter: account.amount, rawAdded: needed }); await persist();
      }
    }
    await assertDevnetFaucetReady(conn);
    if (values.proof && !report.proof) {
      const wallet = await loadOrCreateRunKeypair(dir, "faucet-proof-wallet.json");
      assert(!await readDevnetFaucetClaimed(conn, wallet.publicKey), "Proof wallet already claimed; verify the prior claim without replaying it");
      if (await conn.getBalance(wallet.publicKey) < PROOF_SOL) await send("fund_proof_wallet_sol", [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wallet.publicKey, lamports: PROOF_SOL })]);
      const claim = deriveDevnetFaucetClaim(wallet.publicKey);
      if (!(await conn.getAccountInfo(claim))) await send("prefund_claim_rent", [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: claim, lamports: await conn.getMinimumBalanceForRentExemption(0) })]);
      const instructions = buildDevnetFaucetClaim(wallet.publicKey);
      const latest = await conn.getLatestBlockhash("confirmed");
      const wrongDestination = buildDevnetFaucetClaim(wallet.publicKey);
      wrongDestination[4].keys[7].pubkey = getAssociatedTokenAddressSync(DEVNET_MOCK_TOKENS[0].mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const substituted = new Transaction({ feePayer: wallet.publicKey, ...latest }).add(...wrongDestination);
      substituted.sign(wallet);
      const invalid = await conn.simulateTransaction(substituted);
      assert.deepEqual(invalid.value.err, { InstructionError: [4, "InvalidAccountData"] }, "Wallet destination substitution must be rejected");
      const wrongMint = buildDevnetFaucetClaim(wallet.publicKey); wrongMint[4].keys[5].pubkey = DEVNET_MOCK_TOKENS[1].mint;
      const substitutedMint = new Transaction({ feePayer: wallet.publicKey, ...latest }).add(...wrongMint); substitutedMint.sign(wallet);
      const invalidMint = await conn.simulateTransaction(substitutedMint);
      assert.deepEqual(invalidMint.value.err, { InstructionError: [4, "IncorrectProgramId"] }, "Mint substitution must be rejected");
      const noSigner = buildDevnetFaucetClaim(wallet.publicKey)[4]; noSigner.keys[0].isSigner = false;
      const unsignedUser = new Transaction({ feePayer: payer.publicKey, ...latest }).add(noSigner); unsignedUser.sign(payer);
      const missingSigner = await conn.simulateTransaction(unsignedUser);
      assert.deepEqual(missingSigner.value.err, { InstructionError: [0, "MissingRequiredSignature"] }, "Missing wallet signer must be rejected");
      const beforeVaults = await Promise.all(DEVNET_MOCK_TOKENS.map(async ({ mint }) => (await getAccount(conn, deriveDevnetFaucetVault(mint), "confirmed", TOKEN_2022_PROGRAM_ID)).amount));
      const signature = await send("fresh_wallet_claim_with_prefunded_pda", instructions, [wallet]);
      const rawBalances = [];
      for (let i = 0; i < DEVNET_MOCK_TOKENS.length; i++) {
        const { mint, symbol } = DEVNET_MOCK_TOKENS[i];
        const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
        const account = await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
        const vault = await getAccount(conn, deriveDevnetFaucetVault(mint), "confirmed", TOKEN_2022_PROGRAM_ID);
        assert.equal(account.amount, DEVNET_FAUCET_CLAIM_RAW, "Claimed raw amount mismatch");
        assert.equal(vault.amount, beforeVaults[i] - DEVNET_FAUCET_CLAIM_RAW, "Vault raw debit mismatch");
        rawBalances.push({ symbol, mint: mint.toBase58(), ata: ata.toBase58(), rawBalance: account.amount, rawVaultDebit: beforeVaults[i] - vault.amount });
      }
      assert(await readDevnetFaucetClaimed(conn, wallet.publicKey), "Claim marker not recorded");
      const repeat = new Transaction({ feePayer: wallet.publicKey, ...(await conn.getLatestBlockhash("confirmed")) }).add(...buildDevnetFaucetClaim(wallet.publicKey)); repeat.sign(wallet);
      const rejected = await conn.simulateTransaction(repeat);
      assert.deepEqual(rejected.value.err, { InstructionError: [4, { Custom: 0 }] }, "Second claim must be rejected with AlreadyClaimed");
      for (let i = 0; i < DEVNET_MOCK_TOKENS.length; i++) {
        const { mint } = DEVNET_MOCK_TOKENS[i];
        assert.equal((await getAccount(conn, getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID), "confirmed", TOKEN_2022_PROGRAM_ID)).amount, DEVNET_FAUCET_CLAIM_RAW, "Rejected repeat changed wallet balance");
        assert.equal((await getAccount(conn, deriveDevnetFaucetVault(mint), "confirmed", TOKEN_2022_PROGRAM_ID)).amount, beforeVaults[i] - DEVNET_FAUCET_CLAIM_RAW, "Rejected repeat changed vault balance");
      }
      const status = await conn.confirmTransaction(signature, "finalized"); assert.equal(status.value.err, null, "Claim did not finalize successfully");
      report.proof = { wallet: wallet.publicKey.toBase58(), signature, prefundedPda: true, exactRawBalances: rawBalances, substitutionRejected: invalid.value.err, mintSubstitutionRejected: invalidMint.value.err, missingSignerRejected: missingSigner.value.err, finalized: true, secondClaimRejected: rejected.value.err };
      await persist();
    }
    // Re-read all eight-extension mint authorities after funding/claim; no authority writes exist.
    for (const { mint } of DEVNET_MOCK_TOKENS) assertFixtureMint(await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID), payer.publicKey);
    report.payerBalanceAfter = await conn.getBalance(payer.publicKey, "confirmed");
    assert(report.payerBalanceAfter >= MIN_RESERVE && originalBalance - report.payerBalanceAfter <= MAX_SPEND, "Setup exceeded final balance bound");
    report.complete = true; await persist();
    console.log(json({ complete: true, reportFile, proofVerified: !!report.proof, spentSol: (originalBalance - report.payerBalanceAfter) / 1e9, remainingSol: report.payerBalanceAfter / 1e9 }));
    return report;
  } finally { conn.closeRpc(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : "Faucet setup failed"); process.exitCode = 1; });
