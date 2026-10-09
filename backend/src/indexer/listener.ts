import { createReadOnlyRpcConnection, guardedRpcFetch } from "../rpc/requestBudget.js";
import { readIndexerGenesisHash } from "./rpcIdentity.js";
import { PROGRAM_NAMESPACES, namespaceForProgram, namespaceProgramIds, registeredProgramIds,
  validateNamespaceRegistry, type ProgramNamespace } from "../config/programNamespaces.js";
/**
 * indexer/listener.ts — read-only event indexer for the three Basalt programs.
 *
 * Polls `getSignaturesForAddress` across the closed namespace union, authenticates
 * the optional PROGRAM_* role selector, and fetches each transaction, decodes the four
 * Anchor CPI events (BasketCreated / Minted / Redeemed / FeeAccrued) from
 * `Program data:` logs via the sha256("event:<Name>") discriminator matcher in
 * ./events.ts, and upserts them into the `events` table — plus a full
 * `baskets` row when a BasketCreated event carries a decodable
 * `create_basket` instruction. Missing older creations are recovered from the
 * authenticated immutable Basket account before downstream event inserts.
 *
 * SAFETY: this module is strictly read-only against RPC (AGENTS.md §2 #5).
 * It never signs, never holds keys, and never blocks on-chain flows: when
 * Postgres or RPC are absent it degrades to null-DB / no-op polling.
 *
 * INTEGER-SAFETY CONVENTION: u64 fields ride inside `data` JSONB and the
 * baskets upsert as decimal STRINGS (see ./events.ts). `nonce` is bound to a
 * BIGINT column from a string parameter — never a JS number.
 */
import { PublicKey, type AccountInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { connectFromEnv, isPgLike, withTransaction, type PgLike } from "../db/client.js";
import { syncIndexedBaskets } from "./holdingsSync.js";
import {
  decodeAnchorEvent,
  decodeCreateBasketIx,
  extractAttributedProgramDataLogs,
  matchAnchorEvent,
  type CreateBasketArgs,
  type DecodedFolioxEvent,
  type FolioxEventType,
} from "./events.js";
import { applyPositionEvent, markPositionRebuildRequired, PositionProjectionGapError, PositionRebuildRequiredError } from "./positions.js";
import { syncCurrentBalanceSnapshots, type CurrentBalanceRpc } from "./currentBalanceSnapshot.js";
import { syncPositionsFromChain, type JsonRpcInvoker, type PositionsSyncRpc } from "./positionsSync.js";
import { syncWhitelistedMints, type WhitelistRpc } from "./whitelistSync.js";
import { createPacer, rateLimitedWarn, withRpcBackoff, type Pacer } from "../rpc/backoff.js";
import { DurableHistory } from "./history.js";
import { BasketStateDecodeError, decodeBasketState, decodeFactoryTreasuryState } from "./basketState.js";

/** Minimal structural slice of @solana/web3.js Connection used here. */
export interface SolanaRpc {
  getSignaturesForAddress(
    address: PublicKey,
    options?: { limit?: number; before?: string; until?: string; minContextSlot?: number },
    commitment?: "finalized",
  ): Promise<Array<{ signature: string; slot: number; err: unknown; blockTime?: number | null }>>;
  getParsedTransaction(
    signature: string,
    config?: { maxSupportedTransactionVersion?: number; commitment?: "finalized" },
  ): Promise<ParsedTransactionWithMeta | null>;
  getAccountInfo(address: PublicKey): Promise<AccountInfo<Buffer> | null>;
  // web3.js 1.98 getBlock cannot decode signatures mode. This public method
  // invokes getBlock(transactionDetails:'signatures', rewards:false) correctly.
  getBlockSignatures?(slot: number, commitment?: "finalized"): Promise<{ signatures: string[] }>;
  getSlot?(commitment?: "finalized"): Promise<number>;
}

/**
 * Structural slice for the periodic on-chain state syncs (whitelisted_mints +
 * vault_holdings). A real web3 Connection satisfies it; hand-rolled test RPCs
 * may omit these methods — the syncs no-op when they are missing.
 */
export interface ChainStateRpc extends SolanaRpc {
  getProgramAccounts: WhitelistRpc["getProgramAccounts"];
  getMultipleAccountsInfo(
    keys: PublicKey[],
    commitment?: unknown,
  ): Promise<Array<AccountInfo<Buffer> | null>>;
}

export interface IndexerConfig {
  programIds: string[];
  /** Source-controlled trust roots; isolated registries are injected only by tests. */
  namespaces?: readonly ProgramNamespace[];
  /** Verified read-only RPC identity captured at environment startup. */
  genesisHash?: string;
  /** Required in env-created production indexers. Tests may exercise the DB-less decoder. */
  durableHistory?: boolean;
  historyPagesPerPoll?: number;
  /** Persist canonical logs without changing position projections (migration replay). */
  replayOnly?: boolean;
  pollIntervalMs: number;
  signaturesPerPoll: number;
  maxSeenCache: number;
  /**
   * PROGRAM_WHITELIST — enables the periodic on-chain WhitelistedMint →
   * whitelisted_mints sync (price_source labels for the NAV engine).
   */
  whitelistProgramId?: string;
  /** PROGRAM_BASKET — enables the periodic vault_holdings refresh pass. */
  basketProgramId?: string;
  /** PROGRAM_FACTORY — authenticates creation logs and recovered Basket PDAs. */
  factoryProgramId?: string;
  /** Minimum spacing for signature/transaction/account reads (default 400ms). */
  transactionSpacingMs?: number;
  /**
   * vault_holdings refresh cadence override (env HOLDINGS_SYNC_INTERVAL_MS on
   * the devnet profile; schema §7 default stays 30s). Lower request pressure
   * against the shared public RPC without changing the default profile.
   */
  holdingsSyncIntervalMs?: number;
  /**
   * Chain-truth user_positions reconciliation cadence (env POSITIONS_SYNC_MS,
   * default 120s). Reads each indexed basket's share-mint token accounts via
   * getProgramAccounts and upserts user_positions from ACTUAL balances — the
   * durable fix for Minted/Redeemed events lost to log truncation on
   * N-constituent baskets.
   */
  positionsSyncIntervalMs?: number;
  /** Legacy injected test surface; production holder reads use authenticated raw snapshots. */
  jsonRpcInvoke?: JsonRpcInvoker;
  /**
   * Minimum spacing between sequential RPC reads inside the periodic state
   * syncs — spreads a mint-facts batch over time instead of bursting it
   * (bursty sequential reads were the main 429 trigger on public devnet).
   */
  stateSyncSpacingMs?: number;
  /**
   * Injectable sleep for the shared 429 backoff (tests: instant). Defaults to
   * the real timer — production waits exponential-with-jitter, 60s cap.
   */
  backoffSleep?: (ms: number) => Promise<void>;
}

/** WhitelistedMint account sync cadence (schema §7: whitelist is slow-moving). */
const WHITELIST_SYNC_INTERVAL_MS = 60_000;
/** vault_holdings refresh cadence (schema §7: "updated every 30s or on event"). */
const HOLDINGS_SYNC_INTERVAL_MS = 30_000;
/**
 * Chain-truth user_positions reconciliation cadence (env POSITIONS_SYNC_MS).
 * 120s: positions drift rarely, each pass costs one getProgramAccounts per
 * indexed basket, and devnet RPC headroom is scarce.
 */
const POSITIONS_SYNC_INTERVAL_MS = 120_000;
/**
 * Spacing between sequential RPC reads in the periodic state syncs (the
 * holdings pass reads mint facts one getAccountInfo at a time — spacing turns
 * that burst into a gentle stream, which is what public devnet 429s on).
 */
const STATE_SYNC_SPACING_MS = 100;
/** Leave public-RPC headroom for the independent NAV and state workers. */
const TRANSACTION_SPACING_MS = 400;
class CanonicalLogsIncompleteError extends Error {}
class NamespaceProjectionError extends Error {
  constructor(message: string, readonly emitters: string[] = []) { super(message); }
}

type SignatureInfo = Awaited<ReturnType<SolanaRpc["getSignaturesForAddress"]>>[number];

export const DEFAULT_INDEXER_CONFIG: IndexerConfig = {
  programIds: [],
  pollIntervalMs: 15_000,
  signaturesPerPoll: 50,
  maxSeenCache: 10_000,
  holdingsSyncIntervalMs: HOLDINGS_SYNC_INTERVAL_MS,
  positionsSyncIntervalMs: POSITIONS_SYNC_INTERVAL_MS,
  stateSyncSpacingMs: STATE_SYNC_SPACING_MS,
  transactionSpacingMs: TRANSACTION_SPACING_MS,
};

export interface EventRow {
  sig: string;
  /** Actual index in the transaction runtime log array. */
  logIndex: number;
  slot: number;
  basket: string | null;
  type: FolioxEventType;
  /** Decoded event; u64 values are decimal strings (BIGINT-safe JSONB). */
  data: Record<string, unknown>;
  ts: Date;
}

export interface BasketUpsert {
  pubkey: string;
  factory: string;
  creator: string;
  treasury: string;
  shareMint: string;
  /** u64 as decimal string — bound to BIGINT via string parameter. */
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
}

export interface PollResult {
  programId: string;
  signaturesSeen: number;
  events: DecodedFolioxEvent[];
}

// --- DB writers (no-op with a warn when db is null — DB-less degrade) -------

/** Insert one event row. Returns true only when the row was newly inserted. */
export async function insertEvent(db: PgLike | null | undefined, row: EventRow): Promise<boolean> {
  if (!isPgLike(db)) {
    console.warn("[indexer] insertEvent skipped (no DB):", row.sig, row.type);
    return false;
  }
  if (!Number.isSafeInteger(row.logIndex) || row.logIndex < 0) throw new Error("Event requires actual runtime log index");
  const res = await db.query(
    `INSERT INTO events (sig, slot, basket, type, data, ts, log_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (sig, log_index) DO NOTHING`,
    [row.sig, row.slot, row.basket, row.type, JSON.stringify(row.data), row.ts, row.logIndex],
  );
  return res.rowCount === 1;
}

/** Bulk helper — number of rows actually inserted. */
export async function insertEvents(db: PgLike | null | undefined, rows: EventRow[]): Promise<number> {
  let inserted = 0;
  for (const row of rows) if (await insertEvent(db, row)) inserted++;
  return inserted;
}

/**
 * Upsert the immutable `baskets` row from a BasketCreated event + decoded
 * create_basket args. Baskets never change, so ON CONFLICT DO NOTHING.
 */
export async function upsertBasketFromCreation(
  db: PgLike | null | undefined,
  basket: BasketUpsert,
): Promise<boolean> {
  if (!isPgLike(db)) {
    console.warn("[indexer] upsertBasket skipped (no DB):", basket.pubkey);
    return false;
  }
  const res = await db.query(
    `INSERT INTO baskets (
       pubkey, factory, creator, treasury, share_mint, nonce, created_at,
       metadata_hash, num_constituents, constituents, weights_bps,
       entry_fee_bps, exit_fee_bps, management_fee_bps, last_fee_accrual_ts
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (pubkey) DO NOTHING`,
    [
      basket.pubkey,
      basket.factory,
      basket.creator,
      basket.treasury,
      basket.shareMint,
      basket.nonce, // string → BIGINT (integer-safe)
      basket.createdAt,
      basket.metadataHash,
      basket.numConstituents,
      basket.constituents,
      basket.weightsBps,
      basket.entryFeeBps,
      basket.exitFeeBps,
      basket.managementFeeBps,
      basket.lastFeeAccrualTs,
    ],
  );
  return res.rowCount === 1;
}

/** Count a new basket for the creator (spec §9 creator_stats.basket_count). */
export async function incrementCreatorStats(db: PgLike | null | undefined, creator: string): Promise<void> {
  if (!isPgLike(db)) return; // silent: stats are optional in DB-less mode
  await db.query(
    `INSERT INTO creator_stats (creator, basket_count)
     SELECT $1, COUNT(*) FROM baskets WHERE creator=$1
     ON CONFLICT (creator) DO UPDATE
       SET basket_count = EXCLUDED.basket_count, updated_at = NOW()`,
    [creator],
  );
}

// --- indexer ----------------------------------------------------------------

function buildBasketUpsert(
  event: Extract<DecodedFolioxEvent, { type: "BasketCreated" }>,
  factory: string,
  args: CreateBasketArgs,
  treasury: string,
): BasketUpsert {
  const createdAt = new Date(event.ts * 1000);
  return {
    pubkey: event.basket,
    factory,
    creator: event.creator,
    treasury,
    shareMint: event.shareMint,
    nonce: args.nonce,
    createdAt,
    metadataHash: args.metadataHashHex,
    numConstituents: event.numConstituents,
    constituents: args.constituents,
    weightsBps: args.weightsBps,
    entryFeeBps: args.entryFeeBps,
    exitFeeBps: args.exitFeeBps,
    managementFeeBps: args.managementFeeBps,
    lastFeeAccrualTs: createdAt,
  };
}

export class EventIndexer {
  private readonly seen = new Set<string>();
  /** Per-signature processing attempts (failed sigs are retried, not dropped). */
  private readonly attempts = new Map<string, number>();
  /** Failed reads remain retryable even after leaving the newest-signature page. */
  private readonly pending = new Map<string, { programId: string; info: SignatureInfo }>();
  private readonly knownBaskets = new Map<string, string | undefined>();
  private readonly namespaces: readonly ProgramNamespace[] | null;
  private readonly completedNamespaceSlots = new Map<string, number>();
  private readonly factoryTreasuries = new Map<string, string>();
  private readonly attemptedThisPoll = new Set<string>();
  private readonly rpcPacer: Pacer;
  private readonly history: DurableHistory | null;
  private readonly finalizedBlocks = new Map<number, string[]>();
  private completedDiscoverySlot: number | null = null;
  private completedDiscoveryAt: string | null = null;
  private discoveryGeneration = 0;
  private collection = { lastAttemptAt:null as string|null,lastCompletedAt:null as string|null,collectedTransactions:0,blockedReason:null as string|null };
  get collectionEvidence() { return { ...this.collection, positionPublicationEnabled:!this.cfg.replayOnly }; }

  /** Fresh successful discovery in the latest durable poll only; busy/failure resets it. */
  get lastCompletedDiscoverySlot(): number | null { return this.completedDiscoverySlot; }
  get readinessEvidence() {
    return { programIds: [...this.cfg.programIds], genesisHash: this.cfg.genesisHash ?? null,
      finalizedSlot: this.completedDiscoverySlot, completedAt: this.completedDiscoveryAt };
  }
  private lastDiscoveryMs = 0;
  private lastWhitelistSyncMs = 0;
  private lastHoldingsSyncMs = 0;
  private lastPositionsSyncMs = 0;
  private lastCurrentBalancesMs = 0;
  /**
   * Events NOT indexed because their transaction failed on-chain — either at
   * the signature level (getSignaturesForAddress err) or in the fetched meta
   * (tx.meta.err, the partial-CPI-logs case). A reverted tx must never mint
   * Minted/Redeemed/FeeAccrued/BasketCreated rows out of its leftover logs.
   */
  private failedTxSkips = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly rpc: SolanaRpc,
    private readonly cfg: IndexerConfig,
    private readonly db: PgLike | null = null,
  ) {
    // Durable production and maintenance callers cannot select arbitrary trust roots.
    // A registered complete trio remains accepted for per-basket recovery, while
    // collection always covers the entire reviewed union exactly once.
    this.namespaces = cfg.namespaces ? validateNamespaceRegistry(cfg.namespaces) :
      cfg.durableHistory && isPgLike(db) ? PROGRAM_NAMESPACES : null;
    if (this.namespaces) {
      const requested = [...cfg.programIds].sort(), union = registeredProgramIds(this.namespaces);
      const exact = (ids: string[]) => JSON.stringify(requested) === JSON.stringify(ids);
      if (!exact(union) && !this.namespaces.some(namespace => exact(namespaceProgramIds(namespace)))) {
        throw new Error("Durable indexer programs must match a registered namespace or the closed union");
      }
      const roles = [cfg.whitelistProgramId, cfg.factoryProgramId, cfg.basketProgramId];
      if (roles.some(value => value !== undefined) && !this.namespaces.some(namespace =>
        roles[0] === namespace.programs.whitelist && roles[1] === namespace.programs.factory && roles[2] === namespace.programs.basket)) {
        throw new Error("Indexer roles must match one complete registered namespace");
      }
      this.cfg = { ...cfg, programIds: union, namespaces: this.namespaces };
    }
    this.history = cfg.durableHistory && isPgLike(db) ? new DurableHistory(db) : null;
    if (this.history && typeof db?.connect !== "function") throw new Error("Durable indexer requires a PostgreSQL pool");
    this.rpcPacer = createPacer(cfg.transactionSpacingMs ?? TRANSACTION_SPACING_MS, { sleep: cfg.backoffSleep });
  }

  /** Mark a signature processed, bounding the in-memory cache. */
  private markSeen(sig: string): void {
    this.seen.add(sig);
    this.pending.delete(sig);
    this.attempts.delete(sig);
    if (this.seen.size > this.cfg.maxSeenCache) {
      const it = this.seen.values();
      for (let i = 0; i < this.cfg.maxSeenCache / 2; i++) {
        const oldest = it.next().value;
        if (oldest === undefined) break;
        this.seen.delete(oldest);
      }
    }
  }

  /**
   * One poll pass across all configured programs. Decoded events are returned
   * so callers can inspect them even in DB-less mode (db === null). After the
   * signature sweep, the periodic on-chain state syncs run (whitelisted_mints
   * from WhitelistedMint accounts, vault_holdings for indexed baskets).
   */
  async pollOnce(): Promise<PollResult[]> {
    this.attemptedThisPoll.clear();
    const results: PollResult[] = this.history ? await this.pollDurableHistory() : [];
    if (!this.history) for (const programId of this.cfg.programIds) results.push(await this.pollProgram(programId));
    if (!this.cfg.replayOnly) await this.syncChainState();
    return results;
  }

  /**
   * Periodic (throttled) sync of account state that events alone cannot carry:
   *   1. whitelisted_mints ← on-chain WhitelistedMint accounts (price_source).
   *   2. vault_holdings ← basket PDA vault ATAs for every indexed basket.
   *   3. user_positions ← share-mint token accounts for every indexed basket
   *      (chain-truth reconciliation; heals balances whose Minted/Redeemed
   *      events were lost to log truncation).
   * Whitelist rows land BEFORE holdings rows because vault_holdings.mint carries
   * a FK to whitelisted_mints. Every failure is contained — a broken sync never
   * breaks the event poll loop.
   */
  private async syncChainState(): Promise<void> {
    if (!isPgLike(this.db)) return;
    const full = this.rpc as ChainStateRpc;
    if (typeof full.getProgramAccounts !== "function") return;
    const now = Date.now(), spacing = this.cfg.stateSyncSpacingMs ?? STATE_SYNC_SPACING_MS;
    const routes = this.namespaces ?? (this.cfg.basketProgramId && this.cfg.factoryProgramId ? [{
      id: "diagnostic", programs: { basket: this.cfg.basketProgramId, factory: this.cfg.factoryProgramId, whitelist: this.cfg.whitelistProgramId },
    }] : []);
    const options = this.namespaces ? { namespaces: this.namespaces } : {};
    if (now - this.lastDiscoveryMs >= 300_000) {
      this.lastDiscoveryMs = now;
      for (const route of routes) try {
        const accounts = await this.pacedRead(() => full.getProgramAccounts(new PublicKey(route.programs.basket), { commitment: "finalized", filters: [{ dataSize: 888 }] }));
        for (const account of accounts) try {
          const state = decodeBasketState(account.pubkey.toBase58(), account.account, { basket: new PublicKey(route.programs.basket), factory: new PublicKey(route.programs.factory) });
          if (await this.fetchTreasury(state.factory, route.programs.factory) !== state.treasury) throw new Error("factory treasury mismatch");
          await upsertBasketFromCreation(this.db, state);
          this.rememberBasket(state.pubkey, route.id);
          await incrementCreatorStats(this.db, state.creator);
        } catch (error) { console.warn("[indexer] basket discovery rejected account", account.pubkey.toBase58(), error instanceof Error ? error.message : error); }
      } catch (error) { console.warn("[indexer] basket discovery failed", route.id, error instanceof Error ? error.message : error); }
    }
    if (now - this.lastWhitelistSyncMs >= WHITELIST_SYNC_INTERVAL_MS) {
      this.lastWhitelistSyncMs = now;
      const whitelistPrograms = this.namespaces ? this.namespaces.map(route => route.programs.whitelist) : this.cfg.whitelistProgramId ? [this.cfg.whitelistProgramId] : [];
      for (const program of whitelistPrograms) try {
        const n = await syncWhitelistedMints(full, program, this.db, options);
        if (n > 0) console.log(`[indexer] whitelist sync: ${n} mints upserted`);
      } catch (error) { console.warn("[indexer] whitelist sync failed:", error instanceof Error ? error.message : error); }
    }
    if (now - this.lastHoldingsSyncMs >= (this.cfg.holdingsSyncIntervalMs ?? HOLDINGS_SYNC_INTERVAL_MS)) {
      this.lastHoldingsSyncMs = now;
      try {
        const n = await syncIndexedBaskets(full, this.db, { spacingMs: spacing, ...options });
        if (n > 0) console.log(`[indexer] holdings sync: ${n} baskets refreshed`);
      } catch (error) { console.warn("[indexer] holdings sync failed:", error instanceof Error ? error.message : error); }
    }
    if (typeof (full as unknown as CurrentBalanceRpc).getMultipleAccountsInfoAndContext === "function" && now - this.lastCurrentBalancesMs >= 60_000) {
      this.lastCurrentBalancesMs = now;
      for (const route of routes) try {
        const ids = this.namespaces ? namespaceProgramIds(route as ProgramNamespace) : this.cfg.programIds;
        const stats = await syncCurrentBalanceSnapshots(full as unknown as CurrentBalanceRpc, this.db, {
          basket: new PublicKey(route.programs.basket), factory: new PublicKey(route.programs.factory), ids,
        }, options);
        console.log("[indexer] independent finalized current balance verification:", route.id, JSON.stringify(stats));
      } catch { console.warn("[indexer] current balance verification unavailable; history guards remain active"); }
    }
    if (now - this.lastPositionsSyncMs >= (this.cfg.positionsSyncIntervalMs ?? POSITIONS_SYNC_INTERVAL_MS)) {
      this.lastPositionsSyncMs = now;
      for (const route of routes) try {
        const ids = this.namespaces ? namespaceProgramIds(route as ProgramNamespace) : this.cfg.programIds;
        const stats = await syncPositionsFromChain(full as unknown as PositionsSyncRpc, this.db, {
          spacingMs: spacing, backoffSleep: this.cfg.backoffSleep, jsonRpcInvoke: this.cfg.jsonRpcInvoke, ...options,
          programs: { basket: new PublicKey(route.programs.basket), factory: new PublicKey(route.programs.factory), ids },
          catchUpThroughSlot: async requiredSlot => {
            if (!this.history) throw new Error("Finalized reconciliation requires durable canonical discovery");
            await this.pollDurableHistory();
            const completed = this.namespaces ? this.completedNamespaceSlots.get(route.id) : this.lastCompletedDiscoverySlot;
            if (completed === undefined || completed === null || completed < requiredSlot) throw new Error("Canonical discovery could not reach finalized snapshot slot within this poll budget");
          },
        });
        if (stats.basketsScanned > 0) console.log(`[indexer] positions sync (${route.id}): ${stats.holders} holders across ${stats.basketsScanned} baskets (${stats.basketsFailed} failed)`);
      } catch (error) { console.warn("[indexer] positions sync failed:", route.id, error instanceof Error ? error.message : error); }
    }
  }

  /** Discover every program before globally ordered effects; no signature sorting guesses. */
  private async discoverProgram(programId: string, watermark: number): Promise<boolean> {
    const pageBudget = Math.max(1,Math.min(10,this.cfg.historyPagesPerPoll ?? 2));
    try {
      for (let i=0;i<pageBudget;i++) {
        const state = await this.history!.state(programId);
        const page = await withRpcBackoff(() => this.pacedRead(() => this.rpc.getSignaturesForAddress(new PublicKey(programId), {
          limit:this.cfg.signaturesPerPoll,minContextSlot:watermark,
          ...(state.scan_before ? {before:state.scan_before} : {}),
          ...((state.scan_until ?? state.head_signature) ? {until:(state.scan_until ?? state.head_signature)!} : {}),
        },"finalized")), {logKey:"indexer:getSignaturesForAddress",sleep:this.cfg.backoffSleep});
        if (await this.history!.savePage(state,page,this.cfg.signaturesPerPoll,this.cfg.programIds)) {
          // A resumed scan has an older head. Finish a fresh catch-up scan before
          // effects, or another program could expose a newer event first.
          if (state.scan_before === null && state.scan_head === null) return true;
        }
      }
    } catch(error) { console.warn(`[indexer] history discovery failed for ${programId}:`,error instanceof Error ? error.message : error); }
    return false;
  }

  private async pollDurableHistory(): Promise<PollResult[]> {
    this.completedDiscoverySlot = null;
    this.completedDiscoveryAt = null;
    this.completedNamespaceSlots.clear();
    const generation = ++this.discoveryGeneration;
    return this.history!.withPollLock(() => this.drainDurableHistory(generation),this.cfg.programIds.map(programId => ({programId,signaturesSeen:0,events:[]})));
  }

  private async drainDurableHistory(generation: number): Promise<PollResult[]> {
    const results = new Map(this.cfg.programIds.map(programId => [programId,{programId,signaturesSeen:0,events:[] as DecodedFolioxEvent[]}]));
    if (!this.rpc.getSlot) throw new Error("Durable history requires a finalized slot watermark");
    const watermark = await withRpcBackoff(() => this.pacedRead(() => this.rpc.getSlot!("finalized")),{logKey:"indexer:getSlot",sleep:this.cfg.backoffSleep});
    if (!Number.isSafeInteger(watermark) || watermark < 0) throw new Error("Invalid finalized slot watermark");
    const discovered = new Set<string>();
    for (const program of this.cfg.programIds) {
      if (await this.discoverProgram(program, watermark)) {
        await this.history!.markVerifiedThrough(program, watermark);
        discovered.add(program);
      }
    }
    const eligible = new Set<string>();
    if (this.namespaces) {
      for (const namespace of this.namespaces) {
        const ids = namespaceProgramIds(namespace);
        if (!ids.every(id => discovered.has(id))) continue;
        if (generation === this.discoveryGeneration) this.completedNamespaceSlots.set(namespace.id, watermark);
        if (!await this.history!.hasQuarantined(ids)) eligible.add(namespace.id);
      }
    }
    if (discovered.size === this.cfg.programIds.length && generation === this.discoveryGeneration) {
      this.completedDiscoverySlot = watermark;
      this.completedDiscoveryAt = new Date().toISOString();
    }
    const activePrograms = () => this.namespaces ? this.namespaces.filter(namespace => eligible.has(namespace.id)).flatMap(namespaceProgramIds) : this.cfg.programIds;
    if (!this.namespaces && discovered.size !== this.cfg.programIds.length) return [...results.values()];
    const quarantined = await this.history!.hasQuarantined(this.cfg.programIds);
    if (quarantined) this.collection.blockedReason = "quarantined-history";
    if (!this.namespaces && quarantined) {
      if (!this.cfg.replayOnly) await this.collectRecoveryFacts(watermark);
      return [...results.values()];
    }
    let projectionBlocked=false;
    const budget = Math.max(1,Math.min(1000,this.cfg.signaturesPerPoll));
    for (let i=0;i<budget;i++) {
      let info = await this.history!.nextPendingGlobal(activePrograms());
      if (!info || info.slot > watermark) break;
      if (!this.cfg.replayOnly && await this.history!.projectionBlocked(this.cfg.programIds,info.signature)) {
        this.collection.blockedReason="position-rebuild-required";
        projectionBlocked=true;
        const namespace = namespaceForProgram(info.programId, this.namespaces ?? [])?.namespace;
        if (!namespace) break;
        eligible.delete(namespace.id);
        continue;
      }
      try {
        if (info.txIndex === null) {
          let signatures = this.finalizedBlocks.get(info.slot);
          if (!signatures) {
            if (!this.rpc.getBlockSignatures) throw new Error("Durable history requires finalized block transaction ordering");
            const block = await withRpcBackoff(() => this.pacedRead(() => this.rpc.getBlockSignatures!(info!.slot,"finalized")), {logKey:"indexer:getBlockSignatures",sleep:this.cfg.backoffSleep});
            if (!block?.signatures) throw new Error("Finalized block unavailable; canonical transaction order retained for retry");
            signatures = block.signatures;
            // Validate before caching; malformed or incomplete block lists never unlock effects.
            await this.history!.assignTransactionIndices(this.cfg.programIds,info.slot,signatures);
            this.finalizedBlocks.set(info.slot,signatures);
            if (this.finalizedBlocks.size > 32) this.finalizedBlocks.delete(this.finalizedBlocks.keys().next().value!);
          } else await this.history!.assignTransactionIndices(this.cfg.programIds,info.slot,signatures);
          info = await this.history!.nextPendingGlobal(activePrograms());
          if (!info || info.txIndex === null) throw new Error("Queued signature missing from canonical finalized block");
        }
        const processed = await this.processSignatures(info.programId,[info],true,false,eligible);
        const result = results.get(info.programId)!;
        result.signaturesSeen += processed.signaturesSeen; result.events.push(...processed.events);
        if (processed.blocked) {
          projectionBlocked ||= await this.history!.projectionBlocked(this.cfg.programIds,info.signature);
          const namespace = namespaceForProgram(info.programId, this.namespaces ?? [])?.namespace;
          if (!namespace) break;
          eligible.delete(namespace.id);
          for (const other of this.namespaces!) if (await this.history!.hasQuarantined(namespaceProgramIds(other))) eligible.delete(other.id);
        }
      } catch(error) {
        if (info) await this.history!.retryGlobal(this.cfg.programIds,info.signature,error);
        rateLimitedWarn("indexer:global-order",`[indexer] global history retained for retry: ${error instanceof Error ? error.message : String(error)}`);
        const namespace = info && namespaceForProgram(info.programId, this.namespaces ?? [])?.namespace;
        if (!namespace) break;
        eligible.delete(namespace.id);
      }
    }
    if (!this.cfg.replayOnly && (projectionBlocked || quarantined)) await this.collectRecoveryFacts(watermark);
    return [...results.values()];
  }

  /** Bounded evidence work past blocked projections; active balances stay untouched. */
  private async collectRecoveryFacts(watermark:number):Promise<void> {
    this.collection.lastAttemptAt=new Date().toISOString();
    const budget=Math.max(1,Math.min(5,this.cfg.signaturesPerPoll));
    for(let i=0;i<budget;i++) {
      let info=await this.history!.nextUncollectedGlobal(this.cfg.programIds);
      if(!info || info.slot>watermark) { this.collection.lastCompletedAt=new Date().toISOString(); return; }
      try {
        if(info.txIndex===null) {
          if(!this.rpc.getBlockSignatures) throw new Error("Canonical evidence requires finalized block order");
          const block=await withRpcBackoff(()=>this.pacedRead(()=>this.rpc.getBlockSignatures!(info!.slot,"finalized")),{logKey:"indexer:evidence-block",sleep:this.cfg.backoffSleep});
          await this.history!.assignTransactionIndices(this.cfg.programIds,info.slot,block.signatures);
          info=await this.history!.nextUncollectedGlobal(this.cfg.programIds);
          if(!info || info.txIndex===null) throw new Error("Canonical evidence signature absent from finalized block");
        }
        const result=await this.processSignatures(info.programId,[info],true,true);
        if(result.blocked) return;
        this.collection.collectedTransactions++;
      } catch(error) {
        if(info) await this.history!.retryGlobal(this.cfg.programIds,info.signature,error);
        this.collection.blockedReason="evidence-read-unavailable";
        rateLimitedWarn("indexer:evidence","[indexer] canonical evidence read retained for retry");
        return;
      }
    }
    this.collection.lastCompletedAt=new Date().toISOString();
  }

  private async pollProgram(programId: string): Promise<PollResult> {
    try {
      const infos = await withRpcBackoff(() => this.pacedRead(() => this.rpc.getSignaturesForAddress(new PublicKey(programId), {limit:this.cfg.signaturesPerPoll},"finalized")), {logKey:"indexer:getSignaturesForAddress",sleep:this.cfg.backoffSleep});
      return await this.processSignatures(programId,infos,false);
    } catch(error) {
      console.warn(`[indexer] signature read failed for ${programId}:`,error instanceof Error ? error.message : error);
      return {programId,signaturesSeen:0,events:[]};
    }
  }

  private async processSignatures(programId: string, sigInfos: SignatureInfo[], globalDrain: boolean, evidenceOnly=false, eligibleNamespaces?: ReadonlySet<string>): Promise<PollResult & {blocked:boolean}> {
    const events: DecodedFolioxEvent[] = [];
    let signaturesSeen = 0;
    // getSignaturesForAddress returns NEWEST-first; process OLDEST-first so a
    // fresh sync lands the BasketCreated tx (which upserts the baskets row)
    // before the Minted/Redeemed/FeeAccrued txs whose rows FK-reference it.
    const pending = globalDrain ? [] : [...this.pending.values()]
      .filter((entry) => entry.programId === programId).map((entry) => entry.info);
    const candidates = new Map([...pending, ...sigInfos].map((info) => [info.signature, info]));
    const ordered = [...candidates.values()];
    if (!globalDrain) ordered.sort((a,b) => a.slot-b.slot); // DB-less decoder mode only.
    const finish = (sig: string, quarantine?: string) => evidenceOnly && !quarantine ? Promise.resolve() : globalDrain ? this.history!.finishGlobal(this.cfg.programIds,sig,quarantine) : this.history?.finish(programId,sig,quarantine);
    const retry = (sig: string, error: unknown) => globalDrain ? this.history!.retryGlobal(this.cfg.programIds,sig,error) : this.history?.retry(programId,sig,error);
    let blocked = false;
    for (const sigInfo of ordered) {
      if (sigInfo.err) {
        // ERR GUARD (layer 1): a transaction that failed on-chain must never
        // contribute events — count and skip; the chain-truth positions sync
        // is what keeps user_positions aligned regardless.
        this.failedTxSkips++;
        continue;
      }
      if (!evidenceOnly && globalDrain) {
        const completion = await this.history!.reusableCompletion(this.cfg.programIds,sigInfo.signature,sigInfo.slot);
        if (completion) {
          await finish(sigInfo.signature,completion.status === "quarantined" ? completion.reason ?? "quarantined-history" : undefined);
          if (completion.status === "quarantined") { blocked=true; break; }
          continue;
        }
      } else if (!evidenceOnly && this.seen.has(sigInfo.signature)) {
        await finish(sigInfo.signature);
        continue;
      }
      if (this.attemptedThisPoll.has(sigInfo.signature)) { if (globalDrain) { blocked = true; break; } continue; }
      this.attemptedThisPoll.add(sigInfo.signature);
      if (!this.pending.has(sigInfo.signature)) this.pending.set(sigInfo.signature, { programId, info: sigInfo });
      // The retry ledger is bounded independently of the successful-signature cache.
      if (this.pending.size > this.cfg.maxSeenCache) {
        const oldest = this.pending.keys().next().value;
        if (oldest !== undefined) {
          this.pending.delete(oldest);
          this.attempts.delete(oldest);
          rateLimitedWarn("indexer:retry-capacity", "[indexer] retry ledger capacity reached; oldest pending signature awaits future history backfill");
        }
      }
      signaturesSeen++;
      try {
        const tx = await withRpcBackoff(
          () =>
            this.pacedRead(() => this.rpc.getParsedTransaction(sigInfo.signature, {
              maxSupportedTransactionVersion: 0, commitment: "finalized",
            })),
          { logKey: "indexer:getParsedTransaction", sleep: this.cfg.backoffSleep },
        );
        if (!tx?.meta?.logMessages) {
          throw new Error("transaction or logs temporarily unavailable");
        }
        if (globalDrain && tx.slot !== sigInfo.slot) throw new Error("Finalized transaction slot disagrees with queued signature; retained for retry");
        if (globalDrain && tx.transaction.signatures?.[0] !== sigInfo.signature) throw new Error("Finalized transaction signature disagrees with requested signature; retained for retry");
        if (tx.meta.err) {
          // ERR GUARD (layer 2): the fetched transaction itself reports a
          // on-chain failure (meta.err). Its logs may still contain partial
          // CPI output (fees accrued before the revert), but NONE of it may
          // become Minted/Redeemed/FeeAccrued/BasketCreated rows. Log + count
          // + skip; the positions sync reconciles balances from chain truth.
          this.failedTxSkips++;
          console.warn(
            `[indexer] skipping failed tx ${sigInfo.signature} (meta.err set) — ` +
              `no events indexed from failed transactions (skipped so far: ${this.failedTxSkips})`,
          );
          if (evidenceOnly && this.history) await this.history.markCanonicalCollected(this.cfg.programIds,sigInfo.signature,sigInfo.slot,0);
          await finish(sigInfo.signature);
          if (!evidenceOnly) this.markSeen(sigInfo.signature);
          continue;
        }
        if (tx.meta.logMessages.some((line) => /log truncated/i.test(line))) {
          throw new CanonicalLogsIncompleteError("Runtime logs truncated; canonical event history is incomplete");
        }
        const rows: EventRow[] = [];
        // Events decoded from THIS transaction only (for the positions sync).
        const txEvents: Array<{ event: DecodedFolioxEvent; logIndex: number; namespace?: ProgramNamespace }> = [];
        const creations: Array<{ event: Extract<DecodedFolioxEvent, { type: "BasketCreated" }>; args: CreateBasketArgs | null; programId: string }> = [];

        for (const { programId: emitter, payload, logIndex } of extractAttributedProgramDataLogs(tx.meta.logMessages)) {
          const type = matchAnchorEvent(payload);
          if (!type || !this.isTrustedEmitter(emitter, type)) continue;
          const event = decodeAnchorEvent(type, payload);
          if (!event) {
            if (globalDrain) throw new Error(`Malformed trusted ${type} event payload; retained for review`);
            continue;
          }
          txEvents.push({ event, logIndex, namespace: this.namespaces ? namespaceForProgram(emitter, this.namespaces)?.namespace : undefined });
          // Durable history uses canonical chain time only. The DB-less decoder
          // keeps its legacy test clock; production never substitutes wall time.
          const tsSec = sigInfo.blockTime ?? tx.blockTime ?? (event.type === "BasketCreated" ? event.ts : globalDrain ? undefined : Math.floor(Date.now() / 1000));
          if (tsSec === undefined || !Number.isSafeInteger(tsSec) || tsSec < 0 || !Number.isFinite(new Date(tsSec*1000).getTime())) throw new Error("Canonical event timestamp unavailable; retained for retry");
          const data: Record<string, unknown> = { ...event, programId: emitter };
          if (event.type === "BasketCreated") {
            const args = await this.decodeCreateBasketFromTx(tx, emitter, event.basket);
            creations.push({ event, args, programId: emitter });
            if (args) data.createBasket = args;
          }
          rows.push({
            sig: sigInfo.signature, logIndex,
            slot: sigInfo.slot,
            basket: event.basket,
            type,
            data,
            ts: new Date(tsSec * 1000),
          });
        }

        // Validate the entire transaction before any projection or parent writes.
        // Cross-namespace execution is deliberately unsupported: no first-half effects.
        const eventNamespaces = new Set(txEvents.map(item => item.namespace?.id).filter((id): id is string => id !== undefined));
        if (eventNamespaces.size > 1) throw new NamespaceProjectionError("Mixed namespace transaction requires review", rows.map(row => String(row.data.programId)));
        if (!evidenceOnly && eligibleNamespaces && [...eventNamespaces].some(id => !eligibleNamespaces.has(id))) throw new Error("Transaction namespace history is not ready; retained for retry");
        if (this.namespaces && isPgLike(this.db)) for (const {event,namespace} of txEvents) {
          if (!namespace) throw new NamespaceProjectionError("Unregistered transaction emitter");
          const existing = await this.db.query("SELECT factory FROM baskets WHERE pubkey=$1", [event.basket]);
          if (existing.rows[0] && existing.rows[0].factory !== namespace.factoryConfig) throw new NamespaceProjectionError("Event basket belongs to a different namespace", rows.map(row => String(row.data.programId)));
        }
        if (rows.length > 0) {
          // BasketCreated must upsert the baskets row BEFORE the event rows:
          // events.basket carries a FK to baskets(pubkey), so on a fresh sync
          // the create tx would otherwise fail its own event insert. The
          // upsert is idempotent (ON CONFLICT DO NOTHING); creator_stats below
          // stays gated on the event insert being fresh AND the basket row
          // being newly created, so replays never double-count.
          for (const { event, args, programId: emitter } of creations) {
            if (!args || args.constituents.length !== event.numConstituents) continue;
            const factory = await this.resolveFactory(tx, emitter, event.basket);
            if (!factory) continue;
            const namespace = this.namespaces ? namespaceForProgram(emitter, this.namespaces)?.namespace : undefined;
            if (namespace && factory !== namespace.factoryConfig) throw new NamespaceProjectionError("Creation factory differs from registered singleton", [emitter]);
            const treasury = await this.fetchTreasury(factory, emitter);
            await upsertBasketFromCreation(this.db, buildBasketUpsert(event, factory, args, treasury));
            if (isPgLike(this.db)) this.rememberBasket(event.basket, namespace?.id);
          }
          // Old creations may be outside the bounded history page. Recover
          // absent FK parents from authenticated current chain state, retaining
          // the actual immutable Clock timestamps; never synthesize a creation
          // event or increment creator_stats for this recovery path.
          for (const {event,namespace} of txEvents) await this.ensureBasketExists(event.basket, namespace);
          // Only persist downstream rows when the event insert is fresh, so
          // re-processing a signature can never double-count creator_stats.
        }
        if (globalDrain && this.history && isPgLike(this.db)) {
          // Full-log facts and marker commit together, including genuine zero-event transactions.
          await withTransaction(this.db,async client=>{
            for (const row of rows) await insertEvent(client,row);
            await new DurableHistory(client).markCanonicalCollected(this.cfg.programIds,sigInfo.signature,sigInfo.slot,rows.length);
          });
        } else for (const row of rows) await insertEvent(this.db,row);
        if (!evidenceOnly) for (const { event } of creations) await incrementCreatorStats(this.db,event.creator);

        if (!evidenceOnly) events.push(...txEvents.map(({ event }) => event));

        // user_positions sync — AFTER the core upserts. The position_events
        // (sig, kind) ledger makes each write idempotent on its own, so this
        // runs even when the events row insert above was not fresh (recovery
        // after a crash between the two writes). Degrades to a warn when db
        // is null; per-event failures never break the poll loop.
        if (!this.cfg.replayOnly && !evidenceOnly) for (const { event, logIndex, namespace } of txEvents) {
          // Failure retains the signature in the durable queue; successful earlier
          // effects are independently idempotent and safe to retry after a crash.
          await applyPositionEvent(this.db, sigInfo.signature, event, logIndex, sigInfo.slot, namespace?.factoryConfig);
        }
      } catch (err) {
        if (err instanceof PositionProjectionGapError && isPgLike(this.db)) {
          // The balance/claim transaction has rolled back. Persist only an
          // operational guard so reviewed replay and explicit recovery can
          // resolve legitimate genesis/transfer projection gaps.
          await markPositionRebuildRequired(this.db, err.basket, "position-projection-gap");
        }
        if (err instanceof PositionRebuildRequiredError || err instanceof PositionProjectionGapError) {
          if (globalDrain) await this.history!.markProjectionBlocked(this.cfg.programIds,sigInfo.signature,err.basket);
        }
        if (err instanceof NamespaceProjectionError && globalDrain) await this.history!.quarantineEmitters(err.emitters, sigInfo.signature, sigInfo.slot, err.message);
        if (err instanceof BasketStateDecodeError || err instanceof CanonicalLogsIncompleteError || err instanceof NamespaceProjectionError) {
          // A malformed/wrong-program account is explicit quarantine, never
          // an invented FK parent. Transport and DB errors take the retry path.
          console.warn(`[indexer] rejected basket state for ${sigInfo.signature}: ${err instanceof BasketStateDecodeError ? err.reason : err instanceof NamespaceProjectionError ? "namespace-mismatch" : "truncated-runtime-logs"}`);
          await finish(sigInfo.signature, err.message);
          if (!evidenceOnly) this.markSeen(sigInfo.signature);
          if (globalDrain) { blocked = true; break; }
          continue;
        }
        await retry(sigInfo.signature, err);
        const attempt = (this.attempts.get(sigInfo.signature) ?? 0) + 1;
        this.attempts.set(sigInfo.signature, attempt);
        rateLimitedWarn(
          `indexer:processing:${programId}`,
          `[indexer] failed to process ${sigInfo.signature} (attempt ${attempt}, retained for retry): ` +
            (err instanceof Error ? err.message : String(err)),
        );
        if (globalDrain) { blocked = true; break; } // Never pass a failed global predecessor.
        continue; // transient RPC/FK/DB failures are never marked successfully seen
      }
      await finish(sigInfo.signature);
      if (!evidenceOnly) {
        this.markSeen(sigInfo.signature);
        this.attempts.delete(sigInfo.signature);
      }
    }
    return { programId, signaturesSeen, events, blocked };
  }

  /** Find the create_basket ix for this program and decode its base58 args. */
  private async decodeCreateBasketFromTx(
    tx: ParsedTransactionWithMeta,
    programId: string,
    basket: string,
  ): Promise<CreateBasketArgs | null> {
    const all = [
      ...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions),
    ];
    for (const ix of all) {
      const pid = ix.programId?.toBase58?.();
      if (pid !== programId) continue;
      const data = (ix as { data?: unknown }).data;
      if (typeof data !== "string") continue;
      const accounts = (ix as { accounts?: readonly PublicKey[] }).accounts;
      if (!accounts?.some((key) => key.toBase58() === basket)) continue;
      const args = decodeCreateBasketIx(data);
      if (args) return args;
    }
    return null;
  }

  /** FactoryConfig PDA = first account of the create_basket instruction. */
  private async resolveFactory(tx: ParsedTransactionWithMeta, programId: string, basket: string): Promise<string | null> {
    const all = [
      ...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions),
    ];
    for (const ix of all) {
      if (ix.programId?.toBase58?.() !== programId) continue;
      const data = (ix as { data?: unknown }).data;
      if (typeof data !== "string") continue;
      if (!decodeCreateBasketIx(data)) continue;
      const accounts = (ix as { accounts?: readonly PublicKey[] }).accounts;
      if (!accounts?.some((key) => key.toBase58() === basket)) continue;
      return accounts?.[0]?.toBase58() ?? null;
    }
    return null;
  }

  private async pacedRead<T>(read: () => Promise<T>): Promise<T> {
    await this.rpcPacer.wait();
    return read();
  }

  private isTrustedEmitter(programId: string, type: FolioxEventType): boolean {
    if (this.namespaces) return namespaceForProgram(programId, this.namespaces)?.role === (type === "BasketCreated" ? "factory" : "basket");
    const expected = type === "BasketCreated" ? this.cfg.factoryProgramId : this.cfg.basketProgramId;
    return expected ? programId === expected : this.cfg.programIds.includes(programId);
  }

  private rememberBasket(address: string, namespaceId?: string): void {
    this.knownBaskets.set(address, namespaceId);
    if (this.knownBaskets.size > this.cfg.maxSeenCache) {
      const oldest = this.knownBaskets.keys().next().value;
      if (oldest !== undefined) this.knownBaskets.delete(oldest);
    }
  }

  private async ensureBasketExists(address: string, namespace?: ProgramNamespace): Promise<void> {
    if (!isPgLike(this.db)) return;
    if (this.knownBaskets.has(address) && this.knownBaskets.get(address) === namespace?.id) return;
    const existing = await this.db.query(namespace ? "SELECT pubkey,factory FROM baskets WHERE pubkey = $1" : "SELECT pubkey FROM baskets WHERE pubkey = $1", [address]);
    if (existing.rows.length > 0) {
      if (namespace && existing.rows[0].factory !== namespace.factoryConfig) throw new NamespaceProjectionError("Basket namespace mismatch", [namespace.programs.basket]);
      this.rememberBasket(address, namespace?.id);
      return;
    }
    const basketProgramId = namespace?.programs.basket ?? this.cfg.basketProgramId;
    const factoryProgramId = namespace?.programs.factory ?? this.cfg.factoryProgramId;
    if (!basketProgramId || !factoryProgramId) {
      throw new Error("basket recovery requires PROGRAM_BASKET and PROGRAM_FACTORY");
    }
    const info = await withRpcBackoff(
      () => this.pacedRead(() => this.rpc.getAccountInfo(new PublicKey(address))),
      { logKey: "indexer:getBasketAccount", sleep: this.cfg.backoffSleep },
    );
    if (!info) throw new Error("basket account temporarily unavailable; retained for retry");
    const state = decodeBasketState(address, info, {
      basket: new PublicKey(basketProgramId), factory: new PublicKey(factoryProgramId),
    });
    const treasury = await this.fetchTreasury(state.factory, factoryProgramId);
    if (treasury !== state.treasury) throw new BasketStateDecodeError("factory-treasury-mismatch", "Basket treasury differs from the canonical FactoryConfig treasury");
    await upsertBasketFromCreation(this.db, state);
    this.rememberBasket(address, namespace?.id);
    console.log(`[indexer] recovered basket from chain state: ${address}`);
  }

  private async fetchTreasury(factory: string, factoryProgramId: string): Promise<string> {
    const cached = this.factoryTreasuries.get(factory);
    if (cached) return cached;
    const info = await withRpcBackoff(
      () => this.pacedRead(() => this.rpc.getAccountInfo(new PublicKey(factory))),
      { logKey: "indexer:getFactoryAccount", sleep: this.cfg.backoffSleep },
    );
    if (!info) throw new Error("FactoryConfig temporarily unavailable; retained for retry");
    const treasury = decodeFactoryTreasuryState(factory, info, new PublicKey(factoryProgramId));
    this.factoryTreasuries.set(factory, treasury);
    return treasury;
  }

  /** Long-running poll loop. Idempotent; call stop() to end it. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    const loop = async (): Promise<void> => {
      if (this.stopped) {
        this.running = false;
        return;
      }
      try {
        await this.pollOnce();
      } catch (err) {
        console.warn("[indexer] poll failed:", err instanceof Error ? err.message : err);
      }
      if (!this.stopped) {
        this.timer = setTimeout(() => void loop(), this.cfg.pollIntervalMs);
        this.timer.unref?.();
      } else {
        this.running = false;
      }
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Events skipped because their transaction failed on-chain (err guard). */
  get failedTxSkipCount(): number {
    return this.failedTxSkips;
  }
}

// --- env wiring -------------------------------------------------------------

export function indexerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): (IndexerConfig & { rpcUrl: string }) | null {
  const rpcUrl = env.RPC_URL;
  if (!rpcUrl) return null;
  const selected = PROGRAM_NAMESPACES.find(namespace => namespace.programs.whitelist === env.PROGRAM_WHITELIST && namespace.programs.factory === env.PROGRAM_FACTORY && namespace.programs.basket === env.PROGRAM_BASKET);
  if (!selected) {
    console.warn("[indexer] disabled: PROGRAM_* must match one registered namespace with three distinct valid public keys");
    return null;
  }
  const programIds = registeredProgramIds(PROGRAM_NAMESPACES);
  return {
    rpcUrl,
    programIds, namespaces: PROGRAM_NAMESPACES, durableHistory: true, historyPagesPerPoll: 2,
    whitelistProgramId: env.PROGRAM_WHITELIST,
    basketProgramId: env.PROGRAM_BASKET,
    factoryProgramId: env.PROGRAM_FACTORY,
    pollIntervalMs: Number(env.INDEXER_POLL_MS || DEFAULT_INDEXER_CONFIG.pollIntervalMs),
    signaturesPerPoll: Number(env.INDEXER_POLL_LIMIT || DEFAULT_INDEXER_CONFIG.signaturesPerPoll),
    maxSeenCache: DEFAULT_INDEXER_CONFIG.maxSeenCache,
    holdingsSyncIntervalMs: Number(env.HOLDINGS_SYNC_INTERVAL_MS || HOLDINGS_SYNC_INTERVAL_MS),
    positionsSyncIntervalMs: Number(env.POSITIONS_SYNC_MS || POSITIONS_SYNC_INTERVAL_MS),
    stateSyncSpacingMs: DEFAULT_INDEXER_CONFIG.stateSyncSpacingMs,
    transactionSpacingMs: DEFAULT_INDEXER_CONFIG.transactionSpacingMs,
  };
}

/**
 * Build an indexer from env, or null when RPC_URL / program IDs are missing
 * (DB-less and RPC-less environments degrade honestly to null).
 */
export async function createIndexerFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<EventIndexer | null> {
  const cfg = indexerConfigFromEnv(env);
  if (!cfg) {
    console.warn("[indexer] RPC_URL or PROGRAM_* env missing — indexer disabled");
    return null;
  }
  const db = await connectFromEnv();
  let genesisHash: string | undefined;
  try {
    genesisHash = await readIndexerGenesisHash(cfg.rpcUrl,guardedRpcFetch(cfg.rpcUrl));
  } catch { console.warn("[indexer] RPC identity unverified; release readiness will fail closed"); }
  return new EventIndexer(createReadOnlyRpcConnection(cfg.rpcUrl), { ...cfg, genesisHash }, db);
}
