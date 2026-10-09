import { Buffer } from "buffer";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getScaledUiAmountConfig,
  unpackAccount,
  unpackMint,
} from "./token-2022";

import type { BasketDetail } from "../components/basket/basket-api";
import { APP_NAMESPACE_ROUTING, namespacePrograms, type NamespaceRouting, type ProgramNamespace } from "./program-namespaces";
import { authenticateBasketAccount, authenticateBasketShareMint } from "./basket-account-security";
import { MANAGEMENT_FEE_DENOMINATOR, managementFeeWithRemainder } from "../../backend/src/workers/feeMath";

/** Public fixture identities; these are project-issued devnet mocks with no market value. */
export const DEVNET_MOCKS = [
  { symbol: "BSTESTA", name: "Basalt devnet fixture A", mint: "CrjoC7fq5XAbdej5zjinKNGXVqo8E8qCmh8XSiu2QViQ", decimals: 8, multiplier: 1 },
  { symbol: "BSTESTB", name: "Basalt devnet fixture B", mint: "EpH2swtxW2rCuFg2o2ukD5Qw5Xv3toaug1M3mbcB4hab", decimals: 8, multiplier: 1.25 },
  { symbol: "BSTESTC", name: "Basalt devnet fixture C", mint: "5G1hMSqs2nWKaFQt737FTxwnruPgeQqQWZ2FRoqxvehA", decimals: 8, multiplier: 2 },
  { symbol: "BSTESTD", name: "Basalt devnet fixture D", mint: "8W2hrfJPPrXEBjs5gDgpVZcs8HsELeHkBaqSjnUvgJUq", decimals: 8, multiplier: 10 },
] as const;

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const BASKET_DISC = "db4f6b87e7f3daf8";
const FACTORY_DISC = "1dc5ffe81680431a";
const WHITELIST_DISC = "6883dd77df010112";
const MOCK_MINTS = new Set<string>(DEVNET_MOCKS.map((m) => m.mint));
const SNAPSHOT_TTL_MS = 5_000;
const RPC_SPACING_MS = 400;
type Info = AccountInfo<Buffer>;
type Rpc = Pick<Connection, "getGenesisHash" | "getAccountInfo" | "getMultipleAccountsInfo" | "getProgramAccounts">;
export type DevnetWhitelistStatus = "Active" | "PausedNewMints" | "Unavailable";

export interface DevnetWalletBalance { mint: string; rawAmount: string; exists: boolean }
export interface DevnetMintFacts { mint: string; decimals: number; multiplier: number }
export interface DevnetWalletSnapshot {
  wallet: string;
  /** Lamports, directly read from the wallet's native account. */
  solBalance: number;
  walletBalances: DevnetWalletBalance[];
  mintFacts: DevnetMintFacts[];
  whitelistStatuses: DevnetWhitelistStatus[];
}
export interface RawDevnetSnapshot {
  detail: BasketDetail;
  /** Exact Token-2022 supply; available even when no USD valuation exists. */
  supply: string;
  shareDecimals: 6;
  managementFeeRemainder: string;
  vaultAuthority: string;
  wallet: string | null;
  shareBalance: string | null;
  walletBalances: DevnetWalletBalance[];
  whitelistStatuses: DevnetWhitelistStatus[];
}

export interface DecodedDevnetBasket {
  namespace: ProgramNamespace;
  detail: Omit<BasketDetail, "holdings" | "nav" | "drift">;
  nonce: bigint;
  lastFeeAccrual: bigint;
  managementFeeRemainder: bigint;
  vaultAuthority: PublicKey;
}

function fail(message: string): never { throw new Error(message); }
function checkedInfo(info: Info | null, owner: PublicKey, discriminator?: string, size = 0): Info {
  if (!info || info.executable || !info.owner.equals(owner) || info.data.length < size) fail("Invalid devnet account owner or layout.");
  if (discriminator && info.data.subarray(0, 8).toString("hex") !== discriminator) fail("Invalid devnet account discriminator.");
  return info;
}
function key(data: Buffer, offset: number): PublicKey { return new PublicKey(data.subarray(offset, offset + 32)); }
function u64(value: bigint): Buffer { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes; }
function factoryPda(namespace: ProgramNamespace): [PublicKey, number] { const PROGRAMS = namespacePrograms(namespace); return PublicKey.findProgramAddressSync([Buffer.from("factory")], PROGRAMS.factory); }
function whitelistPda(mint: PublicKey, namespace: ProgramNamespace): [PublicKey, number] { const PROGRAMS = namespacePrograms(namespace); return PublicKey.findProgramAddressSync([Buffer.from("mint"), mint.toBuffer()], PROGRAMS.whitelist); }
function ata(owner: PublicKey, mint: PublicKey): PublicKey { return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID); }
function dateOf(seconds: bigint): string {
  const millis = Number(seconds) * 1_000;
  if (!Number.isSafeInteger(millis)) fail("Invalid devnet account timestamp.");
  try { return new Date(millis).toISOString(); } catch { return fail("Invalid devnet account timestamp."); }
}

/** Decode the current immutable Basket layout, including its five-byte fee remainder. */
export function decodeDevnetBasketAccount(address: string | PublicKey, account: Info, routing: NamespaceRouting = APP_NAMESPACE_ROUTING): DecodedDevnetBasket {
  const pubkey = new PublicKey(address);
  const { namespace } = authenticateBasketAccount(pubkey, account, routing);
  const PROGRAMS = namespacePrograms(namespace);
  const b = checkedInfo(account, PROGRAMS.basket, BASKET_DISC, 886).data;
  const factory = key(b, 8), creator = key(b, 40), treasury = key(b, 72), shareMint = key(b, 104);
  const nonce = b.readBigUInt64LE(136), created = b.readBigInt64LE(144), lastFeeAccrual = b.readBigInt64LE(152);
  const count = b[192];
  if (count < 2 || count > DEVNET_MOCKS.length) fail("This basket does not use the devnet mock token pack.");
  const constituents = Array.from({ length: count }, (_, i) => key(b, 193 + i * 32).toBase58());
  const weights = Array.from({ length: count }, (_, i) => b.readUInt16LE(833 + i * 2));
  if (new Set(constituents).size !== count || constituents.some((m) => !MOCK_MINTS.has(m))) fail("This basket does not use the devnet mock token pack.");
  if (weights.some((w) => w === 0) || weights.reduce((sum, w) => sum + w, 0) !== 10_000) fail("Invalid immutable basket weights.");
  const [expectedFactory] = factoryPda(namespace);
  const [expectedBasket, basketBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), factory.toBuffer(), creator.toBuffer(), u64(nonce)], PROGRAMS.factory);
  const [expectedShare] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), pubkey.toBuffer()], PROGRAMS.factory);
  const [vaultAuthority, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), pubkey.toBuffer()], PROGRAMS.basket);
  if (!factory.equals(expectedFactory) || !pubkey.equals(expectedBasket) || !shareMint.equals(expectedShare) || b[879] !== basketBump || b[880] !== vaultBump) fail("Invalid devnet basket PDA identity.");
  const fees = [b.readUInt16LE(873), b.readUInt16LE(875), b.readUInt16LE(877)];
  if (fees[0] > 300 || fees[1] > 100 || fees[2] > 300) fail("Invalid immutable basket fees.");
  const remainder = b.readUIntLE(881, 5);
  if (BigInt(remainder) >= MANAGEMENT_FEE_DENOMINATOR) fail("Invalid management fee remainder.");
  if (created < 0n || lastFeeAccrual < created || b.subarray(160, 192).every((v) => v === 0)) fail("Invalid immutable basket metadata or timestamps.");
  return {
    namespace, nonce, lastFeeAccrual, managementFeeRemainder: BigInt(remainder), vaultAuthority,
    detail: {
      pubkey: pubkey.toBase58(), factory: factory.toBase58(), creator: creator.toBase58(), treasury: treasury.toBase58(),
      share_mint: shareMint.toBase58(), nonce: nonce.toString(), created_at: dateOf(created),
      metadata_hash: b.subarray(160, 192).toString("hex"), metadata_json: null,
      num_constituents: count, constituents, weights_bps: weights,
      entry_fee_bps: fees[0], exit_fee_bps: fees[1], management_fee_bps: fees[2],
      last_fee_accrual_ts: lastFeeAccrual.toString(), source: "devnet-rpc", asOf: null,
    },
  };
}

function readWhitelist(info: Info | null, mint: PublicKey, decimals: number, namespace: ProgramNamespace): DevnetWhitelistStatus {
  const PROGRAMS = namespacePrograms(namespace);
  const b = checkedInfo(info, PROGRAMS.whitelist, WHITELIST_DISC, 55).data;
  const length = b.readUInt32LE(50), end = 54 + length;
  const [, bump] = whitelistPda(mint, namespace);
  if (!key(b, 8).equals(mint) || b[40] !== decimals || length > 64 || end >= b.length || b[end] !== bump || (b[49] !== 0 && b[49] !== 1)) fail("Invalid devnet whitelist account.");
  // PausedNewMints is returned as data; it never prevents this read or redemption.
  return b[49] === 0 ? "Active" : "PausedNewMints";
}

function readAdmissionStatus(info: Info | null, mint: PublicKey, decimals: number, namespace: ProgramNamespace): DevnetWhitelistStatus {
  try { return readWhitelist(info, mint, decimals, namespace); }
  catch { return "Unavailable"; } // Missing admission never prevents permissionless redemption.
}

function readMintFacts(mint: PublicKey, info: Info | null): DevnetMintFacts {
  const account = checkedInfo(info, TOKEN_2022_PROGRAM_ID, undefined, 82);
  const decoded = unpackMint(mint, account, TOKEN_2022_PROGRAM_ID);
  if (!decoded.isInitialized || decoded.decimals !== 8 || !MOCK_MINTS.has(mint.toBase58())) fail("Invalid devnet mock mint.");
  const scaled = getScaledUiAmountConfig(decoded);
  if (!scaled) fail("The devnet mock is missing its scaled amount configuration.");
  const multiplier = BigInt(Math.floor(Date.now() / 1_000)) >= scaled.newMultiplierEffectiveTimestamp ? scaled.newMultiplier : scaled.multiplier;
  if (!Number.isFinite(multiplier) || multiplier <= 0) fail("Invalid devnet mock multiplier.");
  return { mint: mint.toBase58(), decimals: decoded.decimals, multiplier };
}

function readTokenBalance(address: PublicKey, info: Info | null, owner: PublicKey, mint: PublicKey, optional: boolean): DevnetWalletBalance {
  if (!info && optional) return { mint: mint.toBase58(), rawAmount: "0", exists: false };
  const decoded = unpackAccount(address, checkedInfo(info, TOKEN_2022_PROGRAM_ID, undefined, 165), TOKEN_2022_PROGRAM_ID);
  if (!decoded.isInitialized || !decoded.owner.equals(owner) || !decoded.mint.equals(mint)) fail("Invalid devnet token account identity.");
  return { mint: mint.toBase58(), rawAmount: decoded.amount.toString(), exists: true };
}

/** Exact display conversion. The raw integer used by instructions is never scaled. */
export function scaledDevnetAmount(raw: bigint, multiplier: number, decimals: number): string {
  if (raw < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 12 || !Number.isFinite(multiplier) || multiplier <= 0) fail("Invalid token display amount.");
  const [mantissa, exponent = "0"] = multiplier.toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const coefficient = BigInt(whole + fraction);
  const places = decimals + fraction.length - Number(exponent);
  if (places <= 0) return (raw * coefficient * 10n ** BigInt(-places)).toString();
  const scale = 10n ** BigInt(places), value = raw * coefficient;
  const tail = (value % scale).toString().padStart(places, "0").replace(/0+$/, "");
  return `${value / scale}${tail ? `.${tail}` : ""}`;
}

interface Cached<T> { value: T; at: number }
interface RpcState {
  tail: Promise<unknown>; lastStart: number; genesis: Cached<string> | null; genesisPending: Promise<void> | null;
  cache: Map<string, Cached<unknown>>; pending: Map<string, Promise<unknown>>; generation: number;
}
const states = new WeakMap<object, RpcState>();
function stateOf(rpc: Rpc): RpcState {
  let state = states.get(rpc);
  if (!state) { state = { tail: Promise.resolve(), lastStart: 0, genesis: null, genesisPending: null, cache: new Map(), pending: new Map(), generation: 0 }; states.set(rpc, state); }
  return state;
}
function rpcRead<T>(rpc: Rpc, call: () => Promise<T>): Promise<T> {
  const state = stateOf(rpc);
  const task = state.tail.catch(() => undefined).then(async () => {
    const wait = RPC_SPACING_MS - (Date.now() - state.lastStart);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    state.lastStart = Date.now();
    return call();
  });
  state.tail = task;
  return task;
}

/** Pin chain identity before using any fixture address, including custom RPC URLs. */
export async function assertDevnetConnection(connection: Rpc): Promise<void> {
  const state = stateOf(connection);
  if (state.genesis && Date.now() - state.genesis.at < 60_000 && state.genesis.value === DEVNET_GENESIS_HASH) return;
  if (!state.genesisPending) {
    state.genesisPending = rpcRead(connection, () => connection.getGenesisHash()).then((hash) => {
      if (hash !== DEVNET_GENESIS_HASH) fail("Switch the app RPC to Solana devnet before using these mock tokens.");
      state.genesis = { value: hash, at: Date.now() };
    }).finally(() => { state.genesisPending = null; });
  }
  await state.genesisPending;
}

async function cachedRead<T>(connection: Rpc, cacheKey: string, read: () => Promise<T>): Promise<T> {
  await assertDevnetConnection(connection);
  const state = stateOf(connection), cached = state.cache.get(cacheKey);
  if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached.value as T;
  const pending = state.pending.get(cacheKey);
  if (pending) return pending as Promise<T>;
  const generation = state.generation;
  const task = read().then((value) => {
    if (state.generation === generation) state.cache.set(cacheKey, { value, at: Date.now() });
    return value;
  }).finally(() => { if (state.pending.get(cacheKey) === task) state.pending.delete(cacheKey); });
  state.pending.set(cacheKey, task);
  return task;
}

/** Call after a confirmed claim/create/mint/redeem, before taking a fresh snapshot. */
export function invalidateDevnetBasketCache(connection: Rpc): void {
  const state = stateOf(connection); state.generation += 1; state.cache.clear(); state.pending.clear();
}
async function batch(connection: Rpc, addresses: PublicKey[]): Promise<(Info | null)[]> {
  const output: (Info | null)[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const keys = addresses.slice(i, i + 100);
    const values = await rpcRead(connection, () => connection.getMultipleAccountsInfo(keys, "confirmed"));
    if (values.length !== keys.length) fail("Incomplete devnet RPC account response.");
    output.push(...values);
  }
  return output;
}

async function materializeBasket(connection: Rpc, decoded: DecodedDevnetBasket, wallet: PublicKey | null, routing: NamespaceRouting): Promise<RawDevnetSnapshot> {
  const namespace = decoded.namespace, PROGRAMS = namespacePrograms(namespace);
  const d = decoded.detail, share = new PublicKey(d.share_mint);
  const mints = d.constituents.map((m) => new PublicKey(m));
  const addresses = [new PublicKey(d.pubkey), new PublicKey(d.factory), share, ...(wallet ? [ata(wallet, share)] : []),
    ...mints.flatMap((mint) => [mint, whitelistPda(mint, namespace)[0], ata(decoded.vaultAuthority, mint), ...(wallet ? [ata(wallet, mint)] : [])])];
  const accounts = await batch(connection, addresses);
  let index = 0;
  // The discovery read gives immutable addresses; this batch gives the fee
  // checkpoint and all token balances together, even if a crank ran meanwhile.
  const current = decodeDevnetBasketAccount(d.pubkey, checkedInfo(accounts[index++], PROGRAMS.basket, BASKET_DISC, 886), routing);
  for (const field of ["factory", "creator", "treasury", "share_mint", "nonce", "created_at", "metadata_hash", "entry_fee_bps", "exit_fee_bps", "management_fee_bps"] as const) {
    if (current.detail[field] !== d[field]) fail("Immutable basket data changed during the devnet read.");
  }
  if (current.detail.constituents.join(",") !== d.constituents.join(",") || current.detail.weights_bps.join(",") !== d.weights_bps.join(",")) fail("Immutable basket composition changed during the devnet read.");
  const f = checkedInfo(accounts[index++], PROGRAMS.factory, FACTORY_DISC, 89).data;
  const [, factoryBump] = factoryPda(namespace);
  if (!key(f, 40).equals(new PublicKey(d.treasury)) || f[88] !== factoryBump || f.readUInt16LE(72) !== 9_000 || d.entry_fee_bps > f.readUInt16LE(74) || d.exit_fee_bps > f.readUInt16LE(76) || d.management_fee_bps > f.readUInt16LE(78)) fail("Invalid devnet factory configuration.");
  const shareMint = authenticateBasketShareMint(share, accounts[index++], decoded.vaultAuthority);
  const shareBalance = wallet ? readTokenBalance(ata(wallet, share), accounts[index++], wallet, share, true).rawAmount : null;
  const asOf = new Date().toISOString(), statuses: DevnetWhitelistStatus[] = [], balances: DevnetWalletBalance[] = [];
  const holdings = mints.map((mint) => {
    const facts = readMintFacts(mint, accounts[index++]);
    statuses.push(readAdmissionStatus(accounts[index++], mint, facts.decimals, namespace));
    const vault = readTokenBalance(ata(decoded.vaultAuthority, mint), accounts[index++], decoded.vaultAuthority, mint, false);
    if (wallet) balances.push(readTokenBalance(ata(wallet, mint), accounts[index++], wallet, mint, true));
    return { mint: facts.mint, raw_amount: vault.rawAmount, multiplier: facts.multiplier, decimals: facts.decimals,
      scaled_amount: scaledDevnetAmount(BigInt(vault.rawAmount), facts.multiplier, facts.decimals), updated_at: asOf, source: "devnet-rpc" };
  });
  return { detail: { ...current.detail, asOf, holdings, nav: null, drift: null }, supply: shareMint.supply.toString(), shareDecimals: 6,
    managementFeeRemainder: current.managementFeeRemainder.toString(), vaultAuthority: decoded.vaultAuthority.toBase58(),
    wallet: wallet?.toBase58() ?? null, shareBalance, walletBalances: balances, whitelistStatuses: statuses };
}

/** A read-only current chain snapshot; missing wallet ATAs mean zero balance. */
export async function readDevnetBasket(connection: Rpc, address: string | PublicKey, ownerWallet?: string | PublicKey, routing: NamespaceRouting = APP_NAMESPACE_ROUTING): Promise<RawDevnetSnapshot> {
  const pubkey = new PublicKey(address), wallet = ownerWallet ? new PublicKey(ownerWallet) : null;
  const snapshot = await cachedRead(connection, `basket:${routing.registry.map(n => n.id + n.factoryConfig).join(":")}:${pubkey}:${wallet ?? ""}`, async () => {
    const info = await rpcRead(connection, () => connection.getAccountInfo(pubkey, "confirmed"));
    if (!info) fail("This devnet basket account does not exist.");
    return materializeBasket(connection, decodeDevnetBasketAccount(pubkey, info, routing), wallet, routing);
  });
  return attachMetadata(snapshot);
}

/** Discover only baskets backed by this fixed test-token pack, newest first. */
export async function listDevnetBaskets(connection: Rpc, options: { wallet?: string | PublicKey; limit?: number; routing?: NamespaceRouting } = {}): Promise<RawDevnetSnapshot[]> {
  const routing = options.routing ?? APP_NAMESPACE_ROUTING;
  const wallet = options.wallet ? new PublicKey(options.wallet) : null;
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail("Choose between 1 and 50 devnet baskets per read.");
  const snapshots = await cachedRead(connection, `list:${routing.registry.map(n => n.id + n.factoryConfig).join(":")}:${wallet ?? ""}:${limit}`, async () => {
    const decoded: DecodedDevnetBasket[] = [];
    const seen = new Set<string>();
    for (const namespace of routing.registry) {
      const program = new PublicKey(namespace.programs.basket);
      const accounts = await rpcRead(connection, () => connection.getProgramAccounts(program, { commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: "dgasZH9DJF9" } }] }));
      for (const { pubkey, account } of accounts) {
        try {
          if (!account.owner.equals(program) || seen.has(pubkey.toBase58())) continue;
          const basket = decodeDevnetBasketAccount(pubkey, account, routing);
          if (basket.namespace.id !== namespace.id) continue;
          decoded.push(basket); seen.add(pubkey.toBase58());
        } catch { /* Other and malformed accounts are outside this demo pack. */ }
      }
    }
    decoded.sort((a, b) => b.detail.created_at.localeCompare(a.detail.created_at));
    const result: RawDevnetSnapshot[] = [];
    for (const basket of decoded.slice(0, limit)) result.push(await materializeBasket(connection, basket, wallet, routing));
    return result;
  });
  return Promise.all(snapshots.map(attachMetadata));
}

/** Wallet prerequisites for claiming and atomically seeding a new basket. */
export async function readDevnetWallet(connection: Rpc, ownerWallet: string | PublicKey, routing: NamespaceRouting = APP_NAMESPACE_ROUTING): Promise<DevnetWalletSnapshot> {
  // Wallet facts remain readable while creation is disabled. Admission status
  // uses the selected creation namespace once activated, otherwise explicit legacy.
  let namespace: ProgramNamespace;
  try { namespace = routing.creation(); } catch { namespace = routing.registry[0]; }
  const wallet = new PublicKey(ownerWallet);
  return cachedRead(connection, `wallet:${namespace.id}:${namespace.factoryConfig}:${wallet}`, async () => {
    const mints = DEVNET_MOCKS.map((mock) => new PublicKey(mock.mint));
    const accounts = await batch(connection, [wallet, ...mints.flatMap((mint) => [mint, whitelistPda(mint, namespace)[0], ata(wallet, mint)])]);
    const native = accounts[0];
    if (native && (!Number.isSafeInteger(native.lamports) || native.lamports < 0)) fail("Invalid wallet SOL balance.");
    let index = 1;
    const mintFacts: DevnetMintFacts[] = [], whitelistStatuses: DevnetWhitelistStatus[] = [], walletBalances: DevnetWalletBalance[] = [];
    for (const mint of mints) {
      const facts = readMintFacts(mint, accounts[index++]); mintFacts.push(facts);
      whitelistStatuses.push(readAdmissionStatus(accounts[index++], mint, facts.decimals, namespace));
      walletBalances.push(readTokenBalance(ata(wallet, mint), accounts[index++], wallet, mint, true));
    }
    return { wallet: wallet.toBase58(), solBalance: native?.lamports ?? 0, mintFacts, whitelistStatuses, walletBalances };
  });
}

/** Estimate the supply used by the instruction's first management-fee checkpoint. */
export function estimateDevnetAccruedSupply(snapshot: RawDevnetSnapshot, nowSec: number | bigint = Math.floor(Date.now() / 1_000)): bigint {
  const now = BigInt(nowSec), last = BigInt(snapshot.detail.last_fee_accrual_ts ?? "0"), supply = BigInt(snapshot.supply);
  const elapsed = now > last ? now - last : 0n;
  if (elapsed === 0n) return supply;
  const { fee } = managementFeeWithRemainder(supply, snapshot.detail.management_fee_bps, elapsed, BigInt(snapshot.managementFeeRemainder));
  if (supply + fee > 0xffff_ffff_ffff_ffffn) fail("Estimated share supply exceeds the onchain amount limit.");
  return supply + fee;
}

function metadataKey(address: string | PublicKey): string { return `basalt:devnet:metadata:${new PublicKey(address).toBase58()}`; }
// Some wallet browsers disable localStorage. Keep verified metadata available
// for the current session without preventing a user-signed create transaction.
const sessionMetadata = new Map<string, string>();
function validateMetadataJson(jsonText: string): Record<string, unknown> {
  if (typeof jsonText !== "string" || new TextEncoder().encode(jsonText).length > 16_384) fail("Basket metadata is too large.");
  const metadata: unknown = JSON.parse(jsonText);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) fail("Invalid basket metadata.");
  const value = metadata as Record<string, unknown>;
  if (value.name !== undefined && (typeof value.name !== "string" || value.name.length > 64)) fail("Invalid basket metadata name.");
  for (const field of ["thesis", "description"] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || (value[field] as string).length > 400)) fail("Invalid basket metadata description.");
  }
  return value;
}
export async function hashDevnetBasketMetadata(jsonText: string): Promise<string> {
  validateMetadataJson(jsonText);
  const encoded = new TextEncoder().encode(jsonText), bytes = new Uint8Array(encoded.length); bytes.set(encoded);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("");
}
async function verifiedMetadata(jsonText: string, expectedHash: string): Promise<Record<string, unknown>> {
  if (!/^[a-fA-F0-9]{64}$/.test(expectedHash) || await hashDevnetBasketMetadata(jsonText) !== expectedHash.toLowerCase()) fail("Basket metadata does not match its immutable onchain hash.");
  return validateMetadataJson(jsonText);
}
/** Save only the exact bytes committed onchain; storage failure never changes chain state. */
export async function saveDevnetBasketMetadata(address: string | PublicKey, jsonText: string, expectedHash: string): Promise<void> {
  await verifiedMetadata(jsonText, expectedHash);
  if (typeof window === "undefined") fail("Basket metadata can be saved only in this browser.");
  const storageKey = metadataKey(address);
  sessionMetadata.set(storageKey, jsonText);
  try { window.localStorage.setItem(storageKey, jsonText); } catch { /* Session copy is still verified on read. */ }
}
/** Unverified, unavailable and tampered local metadata never supplies a display name. */
export async function loadDevnetBasketMetadata(address: string | PublicKey, expectedHash: string): Promise<Record<string, unknown> | null> {
  if (typeof window === "undefined") return null;
  try {
    const storageKey = metadataKey(address);
    let text: string | null;
    try { text = window.localStorage.getItem(storageKey) ?? sessionMetadata.get(storageKey) ?? null; }
    catch { text = sessionMetadata.get(storageKey) ?? null; }
    return text === null ? null : await verifiedMetadata(text, expectedHash);
  } catch { return null; }
}
async function attachMetadata(snapshot: RawDevnetSnapshot): Promise<RawDevnetSnapshot> {
  const metadata = await loadDevnetBasketMetadata(snapshot.detail.pubkey, snapshot.detail.metadata_hash ?? "");
  return { ...snapshot, detail: { ...snapshot.detail, metadata_json: metadata } };
}
