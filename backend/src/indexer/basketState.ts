/**
 * Pure current-V0 account decoders for recovering an indexer's missing parent
 * basket row. The caller performs RPC/DB work; these helpers never infer a
 * creation event, sign, or accept frontend mock-pack restrictions.
 *
 * Layout: programs/basket/src/lib.rs::Basket and
 * programs/basket_factory/src/lib.rs::FactoryConfig. u64 values remain exact
 * decimal strings for PostgreSQL parameters; its signed BIGINT nonce limit is
 * explicit rather than silently narrowing an otherwise valid chain account.
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { CREATOR_FEE_SPLIT_BPS, MANAGEMENT_FEE_DENOMINATOR } from "../workers/feeMath.js";

export interface BasketStateAccount {
  owner: PublicKey;
  data: Buffer;
  executable?: boolean;
}

export interface BasketStatePrograms {
  basket: PublicKey;
  factory: PublicKey;
}

/** Structurally compatible with listener.ts::BasketUpsert. */
export interface DecodedBasketState {
  pubkey: string;
  factory: string;
  creator: string;
  treasury: string;
  shareMint: string;
  nonce: string;
  createdAt: Date;
  metadataHash: string;
  numConstituents: number;
  constituents: string[];
  weightsBps: number[];
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  lastFeeAccrualTs: Date;
  managementFeeRemainder: string;
  vaultAuthority: string;
}

export type BasketStateDecodeReason =
  | "invalid-address"
  | "invalid-owner"
  | "executable-account"
  | "truncated-account"
  | "invalid-discriminator"
  | "invalid-factory-pda"
  | "invalid-factory-bump"
  | "invalid-factory-policy"
  | "factory-treasury-mismatch"
  | "invalid-basket-pda"
  | "invalid-basket-bump"
  | "invalid-share-mint-pda"
  | "invalid-vault-bump"
  | "invalid-constituent-count"
  | "invalid-constituents"
  | "invalid-weights"
  | "invalid-fees"
  | "invalid-metadata"
  | "invalid-timestamps"
  | "invalid-management-fee-remainder"
  | "unsupported-nonce-postgres-bigint";

export class BasketStateDecodeError extends Error {
  constructor(readonly reason: BasketStateDecodeReason, message: string) {
    super(message);
    this.name = "BasketStateDecodeError";
  }
}

const BASKET_DISCRIMINATOR = discriminator("Basket");
const FACTORY_DISCRIMINATOR = discriminator("FactoryConfig");
const PG_BIGINT_MAX = (1n << 63n) - 1n;
// JavaScript Date's largest representable nonnegative Unix second. Its
// millisecond conversion is also below Number.MAX_SAFE_INTEGER.
const MAX_DATE_SECONDS = 8_640_000_000_000n;

function discriminator(account: string): Buffer {
  return createHash("sha256").update(`account:${account}`).digest().subarray(0, 8);
}

function reject(reason: BasketStateDecodeReason, message: string): never {
  throw new BasketStateDecodeError(reason, message);
}

function addressKey(address: string): PublicKey {
  try {
    return new PublicKey(address);
  } catch {
    return reject("invalid-address", "Account address is not a Solana public key");
  }
}

function checkedData(account: BasketStateAccount, owner: PublicKey, disc: Buffer, minBytes: number): Buffer {
  if (!account.owner.equals(owner)) reject("invalid-owner", "Account is not owned by its configured V0 program");
  if (account.executable) reject("executable-account", "A V0 state account cannot be executable");
  if (account.data.length < minBytes) reject("truncated-account", "V0 state account is shorter than its Borsh layout");
  if (!account.data.subarray(0, 8).equals(disc)) reject("invalid-discriminator", "Account discriminator does not match its V0 state type");
  return account.data;
}

function keyAt(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function nonceBytes(nonce: bigint): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(nonce);
  return bytes;
}

function dateOf(seconds: bigint): Date {
  if (seconds < 0n || seconds > MAX_DATE_SECONDS) reject("invalid-timestamps", "V0 state timestamp is outside the supported Date range");
  return new Date(Number(seconds * 1_000n));
}

/** Decode and validate the canonical immutable Basket account (2–20 assets). */
export function decodeBasketState(
  address: string,
  account: BasketStateAccount,
  programs: BasketStatePrograms,
): DecodedBasketState {
  const pubkey = addressKey(address);
  // The five-byte carried fee remainder ends at byte 886. The deployed V0
  // allocation is 888 bytes; its two trailing padding bytes are not fields.
  const data = checkedData(account, programs.basket, BASKET_DISCRIMINATOR, 886);
  const factory = keyAt(data, 8);
  const creator = keyAt(data, 40);
  const treasury = keyAt(data, 72);
  const shareMint = keyAt(data, 104);
  const nonce = data.readBigUInt64LE(136);
  if (nonce > PG_BIGINT_MAX) reject("unsupported-nonce-postgres-bigint", "Basket nonce exceeds PostgreSQL's signed BIGINT domain");

  const [expectedFactory] = PublicKey.findProgramAddressSync([Buffer.from("factory")], programs.factory);
  if (!factory.equals(expectedFactory)) reject("invalid-factory-pda", "Basket references a noncanonical factory PDA");
  const [expectedBasket, basketBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("basket"), factory.toBuffer(), creator.toBuffer(), nonceBytes(nonce)],
    programs.factory,
  );
  if (!pubkey.equals(expectedBasket)) reject("invalid-basket-pda", "Basket address does not match its immutable PDA seeds");
  if (data[879] !== basketBump) reject("invalid-basket-bump", "Basket stores a noncanonical basket bump");
  const [expectedShareMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), pubkey.toBuffer()], programs.factory,
  );
  if (!shareMint.equals(expectedShareMint)) reject("invalid-share-mint-pda", "Basket share mint does not match its canonical PDA");
  const [vaultAuthority, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("basket"), pubkey.toBuffer()], programs.basket,
  );
  if (data[880] !== vaultBump) reject("invalid-vault-bump", "Basket stores a noncanonical vault authority bump");

  const numConstituents = data[192];
  if (numConstituents < 2 || numConstituents > 20) reject("invalid-constituent-count", "Basket must contain between two and twenty assets");
  const mints = Array.from({ length: numConstituents }, (_, i) => keyAt(data, 193 + i * 32));
  const constituents = mints.map((mint) => mint.toBase58());
  if (mints.some((mint) => mint.equals(PublicKey.default)) || new Set(constituents).size !== numConstituents) {
    reject("invalid-constituents", "Basket constituents must be distinct nonzero mint addresses");
  }
  const weightsBps = Array.from({ length: numConstituents }, (_, i) => data.readUInt16LE(833 + i * 2));
  if (weightsBps.some((weight) => weight === 0) || weightsBps.reduce((sum, weight) => sum + weight, 0) !== 10_000) {
    reject("invalid-weights", "Basket weights must be positive and sum to 10000 basis points");
  }
  const entryFeeBps = data.readUInt16LE(873);
  const exitFeeBps = data.readUInt16LE(875);
  const managementFeeBps = data.readUInt16LE(877);
  if (entryFeeBps > 300 || exitFeeBps > 100 || managementFeeBps > 300) reject("invalid-fees", "Basket fees exceed the immutable V0 caps");
  const metadata = data.subarray(160, 192);
  if (metadata.every((byte) => byte === 0)) reject("invalid-metadata", "Basket metadata hash cannot be all zero");
  const created = data.readBigInt64LE(144);
  const lastAccrual = data.readBigInt64LE(152);
  if (lastAccrual < created) reject("invalid-timestamps", "Basket fee checkpoint predates creation");
  const createdAt = dateOf(created);
  const lastFeeAccrualTs = dateOf(lastAccrual);
  // Five bytes fit exactly in Number's integer domain; only then convert to
  // bigint for comparison with the canonical helper's denominator.
  const remainder = BigInt(data.readUIntLE(881, 5));
  if (remainder >= MANAGEMENT_FEE_DENOMINATOR) reject("invalid-management-fee-remainder", "Basket carried fee remainder is outside the canonical domain");

  return {
    pubkey: pubkey.toBase58(), factory: factory.toBase58(), creator: creator.toBase58(),
    treasury: treasury.toBase58(), shareMint: shareMint.toBase58(), nonce: nonce.toString(),
    createdAt, metadataHash: metadata.toString("hex"), numConstituents, constituents, weightsBps,
    entryFeeBps, exitFeeBps, managementFeeBps, lastFeeAccrualTs,
    managementFeeRemainder: remainder.toString(), vaultAuthority: vaultAuthority.toBase58(),
  };
}

/** Read treasury only from the configured program's canonical FactoryConfig. */
export function decodeFactoryTreasuryState(
  address: string,
  account: BasketStateAccount,
  factoryProgramId: PublicKey,
): string {
  const pubkey = addressKey(address);
  const data = checkedData(account, factoryProgramId, FACTORY_DISCRIMINATOR, 89);
  const [expectedFactory, bump] = PublicKey.findProgramAddressSync([Buffer.from("factory")], factoryProgramId);
  if (!pubkey.equals(expectedFactory)) reject("invalid-factory-pda", "Factory address is not its configured program's canonical PDA");
  if (data[88] !== bump) reject("invalid-factory-bump", "Factory stores a noncanonical bump");
  if (data.readUInt16LE(72) !== CREATOR_FEE_SPLIT_BPS || data.readUInt16LE(74) !== 300 || data.readUInt16LE(76) !== 100 || data.readUInt16LE(78) !== 300) {
    reject("invalid-factory-policy", "Factory fee split or caps differ from the immutable V0 policy");
  }
  return keyAt(data, 40).toBase58();
}
