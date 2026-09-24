/**
 * Instruction-level localnet proof for the fee-free Managed Basket V2 mock.
 *
 * Requires a local solana-test-validator with the managed_basket program loaded.
 * All generated actor keypairs and run state are written below
 * MANAGED_V2_STATE_DIR (default: a fresh directory in /private/tmp).
 *
 * This is a prototype proof using two locally minted, extension-free Token-2022
 * mints. It does not represent live assets or production deployment readiness.
 */
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID as SHARED_TOKEN_2022_PROGRAM_ID,
  borshU16,
  borshU64,
  concat,
  sighash,
} from "./lib";

const RPC_URL = process.env.MANAGED_V2_RPC_URL ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  "CZ3eG8JutryawXTcA1h97PMrhAGuWzsrYSgssMH43cKL",
);
const STATE_DIR =
  process.env.MANAGED_V2_STATE_DIR ??
  fs.mkdtempSync(path.join("/private/tmp", "basalt-managed-v2-"));
const configuredNoticeSlots = process.env.MANAGED_V2_NOTICE_SLOTS;
const NOTICE_SLOTS = configuredNoticeSlots ? BigInt(configuredNoticeSlots) : 216_000n;
const PROGRAM_ARTIFACT_SHA256 = process.env.MANAGED_V2_PROGRAM_SHA256 ?? null;
if (NOTICE_SLOTS <= 0n) {
  throw new Error("MANAGED_V2_NOTICE_SLOTS must be a positive integer");
}
const GENESIS_SHARES_RAW = 1_000_000n;
const HOLDER_SHARES_RAW = 100_000n;
const PRE_NOTICE_REDEEM_RAW = 50_000n;
const INPUT_RAW = 1_000_000n;
const OUTPUT_RAW = 800_000n;
const MIN_OUTPUT_RAW = 750_000n;

if (!TOKEN_2022_PROGRAM_ID.equals(SHARED_TOKEN_2022_PROGRAM_ID)) {
  throw new Error("Token-2022 program IDs differ between local and shared helpers");
}

fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
try {
  fs.chmodSync(STATE_DIR, 0o700);
} catch {
  // File mode enforcement is best effort on platforms without POSIX modes.
}

function meta(
  pubkey: PublicKey,
  isWritable = false,
  isSigner = false,
): { pubkey: PublicKey; isWritable: boolean; isSigner: boolean } {
  return { pubkey, isWritable, isSigner };
}

function derivePda(seeds: Buffer[], programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function u64Bytes(value: bigint): Buffer {
  return borshU64(value);
}

function managedBasketPda(creator: PublicKey, nonce: bigint): PublicKey {
  return derivePda([
    Buffer.from("managed_basket"),
    creator.toBuffer(),
    u64Bytes(nonce),
  ]);
}

function vaultAuthorityPda(basket: PublicKey): PublicKey {
  return derivePda([Buffer.from("managed_vault_authority"), basket.toBuffer()]);
}

function shareMintPda(basket: PublicKey): PublicKey {
  return derivePda([Buffer.from("managed_share_mint"), basket.toBuffer()]);
}

function identityMintPda(basket: PublicKey): PublicKey {
  return derivePda([Buffer.from("basket_identity_nft"), basket.toBuffer()]);
}

function proposalPda(basket: PublicKey, nonce: bigint): PublicKey {
  return derivePda([
    Buffer.from("managed_rebalance_proposal"),
    basket.toBuffer(),
    u64Bytes(nonce),
  ]);
}

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      owner.toBuffer(),
      TOKEN_2022_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function createManagedBasketIx(a: {
  creator: PublicKey;
  guardian: PublicKey;
  basket: PublicKey;
  vaultAuthority: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  shareMint: PublicKey;
  identityMint: PublicKey;
  sourceA: PublicKey;
  sourceB: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  creatorShareAta: PublicKey;
  creatorIdentityAta: PublicKey;
  basketNonce: bigint;
  weightsBps: [number, number];
  seedAmountsRaw: [bigint, bigint];
  approvalTtlSlots: bigint;
  noticeDurationSlots: bigint;
  executionWindowSlots: bigint;
}): TransactionInstruction {
  const data = concat(
    sighash("create_managed_basket"),
    borshU64(a.basketNonce),
    borshU16(a.weightsBps[0]),
    borshU16(a.weightsBps[1]),
    borshU64(a.seedAmountsRaw[0]),
    borshU64(a.seedAmountsRaw[1]),
    borshU64(a.approvalTtlSlots),
    borshU64(a.noticeDurationSlots),
    borshU64(a.executionWindowSlots),
  );
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.creator, true, true),
      meta(a.guardian),
      meta(a.basket, true),
      meta(a.vaultAuthority),
      meta(a.mintA),
      meta(a.mintB),
      meta(a.shareMint, true),
      meta(a.identityMint, true),
      meta(a.sourceA, true),
      meta(a.sourceB, true),
      meta(a.vaultA, true),
      meta(a.vaultB, true),
      meta(a.creatorShareAta, true),
      meta(a.creatorIdentityAta, true),
      meta(TOKEN_2022_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(SYSTEM_PROGRAM_ID),
    ],
    data,
  });
}

function mintInKindIx(a: {
  user: PublicKey;
  basket: PublicKey;
  vaultAuthority: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  sourceA: PublicKey;
  sourceB: PublicKey;
  shareMint: PublicKey;
  shareAta: PublicKey;
  depositsRaw: [bigint, bigint];
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.user, true, true),
      meta(a.basket),
      meta(a.vaultAuthority),
      meta(a.mintA),
      meta(a.mintB),
      meta(a.vaultA, true),
      meta(a.vaultB, true),
      meta(a.sourceA, true),
      meta(a.sourceB, true),
      meta(a.shareMint, true),
      meta(a.shareAta, true),
      meta(TOKEN_2022_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(SYSTEM_PROGRAM_ID),
    ],
    data: concat(
      sighash("mint_in_kind"),
      borshU64(a.depositsRaw[0]),
      borshU64(a.depositsRaw[1]),
    ),
  });
}

function redeemInKindIx(a: {
  user: PublicKey;
  basket: PublicKey;
  vaultAuthority: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  shareMint: PublicKey;
  shareAta: PublicKey;
  receiveA: PublicKey;
  receiveB: PublicKey;
  sharesRaw: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.user, true, true),
      meta(a.basket),
      meta(a.vaultAuthority),
      meta(a.mintA),
      meta(a.mintB),
      meta(a.vaultA, true),
      meta(a.vaultB, true),
      meta(a.shareMint, true),
      meta(a.shareAta, true),
      meta(a.receiveA, true),
      meta(a.receiveB, true),
      meta(TOKEN_2022_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(SYSTEM_PROGRAM_ID),
    ],
    data: concat(sighash("redeem_in_kind"), borshU64(a.sharesRaw)),
  });
}

function proposeRebalanceIx(a: {
  manager: PublicKey;
  basket: PublicKey;
  proposal: PublicKey;
  nonce: bigint;
  expectedVersion: bigint;
  weightsBps: [number, number];
  inputMint: PublicKey;
  maxInputRaw: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.manager, true, true),
      meta(a.basket, true),
      meta(a.proposal, true),
      meta(SYSTEM_PROGRAM_ID),
    ],
    data: concat(
      sighash("propose_rebalance"),
      borshU64(a.nonce),
      borshU64(a.expectedVersion),
      borshU16(a.weightsBps[0]),
      borshU16(a.weightsBps[1]),
      a.inputMint.toBuffer(),
      borshU64(a.maxInputRaw),
    ),
  });
}

function approvePriceBoundIx(a: {
  guardian: PublicKey;
  basket: PublicKey;
  proposal: PublicKey;
  nonce: bigint;
  minOutputRaw: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.guardian, false, true),
      meta(a.basket, true),
      meta(a.proposal, true),
    ],
    data: concat(
      sighash("approve_price_bound"),
      borshU64(a.nonce),
      borshU64(a.minOutputRaw),
    ),
  });
}

function fillRebalanceIx(a: {
  taker: PublicKey;
  basket: PublicKey;
  proposal: PublicKey;
  vaultAuthority: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  takerAtaA: PublicKey;
  takerAtaB: PublicKey;
  shareMint: PublicKey;
  nonce: bigint;
  inputRaw: bigint;
  outputRaw: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.taker, false, true),
      meta(a.basket, true),
      meta(a.proposal, true),
      meta(a.vaultAuthority),
      meta(a.mintA),
      meta(a.mintB),
      meta(a.vaultA, true),
      meta(a.vaultB, true),
      meta(a.takerAtaA, true),
      meta(a.takerAtaB, true),
      meta(a.shareMint),
      meta(TOKEN_2022_PROGRAM_ID),
    ],
    data: concat(
      sighash("fill_rebalance"),
      borshU64(a.nonce),
      borshU64(a.inputRaw),
      borshU64(a.outputRaw),
    ),
  });
}

async function send(
  connection: Connection,
  payer: Keypair,
  instruction: TransactionInstruction,
  signers: Keypair[] = [],
): Promise<string> {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    instruction,
  );
  tx.feePayer = payer.publicKey;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  return sendAndConfirmTransaction(connection, tx, [payer, ...signers], {
    commitment: "confirmed",
  });
}

async function expectFailure(
  label: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch {
    console.log("PASS rejected: " + label);
    return;
  }
  throw new Error("Expected instruction to fail: " + label);
}

async function requestLocalAirdrop(
  connection: Connection,
  keypair: Keypair,
  sol = 5,
): Promise<void> {
  const signature = await connection.requestAirdrop(
    keypair.publicKey,
    sol * 1_000_000_000,
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
}

async function rawAmount(connection: Connection, address: PublicKey): Promise<bigint> {
  const account = await getAccount(
    connection,
    address,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
  return account.amount;
}

async function vaultAmounts(
  connection: Connection,
  vaultA: PublicKey,
  vaultB: PublicKey,
): Promise<[bigint, bigint]> {
  return [
    await rawAmount(connection, vaultA),
    await rawAmount(connection, vaultB),
  ];
}

function readBasketState(data: Buffer): {
  version: bigint;
  weightsBps: [number, number];
} {
  // Anchor discriminator (8), fixed Borsh field sequence from state.rs.
  if (data.length < 298) throw new Error("ManagedBasket account is truncated");
  return {
    version: data.readBigUInt64LE(247),
    weightsBps: [data.readUInt16LE(243), data.readUInt16LE(245)],
  };
}

function saveWallet(name: string, keypair: Keypair): void {
  const file = path.join(STATE_DIR, name + ".json");
  fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)), {
    mode: 0o600,
  });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // File mode enforcement is best effort on platforms without POSIX modes.
  }
}

type RunState = {
  basket: string;
  proposal: string;
  vaultAuthority: string;
  mintA: string;
  mintB: string;
  vaultA: string;
  vaultB: string;
  takerAtaA: string;
  takerAtaB: string;
  shareMint: string;
  holderShareAta: string;
  holderReceiveA: string;
  holderReceiveB: string;
  identityMint: string;
  targetSlot: number;
  proposalNonce: string;
  signatures: Record<string, string>;
  noticeRedeemOutRaw: [string, string];
};

function loadWallet(name: string): Keypair {
  const file = path.join(STATE_DIR, name + ".json");
  if (!fs.existsSync(file)) throw new Error("Missing persisted wallet: " + name);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")) as number[]),
  );
}

function readRunState(): RunState {
  const file = path.join(STATE_DIR, "run.json");
  if (!fs.existsSync(file)) {
    throw new Error("Missing prepared run state: " + file);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as RunState;
}

async function finishAfterWarp(connection: Connection): Promise<void> {
  const run = readRunState();
  const holder = loadWallet("holder");
  const taker = loadWallet("taker");
  const basket = new PublicKey(run.basket);
  const proposal = new PublicKey(run.proposal);
  const vaultAuthority = new PublicKey(run.vaultAuthority);
  const mintA = new PublicKey(run.mintA);
  const mintB = new PublicKey(run.mintB);
  const vaultA = new PublicKey(run.vaultA);
  const vaultB = new PublicKey(run.vaultB);
  const takerAtaA = new PublicKey(run.takerAtaA);
  const takerAtaB = new PublicKey(run.takerAtaB);
  const shareMint = new PublicKey(run.shareMint);
  const holderShareAta = new PublicKey(run.holderShareAta);
  const holderReceiveA = new PublicKey(run.holderReceiveA);
  const holderReceiveB = new PublicKey(run.holderReceiveB);
  const proposalNonce = BigInt(run.proposalNonce);

  if ((await connection.getSlot("confirmed")) < run.targetSlot) {
    throw new Error(
      "Validator slot is below the saved target. Restart it with --warp-slot " +
        run.targetSlot +
        " and the same ledger before running phase=finish.",
    );
  }

  const shareMintInfo = await getMint(
    connection,
    shareMint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
  const fillArgs = {
    taker: taker.publicKey,
    basket,
    proposal,
    vaultAuthority,
    mintA,
    mintB,
    vaultA,
    vaultB,
    takerAtaA,
    takerAtaB,
    shareMint,
    nonce: proposalNonce,
    inputRaw: INPUT_RAW,
    outputRaw: OUTPUT_RAW,
  };
  await expectFailure("fill below guardian minimum output is rejected", () =>
    send(
      connection,
      taker,
      fillRebalanceIx({ ...fillArgs, outputRaw: MIN_OUTPUT_RAW - 1n }),
    ),
  );

  const vaultBeforeFill = await vaultAmounts(connection, vaultA, vaultB);
  const takerABeforeFill = await rawAmount(connection, takerAtaA);
  const takerBBeforeFill = await rawAmount(connection, takerAtaB);
  const fillSignature = await send(connection, taker, fillRebalanceIx(fillArgs));
  const vaultAfterFill = await vaultAmounts(connection, vaultA, vaultB);
  const takerAAfterFill = await rawAmount(connection, takerAtaA);
  const takerBAfterFill = await rawAmount(connection, takerAtaB);
  const supplyAfterFill = (await getMint(
    connection,
    shareMint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  )).supply;
  if (
    vaultBeforeFill[0] - vaultAfterFill[0] !== INPUT_RAW ||
    vaultAfterFill[1] - vaultBeforeFill[1] !== OUTPUT_RAW ||
    takerAAfterFill - takerABeforeFill !== INPUT_RAW ||
    takerBBeforeFill - takerBAfterFill !== OUTPUT_RAW ||
    supplyAfterFill !== shareMintInfo.supply
  ) {
    throw new Error("Atomic rebalance fill deltas or share supply did not match");
  }
  console.log("PASS one delayed fill met guardian bounds and kept share supply unchanged");

  const basketInfo = await connection.getAccountInfo(basket, "confirmed");
  if (!basketInfo) throw new Error("ManagedBasket account disappeared");
  const basketState = readBasketState(basketInfo.data);
  if (
    basketState.version !== 1n ||
    basketState.weightsBps[0] !== 3_000 ||
    basketState.weightsBps[1] !== 7_000
  ) {
    throw new Error("Successful fill did not advance target allocation version");
  }
  console.log("PASS successful fill advanced target weights to 30 / 70");

  const remainingShares = await rawAmount(connection, holderShareAta);
  if (remainingShares !== HOLDER_SHARES_RAW - PRE_NOTICE_REDEEM_RAW) {
    throw new Error("Unexpected remaining holder shares after notice redemption");
  }
  const holderABeforeFinalRedeem = await rawAmount(connection, holderReceiveA);
  const holderBBeforeFinalRedeem = await rawAmount(connection, holderReceiveB);
  const finalRedeemSignature = await send(
    connection,
    holder,
    redeemInKindIx({
      user: holder.publicKey,
      basket,
      vaultAuthority,
      mintA,
      mintB,
      vaultA,
      vaultB,
      shareMint,
      shareAta: holderShareAta,
      receiveA: holderReceiveA,
      receiveB: holderReceiveB,
      sharesRaw: remainingShares,
    }),
  );
  const supplyAfterRedeem = (await getMint(
    connection,
    shareMint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  )).supply;
  if (
    supplyAfterRedeem !== GENESIS_SHARES_RAW ||
    (await rawAmount(connection, holderShareAta)) !== 0n
  ) {
    throw new Error("Post-fill holder pro-rata redemption did not burn shares");
  }
  const holderAAfterFinalRedeem = await rawAmount(connection, holderReceiveA);
  const holderBAfterFinalRedeem = await rawAmount(connection, holderReceiveB);
  console.log("PASS holder redeemed pro-rata after the rebalance fill");

  const proposalAfter = await connection.getAccountInfo(proposal, "confirmed");
  if (!proposalAfter || proposalAfter.data[284] !== 2) {
    throw new Error("Proposal status is not Executed after a successful fill");
  }
  const result = {
    rpcUrl: RPC_URL,
    stateDir: STATE_DIR,
    programId: PROGRAM_ID.toBase58(),
    programArtifactSha256: PROGRAM_ARTIFACT_SHA256,
    noticeDurationSlots: NOTICE_SLOTS.toString(),
    basket: run.basket,
    shareMint: run.shareMint,
    identityNftMint: run.identityMint,
    mockMints: [run.mintA, run.mintB],
    finalShareSupplyRaw: supplyAfterRedeem.toString(),
    allocationVersion: basketState.version.toString(),
    targetWeightsBps: basketState.weightsBps,
    signatures: {
      ...run.signatures,
      delayedFill: fillSignature,
      finalHolderRedeem: finalRedeemSignature,
    },
    balancesRaw: {
      noticeRedeemOut: run.noticeRedeemOutRaw,
      vaultBeforeFill: vaultBeforeFill.map(String),
      vaultAfterFill: vaultAfterFill.map(String),
      takerReceivedInput: (takerAAfterFill - takerABeforeFill).toString(),
      takerPaidOutput: (takerBBeforeFill - takerBAfterFill).toString(),
      finalHolderRedeemOut: [
        (holderAAfterFinalRedeem - holderABeforeFinalRedeem).toString(),
        (holderBAfterFinalRedeem - holderBBeforeFinalRedeem).toString(),
      ],
      shareSupplyAfterFill: supplyAfterFill.toString(),
      finalShareSupply: supplyAfterRedeem.toString(),
    },
    status: "PASS",
  };
  fs.writeFileSync(
    path.join(STATE_DIR, "result.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  console.log("PASS managed-basket-v2 localnet proof complete");
  console.log(JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  const rpcHost = new URL(RPC_URL).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(rpcHost)) {
    throw new Error("This proof only permits an explicitly local validator URL");
  }
  const connection = new Connection(RPC_URL, "confirmed");
  const programInfo = await connection.getAccountInfo(PROGRAM_ID, "confirmed");
  if (!programInfo?.executable) {
    throw new Error(
      "Managed Basket V2 program is not loaded at " + PROGRAM_ID.toBase58(),
    );
  }
  if (process.env.MANAGED_V2_PHASE === "finish") {
    await finishAfterWarp(connection);
    return;
  }

  const creator = Keypair.generate();
  const guardian = Keypair.generate();
  const holder = Keypair.generate();
  const taker = Keypair.generate();
  const unauthorized = Keypair.generate();
  for (const [name, key] of [
    ["creator", creator],
    ["guardian", guardian],
    ["holder", holder],
    ["taker", taker],
    ["unauthorized", unauthorized],
  ] as const) {
    saveWallet(name, key);
    await requestLocalAirdrop(connection, key);
  }

  const mintA = await createMint(
    connection,
    creator,
    creator.publicKey,
    null,
    6,
    undefined,
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  const mintB = await createMint(
    connection,
    creator,
    creator.publicKey,
    null,
    6,
    undefined,
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  for (const [label, mint] of [
    ["mock token A", mintA],
    ["mock token B", mintB],
  ] as const) {
    const info = await connection.getAccountInfo(mint, "confirmed");
    if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID) || info.data.length !== 82) {
      throw new Error(label + " is not an extension-free Token-2022 mint");
    }
  }
  console.log("PASS created two extension-free Token-2022 mock mints");

  const creatorA = await getOrCreateAssociatedTokenAccount(
    connection,
    creator,
    mintA,
    creator.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  const creatorB = await getOrCreateAssociatedTokenAccount(
    connection,
    creator,
    mintB,
    creator.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  const holderA = await getOrCreateAssociatedTokenAccount(
    connection,
    creator,
    mintA,
    holder.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  const holderB = await getOrCreateAssociatedTokenAccount(
    connection,
    creator,
    mintB,
    holder.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  const takerA = await getOrCreateAssociatedTokenAccount(
    connection,
    creator,
    mintA,
    taker.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  const takerB = await getOrCreateAssociatedTokenAccount(
    connection,
    creator,
    mintB,
    taker.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  const seedA = 50_000_000n;
  const seedB = 50_000_000n;
  await mintTo(
    connection,
    creator,
    mintA,
    creatorA.address,
    creator,
    seedA + 5_000_000n,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  await mintTo(
    connection,
    creator,
    mintB,
    creatorB.address,
    creator,
    seedB + 5_000_000n,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  await mintTo(
    connection,
    creator,
    mintA,
    holderA.address,
    creator,
    5_000_000n,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  await mintTo(
    connection,
    creator,
    mintB,
    holderB.address,
    creator,
    5_000_000n,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  await mintTo(
    connection,
    creator,
    mintB,
    takerB.address,
    creator,
    5_000_000n,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );

  const basketNonce = BigInt(Date.now());
  const basket = managedBasketPda(creator.publicKey, basketNonce);
  const vaultAuthority = vaultAuthorityPda(basket);
  const shareMint = shareMintPda(basket);
  const identityMint = identityMintPda(basket);
  const vaultA = ata(vaultAuthority, mintA);
  const vaultB = ata(vaultAuthority, mintB);
  const creatorShareAta = ata(creator.publicKey, shareMint);
  const creatorIdentityAta = ata(creator.publicKey, identityMint);
  const initialCreateIx = createManagedBasketIx({
    creator: creator.publicKey,
    guardian: guardian.publicKey,
    basket,
    vaultAuthority,
    mintA,
    mintB,
    shareMint,
    identityMint,
    sourceA: creatorA.address,
    sourceB: creatorB.address,
    vaultA,
    vaultB,
    creatorShareAta,
    creatorIdentityAta,
    basketNonce,
    weightsBps: [5_000, 5_000],
    seedAmountsRaw: [seedA, seedB],
    approvalTtlSlots: 10_000n,
    noticeDurationSlots: NOTICE_SLOTS,
    executionWindowSlots: 10_000n,
  });
  const createSignature = await send(connection, creator, initialCreateIx);

  const shareMintInfo = await getMint(
    connection,
    shareMint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
  const identityMintInfo = await getMint(
    connection,
    identityMint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
  if (shareMintInfo.supply !== GENESIS_SHARES_RAW || shareMintInfo.decimals !== 6) {
    throw new Error("Create did not mint the expected 1.0 genesis share");
  }
  if (
    identityMintInfo.supply !== 1n ||
    identityMintInfo.decimals !== 0 ||
    identityMintInfo.mintAuthority !== null ||
    (await rawAmount(connection, creatorIdentityAta)) !== 1n
  ) {
    throw new Error("Identity NFT is not a supply-one, non-mintable token");
  }
  console.log("PASS create minted one identity NFT and 1.0 fungible genesis share");

  const holderShareAta = ata(holder.publicKey, shareMint);
  const mintHolderIx = mintInKindIx({
    user: holder.publicKey,
    basket,
    vaultAuthority,
    mintA,
    mintB,
    vaultA,
    vaultB,
    sourceA: holderA.address,
    sourceB: holderB.address,
    shareMint,
    shareAta: holderShareAta,
    depositsRaw: [5_000_000n, 5_000_000n],
  });
  const holderMintSignature = await send(connection, holder, mintHolderIx);
  if ((await rawAmount(connection, holderShareAta)) !== HOLDER_SHARES_RAW) {
    throw new Error("Second holder did not receive the expected pro-rata shares");
  }
  console.log("PASS second holder minted shares with matching in-kind deposits");

  const proposalNonce = 0n;
  const proposal = proposalPda(basket, proposalNonce);
  const unauthorizedProposal = proposeRebalanceIx({
    manager: unauthorized.publicKey,
    basket,
    proposal,
    nonce: proposalNonce,
    expectedVersion: 0n,
    weightsBps: [3_000, 7_000],
    inputMint: mintA,
    maxInputRaw: INPUT_RAW,
  });
  await expectFailure("non-manager cannot propose a rebalance", () =>
    send(connection, unauthorized, unauthorizedProposal),
  );

  const proposalIx = proposeRebalanceIx({
    manager: creator.publicKey,
    basket,
    proposal,
    nonce: proposalNonce,
    expectedVersion: 0n,
    weightsBps: [3_000, 7_000],
    inputMint: mintA,
    maxInputRaw: INPUT_RAW,
  });
  const proposalSignature = await send(connection, creator, proposalIx);

  await expectFailure("non-guardian cannot approve a price bound", () =>
    send(
      connection,
      unauthorized,
      approvePriceBoundIx({
        guardian: unauthorized.publicKey,
        basket,
        proposal,
        nonce: proposalNonce,
        minOutputRaw: MIN_OUTPUT_RAW,
      }),
    ),
  );
  const guardianApprovalSignature = await send(
    connection,
    guardian,
    approvePriceBoundIx({
      guardian: guardian.publicKey,
      basket,
      proposal,
      nonce: proposalNonce,
      minOutputRaw: MIN_OUTPUT_RAW,
    }),
  );
  console.log("PASS manager proposal requires a guardian price-bound approval");

  const fillArgs = {
    taker: taker.publicKey,
    basket,
    proposal,
    vaultAuthority,
    mintA,
    mintB,
    vaultA,
    vaultB,
    takerAtaA: takerA.address,
    takerAtaB: takerB.address,
    shareMint,
    nonce: proposalNonce,
    inputRaw: INPUT_RAW,
    outputRaw: OUTPUT_RAW,
  };
  await expectFailure("fill cannot execute before the holder notice period", () =>
    send(connection, taker, fillRebalanceIx(fillArgs)),
  );

  const beforeNoticeRedeem = redeemInKindIx({
    user: holder.publicKey,
    basket,
    vaultAuthority,
    mintA,
    mintB,
    vaultA,
    vaultB,
    shareMint,
    shareAta: holderShareAta,
    receiveA: holderA.address,
    receiveB: holderB.address,
    sharesRaw: PRE_NOTICE_REDEEM_RAW,
  });
  const holderABeforeNoticeRedeem = await rawAmount(connection, holderA.address);
  const holderBBeforeNoticeRedeem = await rawAmount(connection, holderB.address);
  const noticeRedeemSignature = await send(connection, holder, beforeNoticeRedeem);
  const noticeRedeemOutRaw: [string, string] = [
    ((await rawAmount(connection, holderA.address)) - holderABeforeNoticeRedeem).toString(),
    ((await rawAmount(connection, holderB.address)) - holderBBeforeNoticeRedeem).toString(),
  ];
  const supplyBeforeFill = (await getMint(
    connection,
    shareMint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  )).supply;
  if (supplyBeforeFill !== GENESIS_SHARES_RAW + 50_000n) {
    throw new Error("Holder redemption during notice period changed supply incorrectly");
  }
  console.log("PASS holder can redeem while a manager change is pending");

  await expectFailure("fill remains blocked during the notice period", () =>
    send(connection, taker, fillRebalanceIx(fillArgs)),
  );
  const proposalInfo = await connection.getAccountInfo(proposal, "confirmed");
  if (!proposalInfo) throw new Error("Approved proposal account disappeared");
  // RebalanceProposal fields: 8-byte discriminator, then 252 bytes through the
  // two hashes; status is the next byte after those fixed fields.
  const notBeforeSlot = proposalInfo.data.readBigUInt64LE(204);
  const currentSlot = BigInt(await connection.getSlot("confirmed"));
  if (notBeforeSlot <= currentSlot) {
    throw new Error("Guardian approval did not set a future notice deadline");
  }
  const targetSlot = Number(notBeforeSlot + 1n);
  const runState: RunState = {
    basket: basket.toBase58(),
    proposal: proposal.toBase58(),
    vaultAuthority: vaultAuthority.toBase58(),
    mintA: mintA.toBase58(),
    mintB: mintB.toBase58(),
    vaultA: vaultA.toBase58(),
    vaultB: vaultB.toBase58(),
    takerAtaA: takerA.address.toBase58(),
    takerAtaB: takerB.address.toBase58(),
    shareMint: shareMint.toBase58(),
    holderShareAta: holderShareAta.toBase58(),
    holderReceiveA: holderA.address.toBase58(),
    holderReceiveB: holderB.address.toBase58(),
    identityMint: identityMint.toBase58(),
    targetSlot,
    proposalNonce: proposalNonce.toString(),
    signatures: {
      create: createSignature,
      secondHolderMint: holderMintSignature,
      managerProposal: proposalSignature,
      guardianApproval: guardianApprovalSignature,
      noticePeriodHolderRedeem: noticeRedeemSignature,
    },
    noticeRedeemOutRaw,
  };
  fs.writeFileSync(
    path.join(STATE_DIR, "run.json"),
    JSON.stringify(runState, null, 2),
    { mode: 0o600 },
  );
  console.log(
    "PASS prepare phase complete; holder redeemed during notice. Continue on " +
      "the same validator after it reaches slot " +
      targetSlot +
      ", then run MANAGED_V2_PHASE=finish.",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("FAIL managed-basket-v2 localnet proof: " + message);
  process.exitCode = 1;
});
