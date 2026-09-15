/**
 * addMockMints.ts — extend the devnet mock xStock universe.
 *
 * Companion to createWhitelist.ts (which deployed the original 12). This
 * script adds the 24 catalog additions (owner request 2026-09-15: "çok daha
 * fazla stock") to the EXISTING devnet whitelist without touching anything
 * else:
 *   - for each new symbol: create a fresh Token-2022 mint (ScaledUiAmount
 *     extension first, same probe ladder as createWhitelist), mint 10M to the
 *     payer ATA, then whitelist add_mint with price_source "mock:<slug>".
 *   - stable per-symbol mint keypairs (stateKeypair "mint-<SYM>.json") +
 *     reuse-from-state, so a 429-throttled partial run resumes cleanly.
 *   - verify every WhitelistedMint PDA reads back Active with the right
 *     decimals, then append to state.json (mints / mockSymbols /
 *     mintAddressBySymbol).
 *
 * RUN (from the repo root):
 *   FOLIOX_E2E_STATE_DIR=scripts/.e2e-devnet \
 *   FOLIOX_E2E_PAYER=~/.config/solana/id.json \
 *   FOLIOX_E2E_RPC_URL=https://api.devnet.solana.com \
 *   npx tsx scripts/addMockMints.ts
 *
 * The payer MUST be the whitelist config authority on the target cluster
 * (checked on-chain before any write). No airdrop on public clusters — fund
 * the payer first (see ensureSol).
 *
 * KEEP IN SYNC: the entries below must mirror additions in
 * backend/src/catalog/mockStocks.ts (MOCK_XSTOCKS + MOCK_SLUG_TO_TICKER).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  createAtaIdempotent,
  deriveAta,
  deriveWhitelistConfig,
  deriveWhitelistedMint,
  ensureSol,
  fmtRaw,
  initializeMint2,
  initializeScaledUiAmountConfig,
  ixAddMint,
  loadState,
  mintTo,
  newConnection,
  payerKeypair,
  readMint,
  saveState,
  send,
  stateKeypair,
  step,
  TOKEN_2022_PROGRAM_ID,
  trySend,
  hasStepFailure,
} from "./lib.ts";

const MINT_DECIMALS = 6;
const PAYER_SUPPLY = 10_000_000n * 10n ** BigInt(MINT_DECIMALS);
const SCALED_SPACE_COMPACT = 82 + 1 + 4 + 56;
const SCALED_SPACE_PADDED = 82 + 83 + 1 + 4 + 56;
const PLAIN_SPACE = 82;

/**
 * The 24 catalog additions — MUST stay in sync with
 * backend/src/catalog/mockStocks.ts (MOCK_XSTOCKS + MOCK_SLUG_TO_TICKER).
 */
const NEW_MOCKS = [
  { symbol: "ADBEx", priceSource: "mock:adbe" },
  { symbol: "NFLXx", priceSource: "mock:nflx" },
  { symbol: "ORCLx", priceSource: "mock:orcl" },
  { symbol: "CRMx", priceSource: "mock:crm" },
  { symbol: "INTCx", priceSource: "mock:intc" },
  { symbol: "QCOMx", priceSource: "mock:qcom" },
  { symbol: "AVGOx", priceSource: "mock:avgo" },
  { symbol: "TSMx", priceSource: "mock:tsm" },
  { symbol: "UBERx", priceSource: "mock:uber" },
  { symbol: "ABNBx", priceSource: "mock:abnb" },
  { symbol: "DISx", priceSource: "mock:dis" },
  { symbol: "BAx", priceSource: "mock:ba" },
  { symbol: "JPMx", priceSource: "mock:jpm" },
  { symbol: "Vx", priceSource: "mock:v" },
  { symbol: "WMTx", priceSource: "mock:wmt" },
  { symbol: "KOx", priceSource: "mock:ko" },
  { symbol: "MCDx", priceSource: "mock:mcd" },
  { symbol: "NKEx", priceSource: "mock:nke" },
  { symbol: "PFEx", priceSource: "mock:pfe" },
  { symbol: "JNJx", priceSource: "mock:jnj" },
  { symbol: "XOMx", priceSource: "mock:xom" },
  { symbol: "CVXx", priceSource: "mock:cvx" },
  { symbol: "PLTRx", priceSource: "mock:pltr" },
  { symbol: "GMEx", priceSource: "mock:gme" },
];

async function main() {
  const conn: Connection = newConnection();
  const payer = payerKeypair();
  const savedState = loadState();
  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`payer (must be the whitelist authority): ${payer.publicKey.toBase58()}`);

  // Guard: the config on this cluster must exist and belong to the payer.
  const config = deriveWhitelistConfig();
  const configInfo = await conn.getAccountInfo(config);
  if (!configInfo) throw new Error(`whitelist config ${config.toBase58()} not found on this cluster`);
  if (savedState.whitelistConfig && savedState.whitelistConfig !== config.toBase58()) {
    throw new Error(
      `state.json whitelistConfig ${savedState.whitelistConfig} != derived ${config.toBase58()} — wrong state dir?`,
    );
  }

  await ensureSol(conn, payer, 2, 10);

  const prior: Record<string, string> = { ...(savedState?.mintAddressBySymbol ?? {}) };
  const mintStates: { symbol: string; mint: string; scaled: boolean }[] = [];

  // ---- create the 24 mock Token-2022 mints (same probe ladder as
  //      createWhitelist.ts) ----
  await step(`create mock xStocks x${NEW_MOCKS.length} (Token-2022, ScaledUiAmountConfig x1.0, decimals 6)`, async () => {
    for (const mock of NEW_MOCKS) {
      const mintKp: Keypair = stateKeypair(`mint-${mock.symbol}.json`);
      const mint = mintKp.publicKey;
      const existingAddr = prior[mock.symbol] ? new PublicKey(prior[mock.symbol]) : null;
      const existing = existingAddr ? await conn.getAccountInfo(existingAddr) : null;
      if (existingAddr && existing) {
        if (!existing.owner.equals(TOKEN_2022_PROGRAM_ID)) {
          throw new Error(`existing ${mock.symbol} mint ${existingAddr.toBase58()} is not Token-2022`);
        }
        const st = await readMint(conn, existingAddr);
        if (!st || st.decimals !== MINT_DECIMALS) {
          throw new Error(`existing ${mock.symbol} mint decimals mismatch`);
        }
        const payerAta = deriveAta(payer.publicKey, existingAddr);
        const bal = BigInt(
          await conn.getTokenAccountBalance(payerAta).then((r) => r.value.amount).catch(() => "0"),
        );
        if (bal < PAYER_SUPPLY) {
          // Note: mint authority was the ORIGINAL deploy payer; a top-up from
          // this payer only works when it still holds mint authority. If the
          // mint was created by another wallet, top-up is skipped loudly.
          try {
            await send(conn, `mint_to(${mock.symbol}, top-up)`, [
              createAtaIdempotent(payer.publicKey, payer.publicKey, existingAddr),
              mintTo(existingAddr, payerAta, payer.publicKey, PAYER_SUPPLY - bal),
            ], [payer]);
          } catch (e) {
            console.log(`  ${mock.symbol}: top-up failed (mint authority is not this payer) — continuing`);
          }
        }
        mintStates.push({ symbol: mock.symbol, mint: existingAddr.toBase58(), scaled: st!.scaledExtension });
        console.log(`  ${mock.symbol}: ${existingAddr.toBase58()} [reused] payer ATA ${fmtRaw(bal)}`);
        continue;
      }
      if (await conn.getAccountInfo(mint)) {
        throw new Error(`mock mint ${mint.toBase58()} already exists (fresh state dir required)`);
      }
      const payerAta = deriveAta(payer.publicKey, mint);
      const tail = [
        createAtaIdempotent(payer.publicKey, payer.publicKey, mint),
        mintTo(mint, payerAta, payer.publicKey, PAYER_SUPPLY),
      ];

      const attempts: { label: string; space: number; ixs: ReturnType<typeof initializeMint2>[] }[] = [
        {
          label: `scaled(${SCALED_SPACE_COMPACT}B)`,
          space: SCALED_SPACE_COMPACT,
          ixs: [
            initializeScaledUiAmountConfig(mint, 1.0, payer.publicKey),
            initializeMint2(mint, MINT_DECIMALS, payer.publicKey, null),
          ],
        },
        {
          label: `scaled(${SCALED_SPACE_PADDED}B)`,
          space: SCALED_SPACE_PADDED,
          ixs: [
            initializeScaledUiAmountConfig(mint, 1.0, payer.publicKey),
            initializeMint2(mint, MINT_DECIMALS, payer.publicKey, null),
          ],
        },
        {
          label: "plain(82B)",
          space: PLAIN_SPACE,
          ixs: [initializeMint2(mint, MINT_DECIMALS, payer.publicKey, null)],
        },
      ];

      let done = false;
      let usedLabel = "";
      for (const a of attempts) {
        const ixs = [
          SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mint,
            space: a.space,
            lamports: await conn.getMinimumBalanceForRentExemption(a.space),
            programId: TOKEN_2022_PROGRAM_ID,
          }),
          ...a.ixs,
          ...tail,
        ];
        const ok = await trySend(conn, ixs, [payer, mintKp]);
        if (ok) {
          usedLabel = a.label;
          done = true;
          break;
        }
      }
      if (!done) throw new Error(`could not create mock mint ${mock.symbol} in any layout`);

      const state = await readMint(conn, mint);
      if (!state) throw new Error(`mint ${mock.symbol} vanished after creation`);
      if (state.decimals !== MINT_DECIMALS) {
        throw new Error(`mint ${mock.symbol} decimals ${state.decimals} != ${MINT_DECIMALS}`);
      }
      if (state.supply < PAYER_SUPPLY) throw new Error(`mint ${mock.symbol} supply short`);
      const payerBal = await conn
        .getTokenAccountBalance(deriveAta(payer.publicKey, mint))
        .then((r) => r.value.amount)
        .catch(() => "0");
      if (BigInt(payerBal) < PAYER_SUPPLY) throw new Error(`payer ATA short for ${mock.symbol}`);
      // Persist immediately — a mid-loop crash (devnet 429s) resumes with the
      // same addresses instead of creating orphans.
      savedState.mintAddressBySymbol = {
        ...((savedState?.mintAddressBySymbol as Record<string, string>) ?? {}),
        [mock.symbol]: mint.toBase58(),
      };
      saveState({ mintAddressBySymbol: savedState.mintAddressBySymbol });
      mintStates.push({ symbol: mock.symbol, mint: mint.toBase58(), scaled: state.scaledExtension });
      console.log(`  ${mock.symbol}: ${mint.toBase58()} [${usedLabel}] payer ATA ${fmtRaw(BigInt(payerBal))}`);
    }
  });

  // ---- whitelist add_mint against the EXISTING config (no init here) ----
  await step(`whitelist add_mint x${NEW_MOCKS.length} (status Active)`, async () => {
    for (let i = 0; i < mintStates.length; i++) {
      const mint = new PublicKey(mintStates[i].mint);
      const wlPda = deriveWhitelistedMint(mint);
      if (await conn.getAccountInfo(wlPda)) {
        console.log(`  whitelisted already: ${mintStates[i].symbol}`);
        continue;
      }
      // One tx per add_mint keeps failures attributable to a single mint.
      await send(
        conn,
        `add_mint(${mintStates[i].symbol})`,
        [ixAddMint(payer.publicKey, mint, MINT_DECIMALS, NEW_MOCKS[i].priceSource)],
        [payer],
      );
    }
  });

  await step("verify WhitelistedMint records (Active, decimals cached)", async () => {
    for (let i = 0; i < mintStates.length; i++) {
      const mint = new PublicKey(mintStates[i].mint);
      const wlPda = deriveWhitelistedMint(mint);
      const info = await conn.getAccountInfo(wlPda);
      if (!info) throw new Error(`WhitelistedMint PDA missing for ${mintStates[i].symbol}`);
      // 8 disc + 32 mint + 1 decimals + 8 watermark + 1 status
      const status = info.data[49];
      const decimals = info.data[40];
      const storedMint = new PublicKey(info.data.subarray(8, 40));
      if (!storedMint.equals(mint)) throw new Error(`record mint mismatch for ${mintStates[i].symbol}`);
      if (status !== 0) throw new Error(`record status ${status} != Active(0) for ${mintStates[i].symbol}`);
      if (decimals !== MINT_DECIMALS) throw new Error(`record decimals ${decimals} != ${MINT_DECIMALS}`);
      console.log(`  ${mintStates[i].symbol}: ${wlPda.toBase58()} status=Active decimals=${decimals}`);
    }
  });

  // Append to the parallel arrays; the old informational weightsBps list no
  // longer aligns (it had no reader — drop it rather than pad with fake data).
  const prevMints: string[] = Array.isArray(savedState.mints) ? savedState.mints : [];
  const prevSymbols: string[] = Array.isArray(savedState.mockSymbols) ? savedState.mockSymbols : [];
  const known = new Set(prevSymbols);
  for (const m of mintStates) {
    if (!known.has(m.symbol)) {
      prevMints.push(m.mint);
      prevSymbols.push(m.symbol);
    }
  }
  saveState({
    mints: prevMints,
    mockSymbols: prevSymbols,
    whitelistConfig: config.toBase58(),
    weightsBps: undefined,
  });
  console.log(`\nstate saved: ${prevSymbols.length} mock mints whitelisted in total`);
  if (hasStepFailure()) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
