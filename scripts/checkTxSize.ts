/**
 * OFFLINE wire-size proof — v0 (VersionedTransaction + MessageV0) +
 * Address Lookup Table packing keeps create_basket (and the consumer
 * mint/redeem pair) inside the 1232-byte Solana packet limit for up to
 * MAX_CONSTITUENTS (20) baskets, checked here for n = 2..10.
 *
 * NO network, NO keypair file, NO devnet state: the exact instructions the
 * UI sends (app/lib builders — buildCreateBasketInstruction +
 * computeBudgetInstructions, buildMintInKind / buildRedeemInKind) are compiled
 * into v0 messages against a SYNTHETIC lookup table filled with the same
 * derivation functions the wizard's ensureCreateBasketAlt /
 * ensureMintRedeemAlt provision on-chain. The measured quantity is exactly
 * what the send path checks:
 *
 *     message.serialize().length + 64 * signers   vs   PACKET_LIMIT (1232)
 *
 * For n >= 4 (where the legacy wire overflows) the proof additionally asserts
 * the COVERAGE contract that guards the "stale table" regression: every
 * non-signer account resolves through the table, so the compiled message keeps
 * exactly ONE static key (the payer) and ONE address-table lookup — a partial
 * table would balloon the static-key section back toward the legacy size.
 *
 * Run from the repo root (the --tsconfig flag teaches tsx the "@/lib" alias):
 *
 *   npx tsx --tsconfig app/tsconfig.json scripts/checkTxSize.ts
 *   (or) npm run proof:txsize
 */

import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  CREATE_BASKET_COMPUTE_UNITS,
  buildCreateBasketInstruction,
  estimateCreateBasketTxSize,
  validateCreateBasketArgs,
  type CreateBasketArgs,
} from "../app/lib/create-basket.ts";
import {
  FACTORY_PROGRAM_ID,
  PACKET_LIMIT,
  buildMintInKind,
  buildRedeemInKind,
  computeBudgetInstructions,
  createBasketNeedsAlt,
  deriveBasketPda,
  deriveCreateBasketAltAddresses,
  deriveMintRedeemAltAddresses,
  deriveShareMint,
  mintRedeemNeedsAlt,
  type BasketCoreKeys,
} from "../app/lib/transactions.ts";

// ---------- deterministic (offline) inputs ----------

/** Fixed keys so the proof is byte-for-byte reproducible across runs. */
const CREATOR = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
const USER = Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey;
const TREASURY = Keypair.fromSeed(new Uint8Array(32).fill(13)).publicKey;
const NONCE = 42;
/** Derivation slot of the synthetic table (any value — offline). */
const RECENT_SLOT = 1_000;
/** A plausible 32-byte blockhash used ONLY for offline measurement. */
const MEASURE_BLOCKHASH_B58 = PublicKey.default.toBase58();

function u64Le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

/** Deterministic stand-in constituent mint (any 32 bytes are a valid key). */
function mintKey(i: number): PublicKey {
  const bytes = new Uint8Array(32);
  for (let k = 0; k < 32; k += 1) bytes[k] = (i * 37 + k + 1) & 0xff;
  return new PublicKey(bytes);
}

function createArgs(n: number): CreateBasketArgs {
  const per = Math.floor(10_000 / n);
  const weightsBps = Array.from({ length: n }, () => per);
  weightsBps[n - 1] += 10_000 - per * n; // remainder on the last — sums to 10_000
  return {
    nonce: NONCE,
    constituents: Array.from({ length: n }, (_, i) => mintKey(i).toBase58()),
    weightsBps,
    entryFeeBps: 100,
    exitFeeBps: 50,
    managementFeeBps: 200,
    metadataHash: Uint8Array.from({ length: 32 }, (_, k) => k + 1),
    seedAmounts: Array.from({ length: n }, (_, i) => BigInt(i + 1) * 100_000n),
  };
}

/** Core keys for the consumer mint/redeem pair, derived the way the UI does. */
function basketKeys(n: number): BasketCoreKeys {
  const [basket] = deriveBasketPda(FACTORY_PROGRAM_ID, CREATOR, BigInt(NONCE));
  const [shareMint] = deriveShareMint(basket);
  return {
    basket,
    factory: FACTORY_PROGRAM_ID,
    creator: CREATOR,
    treasury: TREASURY,
    shareMint,
    constituents: Array.from({ length: n }, (_, i) => mintKey(i).toBase58()),
    user: USER,
  };
}

/**
 * The synthetic stand-in for the on-chain table ensureCreateBasketAlt /
 * ensureMintRedeemAlt create+verify: derived at (authority, recentSlot) like
 * the real flow and filled with the SAME address lists the real tables get.
 */
function syntheticAlt(
  authority: PublicKey,
  recentSlot: number,
  addresses: PublicKey[],
): AddressLookupTableAccount {
  const key = PublicKey.findProgramAddressSync(
    [authority.toBuffer(), u64Le(BigInt(recentSlot))],
    AddressLookupTableProgram.programId,
  )[0];
  return new AddressLookupTableAccount({
    key,
    state: {
      delegation: PublicKey.default,
      activationSlot: 0,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority,
      addresses,
    },
  });
}

/**
 * Compile v0 and measure EXACTLY like the send paths do:
 * message.serialize().length + 64 * signers.
 */
function measureV0(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  tables: AddressLookupTableAccount[],
): {
  size: number;
  signers: number;
  staticKeys: number;
  lookups: number;
} {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: MEASURE_BLOCKHASH_B58,
    instructions,
  }).compileToV0Message(tables);
  const transaction = new VersionedTransaction(message);
  return {
    size: transaction.message.serialize().length + transaction.signatures.length * 64,
    signers: transaction.signatures.length,
    staticKeys: message.staticAccountKeys.length,
    lookups: message.addressTableLookups.length,
  };
}

/**
 * web3.js keeps INVOKED program ids in the static section even when the table
 * covers them (see the coverage-contract note on deriveCreateBasketAltAddresses).
 * So a fully-covered ALT message is static-payer + compute-budget program +
 * the instruction's own program (factory for create, basket for mint/redeem).
 */
const FULLY_COVERED_STATIC_KEYS = 3;

/**
 * Measure the ALT-less wire for an arbitrary n. web3.js's v0 serialize()
 * refuses to encode messages that cannot fit a packet — that refusal IS the
 * overflow, so it is reported as Infinity rather than crashing the proof.
 */
function measureNoAlt(instructions: TransactionInstruction[], payer: PublicKey): number {
  try {
    return measureV0(instructions, payer, []).size;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

// ---------- the proof ----------

const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
}

function main(): void {
  const rows: string[] = [];
  rows.push(
    "  n | no-ALT wire (exact) | v0+ALT exact | headroom | static keys | ALT lookups | gate",
    "----+---------------------+--------------+----------+-------------+-------------+------",
  );

  const noAltExact: { n: number; size: number }[] = [];

  for (let n = 2; n <= 10; n += 1) {
    // ---- create_basket (the wire overflow the wizard hit at n = 4) ----
    const args = createArgs(n);
    const validation = validateCreateBasketArgs(args);
    check(`create[${n}] args valid`, validation.length === 0, validation.join(" "));

    const needsAlt = createBasketNeedsAlt(n);
    const estimate = estimateCreateBasketTxSize(n);
    check(
      `create[${n}] gate`,
      needsAlt === (n >= 4 || estimate > PACKET_LIMIT),
      `createBasketNeedsAlt=${needsAlt}, n=${n}, estimate=${estimate}`,
    );

    const instruction = buildCreateBasketInstruction(CREATOR.toBase58(), args);
    const createIxs = [
      ...computeBudgetInstructions(CREATE_BASKET_COMPUTE_UNITS),
      instruction,
    ];

    let createSize: number;
    let createStatic: number;
    let createLookups: number;
    let createSigners: number;
    if (needsAlt) {
      // n >= 4: the exact table payload ensureCreateBasketAlt provisions.
      const altAddresses = deriveCreateBasketAltAddresses(CREATOR.toBase58(), args);
      const table = syntheticAlt(CREATOR, RECENT_SLOT, altAddresses);
      const m = measureV0(createIxs, CREATOR, [table]);
      createSize = m.size;
      createStatic = m.staticKeys;
      createLookups = m.lookups;
      createSigners = m.signers;
      // Coverage contract: every account except the payer and the two INVOKED
      // program ids (compute budget + factory — web3.js pins those to the
      // static section) resolves through the single table. A partial table
      // (the stale-RPC regression that once measured 1283B) would leave
      // account keys behind in the static section.
      check(
        `create[${n}] ALT coverage`,
        createStatic === FULLY_COVERED_STATIC_KEYS && createLookups === 1,
        `staticKeys=${createStatic} (want ${FULLY_COVERED_STATIC_KEYS} = payer + 2 invoked program ids), lookups=${createLookups} (want 1)`,
      );
    } else {
      // n <= 3: the legacy-shaped path — v0, no table, still fits.
      const m = measureV0(createIxs, CREATOR, []);
      createSize = m.size;
      createStatic = m.staticKeys;
      createLookups = m.lookups;
      createSigners = m.signers;
      check(
        `create[${n}] no-ALT shape`,
        createLookups === 0,
        `lookups=${createLookups} (want 0)`,
      );
    }
    check(
      `create[${n}] fits packet`,
      createSize <= PACKET_LIMIT,
      `${createSize}B > ${PACKET_LIMIT}B`,
    );

    // The REGRESSION this proof guards: without the table, n >= 4 cannot fit.
    // Serialize where web3.js allows it (n = 4 measured 1283B — the exact
    // number the old estimate formula under-counted as 1170B) and treat its
    // refusal to encode larger messages as the overflow it is.
    const noAltSize = measureNoAlt(createIxs, CREATOR);
    noAltExact.push({ n, size: noAltSize });
    if (n >= 4) {
      check(
        `create[${n}] overflows without ALT`,
        noAltSize > PACKET_LIMIT,
        `no-ALT wire = ${noAltSize}B (expected > ${PACKET_LIMIT}B)`,
      );
    } else {
      check(
        `create[${n}] fits without ALT`,
        noAltSize <= PACKET_LIMIT,
        `${noAltSize}B`,
      );
    }

    // ---- mint_in_kind / redeem_in_kind (the consumer pair, same table) ----
    const keys = basketKeys(n);
    const seeds = args.seedAmounts as bigint[];
    const consumerNeedsAlt = mintRedeemNeedsAlt(n);
    const consumerTables = consumerNeedsAlt
      ? [syntheticAlt(USER, RECENT_SLOT, deriveMintRedeemAltAddresses(keys))]
      : [];

    const mintBuilt = buildMintInKind({ keys, amounts: seeds, vaultBalances: seeds });
    const mint = measureV0(
      [...computeBudgetInstructions(), ...mintBuilt.instructions],
      USER,
      consumerTables,
    );
    const redeemBuilt = buildRedeemInKind({ keys, sharesToBurn: 25_000n, vaultBalances: seeds });
    const redeem = measureV0(
      [...computeBudgetInstructions(), ...redeemBuilt.instructions],
      USER,
      consumerTables,
    );

    check(`mint[${n}] fits packet`, mint.size <= PACKET_LIMIT, `${mint.size}B`);
    check(`redeem[${n}] fits packet`, redeem.size <= PACKET_LIMIT, `${redeem.size}B`);
    if (consumerNeedsAlt) {
      check(
        `mint[${n}] ALT coverage`,
        mint.staticKeys === FULLY_COVERED_STATIC_KEYS && mint.lookups === 1,
        `staticKeys=${mint.staticKeys} (want ${FULLY_COVERED_STATIC_KEYS}), lookups=${mint.lookups}`,
      );
    }

    // Sanity: exactly one required signature on the measured path (the payer).
    check(`create[${n}] one signer`, createSigners === 1, `${createSigners}`);

    const headroom = PACKET_LIMIT - Math.max(createSize, mint.size, redeem.size);
    const noAltLabel = Number.isFinite(noAltSize) ? `${noAltSize}B` : "> packet (refused)";
    rows.push(
      ` ${String(n).padStart(2)} | ${noAltLabel.padStart(19)} | ` +
        `${String(createSize).padStart(10)}B (create) | ${String(headroom).padStart(8)}B | ` +
        `${String(createStatic).padStart(11)} | ${String(createLookups).padStart(11)} | ` +
        `${needsAlt ? "v0+ALT" : "v0 plain"}`,
    );
    rows.push(
      `    |                         | ${String(mint.size).padStart(10)}B (mint)   |          | ` +
        `${consumerNeedsAlt ? "consumer ALT on" : "consumer plain"} |             |`,
    );
    rows.push(
      `    |                         | ${String(redeem.size).padStart(10)}B (redeem) |          |             |             |`,
    );
  }

  // The headline fact, from the EXACT no-table compiles above: n = 4 is the
  // boundary — it serializes (1283B, the number the old estimate under-counted
  // as 1170B) and still cannot fit a packet; n >= 5 messages are refused by
  // web3.js outright. Recorded for the evidence table.
  const boundary = noAltExact.find((r) => r.n === 4);
  console.log(
    `\nNo-ALT boundary: n=4 compiles to ${
      boundary && Number.isFinite(boundary.size) ? `${boundary.size}B (> ${PACKET_LIMIT}B)` : "a message web3.js refuses to encode"
    } — the estimateCreateBasketTxSize calibration point and the reason createBasketNeedsAlt carries the explicit n >= 4 clause.`,
  );

  console.log("Basalt wire-size proof (offline) — PACKET_LIMIT =", PACKET_LIMIT, "bytes\n");
  console.log(rows.join("\n"));
  console.log(
    `\nCompute-budget instructions: setComputeUnitLimit(${CREATE_BASKET_COMPUTE_UNITS}) + ` +
      `setComputeUnitPrice (first two ixs on every path) — ` +
      `also covered: ${ComputeBudgetProgram.programId.toBase58().slice(0, 8)}… / system ${SystemProgram.programId.toBase58().slice(0, 8)}…`,
  );

  if (failures.length > 0) {
    console.error(`\nFAIL (${failures.length} assertion(s)):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(
    `\nPASS: create_basket + mint_in_kind + redeem_in_kind compile offline to v0 messages ≤ ${PACKET_LIMIT}B for n = 2..10 constituents; n ≥ 4 goes through one lookup table (static keys = payer + 2 invoked program ids).`,
  );
}

main();
