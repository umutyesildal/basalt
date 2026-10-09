/**
 * indexer/holdingsSync.ts — real vault holdings sync (spec §4.3, §7).
 *
 * Reads vault ATAs in batches via `getMultipleAccountsInfo`, reads each
 * constituent's Token-2022 mint ScaledUiAmountConfig multiplier via
 * unpackMint/getScaledUiAmountConfig (1.0 only for a verified plain mint),
 * and produces rows carrying raw + multiplier + scaled + decimals.
 *
 * INTEGER-SAFETY CONVENTION (AGENTS.md §2 #7 — crosses module boundaries):
 *   * `raw` is the on-chain u64 amount carried as a bigint; `rawAmount` is the
 *     same value as a DECIMAL STRING for binding into BIGINT columns
 *     (vault_holdings.raw_amount, supply columns). Never pass `Number(raw)`.
 *   * `multiplier` is the f64 ScaledUiAmountConfig multiplier (token-2022
 *     stores it as f64; @solana/spl-token 0.4.15 parses it as f64 — the spec's
 *     "u64 fixed-point with multiplier_decimals" sketch predates that layout).
 *   * `scaled` = raw × multiplier ÷ 10^decimals in HUMAN units (display/NAV
 *     only). `scaledAmount` is the exact decimal string stored in the NUMERIC
 *     column; `scaled` is its Number rounding for the NAV engine. Programs
 *     consume raw only — scaled never flows back on-chain.
 *
 * Degradation: every RPC touch goes through a structural `SolanaRpc` param and
 * every DB write through a `PgLike | null` param; null db simply skips
 * persistence and still returns rows.
 */
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  ExtensionType,
  ScaledUiAmountConfigLayout,
  getScaledUiAmountConfig,
  TOKEN_2022_PROGRAM_ID,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import { isPgLike } from "../db/client.js";
import { recordValuationAttempt } from "../api/valuation-quality.js";
import { withRpcBackoff, createPacer } from "../rpc/backoff.js";

/** Minimal structural slice of @solana/web3.js Connection used here. */
export interface SolanaRpc {
  getMultipleAccountsInfo(
    keys: PublicKey[],
    commitment?: unknown,
  ): Promise<Array<AccountInfo<Buffer> | null>>;
  getAccountInfo(address: PublicKey): Promise<AccountInfo<Buffer> | null>;
}

export interface HoldingsRow {
  basket: string;
  mint: string;
  /** On-chain u64 amount — bigint, the source of truth for all math. */
  raw: bigint;
  /** Same u64 as a decimal string for BIGINT-safe SQL binding. */
  rawAmount: string;
  /** Token-2022 ScaledUiAmountConfig multiplier; 1.0 for verified plain mints. */
  multiplier: number;
  /** Display/NAV units: raw × multiplier ÷ 10^decimals (Number rounding). */
  scaled: number;
  /** Exact decimal string of `scaled` for the NUMERIC column. */
  scaledAmount: string;
  decimals: number;
  /** True only after checking the mint, canonical vault ATA and authority. */
  authenticated: true;
  /** Conservative observation time: taken before this RPC read pass starts. */
  observedAt: string;
}

const MULTISIG_SIZE = 355; // spl-token: extended mints must not collide with multisig size

export interface MintFacts {
  multiplier: number;
  decimals: number;
}

/**
 * Read `decimals` straight from a mint account buffer (base Mint layout puts
 * the u8 at offset 44 — valid for both legacy and Token-2022 mints). Returns
 * null when the buffer is too short or the value is implausible.
 */
export function parseMintDecimalsFromMintData(data: Buffer): number | null {
  if (data.length < 45) return null;
  const decimals = data.readUInt8(44);
  if (decimals > 60) return null;
  return decimals;
}

/**
 * Authenticate Token-2022 mint facts. Missing/invalid/failed reads return null;
 * only a valid initialized mint without a scaled extension has multiplier 1.
 * Active multipliers outside the existing fixed-point representation fail closed.
 */
export async function fetchMintFacts(rpc: SolanaRpc, mint: PublicKey, now: () => Date = () => new Date()): Promise<MintFacts | null> {
  try {
    const info = await withRpcBackoff(() => rpc.getAccountInfo(mint), {
      logKey: "holdings:getAccountInfo",
    });
    if (!info || info.executable || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
    const parsed = unpackMint(mint, info, TOKEN_2022_PROGRAM_ID);
    if (!parsed.isInitialized || info.data[45] !== 1 || parsed.decimals > 12 ||
        info.data.readUInt32LE(0) > 1 || info.data.readUInt32LE(46) > 1) return null;
    const extensions = validatedTlvTypes(parsed.tlvData);
    if (!extensions) return null;
    const multiplier = extensions.has(ExtensionType.ScaledUiAmountConfig)
      ? parseScaledUiMultiplierFromMintData(info.data, now)
      : 1;
    if (multiplier === null || !Number.isFinite(Math.round(multiplier * 1e9)) || Math.round(multiplier * 1e9) < 1) return null;
    return { multiplier, decimals: parsed.decimals };
  } catch (err) {
    console.warn(`[holdings] mint ${mint.toBase58()} could not be verified:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Parse the ScaledUiAmountConfig multiplier out of raw Token-2022 mint account
 * data. The scheduled multiplier becomes effective at its Unix timestamp,
 * including the exact activation second. The clock is injectable for fixtures.
 * Returns null for legacy accounts, missing extensions, or invalid active data.
 */
export function parseScaledUiMultiplierFromMintData(
  data: Buffer,
  now: () => Date = () => new Date(),
): number | null {
  try {
    if (data.length <= 82) return null; // base mint only, no TLV stream
    // Extended token-2022 mints are larger than a token account (165) and not
    // multisig-sized (355); AccountType byte sits at offset 165, TLV at 166.
    if (data.length <= 165 || data.length === MULTISIG_SIZE) return null;
    if (data[165] !== 1) return null; // AccountType.Mint
    const mint = unpackMint(PublicKey.default, {
      executable: false,
      owner: TOKEN_2022_PROGRAM_ID,
      lamports: 0,
      data,
    }, TOKEN_2022_PROGRAM_ID);
    const cfg = getScaledUiAmountConfig(mint);
    if (!cfg) return null;
    const nowSeconds = Math.floor(now().getTime() / 1_000);
    if (!Number.isFinite(nowSeconds)) return null;
    const multiplier = BigInt(nowSeconds) >= cfg.newMultiplierEffectiveTimestamp
      ? cfg.newMultiplier
      : cfg.multiplier;
    if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
    return multiplier;
  } catch {
    return null;
  }
}

/**
 * Read the ScaledUiAmountConfig multiplier for `mint` from RPC.
 * A verified plain mint returns 1.0. Invalid/missing facts return null.
 */
export async function fetchMultiplier(rpc: SolanaRpc, mint: PublicKey): Promise<number | null> {
  return (await fetchMintFacts(rpc, mint))?.multiplier ?? null;
}

/** Distinguish an absent extension from truncated/duplicate/invalid TLV data. */
function validatedTlvTypes(data: Buffer): Set<number> | null {
  const types = new Set<number>();
  let offset = 0;
  while (offset < data.length) {
    if (data.subarray(offset).every((byte) => byte === 0)) break;
    if (offset + 4 > data.length) return null;
    const type = data.readUInt16LE(offset);
    const length = data.readUInt16LE(offset + 2);
    if (type === 0 || types.has(type) || offset + 4 + length > data.length) return null;
    if (type === ExtensionType.ScaledUiAmountConfig && length !== ScaledUiAmountConfigLayout.span) return null;
    types.add(type);
    offset += 4 + length;
  }
  return types;
}

/**
 * Exact scaled value as a decimal string: raw × multiplier ÷ 10^decimals,
 * computed with BigInt fixed-point (9 digits for the f64 multiplier) so no
 * u64-scale precision is ever lost to Number.
 */
export function exactScaledDecimalString(raw: bigint, multiplier: number, decimals: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || raw === 0n) return "0";
  const MULT_SCALE = 9; // f64 multiplier captured to 9 decimal places
  const multFixed = BigInt(Math.round(multiplier * 10 ** MULT_SCALE));
  const num = raw * multFixed;
  const den = 10n ** BigInt(MULT_SCALE + decimals);
  const whole = num / den;
  const rem = num % den;
  if (rem === 0n) return whole.toString();
  const frac = rem.toString().padStart(MULT_SCALE + decimals, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Multipliers for many mints (sequential — one getAccountInfo each). */
export async function fetchMultipliers(rpc: SolanaRpc, mints: PublicKey[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const mint of mints) {
    const multiplier = await fetchMultiplier(rpc, mint);
    if (multiplier !== null) map.set(mint.toBase58(), multiplier);
  }
  return map;
}

/**
 * Sync vault holdings: batch-read the ATAs, read multipliers, compute
 * raw/multiplier/scaled/decimals rows. Optionally persist into
 * vault_holdings (and ensure the whitelisted_mints FK rows exist) when
 * `opts.db` is a pg client.
 */
export async function syncHoldings(
  rpc: SolanaRpc,
  basket: PublicKey,
  vaultAtas: PublicKey[],
  mints: PublicKey[],
  opts: { db?: unknown; spacingMs?: number; now?: () => Date } = {},
): Promise<HoldingsRow[]> {
  const db = isPgLike(opts?.db) ? opts.db : null;
  if (mints.length !== vaultAtas.length || new Set(mints.map((mint) => mint.toBase58())).size !== mints.length) {
    throw new Error("Vault and constituent identities must be unique and aligned");
  }
  const now = opts.now ?? (() => new Date());
  const observedAt = now().toISOString();
  const authority = deriveVaultAuthority(basket);
  // Optional pacing: minimum spacing between sequential RPC reads so a
  // holdings pass cannot burst 10+ reads at a public RPC (default 0 = the
  // unspaced legacy behavior; the devnet listener wires a small gap).
  const pacer = createPacer(opts.spacingMs ?? 0);
  const facts = new Map<string, MintFacts>();
  for (const mint of mints) {
    await pacer.wait();
    const verified = await fetchMintFacts(rpc, mint, now);
    if (verified) facts.set(mint.toBase58(), verified);
  }

  const infos: Array<AccountInfo<Buffer> | null> = [];
  for (const batch of chunk(vaultAtas, 100)) {
    await pacer.wait();
    try {
      const result = await withRpcBackoff(() => rpc.getMultipleAccountsInfo(batch), {
        logKey: "holdings:getMultipleAccountsInfo",
      });
      infos.push(...batch.map((_key, index) => result[index] ?? null));
    } catch (error) {
      console.warn("[holdings] vault RPC batch unavailable:", error instanceof Error ? error.message : error);
      infos.push(...batch.map(() => null));
    }
  }

  const rows: HoldingsRow[] = [];
  for (let i = 0; i < vaultAtas.length; i++) {
    const mint = mints[i];
    const mintKey = mint.toBase58();
    const info = infos[i] ?? null;
    const mintFacts = facts.get(mintKey);
    if (!mintFacts || !info || info.executable || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) continue;
    if (!vaultAtas[i].equals(getAssociatedTokenAddressSync(mint, authority, true, TOKEN_2022_PROGRAM_ID))) continue;
    let raw: bigint;
    try {
      const account = unpackAccount(vaultAtas[i], info, TOKEN_2022_PROGRAM_ID);
      if (!account.mint.equals(mint) || !account.owner.equals(authority) ||
          !account.isInitialized || ![1, 2].includes(info.data[108]) || !validatedTlvTypes(account.tlvData)) continue;
      raw = account.amount;
    } catch (err) {
      console.warn(`[holdings] failed to verify vault ${vaultAtas[i].toBase58()}:`, err instanceof Error ? err.message : err);
      continue;
    }
    const decimals = mintFacts.decimals;
    const multiplier = mintFacts.multiplier;
    const scaledAmount = exactScaledDecimalString(raw, multiplier, decimals);
    rows.push({
      basket: basket.toBase58(),
      mint: mintKey,
      raw,
      rawAmount: raw.toString(),
      multiplier,
      scaled: Number(scaledAmount), // display rounding — NAV engine input
      scaledAmount,
      decimals,
      authenticated: true,
      observedAt,
    });
  }

  if (db) {
    const verified = new Set(rows.map((row) => row.mint));
    const invalid = mints.map((mint) => mint.toBase58()).filter((mint) => !verified.has(mint));
    if (invalid.length > 0) {
      // Preserve last-good values AND their actual observation time. A known
      // failed refresh immediately disqualifies them until authentication recovers.
      await db.query("UPDATE vault_holdings SET authenticated = false WHERE basket = $1 AND mint = ANY($2::text[])",
        [basket.toBase58(), invalid]);
      await recordValuationAttempt(db, basket.toBase58(), { complete: false, reason: "holdings-unavailable", attemptedAt: now().toISOString() });
    }
    try {
      await upsertVaultHoldings(db, rows);
    } catch (error) {
      // A known write failure must not leave an older successful observation
      // eligible merely because its timestamp still falls inside the TTL.
      try {
        await db.query("UPDATE vault_holdings SET authenticated = false WHERE basket = $1 AND mint = ANY($2::text[])",
          [basket.toBase58(), mints.map((mint) => mint.toBase58())]);
        await recordValuationAttempt(db, basket.toBase58(), {
          complete: false, reason: "holdings-persist-failed", attemptedAt: now().toISOString(),
        });
      } catch (markError) {
        console.warn("[holdings] could not record failed persistence:", markError instanceof Error ? markError.message : markError);
      }
      throw error;
    }
  }
  return rows;
}

/**
 * Persist holdings rows. raw_amount is bound from the decimal string; the
 * whitelisted_mints FK row is ensured first. Status is only set on INSERT
 * (defaults to 'Active'); existing rows keep their status untouched.
 */
export async function upsertVaultHoldings(db: unknown, rows: HoldingsRow[]): Promise<boolean> {
  if (!isPgLike(db)) {
    console.warn("[holdings] upsertVaultHoldings skipped (no DB)");
    return false;
  }
  for (const row of rows) {
    if (row.authenticated !== true || !Number.isFinite(Date.parse(row.observedAt))) {
      throw new Error("Only authenticated observed holdings may be persisted");
    }
    await db.query(
      `INSERT INTO whitelisted_mints (mint, decimals, status, multiplier, updated_at)
       VALUES ($1, $2, 'Active', $3, $4)
       ON CONFLICT (mint) DO UPDATE
         SET decimals = EXCLUDED.decimals,
             multiplier = EXCLUDED.multiplier,
             updated_at = $4`,
      [row.mint, row.decimals, row.multiplier, new Date(row.observedAt)],
    );
    await db.query(
      `INSERT INTO vault_holdings (basket, mint, raw_amount, multiplier, scaled_amount, decimals, updated_at, authenticated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (basket, mint) DO UPDATE
         SET raw_amount = EXCLUDED.raw_amount,
             multiplier = EXCLUDED.multiplier,
             scaled_amount = EXCLUDED.scaled_amount,
             decimals = EXCLUDED.decimals,
             updated_at = EXCLUDED.updated_at,
             authenticated = true`,
      [
        row.basket,
        row.mint,
        row.rawAmount, // decimal string → BIGINT (integer-safe)
        row.multiplier,
        row.scaledAmount, // exact decimal string → NUMERIC
        row.decimals,
        new Date(row.observedAt),
      ],
    );
  }
  return true;
}

// --- PDA / ATA derivation helpers -------------------------------------------

/** u64 little-endian bytes (for PDA seeds) from a decimal string or bigint. */
export function u64LeBytes(value: string | bigint): Buffer {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n || v >= 2n ** 64n) throw new Error(`u64 out of range: ${value}`);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(v);
  return buf;
}

/**
 * Basket PDA: seeds = ["basket", factory, creator, nonce_le] derived under
 * the BASKET_FACTORY program id — the factory PDA-signs its own creation and
 * the account is created with owner = basket program
 * (programs/basket_factory/src/lib.rs create_basket: `basket_signer_seeds`
 * + `create_account(..., &basket::ID)`). NOTE: the basket account's OWNER is
 * the basket program, but its PDA derives under the factory program.
 */
export function deriveBasketPda(factory: PublicKey, creator: PublicKey, nonce: string | bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("basket"), factory.toBuffer(), creator.toBuffer(), u64LeBytes(nonce)],
    new PublicKey("3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF"), // basket_factory program
  )[0];
}

/**
 * Vault authority PDA (the basket program's vault/share-mint authority):
 * seeds = ["basket", basket_key] under the BASKET program id
 * (programs/basket_factory/src/lib.rs vault_authority_pda).
 */
export function deriveVaultAuthority(basketPda: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("basket"), basketPda.toBuffer()],
    new PublicKey("6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k"), // basket program
  )[0];
}

/** Vault ATAs: the vault authority owns one ATA per constituent (Token-2022). */
export function getVaultAtas(basketPda: PublicKey, mints: PublicKey[]): PublicKey[] {
  const vaultAuthority = deriveVaultAuthority(basketPda);
  return mints.map((mint) =>
    getAssociatedTokenAddressSync(mint, vaultAuthority, true, TOKEN_2022_PROGRAM_ID),
  );
}

/**
 * Refresh vault_holdings for EVERY indexed basket: derive each basket PDA from
 * its indexed (factory, creator, nonce), derive the constituent vault ATAs,
 * re-read balances + mint facts from RPC and persist via syncHoldings (which
 * also ensures the whitelisted_mints FK rows for constituents). This is the
 * missing write path that turns indexed baskets into NAV-engine-ready
 * holdings rows. Returns the number of baskets refreshed.
 */
export async function syncIndexedBaskets(
  rpc: SolanaRpc,
  db: unknown,
  opts: { spacingMs?: number } = {},
): Promise<number> {
  if (!isPgLike(db)) {
    console.warn("[holdings] syncIndexedBaskets skipped (no DB)");
    return 0;
  }
  const res = await db.query(
    `SELECT pubkey, factory, creator, nonce::text AS nonce, constituents FROM baskets`,
  );
  const baskets = res.rows as Array<{
    pubkey: string;
    factory: string;
    creator: string;
    nonce: string;
    constituents: string[];
  }>;
  let refreshed = 0;
  for (const b of baskets) {
    try {
      const basketPda = deriveBasketPda(new PublicKey(b.factory), new PublicKey(b.creator), b.nonce);
      if (basketPda.toBase58() !== b.pubkey) throw new Error("Indexed basket address does not match its PDA seeds");
      const mints = b.constituents.map((m) => new PublicKey(m));
      const atas = getVaultAtas(basketPda, mints);
      const rows = await syncHoldings(rpc, basketPda, atas, mints, { db, spacingMs: opts.spacingMs });
      if (rows.length === mints.length) refreshed++;
    } catch (err) {
      console.warn(`[holdings] refresh failed for basket ${b.pubkey}:`,
        err instanceof Error ? err.message : err);
    }
  }
  return refreshed;
}
