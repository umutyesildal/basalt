/** Independent current-balance evidence. Never changes historical claims or projections. */
import { PROGRAM_NAMESPACES, validateNamespaceRegistry, namespaceForPrograms, type ProgramNamespace } from "../config/programNamespaces.js";
import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo, type Context, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, unpackMint } from "@solana/spl-token";
import { isTransactionPool, type PgLike, type PgTransactionClient } from "../db/client.js";
import { DEVNET_RPC_GENESIS } from "../rpc/positionsProvider.js";
import { withRpcBackoff } from "../rpc/backoff.js";
import { RpcReadError } from "../rpc/requestBudget.js";
import { decodeBasketState, type DecodedBasketState } from "./basketState.js";
import { parseShareHolders, type RecoveryPrograms } from "./positionsSync.js";
import { assertBasketProjectionMatches } from "./positionSnapshotProjection.js";

export interface CurrentBalanceRpc {
  getGenesisHash(): Promise<string>;
  getAccountInfoAndContext(address: PublicKey, config: { commitment: "finalized"; minContextSlot?: number }): Promise<{ context: Context; value: AccountInfo<Buffer> | null }>;
  getMultipleAccountsInfoAndContext(addresses: PublicKey[], config: { commitment: "finalized"; minContextSlot?: number }): Promise<{ context: Context; value: Array<AccountInfo<Buffer> | null> }>;
  getParsedTransaction(signature: string, config: { commitment: "finalized"; maxSupportedTransactionVersion: 0 }): Promise<ParsedTransactionWithMeta | null>;
}
export interface CurrentBalanceSnapshot {
  slot: number; supply: string; balances: Array<{ user: string; shares: string }>;
  basketState: DecodedBasketState; accountsDigest: string; accountCount: number; candidateAccounts: string[];
  observedAt: Date; historyComplete: false; programIds: string[];
}
export class CurrentBalanceSnapshotError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CurrentBalanceSnapshotError"; }
}
const MAX_CANDIDATES = 1_000;
const BATCH_CANDIDATES = 98; // Repeat basket + mint inside the same <=100-address RPC bank read.
const MAX_ATTEMPTS = 3;
const U64_MAX = (1n << 64n) - 1n;
const MAX_SNAPSHOT_AGE_MS = 5 * 60_000;
const identity = new WeakMap<CurrentBalanceRpc, number>();
const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function key(value: string, nonzero = false): PublicKey {
  try { const result = new PublicKey(value); if (nonzero && result.equals(PublicKey.default) || result.toBase58() !== value) throw new Error(); return result; }
  catch { throw new CurrentBalanceSnapshotError("invalid-public-key"); }
}
function validatePrograms(programs: RecoveryPrograms): void {
  if (programs.ids.length !== 3 || new Set(programs.ids).size !== 3 || programs.basket.equals(programs.factory) ||
    !programs.ids.includes(programs.basket.toBase58()) || !programs.ids.includes(programs.factory.toBase58())) throw new CurrentBalanceSnapshotError("invalid-program-roles");
  programs.ids.forEach(value => key(value, true));
}
function slot(context: Context | undefined, minimum = 0): number {
  if (!Number.isSafeInteger(context?.slot) || context!.slot < minimum) throw new CurrentBalanceSnapshotError("invalid-finalized-context");
  return context!.slot;
}
async function bounded<T>(read: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now(); if (remaining <= 0) throw new CurrentBalanceSnapshotError("snapshot-deadline");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CurrentBalanceSnapshotError("snapshot-deadline")), remaining); })]); }
  finally { if (timer) clearTimeout(timer); }
}
/** A timed-out pool acquisition can finish later; release it without starting work. */
async function snapshotTransaction<T>(db: PgLike, deadline: number, run: (client: PgLike) => Promise<T>): Promise<T> {
  if (!isTransactionPool(db)) throw new CurrentBalanceSnapshotError("snapshot-pool-required");
  const acquisition = db.connect!();
  let client: PgTransactionClient;
  try { client = await bounded(() => acquisition, deadline); }
  catch (error) { void acquisition.then(late => late.release(), () => {}).catch(() => {}); throw error; }
  let released = false;
  const discard = () => {
    if (released) return;
    released = true;
    // pg.PoolClient.release(true) removes and closes this connection. An active
    // non-pipelined pg query is force-disconnected, so it cannot resume our work.
    (client as unknown as { release(destroy: boolean): void }).release(true);
  };
  const remaining = () => {
    const ms = Math.floor(deadline - Date.now());
    if (ms <= 0) throw new CurrentBalanceSnapshotError("snapshot-deadline");
    return ms;
  };
  const query: PgLike["query"] = async (sql, values) => {
    try { return await bounded(() => client.query(sql, values), deadline); }
    catch (error) {
      if (error instanceof CurrentBalanceSnapshotError && error.code === "snapshot-deadline") discard();
      throw error;
    }
  };
  try {
    remaining(); await query("BEGIN");
    const scoped: PgLike = { async query(sql, values) {
      const ms = remaining();
      await query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)", [`${ms}ms`, `${Math.min(5_000, ms)}ms`]);
      remaining(); return query(sql, values);
    } };
    const result = await run(scoped);
    remaining(); await query("COMMIT");
    return result;
  } catch (error) {
    if (!released) {
      try { await bounded(() => client.query("ROLLBACK"), Math.min(deadline, Date.now() + 1_000)); }
      catch { discard(); }
    }
    throw error;
  } finally { if (!released) client.release(); }

}
function assertFreshObservation(snapshot: CurrentBalanceSnapshot): void {
  const timestamp = snapshot.observedAt instanceof Date ? snapshot.observedAt.getTime() : NaN, now = Date.now();
  if (!Number.isFinite(timestamp) || timestamp > now || now - timestamp > MAX_SNAPSHOT_AGE_MS) throw new CurrentBalanceSnapshotError("snapshot-observation-stale-or-future");
}
async function retryRead<T>(read: () => Promise<T>, deadline: number, sleep?: (ms: number) => Promise<void>): Promise<T> {
  return bounded(() => withRpcBackoff(() => bounded(read, deadline), { sleep, logKey: "current-balances" }), deadline);
}
async function verifyNetwork(rpc: CurrentBalanceRpc, deadline: number, sleep?: (ms: number) => Promise<void>): Promise<void> {
  if ((identity.get(rpc) ?? 0) > Date.now()) return;
  if (await retryRead(() => rpc.getGenesisHash(), deadline, sleep) !== DEVNET_RPC_GENESIS) throw new CurrentBalanceSnapshotError("wrong-network");
  identity.set(rpc, Date.now() + 60_000);
}
function accountBytes(info: AccountInfo<Buffer>): string {
  if (!Buffer.isBuffer(info.data)) throw new CurrentBalanceSnapshotError("invalid-account-bytes");
  return JSON.stringify([info.owner.toBase58(), info.executable, info.data.toString("base64")]);
}

/** Candidate addresses are hints. Exact authenticated raw supply conservation proves coverage. */
export async function readCurrentBalanceSnapshot(
  rpc: CurrentBalanceRpc, basket: string, programs: RecoveryPrograms, candidates: readonly string[],
  options: { deadlineMs?: number; backoffSleep?: (ms: number) => Promise<void>; preparedBasket?: Awaited<ReturnType<CurrentBalanceRpc["getAccountInfoAndContext"]>> } = {},
): Promise<CurrentBalanceSnapshot> {
  validatePrograms(programs); const basketAddress = key(basket, true);
  if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES) throw new CurrentBalanceSnapshotError("candidate-limit-exceeded");
  const addresses = [...new Set(candidates.map(value => key(value).toBase58()))].sort(ordinal);
  const duration = options.deadlineMs ?? 10_000;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 10_000) throw new CurrentBalanceSnapshotError("invalid-snapshot-deadline");
  const deadline = Date.now() + duration;
  const read = <T>(fn: () => Promise<T>) => retryRead(fn, deadline, options.backoffSleep);
  await verifyNetwork(rpc, deadline, options.backoffSleep);
  // This prior read supplies hints/minContextSlot only. Every proof batch below
  // independently authenticates the canonical raw basket, mint and holders.
  const initial = options.preparedBasket ?? await read(() => rpc.getAccountInfoAndContext(basketAddress, { commitment: "finalized" }));
  let minimum = slot(initial.context);
  if (!initial.value) throw new CurrentBalanceSnapshotError("basket-unavailable");
  const firstState = decodeBasketState(basket, initial.value, programs);
  const mintAddress = key(firstState.shareMint, true);
  // Basket/mint themselves are not token-account candidates and must not count twice.
  const tokenCandidates = addresses.filter(address => address !== basket && address !== firstState.shareMint);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let bankSlot: number | null = null, basketBytes: string | null = null, mintBytes: string | null = null;
    let state: DecodedBasketState | null = null, supply: bigint | null = null, drifted = false;
    const accounts: Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }> = [];
    const batches = Math.max(1, Math.ceil(tokenCandidates.length / BATCH_CANDIDATES));
    for (let batch = 0; batch < batches; batch++) {
      const selected = tokenCandidates.slice(batch * BATCH_CANDIDATES, (batch + 1) * BATCH_CANDIDATES);
      const response = await read(() => rpc.getMultipleAccountsInfoAndContext([basketAddress, mintAddress, ...selected.map(value => key(value))], { commitment: "finalized", minContextSlot: minimum }));
      const contextSlot = slot(response.context, minimum); minimum = contextSlot;
      if (bankSlot !== null && bankSlot !== contextSlot) { drifted = true; break; }
      bankSlot = contextSlot;
      if (!Array.isArray(response.value) || response.value.length !== selected.length + 2) throw new CurrentBalanceSnapshotError("missing-account-results");
      const [basketInfo, mintInfo] = response.value;
      if (!basketInfo || !mintInfo) throw new CurrentBalanceSnapshotError("basket-or-mint-unavailable");
      const decoded = decodeBasketState(basket, basketInfo, programs);
      if (decoded.shareMint !== firstState.shareMint) throw new CurrentBalanceSnapshotError("share-mint-changed");
      const rawBasket = accountBytes(basketInfo), rawMint = accountBytes(mintInfo);
      if ((basketBytes !== null && basketBytes !== rawBasket) || (mintBytes !== null && mintBytes !== rawMint)) throw new CurrentBalanceSnapshotError("same-slot-account-disagreement");
      basketBytes = rawBasket; mintBytes = rawMint; state = decoded;
      if (mintInfo.executable || !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) || mintInfo.data.length !== 82 ||
        mintInfo.data[45] !== 1 || mintInfo.data.readUInt32LE(0) !== 1 || mintInfo.data.readUInt32LE(46) !== 0) throw new CurrentBalanceSnapshotError("unauthenticated-share-mint");
      const mint = unpackMint(mintAddress, mintInfo, TOKEN_2022_PROGRAM_ID);
      if (mint.decimals !== 6 || !mint.mintAuthority?.equals(key(decoded.vaultAuthority))) throw new CurrentBalanceSnapshotError("unauthenticated-share-mint");
      supply = mint.supply;
      for (let i = 0; i < selected.length; i++) {
        const info = response.value[i + 2];
        // Transaction key lists contain unrelated accounts. They contribute no share balances.
        if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID) || !Buffer.isBuffer(info.data) || info.data.length < 32 || !info.data.subarray(0, 32).equals(mintAddress.toBuffer())) continue;
        accounts.push({ pubkey: key(selected[i]), account: info });
      }
    }
    if (drifted) continue;
    if (bankSlot === null || !state || supply === null) throw new CurrentBalanceSnapshotError("missing-finalized-snapshot");
    let balances: Array<{ user: string; shares: string }>;
    try { balances = parseShareHolders(accounts, mintAddress).map(row => ({ user: row.user, shares: row.amount })).sort((a, b) => ordinal(a.user, b.user)); }
    catch { throw new CurrentBalanceSnapshotError("unauthenticated-share-account"); }
    const total = balances.reduce((sum, row) => sum + BigInt(row.shares), 0n);
    if (total > U64_MAX || total !== supply) throw new CurrentBalanceSnapshotError("share-supply-coverage-incomplete");
    const canonicalAccounts = accounts.sort((a, b) => ordinal(a.pubkey.toBase58(), b.pubkey.toBase58()));
    const accountsDigest = createHash("sha256").update(JSON.stringify([basket, [...programs.ids].sort(ordinal), bankSlot, basketBytes, mintBytes,
      canonicalAccounts.map(row => [row.pubkey.toBase58(), accountBytes(row.account)])])).digest("hex");
    return { slot: bankSlot, supply: supply.toString(), balances, basketState: state, accountsDigest, accountCount: accounts.length,
      candidateAccounts: canonicalAccounts.map(row => row.pubkey.toBase58()), observedAt: new Date(), historyComplete: false, programIds: [...programs.ids].sort(ordinal) };
  }
  throw new CurrentBalanceSnapshotError("equal-context-retry-exhausted");
}

/** Read bounded address hints, not purported current balances or historical events. */
export async function discoverCurrentBalanceCandidates(db: PgLike, basket: string, state: DecodedBasketState, deadline = Date.now() + 15_000): Promise<string[]> {
  return snapshotTransaction(db, deadline, async client => {
    const owners = (await client.query(`SELECT owner FROM (SELECT "user" AS owner FROM user_positions WHERE basket=$1
      UNION SELECT data->>'user' AS owner FROM events WHERE basket=$1 AND type IN ('Minted','Redeemed')) hints
      WHERE owner IS NOT NULL ORDER BY owner COLLATE "C" LIMIT $2`, [basket, MAX_CANDIDATES + 1])).rows;
    if (owners.length > MAX_CANDIDATES) throw new CurrentBalanceSnapshotError("candidate-limit-exceeded");
    const previous = (await client.query("SELECT candidate_accounts FROM current_balance_snapshots WHERE basket=$1", [basket])).rows[0]?.candidate_accounts ?? [];
    if (!Array.isArray(previous) || previous.length > MAX_CANDIDATES) throw new CurrentBalanceSnapshotError("candidate-limit-exceeded");
    const mint = key(state.shareMint), candidates = new Set<string>(previous.map(value => key(value).toBase58()));
    for (const owner of [state.creator, state.treasury, ...owners.map(row => row.owner)]) candidates.add(getAssociatedTokenAddressSync(mint, key(owner), true, TOKEN_2022_PROGRAM_ID).toBase58());
    if (candidates.size > MAX_CANDIDATES) throw new CurrentBalanceSnapshotError("candidate-limit-exceeded");
    return [...candidates].sort(ordinal);
  });
}

async function expandTransactionHints(rpc: CurrentBalanceRpc, db: PgLike, basket: string, programs: RecoveryPrograms, candidates: string[], passDeadline: number, sleep?: (ms: number) => Promise<void>): Promise<string[]> {
  const rows = (await snapshotTransaction(db, passDeadline, client => client.query(`SELECT sig,MAX(slot) AS slot FROM (SELECT sig,slot FROM events WHERE basket=$1
    UNION SELECT sig,slot FROM indexer_signature_queue WHERE program_id=ANY($2::text[]) AND status='quarantined') hints
    GROUP BY sig ORDER BY MAX(slot) DESC,sig COLLATE "C" LIMIT 4`, [basket, [...programs.ids]]))).rows;
  const found = new Set(candidates), deadline = Math.min(passDeadline, Date.now() + 10_000);
  for (const row of rows) {
    const tx = await retryRead(() => rpc.getParsedTransaction(row.sig, { commitment: "finalized", maxSupportedTransactionVersion: 0 }), deadline, sleep);
    if (!tx || !tx.meta || tx.meta.err || tx.transaction.signatures[0] !== row.sig || !Number.isSafeInteger(tx.slot) || tx.slot !== Number(row.slot)) throw new CurrentBalanceSnapshotError("transaction-hint-unavailable");
    if (!Array.isArray(tx.transaction.message.accountKeys) || tx.transaction.message.accountKeys.length > 256) throw new CurrentBalanceSnapshotError("transaction-hint-invalid");
    for (const account of tx.transaction.message.accountKeys) found.add(key(account.pubkey.toBase58()).toBase58());
    if (found.size > MAX_CANDIDATES) throw new CurrentBalanceSnapshotError("candidate-limit-exceeded");
  }
  return [...found].sort(ordinal);
}

async function failSnapshot(db: PgLike, basket: string, programs: RecoveryPrograms, attemptedAt: Date, reason: string, deadline: number): Promise<void> {
  await snapshotTransaction(db, deadline, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`positions:${basket}`]);
    await client.query(`INSERT INTO current_balance_snapshots(basket,program_ids,status,reason,attempted_at) VALUES($1,$2,'incomplete',$3,$4)
      ON CONFLICT(basket) DO UPDATE SET status='incomplete',reason=EXCLUDED.reason,attempted_at=EXCLUDED.attempted_at
      WHERE current_balance_snapshots.attempted_at<=EXCLUDED.attempted_at`, [basket, [...programs.ids].sort(ordinal), reason, attemptedAt]);
  });
}
export async function persistCurrentBalanceSnapshot(db: PgLike, snapshot: CurrentBalanceSnapshot, programs: RecoveryPrograms, attemptedAt: Date, deadline = Date.now() + 15_000, namespaces: readonly ProgramNamespace[] = PROGRAM_NAMESPACES): Promise<boolean> {
  validatePrograms(programs); assertFreshObservation(snapshot);
  const namespace=namespaceForPrograms(programs,validateNamespaceRegistry(namespaces));
  if(!namespace || snapshot.basketState.factory!==namespace.factoryConfig)throw new CurrentBalanceSnapshotError("unregistered-snapshot-namespace");
  if (snapshot.historyComplete !== false || JSON.stringify(snapshot.programIds) !== JSON.stringify([...programs.ids].sort(ordinal)) ||
    !Number.isSafeInteger(snapshot.slot) || snapshot.slot < 0 || !/^[a-f0-9]{64}$/.test(snapshot.accountsDigest) ||
    !Number.isSafeInteger(snapshot.accountCount) || snapshot.accountCount < 0 || snapshot.accountCount > MAX_CANDIDATES ||
    snapshot.candidateAccounts.length !== snapshot.accountCount || new Set(snapshot.candidateAccounts).size !== snapshot.accountCount ||
    !/^(0|[1-9]\d*)$/.test(snapshot.supply) || BigInt(snapshot.supply) > U64_MAX ||
    !Number.isFinite(attemptedAt.getTime())) throw new CurrentBalanceSnapshotError("invalid-snapshot-evidence");
  const seenOwners = new Set<string>(); let total = 0n;
  for (const balance of snapshot.balances) {
    key(balance.user);
    if (seenOwners.has(balance.user) || !/^[1-9]\d*$/.test(balance.shares) || BigInt(balance.shares) > U64_MAX) throw new CurrentBalanceSnapshotError("invalid-snapshot-evidence");
    seenOwners.add(balance.user); total += BigInt(balance.shares);
  }
  if (total !== BigInt(snapshot.supply)) throw new CurrentBalanceSnapshotError("invalid-snapshot-evidence");
  snapshot.candidateAccounts.forEach(value => key(value));
  return snapshotTransaction(db, deadline, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`positions:${snapshot.basketState.pubkey}`]);
    await assertBasketProjectionMatches(client, snapshot.basketState);
    assertFreshObservation(snapshot);
    const prior = (await client.query("SELECT slot::text FROM current_balance_snapshots WHERE basket=$1 FOR UPDATE", [snapshot.basketState.pubkey])).rows[0];
    if (prior?.slot != null && BigInt(prior.slot) > BigInt(snapshot.slot)) throw new CurrentBalanceSnapshotError("snapshot-slot-regression");
    assertFreshObservation(snapshot);
    const result = await client.query(`INSERT INTO current_balance_snapshots(basket,slot,supply,balances,accounts_digest,account_count,candidate_accounts,observed_at,attempted_at,status,reason,history_complete,program_ids)
      VALUES($1,$2,$3,$4,$5,$6,$7,$10,$8,'verified',NULL,false,$9)
      ON CONFLICT(basket) DO UPDATE SET slot=EXCLUDED.slot,supply=EXCLUDED.supply,balances=EXCLUDED.balances,accounts_digest=EXCLUDED.accounts_digest,
      account_count=EXCLUDED.account_count,candidate_accounts=EXCLUDED.candidate_accounts,observed_at=EXCLUDED.observed_at,attempted_at=EXCLUDED.attempted_at,status='verified',reason=NULL,history_complete=false,program_ids=EXCLUDED.program_ids
      WHERE current_balance_snapshots.attempted_at<EXCLUDED.attempted_at RETURNING basket`, [snapshot.basketState.pubkey, String(snapshot.slot), snapshot.supply,
      JSON.stringify(snapshot.balances), snapshot.accountsDigest, snapshot.accountCount, JSON.stringify(snapshot.candidateAccounts), attemptedAt, [...programs.ids].sort(ordinal), snapshot.observedAt]);
    return result.rows.length === 1;
  });
}

// Expose only transport codes owned by our read-only adapter, never provider
// messages, endpoints, request bodies or arbitrary error.code values.
const RPC_FAILURE_CODES = new Set(["rpc-queue-deadline", "rpc-queue-full", "rpc-request-deadline", "rpc-request-aborted",
  "rpc-transport-unavailable", "rpc-response-too-large", "rpc-response-body-unavailable", "rpc-invalid-json", "rpc-response-identity-mismatch"]);
function snapshotFailureReason(error: unknown): string {
  if (error instanceof CurrentBalanceSnapshotError) return error.code;
  if (error instanceof RpcReadError && (RPC_FAILURE_CODES.has(error.code) || /^rpc-http-[1-5]\d{2}$/.test(error.code))) return error.code;
  return "snapshot-read-or-storage-unavailable";
}

const passCursors = new WeakMap<PgLike, Map<string,number>>();
export async function syncCurrentBalanceSnapshots(rpc: CurrentBalanceRpc, db: PgLike, programs: RecoveryPrograms,
  options: { maxBasketsPerPass?: number; passDeadlineMs?: number; backoffSleep?: (ms: number) => Promise<void>; namespaces?:readonly ProgramNamespace[] } = {},
): Promise<{ attempted: number; verified: number; incomplete: number; deferred: number }> {
  validatePrograms(programs);
  const maxBaskets = options.maxBasketsPerPass ?? 10, passDuration = options.passDeadlineMs ?? 30_000;
  if (!Number.isSafeInteger(maxBaskets) || maxBaskets < 1 || maxBaskets > 10 || !Number.isSafeInteger(passDuration) || passDuration < 1 || passDuration > 60_000) throw new CurrentBalanceSnapshotError("invalid-pass-budget");
  const namespace=namespaceForPrograms(programs,validateNamespaceRegistry(options.namespaces??PROGRAM_NAMESPACES));
  if(!namespace)throw new CurrentBalanceSnapshotError("unregistered-snapshot-namespace");
  const passDeadline = Date.now() + passDuration;
  const baskets = (await snapshotTransaction(db, passDeadline, client => client.query("SELECT pubkey,factory FROM baskets WHERE factory=$1 ORDER BY pubkey LIMIT 101",[namespace.factoryConfig]))).rows;
  if (baskets.length > 100) throw new CurrentBalanceSnapshotError("basket-limit-exceeded");
  const stats = { attempted: 0, verified: 0, incomplete: 0, deferred: 0 };
  const cursors=passCursors.get(db)??new Map<string,number>();passCursors.set(db,cursors);
  const start = (cursors.get(namespace.id) ?? 0) % Math.max(1, baskets.length);
  for (let index = 0; index < Math.min(maxBaskets, baskets.length); index++) {
    if (Date.now() >= passDeadline) break;
    const offset = (start + index) % baskets.length, row = baskets[offset];
    cursors.set(namespace.id, (offset + 1) % baskets.length);
    const attemptedAt = new Date(); stats.attempted++;
    const remaining = () => Math.min(10_000, Math.max(1, passDeadline - Date.now()));
    try {
      if(row.factory!==namespace.factoryConfig)throw new CurrentBalanceSnapshotError("snapshot-namespace-factory-mismatch");
      await verifyNetwork(rpc, Math.min(passDeadline, Date.now() + 10_000), options.backoffSleep);
      const account = await retryRead(() => rpc.getAccountInfoAndContext(key(row.pubkey), { commitment: "finalized" }), Math.min(passDeadline, Date.now() + 10_000), options.backoffSleep);
      slot(account.context); if (!account.value) throw new CurrentBalanceSnapshotError("basket-unavailable");
      const state = decodeBasketState(row.pubkey, account.value, programs);
      let candidates = await discoverCurrentBalanceCandidates(db, row.pubkey, state, passDeadline), snapshot: CurrentBalanceSnapshot;
      try { snapshot = await readCurrentBalanceSnapshot(rpc, row.pubkey, programs, candidates, { deadlineMs: remaining(), preparedBasket: account, backoffSleep: options.backoffSleep }); }
      catch (error) {
        if (!(error instanceof CurrentBalanceSnapshotError) || error.code !== "share-supply-coverage-incomplete") throw error;
        candidates = await expandTransactionHints(rpc, db, row.pubkey, programs, candidates, passDeadline, options.backoffSleep);
        snapshot = await readCurrentBalanceSnapshot(rpc, row.pubkey, programs, candidates, { deadlineMs: remaining(), preparedBasket: account, backoffSleep: options.backoffSleep });
      }
      if (await persistCurrentBalanceSnapshot(db, snapshot, programs, attemptedAt, passDeadline, options.namespaces??PROGRAM_NAMESPACES)) stats.verified++;
    } catch (error) {
      stats.incomplete++;
      await failSnapshot(db, row.pubkey, programs, attemptedAt, snapshotFailureReason(error), Math.max(passDeadline, Date.now() + 1_000));
    }
  }
  stats.deferred = baskets.length - stats.attempted;
  return stats;
}
