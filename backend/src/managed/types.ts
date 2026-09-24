/**
 * Managed Basket V2 read model types.
 *
 * Raw on-chain u64 values cross the backend boundary only as canonical decimal
 * strings. Convert to BigInt for arithmetic; never convert them to Number.
 * This module describes the fee-free, two-asset mock prototype only.
 */

export type RawU64 = string;
export type PubkeyString = string;
export type Hash32Hex = string;
export type Pair<T> = readonly [T, T];
export type Commitment = "processed" | "confirmed" | "finalized";

export interface ManagedBasketCreatedEvent {
  type: "ManagedBasketCreated";
  basket: PubkeyString;
  creator: PubkeyString;
  manager: PubkeyString;
  guardian: PubkeyString;
  share_mint: PubkeyString;
  identity_nft_mint: PubkeyString;
  constituent_mints: Pair<PubkeyString>;
  target_weights_bps: Pair<number>;
  allocation_version: RawU64;
  total_supply_raw: RawU64;
}

export interface ManagedSharesMintedEvent {
  type: "ManagedSharesMinted";
  basket: PubkeyString;
  holder: PubkeyString;
  shares_minted_raw: RawU64;
  deposit_amounts_raw: Pair<RawU64>;
  total_supply_raw: RawU64;
}

export interface ManagedSharesRedeemedEvent {
  type: "ManagedSharesRedeemed";
  basket: PubkeyString;
  holder: PubkeyString;
  shares_burned_raw: RawU64;
  amounts_out_raw: Pair<RawU64>;
  total_supply_raw: RawU64;
}

export interface RebalanceProposedEvent {
  type: "RebalanceProposed";
  basket: PubkeyString;
  nonce: RawU64;
  base_version: RawU64;
  /** Manager's pre-approval commitment. It does not contain the guardian's min-out. */
  commitment_hash: Hash32Hex;
  input_mint: PubkeyString;
  output_mint: PubkeyString;
  max_input_raw: RawU64;
  target_weights_bps: Pair<number>;
  approval_deadline_slot: RawU64;
  notice_duration_slots: RawU64;
  execution_window_slots: RawU64;
}

export interface PriceBoundApprovedEvent {
  type: "PriceBoundApproved";
  basket: PubkeyString;
  nonce: RawU64;
  /** Guardian's final execution hash, which includes minOutputRaw. */
  commitment_hash: Hash32Hex;
  proposal_hash: Hash32Hex;
  max_input_raw: RawU64;
  min_output_raw: RawU64;
  approved_at_slot: RawU64;
  execute_after_slot: RawU64;
  expires_at_slot: RawU64;
}

export interface RebalanceCancelledEvent {
  type: "RebalanceCancelled";
  basket: PubkeyString;
  nonce: RawU64;
  commitment_hash: Hash32Hex;
  /** Zero sentinel before approval; final execution hash after approval. */
  proposal_hash: Hash32Hex;
}

export interface RebalanceExpiredEvent {
  type: "RebalanceExpired";
  basket: PubkeyString;
  nonce: RawU64;
  commitment_hash: Hash32Hex;
  /** Zero sentinel before approval; final execution hash after approval. */
  proposal_hash: Hash32Hex;
}

export interface RebalanceExecutedEvent {
  type: "RebalanceExecuted";
  basket: PubkeyString;
  nonce: RawU64;
  /** Final guardian-approved hash. */
  proposal_hash: Hash32Hex;
  from_version: RawU64;
  to_version: RawU64;
  input_mint: PubkeyString;
  output_mint: PubkeyString;
  input_raw: RawU64;
  output_raw: RawU64;
  target_weights_bps: Pair<number>;
  executed_at_slot: RawU64;
  total_supply_raw: RawU64;
  /** Event-reported post balances are evidence to reconcile, not a chain snapshot. */
  post_balances_raw: Pair<RawU64>;
}

export type ManagedProgramEvent =
  | ManagedBasketCreatedEvent
  | ManagedSharesMintedEvent
  | ManagedSharesRedeemedEvent
  | RebalanceProposedEvent
  | PriceBoundApprovedEvent
  | RebalanceCancelledEvent
  | RebalanceExpiredEvent
  | RebalanceExecutedEvent;

export interface ManagedEventEnvelope {
  signature: string;
  slot: RawU64;
  transactionIndex: number;
  /** Position among decoded events for this transaction. */
  eventIndex: number;
  commitment: Commitment;
  transactionSucceeded: boolean;
  event: ManagedProgramEvent;
}

export type ProposalStatus = "proposed" | "approved" | "executed" | "cancelled" | "expired";

export interface ManagedProposalProjection {
  nonce: RawU64;
  baseVersion: RawU64;
  /** Pre-approval manager commitment. */
  commitmentHash: Hash32Hex;
  /** Final guardian-approved execution hash; absent before approval. */
  proposalHash: Hash32Hex | null;
  inputMint: PubkeyString;
  outputMint: PubkeyString;
  maxInputRaw: RawU64;
  minOutputRaw: RawU64 | null;
  targetWeightsBps: Pair<number>;
  proposedAtSlot: RawU64;
  approvalDeadlineSlot: RawU64;
  noticeDurationSlots: RawU64;
  executionWindowSlots: RawU64;
  approvedAtSlot: RawU64 | null;
  executeAfterSlot: RawU64 | null;
  expiresAtSlot: RawU64 | null;
  status: ProposalStatus;
  execution: {
    inputRaw: RawU64;
    outputRaw: RawU64;
    executedAtSlot: RawU64;
    fromVersion: RawU64;
    toVersion: RawU64;
    /** Compare with the account snapshot; never expose as current holdings by itself. */
    reportedPostBalancesRaw: Pair<RawU64>;
  } | null;
}

export interface ChainAccountSnapshot {
  basket: PubkeyString;
  contextSlot: RawU64;
  commitment: "confirmed" | "finalized";
  allocationVersion: RawU64;
  totalSupplyRaw: RawU64;
  constituentMints: Pair<PubkeyString>;
  /** Ordered exactly like the basket's immutable constituentMints tuple. */
  holdingsRaw: Pair<RawU64>;
}

export interface ConfirmedHoldings {
  status: "confirmed";
  holdingsRaw: Pair<RawU64>;
  contextSlot: RawU64;
  commitment: "confirmed" | "finalized";
  allocationVersion: RawU64;
  totalSupplyRaw: RawU64;
}

export interface StaleHoldings {
  status: "stale";
  lastConfirmed: ConfirmedHoldings | null;
  reason: "awaiting_chain_snapshot" | "balance_event_after_snapshot" | "snapshot_state_mismatch";
}

export type HoldingsProjection = ConfirmedHoldings | StaleHoldings;

export interface EventCursor {
  slot: RawU64;
  transactionIndex: number;
  eventIndex: number;
  signature: string;
}

export interface ManagedBasketProjection {
  basket: PubkeyString;
  creator: PubkeyString;
  manager: PubkeyString;
  guardian: PubkeyString;
  shareMint: PubkeyString;
  identityNftMint: PubkeyString;
  constituentMints: Pair<PubkeyString>;
  targetWeightsBps: Pair<number>;
  allocationVersion: RawU64;
  totalSupplyRaw: RawU64;
  latestProposalNonce: RawU64 | null;
  lastBalanceChangeSlot: RawU64;
  proposals: readonly ManagedProposalProjection[];
  holdings: HoldingsProjection;
  lastEvent: EventCursor;
}

export type ProjectionErrorCode =
  | "INVALID_EVENT"
  | "INVALID_RAW_U64"
  | "INVALID_HASH"
  | "BASKET_MISMATCH"
  | "BASKET_NOT_CREATED"
  | "BASKET_ALREADY_CREATED"
  | "OUT_OF_ORDER_EVENT"
  | "EVENT_ID_COLLISION"
  | "STALE_VERSION"
  | "NON_MONOTONIC_NONCE"
  | "NO_PENDING_PROPOSAL"
  | "PROPOSAL_MISMATCH"
  | "INVALID_EVENT_TRANSITION"
  | "INVALID_SUPPLY"
  | "INVALID_EXECUTION"
  | "INVALID_SNAPSHOT"
  | "STALE_SNAPSHOT"
  | "SNAPSHOT_STATE_MISMATCH";

export interface ProjectionError {
  code: ProjectionErrorCode;
  message: string;
}

export type ApplyEventResult =
  | { status: "applied"; projection: ManagedBasketProjection }
  | { status: "duplicate"; projection: ManagedBasketProjection | null }
  | { status: "ignored_unconfirmed"; projection: ManagedBasketProjection | null }
  | { status: "ignored_failed_transaction"; projection: ManagedBasketProjection | null }
  | { status: "rejected"; error: ProjectionError; projection: ManagedBasketProjection | null };

export type ReconcileSnapshotResult =
  | { status: "applied"; projection: ManagedBasketProjection }
  | { status: "rejected"; error: ProjectionError; projection: ManagedBasketProjection | null };
