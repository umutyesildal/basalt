/** Prepare four explicitly labelled issuer-profile devnet mocks. Default: read-only plan. */
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync, getMint, getAccount } from "@solana/spl-token";
import { buildFixtureMint, fixtureSizes, assertFixtureMint, DEVNET_GENESIS, FIXTURE_PROFILE, FIXTURE_EXTENSIONS } from "./xstocks-devnet/profile.ts";
import { createDevnetConnection, getRunDir, loadSigner, loadOrCreateRunKeypair, loadFixtureState, saveFixtureState, type FixtureState } from "./xstocks-devnet/runtime.ts";
import { WHITELIST_PROGRAM_ID, FACTORY_PROGRAM_ID, BASKET_PROGRAM_ID, deriveWhitelistConfig, decodeWhitelistAuthority, deriveWhitelistedMint, ixAddMint } from "./lib.ts";

const RPC = "https://api.devnet.solana.com";
const DEFAULT_PAYER = "y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE";
const SUPPLY = 10_000_000n * 100_000_000n;
const MIN_RESERVE = 250_000_000;
const MAX_SETUP_SPEND = 150_000_000;
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { execute: { type: "boolean", default: false }, "run-id": { type: "string" }, payer: { type: "string" }, "expected-payer": { type: "string", default: DEFAULT_PAYER } }, strict: true });
  const runId = values["run-id"] ?? `issuer-profile-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const dir = getRunDir(runId), expected = new PublicKey(values["expected-payer"]!);
  const plan = { mode: values.execute ? "execute" : "plan", cluster: "devnet", rpc: RPC, expectedGenesis: DEVNET_GENESIS, stateDirectory: dir,
    payer: expected.toBase58(), profile: FIXTURE_PROFILE, extensionIds: FIXTURE_EXTENSIONS, decimals: 8,
    mocks: ["A", "B", "C", "D"].map((letter, i) => ({ letter, symbol: `BSTEST${letter}`, multiplier: [1, 1.25, 2, 10][i] })),
    maximumSetupSpendSol: MAX_SETUP_SPEND / 1e9, minimumRemainingSol: MIN_RESERVE / 1e9,
    note: "Project-issued test tokens, not official xStocks. No confidential account balances. No program deployment or historical state mutation." };
  console.log(JSON.stringify(plan, null, 2));
  if (!values.execute) return plan;

  const conn = createDevnetConnection();
  try {
  if (await conn.getGenesisHash() !== DEVNET_GENESIS) throw new Error("Refusing a non-devnet cluster");
  const payer = await loadSigner(resolve(values.payer ?? join(homedir(), ".config", "solana", "id.json")), expected);
  const balanceBefore = await conn.getBalance(payer.publicKey, "confirmed");
  if (balanceBefore < MIN_RESERVE + MAX_SETUP_SPEND) throw new Error("Insufficient devnet SOL for bounded setup plus reserve");
  for (const program of [WHITELIST_PROGRAM_ID, FACTORY_PROGRAM_ID, BASKET_PROGRAM_ID]) {
    if (!(await conn.getAccountInfo(program))?.executable) throw new Error(`Devnet program unavailable: ${program.toBase58()}`);
  }
  const config = await conn.getAccountInfo(deriveWhitelistConfig());
  if (!config || !config.owner.equals(WHITELIST_PROGRAM_ID) || !decodeWhitelistAuthority(config.data).equals(payer.publicKey)) throw new Error("Payer is not the existing whitelist authority");
  const previous = await loadFixtureState(dir);
  if (previous && previous.payer !== payer.publicKey.toBase58()) throw new Error("Fixture state belongs to another payer");
  const state: FixtureState = previous ?? { version: 1, cluster: "devnet", genesisHash: DEVNET_GENESIS, profile: FIXTURE_PROFILE, payer: payer.publicKey.toBase58(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mocks: [] };
  async function send(label: string, instructions: TransactionInstruction[], signers: Keypair[] = [payer]) {
    const current = await conn.getBalance(payer.publicKey);
    if (current < MIN_RESERVE || balanceBefore - current > MAX_SETUP_SPEND) throw new Error("Setup spending bound reached");
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ...instructions);
    const signature = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed", skipPreflight: false, maxRetries: 3 });
    console.log(JSON.stringify({ action: label, signature })); return signature;
  }
  for (const fixture of plan.mocks) {
    const keypair = await loadOrCreateRunKeypair(dir, `mint-${fixture.letter}.json`), mint = keypair.publicKey;
    let row = state.mocks.find(item => item.letter === fixture.letter);
    if (row && row.mint !== mint.toBase58()) throw new Error("Saved fixture mint does not match its isolated signing key");
    if (!row) { row = { ...fixture, name: `Basalt devnet fixture ${fixture.letter}`, mint: mint.toBase58(), decimals: 8, signatures: {} }; state.mocks.push(row); await saveFixtureState(dir, state); }
    if (!(await conn.getAccountInfo(mint))) {
      const size = fixtureSizes(mint, payer.publicKey, fixture.letter);
      const rent = await conn.getMinimumBalanceForRentExemption(size.final);
      row.signatures.create = await send(`create_${fixture.symbol}`, buildFixtureMint(mint, payer.publicKey, fixture.letter, rent, fixture.multiplier), [payer, keypair]);
      await saveFixtureState(dir, state);
    }
    assertFixtureMint(await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID), payer.publicKey);
    const ata = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const existingAta = await conn.getAccountInfo(ata);
    const amount = existingAta ? (await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount : 0n;
    if (amount < SUPPLY) {
      row.signatures.fund = await send(`fund_${fixture.symbol}`, [createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID), createMintToInstruction(mint, ata, payer.publicKey, SUPPLY - amount, [], TOKEN_2022_PROGRAM_ID)]);
      await saveFixtureState(dir, state);
    }
    if (!(await conn.getAccountInfo(deriveWhitelistedMint(mint)))) {
      row.signatures.whitelist = await send(`whitelist_${fixture.symbol}`, [ixAddMint(payer.publicKey, mint, 8, `mock:issuer-profile:${fixture.letter.toLowerCase()}`)]);
      await saveFixtureState(dir, state);
    }
  }
  const balanceAfter = await conn.getBalance(payer.publicKey, "confirmed");
  console.log(JSON.stringify({ complete: true, stateDirectory: dir, mockMints: state.mocks.map(({ symbol, mint }) => ({ symbol, mint })), spentSol: (balanceBefore - balanceAfter) / 1e9, remainingSol: balanceAfter / 1e9 }));
  return state;
  } finally { conn.closeRpc(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : "Setup failed"); process.exitCode = 1; });
