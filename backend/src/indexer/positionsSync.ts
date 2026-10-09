/** Authenticated finalized holder snapshots and atomic position reconciliation. */
import { PublicKey, type AccountInfo, type Context } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, unpackAccount, unpackMint } from "@solana/spl-token";
import { unresolvedPositionRebuildCondition } from "../db/projectionGuard.js";
import { isPgLike, withTransaction, type PgLike } from "../db/client.js";
import { withRpcBackoff, createPacer } from "../rpc/backoff.js";
import { decodeBasketState, type DecodedBasketState } from "./basketState.js";
import { assertBasketProjectionMatches } from "./positionSnapshotProjection.js";
import type { FinalizedPositionSnapshot } from "./positions.js";

export interface PositionsSyncRpc {
  getProgramAccounts(programId: PublicKey, config: {
    encoding?: "base64"; commitment: "finalized"; withContext: true; minContextSlot?: number;
    filters: Array<{ memcmp: { offset: number; bytes: string } }>;
  }): Promise<{ context: Context; value: ReadonlyArray<{ pubkey: PublicKey; account: AccountInfo<Buffer> }> }>;
  getAccountInfoAndContext(address: PublicKey, config: { commitment: "finalized"; minContextSlot?: number }):
    Promise<{ context: Context; value: AccountInfo<Buffer> | null }>;
}
export type JsonRpcInvoker = (method: string, params: unknown[]) => Promise<unknown>;
export interface ChainHolder { user: string; mint: string; amount: string }
export interface PositionsSyncStats {
  basketsScanned: number; basketsFailed: number; holders: number;
  eventKept: number; balanceSynced: number; zeroed: number;
}
export interface RecoveryPrograms { basket: PublicKey; factory: PublicKey; ids: readonly string[] }
export interface PositionsSyncOptions {
  spacingMs?: number;
  backoffSleep?: (ms: number) => Promise<void>;
  /** Kept for caller compatibility; enhanced parsed balances are never trusted. */
  jsonRpcInvoke?: JsonRpcInvoker;
  programs?: RecoveryPrograms;
  /** Discover and drain canonical history after the snapshot, before taking locks. */
  catchUpThroughSlot?: (slot: number) => Promise<void>;
}
const SNAPSHOT_DEADLINE_MS = 10_000;
const MAX_CONTEXT_ATTEMPTS = 3;
const U64_MAX = (1n << 64n) - 1n;

function canonicalKey(value: string): PublicKey {
  const key = new PublicKey(value);
  if (key.toBase58() !== value) throw new Error("Noncanonical public key");
  return key;
}
function validateProgramIds(programs: readonly string[]): void {
  if (programs.length !== 3 || new Set(programs).size !== programs.length) throw new Error("Explicit unique program IDs required");
  programs.forEach(canonicalKey);
}
function validatePrograms(programs: RecoveryPrograms): void {
  validateProgramIds(programs.ids);
  if (programs.basket.equals(programs.factory) ||
      !programs.ids.includes(programs.basket.toBase58()) || !programs.ids.includes(programs.factory.toBase58())) {
    throw new Error("Basket and factory roles require distinct, covered program IDs");
  }
}
function finalizedSlot(context: Context | undefined, minimum = 0): number {
  const slot = context?.slot;
  if (!Number.isSafeInteger(slot) || slot! < minimum) throw new Error("Invalid or regressing finalized RPC context");
  return slot!;
}

export function isTokenIndexExcludedError(error: unknown): boolean {
  return /excluded from account secondary indexes|this RPC method unavailable for key/i.test(String(error));
}
/** Structural helper only; ownership and expected mint require parseShareHolders. */
export function parseTokenAccountOwnerAmount(data: Buffer): { owner: string; amount: bigint } | null {
  if (!Buffer.isBuffer(data) || data.length < 165 || ![1, 2].includes(data[108])) return null;
  return { owner: new PublicKey(data.subarray(32, 64)).toBase58(), amount: data.readBigUInt64LE(64) };
}

function validateTokenAccountBytes(data: Buffer): void {
  if (!Buffer.isBuffer(data) || data.length < 165 || ![1, 2].includes(data[108])) {
    throw new Error("Invalid initialized token-account bytes");
  }
  for (const offset of [72, 109, 129]) {
    if (data.readUInt32LE(offset) > 1) throw new Error("Invalid token-account optional field");
  }
  if (data.readUInt32LE(109) !== 0) throw new Error("Basket shares cannot be native token accounts");
  if (data.length === 165) return;
  if (data.length < 166 || data[165] !== 2) throw new Error("Invalid Token-2022 account type");
  const extensions = new Set<number>();
  for (let offset = 166; offset < data.length;) {
    if (data.subarray(offset).every(byte => byte === 0)) break;
    if (offset + 4 > data.length) throw new Error("Truncated token-account extension");
    const type = data.readUInt16LE(offset), length = data.readUInt16LE(offset + 2);
    if (type === 0 || extensions.has(type) || offset + 4 + length > data.length) throw new Error("Malformed token-account extensions");
    extensions.add(type);
    offset += 4 + length;
  }
}

export function parseShareHolders(
  accounts: ReadonlyArray<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>,
  expectedMint: PublicKey | string,
): ChainHolder[] {
  const mint = new PublicKey(expectedMint), totals = new Map<string, bigint>(), seen = new Set<string>();
  for (const row of accounts) {
    const address = row.pubkey.toBase58();
    if (seen.has(address)) throw new Error("Duplicate token account in holder snapshot");
    seen.add(address);
    if (row.account.executable || !row.account.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("Unauthenticated share holder snapshot");
    validateTokenAccountBytes(row.account.data);
    const account = unpackAccount(row.pubkey, row.account, TOKEN_2022_PROGRAM_ID);
    if (!account.isInitialized || !account.mint.equals(mint)) throw new Error("Unauthenticated share holder snapshot");
    const user = account.owner.toBase58(), amount = (totals.get(user) ?? 0n) + account.amount;
    if (amount > U64_MAX) throw new Error("Holder balance exceeds raw share supply domain");
    totals.set(user, amount);
  }
  return [...totals].filter(([, amount]) => amount > 0n)
    .map(([user, amount]) => ({ user, mint: mint.toBase58(), amount: amount.toString() }));
}
/** Parsed provider results lack authenticated owner, mint and finalized context. */
export async function fetchShareHoldersViaTokenApi(_invoke: JsonRpcInvoker, _mint: PublicKey | string): Promise<ChainHolder[]> {
  throw new Error("Enhanced token-account enumeration is not authenticated finalized evidence");
}
export async function fetchShareHolders(
  rpc: PositionsSyncRpc, shareMint: PublicKey | string,
  opts: { backoffSleep?: (ms: number) => Promise<void>; jsonRpcInvoke?: JsonRpcInvoker } = {},
): Promise<ChainHolder[]> {
  const mint = new PublicKey(shareMint);
  const snapshot = await withRpcBackoff(() => rpc.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    commitment: "finalized", encoding: "base64", withContext: true,
    filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
  }), { sleep: opts.backoffSleep, logKey: "positionsSync:finalized-holders" });
  finalizedSlot(snapshot.context);
  if (!Array.isArray(snapshot.value)) throw new Error("Missing finalized holder accounts");
  return parseShareHolders(snapshot.value, mint);
}

/** The outer deadline also covers backoff waits and unresolved provider promises. */
async function boundedSnapshotRead<T>(read: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Finalized snapshot read deadline exhausted");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Finalized snapshot read deadline exhausted")), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
class ContextAdvancedError extends Error {}

/** Holders and supply must come from exactly one slot; immutable basket may be earlier. */
export async function fetchFinalizedPositionSnapshot(
  rpc: PositionsSyncRpc, basket: string, programs: RecoveryPrograms,
  backoffSleep?: (ms: number) => Promise<void>,
): Promise<FinalizedPositionSnapshot & { basketState: DecodedBasketState }> {
  const address = canonicalKey(basket);
  validatePrograms(programs);
  const deadline = Date.now() + SNAPSHOT_DEADLINE_MS;
  let minimumSlot = 0;
  const read = <T>(fn: () => Promise<T>, logKey: string) => withRpcBackoff(
    () => boundedSnapshotRead(fn, deadline), { sleep: backoffSleep, logKey },
  );
  return boundedSnapshotRead(async () => {
    for (let attempt = 0; attempt < MAX_CONTEXT_ATTEMPTS; attempt++) {
      try {
        const basketAccount = await read(() => rpc.getAccountInfoAndContext(address, {
          commitment: "finalized", minContextSlot: minimumSlot,
        }), "positionsSync:basket");
        minimumSlot = finalizedSlot(basketAccount.context, minimumSlot);
        if (!basketAccount.value) throw new Error("Basket unavailable");
        const state = decodeBasketState(basket, basketAccount.value, programs);
        const mintAddress = new PublicKey(state.shareMint);
        const holders = await read(() => rpc.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
          commitment: "finalized", encoding: "base64", withContext: true, minContextSlot: minimumSlot,
          filters: [{ memcmp: { offset: 0, bytes: state.shareMint } }],
        }), "positionsSync:finalized-holders");
        minimumSlot = finalizedSlot(holders.context, minimumSlot);
        if (!Array.isArray(holders.value)) throw new Error("Missing finalized holder accounts");
        const balances = parseShareHolders(holders.value, mintAddress).map(row => ({ user: row.user, shares: row.amount }));
        const mintAccount = await read(() => rpc.getAccountInfoAndContext(mintAddress, {
          commitment: "finalized", minContextSlot: minimumSlot,
        }), "positionsSync:finalized-mint");
        const mintSlot = finalizedSlot(mintAccount.context, minimumSlot);
        if (!mintAccount.value) throw new Error("Share mint unavailable");
        if (mintSlot !== minimumSlot) {
          minimumSlot = mintSlot;
          throw new ContextAdvancedError("Finalized holder/mint contexts differ; retry snapshot");
        }
        // The factory creates a plain 82-byte mint with no freeze authority.
        const info = mintAccount.value;
        if (info.executable || !info.owner.equals(TOKEN_2022_PROGRAM_ID) || !Buffer.isBuffer(info.data) ||
            info.data.length !== 82 || info.data[45] !== 1 || info.data.readUInt32LE(0) !== 1 || info.data.readUInt32LE(46) !== 0) {
          throw new Error("Share mint authentication failed");
        }
        const mint = unpackMint(mintAddress, info, TOKEN_2022_PROGRAM_ID);
        if (mint.decimals !== 6 || !mint.mintAuthority?.equals(new PublicKey(state.vaultAuthority))) throw new Error("Share mint authentication failed");
        if (balances.reduce((sum, row) => sum + BigInt(row.shares), 0n) !== mint.supply) throw new Error("Holder snapshot does not reconcile to share supply");
        return { slot: minimumSlot, supply: mint.supply.toString(), balances, basketState: state };
      } catch (error) {
        if (!(error instanceof ContextAdvancedError) || attempt === MAX_CONTEXT_ATTEMPTS - 1) throw error;
      }
    }
    throw new Error("Finalized snapshot retry budget exhausted");
  }, deadline);
}

/** Same global/program/basket lock order as durable discovery and activation. */
export async function lockCompleteHistory(client: PgLike, basket: string, programs: readonly string[]): Promise<void> {
  canonicalKey(basket);
  validateProgramIds(programs);
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["indexer-global-finalized-poll"]);
  for (const program of [...programs].sort()) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`indexer-history:${program}`]);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`positions:${basket}`]);
  const state = await client.query("SELECT program_id,history_complete,scan_before,scan_head FROM indexer_program_state WHERE program_id=ANY($1::text[])", [[...programs]]);
  if (state.rows.length !== programs.length || state.rows.some(row => !row.history_complete || row.scan_before !== null || row.scan_head !== null)) throw new Error("Canonical program scan incomplete");
  const pending = await client.query("SELECT COUNT(*)::int AS count FROM indexer_signature_queue WHERE program_id=ANY($1::text[]) AND status<>'processed'", [[...programs]]);
  if (pending.rows[0]?.count !== 0) throw new Error("Pending/quarantined canonical signatures block reconciliation");
}
/** Supply equality alone cannot prove absence of undiscovered zero-net history. */
export async function assertFinalizedHistoryCoverage(client: PgLike, programs: readonly string[], slot: number): Promise<void> {
  validateProgramIds(programs);
  finalizedSlot({ slot });
  const state = await client.query("SELECT program_id,finalized_through_slot::text AS finalized_through_slot FROM indexer_program_state WHERE program_id=ANY($1::text[])", [[...programs]]);
  if (state.rows.length !== programs.length || state.rows.some(row => row.finalized_through_slot == null || BigInt(row.finalized_through_slot) < BigInt(slot))) throw new Error("Finalized snapshot is newer than verified canonical discovery; catch up and restage");
}

/** Read before locks, catch history up, then publish each basket atomically. */
export async function syncPositionsFromChain(
  rpc: PositionsSyncRpc, db: PgLike | null | undefined, opts: PositionsSyncOptions = {},
): Promise<PositionsSyncStats> {
  const stats: PositionsSyncStats = { basketsScanned: 0, basketsFailed: 0, holders: 0, eventKept: 0, balanceSynced: 0, zeroed: 0 };
  if (!isPgLike(db)) return stats;
  if (!opts.programs) throw new Error("Authenticated recovery programs are required");
  const programs = opts.programs;
  validatePrograms(programs);
  const baskets = (await db.query("SELECT pubkey FROM baskets ORDER BY pubkey")).rows;
  const pacer = createPacer(opts.spacingMs ?? 100);
  for (const row of baskets) {
    try {
      await pacer.wait();
      const snapshot = await fetchFinalizedPositionSnapshot(rpc, row.pubkey, programs, opts.backoffSleep);
      if (opts.catchUpThroughSlot) await boundedSnapshotRead(() => opts.catchUpThroughSlot!(snapshot.slot), Date.now() + SNAPSHOT_DEADLINE_MS);
      const result = await withTransaction(db, async client => {
        await lockCompleteHistory(client, row.pubkey, programs.ids);
        await assertBasketProjectionMatches(client, snapshot.basketState);
        const pending = await client.query(`SELECT basket FROM position_rebuild_required r WHERE basket=$1 AND ${unresolvedPositionRebuildCondition("r")}`, [row.pubkey]);
        if (pending.rows.length) throw new Error("Legacy projection pending reviewed activation");
        await assertFinalizedHistoryCoverage(client, programs.ids, snapshot.slot);
        const known = await client.query("SELECT COALESCE(MAX(slot),0)::text AS slot FROM events WHERE basket=$1 AND log_index>=0", [row.pubkey]);
        if (BigInt(known.rows[0].slot) > BigInt(snapshot.slot)) throw new Error("Snapshot predates canonical events");
        const claims = await client.query("SELECT 1 FROM position_events WHERE basket=$1 AND log_index>=0 AND (slot IS NULL OR slot>$2) LIMIT 1", [row.pubkey, String(snapshot.slot)]);
        if (claims.rows.length) throw new Error("Snapshot predates applied events or their finalized slots are unknown");
        const previous = await client.query("SELECT snapshot_slot::text FROM position_reconciliation_state WHERE basket=$1", [row.pubkey]);
        if (previous.rows[0] && BigInt(previous.rows[0].snapshot_slot) > BigInt(snapshot.slot)) throw new Error("Snapshot would move projection backwards");
        const users = snapshot.balances.map(holder => holder.user);
        const zeroed = await client.query(`UPDATE user_positions SET share_balance=0,cost_basis=NULL,cost_basis_source=NULL,updated_at=NOW()
          WHERE basket=$1 AND NOT("user"=ANY($2::text[])) AND share_balance<>0`, [row.pubkey, users]);
        for (const holder of snapshot.balances) await client.query(`INSERT INTO user_positions("user",basket,share_balance,cost_basis,cost_basis_source)
          VALUES($1,$2,$3,NULL,'balance-sync') ON CONFLICT("user",basket) DO UPDATE SET share_balance=EXCLUDED.share_balance,
          cost_basis=CASE WHEN user_positions.share_balance=EXCLUDED.share_balance THEN user_positions.cost_basis END,
          cost_basis_source=CASE WHEN user_positions.share_balance=EXCLUDED.share_balance THEN user_positions.cost_basis_source ELSE 'balance-sync' END,updated_at=NOW()`, [holder.user, row.pubkey, holder.shares]);
        await client.query(`INSERT INTO position_reconciliation_state(basket,snapshot_slot) VALUES($1,$2)
          ON CONFLICT(basket) DO UPDATE SET snapshot_slot=EXCLUDED.snapshot_slot,updated_at=NOW()`, [row.pubkey, String(snapshot.slot)]);
        return { holders: users.length, zeroed: zeroed.rowCount ?? 0 };
      });
      stats.basketsScanned++;
      stats.holders += result.holders;
      stats.balanceSynced += result.holders;
      stats.zeroed += result.zeroed;
    } catch (error) {
      stats.basketsFailed++;
      console.warn(`[positionsSync] preserving prior projection for ${row.pubkey}:`, error instanceof Error ? error.message : "snapshot failed");
    }
  }
  return stats;
}
