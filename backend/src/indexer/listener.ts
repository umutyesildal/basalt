/**
 * indexer/listener.ts — read-only event indexer for the three Basalt programs.
 *
 * Polls `getSignaturesForAddress` per program ID (env: PROGRAM_WHITELIST,
 * PROGRAM_FACTORY, PROGRAM_BASKET), fetches each transaction, decodes the four
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
import { Connection, PublicKey, type AccountInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { connectFromEnv, isPgLike, type PgLike } from "../db/client.js";
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
import { applyPositionEvent, markPositionRebuildRequired, PositionProjectionGapError } from "./positions.js";
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
  /**
   * Raw JSON-RPC invoker used ONLY as the positions-sync provider fallback
   * (enhanced getTokenAccounts when the provider blocks token-program gPA).
   * Wired from RPC_URL by createIndexerFromEnv; tests may inject their own.
   */
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
  private readonly knownBaskets = new Set<string>();
  private readonly factoryTreasuries = new Map<string, string>();
  private readonly attemptedThisPoll = new Set<string>();
  private readonly rpcPacer: Pacer;
  private readonly history: DurableHistory | null;
  private readonly finalizedBlocks = new Map<number, string[]>();
  private completedDiscoverySlot: number | null = null;
  private discoveryGeneration = 0;

  /** Fresh successful discovery in the latest durable poll only; busy/failure resets it. */
  get lastCompletedDiscoverySlot(): number | null { return this.completedDiscoverySlot; }
  private lastDiscoveryMs = 0;
  private lastWhitelistSyncMs = 0;
  private lastHoldingsSyncMs = 0;
  private lastPositionsSyncMs = 0;
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
    if (typeof full.getProgramAccounts !== "function") return; // hand-rolled test rpc
    const now = Date.now();
    const spacing = this.cfg.stateSyncSpacingMs ?? STATE_SYNC_SPACING_MS;
    // Discover authenticated Basket accounts even when creation logs were truncated or pruned.
    if (this.cfg.basketProgramId && this.cfg.factoryProgramId && now - this.lastDiscoveryMs >= 300_000) {
      this.lastDiscoveryMs = now;
      try {
        const accounts = await this.pacedRead(() => full.getProgramAccounts(new PublicKey(this.cfg.basketProgramId!), { commitment: "finalized", filters: [{ dataSize: 888 }] }));
        for (const account of accounts) {
          try {
            const state = decodeBasketState(account.pubkey.toBase58(), account.account, { basket: new PublicKey(this.cfg.basketProgramId), factory: new PublicKey(this.cfg.factoryProgramId) });
            if (await this.fetchTreasury(state.factory, this.cfg.factoryProgramId) !== state.treasury) throw new Error("factory treasury mismatch");
            await upsertBasketFromCreation(this.db, state);
            this.rememberBasket(state.pubkey);
            await incrementCreatorStats(this.db, state.creator);
          } catch (error) { console.warn("[indexer] basket discovery rejected account", account.pubkey.toBase58(), error instanceof Error ? error.message : error); }
        }
      } catch (error) { console.warn("[indexer] basket discovery failed", error instanceof Error ? error.message : error); }
    }
    if (this.cfg.whitelistProgramId && now - this.lastWhitelistSyncMs >= WHITELIST_SYNC_INTERVAL_MS) {
      this.lastWhitelistSyncMs = now;
      try {
        const n = await syncWhitelistedMints(full, this.cfg.whitelistProgramId, this.db);
        if (n > 0) console.log(`[indexer] whitelist sync: ${n} mints upserted`);
      } catch (err) {
        console.warn("[indexer] whitelist sync failed:", err instanceof Error ? err.message : err);
      }
    }
    const holdingsIntervalMs = this.cfg.holdingsSyncIntervalMs ?? HOLDINGS_SYNC_INTERVAL_MS;
    if (now - this.lastHoldingsSyncMs >= holdingsIntervalMs) {
      this.lastHoldingsSyncMs = now;
      try {
        const n = await syncIndexedBaskets(full, this.db, { spacingMs: spacing });
        if (n > 0) console.log(`[indexer] holdings sync: ${n} baskets refreshed`);
      } catch (err) {
        console.warn("[indexer] holdings sync failed:", err instanceof Error ? err.message : err);
      }
    }
    const positionsIntervalMs = this.cfg.positionsSyncIntervalMs ?? POSITIONS_SYNC_INTERVAL_MS;
    if (!this.cfg.replayOnly && now - this.lastPositionsSyncMs >= positionsIntervalMs) {
      this.lastPositionsSyncMs = now;
      try {
        // Structural cast: the real Connection (and the test doubles that opt
        // in) carries getProgramAccounts; hand-rolled test RPCs without it are
        // filtered out above.
        const stats = await syncPositionsFromChain(
          full as unknown as PositionsSyncRpc,
          this.db,
          { spacingMs: spacing, backoffSleep: this.cfg.backoffSleep, jsonRpcInvoke: this.cfg.jsonRpcInvoke,
            catchUpThroughSlot: async (requiredSlot: number) => {
              if (!this.history) throw new Error("Finalized reconciliation requires durable canonical discovery");
              await this.pollDurableHistory();
              if (this.lastCompletedDiscoverySlot === null || this.lastCompletedDiscoverySlot < requiredSlot) throw new Error("Canonical discovery could not reach finalized snapshot slot within this poll budget");
            },
            programs: this.cfg.basketProgramId && this.cfg.factoryProgramId ? { basket:new PublicKey(this.cfg.basketProgramId),factory:new PublicKey(this.cfg.factoryProgramId),ids:this.cfg.programIds } : undefined },
        );
        if (stats.basketsScanned > 0) {
          console.log(
            `[indexer] positions sync: ${stats.holders} holders across ${stats.basketsScanned} baskets ` +
              `(${stats.eventKept} event-derived, ${stats.balanceSynced} balance-sync, ${stats.zeroed} zeroed` +
              `${stats.basketsFailed > 0 ? `, ${stats.basketsFailed} baskets failed (retry next tick)` : ""})`,
          );
        }
      } catch (err) {
        console.warn("[indexer] positions sync failed:", err instanceof Error ? err.message : err);
      }
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
        if (await this.history!.savePage(state,page,this.cfg.signaturesPerPoll)) {
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
    const generation = ++this.discoveryGeneration;
    return this.history!.withPollLock(() => this.drainDurableHistory(generation),this.cfg.programIds.map(programId => ({programId,signaturesSeen:0,events:[]})));
  }

  private async drainDurableHistory(generation: number): Promise<PollResult[]> {
    const results = new Map(this.cfg.programIds.map(programId => [programId,{programId,signaturesSeen:0,events:[] as DecodedFolioxEvent[]}]));
    if (!this.rpc.getSlot) throw new Error("Durable history requires a finalized slot watermark");
    const watermark = await withRpcBackoff(() => this.pacedRead(() => this.rpc.getSlot!("finalized")),{logKey:"indexer:getSlot",sleep:this.cfg.backoffSleep});
    if (!Number.isSafeInteger(watermark) || watermark < 0) throw new Error("Invalid finalized slot watermark");
    let ready = true;
    for (const program of this.cfg.programIds) {
      if (await this.discoverProgram(program,watermark)) await this.history!.markVerifiedThrough(program,watermark);
      else ready = false;
    }
    if (!ready || await this.history!.hasQuarantined(this.cfg.programIds)) return [...results.values()];
    if (generation === this.discoveryGeneration) this.completedDiscoverySlot = watermark;
    const budget = Math.max(1,Math.min(1000,this.cfg.signaturesPerPoll));
    for (let i=0;i<budget;i++) {
      let info = await this.history!.nextPendingGlobal(this.cfg.programIds);
      if (!info || info.slot > watermark) break;
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
          info = await this.history!.nextPendingGlobal(this.cfg.programIds);
          if (!info || info.txIndex === null) throw new Error("Queued signature missing from canonical finalized block");
        }
        const processed = await this.processSignatures(info.programId,[info],true);
        const result = results.get(info.programId)!;
        result.signaturesSeen += processed.signaturesSeen; result.events.push(...processed.events);
        if (processed.blocked) break;
      } catch(error) {
        if (info) await this.history!.retryGlobal(this.cfg.programIds,info.signature,error);
        rateLimitedWarn("indexer:global-order",`[indexer] global history retained for retry: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
    return [...results.values()];
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

  private async processSignatures(programId: string, sigInfos: SignatureInfo[], globalDrain: boolean): Promise<PollResult & {blocked:boolean}> {
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
    const finish = (sig: string, quarantine?: string) => globalDrain ? this.history!.finishGlobal(this.cfg.programIds,sig,quarantine) : this.history?.finish(programId,sig,quarantine);
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
      if (this.seen.has(sigInfo.signature)) {
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
          await finish(sigInfo.signature);
          this.markSeen(sigInfo.signature);
          continue;
        }
        if (tx.meta.logMessages.some((line) => /log truncated/i.test(line))) {
          throw new BasketStateDecodeError("truncated-account", "Runtime logs truncated; canonical event history is incomplete");
        }
        const rows: EventRow[] = [];
        // Events decoded from THIS transaction only (for the positions sync).
        const txEvents: Array<{ event: DecodedFolioxEvent; logIndex: number }> = [];
        const creations: Array<{ event: Extract<DecodedFolioxEvent, { type: "BasketCreated" }>; args: CreateBasketArgs | null; programId: string }> = [];

        for (const { programId: emitter, payload, logIndex } of extractAttributedProgramDataLogs(tx.meta.logMessages)) {
          const type = matchAnchorEvent(payload);
          if (!type || !this.isTrustedEmitter(emitter, type)) continue;
          const event = decodeAnchorEvent(type, payload);
          if (!event) {
            if (globalDrain) throw new Error(`Malformed trusted ${type} event payload; retained for review`);
            continue;
          }
          txEvents.push({ event, logIndex });
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
            const treasury = await this.fetchTreasury(factory, emitter);
            await upsertBasketFromCreation(this.db, buildBasketUpsert(event, factory, args, treasury));
            if (isPgLike(this.db)) this.rememberBasket(event.basket);
          }
          // Old creations may be outside the bounded history page. Recover
          // absent FK parents from authenticated current chain state, retaining
          // the actual immutable Clock timestamps; never synthesize a creation
          // event or increment creator_stats for this recovery path.
          for (const basket of new Set(rows.map((row) => row.basket).filter((value): value is string => value !== null))) {
            await this.ensureBasketExists(basket);
          }
          // Only persist downstream rows when the event insert is fresh, so
          // re-processing a signature can never double-count creator_stats.
          for (const row of rows) await insertEvent(this.db, row);
          for (const { event } of creations) await incrementCreatorStats(this.db, event.creator);
        }

        events.push(...txEvents.map(({ event }) => event));

        // user_positions sync — AFTER the core upserts. The position_events
        // (sig, kind) ledger makes each write idempotent on its own, so this
        // runs even when the events row insert above was not fresh (recovery
        // after a crash between the two writes). Degrades to a warn when db
        // is null; per-event failures never break the poll loop.
        if (!this.cfg.replayOnly) for (const { event, logIndex } of txEvents) {
          // Failure retains the signature in the durable queue; successful earlier
          // effects are independently idempotent and safe to retry after a crash.
          await applyPositionEvent(this.db, sigInfo.signature, event, logIndex, sigInfo.slot);
        }
      } catch (err) {
        if (err instanceof PositionProjectionGapError && isPgLike(this.db)) {
          // The balance/claim transaction has rolled back. Persist only an
          // operational guard so reviewed replay and explicit recovery can
          // resolve legitimate genesis/transfer projection gaps.
          await markPositionRebuildRequired(this.db, err.basket, "position-projection-gap");
        }
        if (err instanceof BasketStateDecodeError) {
          // A malformed/wrong-program account is explicit quarantine, never
          // an invented FK parent. Transport and DB errors take the retry path.
          console.warn(`[indexer] rejected basket state for ${sigInfo.signature}: ${err.reason}`);
          await finish(sigInfo.signature, err.message);
          this.markSeen(sigInfo.signature);
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
      this.markSeen(sigInfo.signature);
      this.attempts.delete(sigInfo.signature);
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
    const expected = type === "BasketCreated" ? this.cfg.factoryProgramId : this.cfg.basketProgramId;
    return expected ? programId === expected : this.cfg.programIds.includes(programId);
  }

  private rememberBasket(address: string): void {
    this.knownBaskets.add(address);
    if (this.knownBaskets.size > this.cfg.maxSeenCache) {
      const oldest = this.knownBaskets.values().next().value;
      if (oldest !== undefined) this.knownBaskets.delete(oldest);
    }
  }

  private async ensureBasketExists(address: string): Promise<void> {
    if (!isPgLike(this.db) || this.knownBaskets.has(address)) return;
    const existing = await this.db.query("SELECT pubkey FROM baskets WHERE pubkey = $1", [address]);
    if (existing.rows.length > 0) {
      this.rememberBasket(address);
      return;
    }
    if (!this.cfg.basketProgramId || !this.cfg.factoryProgramId) {
      throw new Error("basket recovery requires PROGRAM_BASKET and PROGRAM_FACTORY");
    }
    const info = await withRpcBackoff(
      () => this.pacedRead(() => this.rpc.getAccountInfo(new PublicKey(address))),
      { logKey: "indexer:getBasketAccount", sleep: this.cfg.backoffSleep },
    );
    if (!info) throw new Error("basket account temporarily unavailable; retained for retry");
    const state = decodeBasketState(address, info, {
      basket: new PublicKey(this.cfg.basketProgramId),
      factory: new PublicKey(this.cfg.factoryProgramId),
    });
    const treasury = await this.fetchTreasury(state.factory, this.cfg.factoryProgramId);
    if (treasury !== state.treasury) throw new BasketStateDecodeError("factory-treasury-mismatch", "Basket treasury differs from the canonical FactoryConfig treasury");
    await upsertBasketFromCreation(this.db, state);
    this.rememberBasket(address);
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
  const programIds = [env.PROGRAM_WHITELIST, env.PROGRAM_FACTORY, env.PROGRAM_BASKET]
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  try {
    if (programIds.length !== 3 || new Set(programIds).size !== 3 || programIds.some(id => new PublicKey(id).toBase58() !== id)) throw new Error("invalid program roles");
  } catch {
    console.warn("[indexer] disabled: PROGRAM_WHITELIST, PROGRAM_FACTORY and PROGRAM_BASKET must be three distinct valid public keys");
    return null;
  }
  return {
    rpcUrl,
    programIds, durableHistory: true, historyPagesPerPoll: 2,
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
  // Raw JSON-RPC invoker (read-only POST) for the positions-sync provider
  // fallback: web3.js Connection has no custom-method surface, and some
  // providers block token-program getProgramAccounts while offering an
  // enhanced getTokenAccounts instead.
  const jsonRpcInvoke: JsonRpcInvoker = async (method, params) => {
    const res = await fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`jsonrpc ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(`jsonrpc ${method} failed: ${body.error.message}`);
    return body.result;
  };
  return new EventIndexer(new Connection(cfg.rpcUrl, { commitment: "finalized", disableRetryOnRateLimit: true }), { ...cfg, jsonRpcInvoke }, db);
}
