import type {
  ApplyEventResult,
  ChainAccountSnapshot,
  ConfirmedHoldings,
  EventCursor,
  Hash32Hex,
  HoldingsProjection,
  ManagedBasketProjection,
  ManagedEventEnvelope,
  ManagedProgramEvent,
  ManagedProposalProjection,
  Pair,
  ProjectionError,
  ProjectionErrorCode,
  ReconcileSnapshotResult,
  RawU64,
} from "./types.js";

const U64_MAX = (1n << 64n) - 1n;
const BPS = 10_000;
const ZERO_HASH = "0".repeat(64);

/** Validate a decoded on-chain u64 and preserve its integer-safe representation. */
export function canonicalRawU64(value: unknown, field: string): RawU64 {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw projectionError("INVALID_RAW_U64", `${field} must be a canonical decimal string`);
  }
  let amount: bigint;
  try {
    amount = BigInt(value);
  } catch {
    throw projectionError("INVALID_RAW_U64", `${field} is not a valid u64`);
  }
  if (amount > U64_MAX) throw projectionError("INVALID_RAW_U64", `${field} exceeds u64`);
  return value;
}

function projectionError(code: ProjectionErrorCode, message: string): ProjectionError {
  return { code, message };
}

function bigint(value: RawU64, field: string): bigint {
  return BigInt(canonicalRawU64(value, field));
}

function requireKey(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw projectionError("INVALID_EVENT", `${field} must be a non-empty canonical key string`);
  }
  return value;
}

function requireHash(value: unknown, field: string): Hash32Hex {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw projectionError("INVALID_HASH", `${field} must be a 32-byte hex string`);
  }
  return value.toLowerCase();
}

function requirePair<T>(value: unknown, field: string): Pair<T> {
  if (!Array.isArray(value) || value.length !== 2) {
    throw projectionError("INVALID_EVENT", `${field} must contain exactly two ordered values`);
  }
  return value as unknown as Pair<T>;
}

function validateWeights(weightsValue: unknown, field: string): Pair<number> {
  const weights = requirePair<number>(weightsValue, field);
  if (
    !weights.every((weight) => Number.isSafeInteger(weight) && weight > 0 && weight < BPS) ||
    weights[0] + weights[1] !== BPS
  ) {
    throw projectionError("INVALID_EVENT", `${field} must be two positive integer weights summing to 10000`);
  }
  return [weights[0], weights[1]];
}

function rawPair(value: unknown, field: string, requirePositive = false): Pair<RawU64> {
  const pair = requirePair<unknown>(value, field);
  const left = canonicalRawU64(pair[0], `${field}[0]`);
  const right = canonicalRawU64(pair[1], `${field}[1]`);
  if (requirePositive && (left === "0" || right === "0")) {
    throw projectionError("INVALID_EVENT", `${field} must contain positive raw amounts`);
  }
  return [left, right];
}

function addressPair(value: unknown, field: string): Pair<string> {
  const pair = requirePair<unknown>(value, field);
  const left = requireKey(pair[0], `${field}[0]`);
  const right = requireKey(pair[1], `${field}[1]`);
  if (left === right) throw projectionError("INVALID_EVENT", `${field} must contain distinct keys`);
  return [left, right];
}

function cloneProposal(proposal: ManagedProposalProjection): ManagedProposalProjection {
  return {
    ...proposal,
    targetWeightsBps: [proposal.targetWeightsBps[0], proposal.targetWeightsBps[1]],
    execution: proposal.execution ? { ...proposal.execution, reportedPostBalancesRaw: [...proposal.execution.reportedPostBalancesRaw] as Pair<RawU64> } : null,
  };
}

function cloneHoldings(holdings: HoldingsProjection): HoldingsProjection {
  if (holdings.status === "confirmed") {
    return { ...holdings, holdingsRaw: [...holdings.holdingsRaw] as Pair<RawU64> };
  }
  return {
    ...holdings,
    lastConfirmed: holdings.lastConfirmed
      ? { ...holdings.lastConfirmed, holdingsRaw: [...holdings.lastConfirmed.holdingsRaw] as Pair<RawU64> }
      : null,
  };
}

function cloneProjection(projection: ManagedBasketProjection): ManagedBasketProjection {
  return {
    ...projection,
    constituentMints: [...projection.constituentMints] as Pair<string>,
    targetWeightsBps: [...projection.targetWeightsBps] as Pair<number>,
    proposals: projection.proposals.map(cloneProposal),
    holdings: cloneHoldings(projection.holdings),
    lastEvent: { ...projection.lastEvent },
  };
}

function cloneEvent(event: ManagedProgramEvent): ManagedProgramEvent {
  if (event.type === "ManagedBasketCreated") {
    return {
      ...event,
      constituent_mints: [...event.constituent_mints] as Pair<string>,
      target_weights_bps: [...event.target_weights_bps] as Pair<number>,
    };
  }
  if (event.type === "ManagedSharesMinted") {
    return { ...event, deposit_amounts_raw: [...event.deposit_amounts_raw] as Pair<RawU64> };
  }
  if (event.type === "ManagedSharesRedeemed") {
    return { ...event, amounts_out_raw: [...event.amounts_out_raw] as Pair<RawU64> };
  }
  if (event.type === "RebalanceProposed") {
    return { ...event, target_weights_bps: [...event.target_weights_bps] as Pair<number> };
  }
  if (event.type === "RebalanceExecuted") {
    return {
      ...event,
      target_weights_bps: [...event.target_weights_bps] as Pair<number>,
      post_balances_raw: [...event.post_balances_raw] as Pair<RawU64>,
    };
  }
  return { ...event };
}

function cursorOf(envelope: ManagedEventEnvelope): EventCursor {
  return {
    slot: canonicalRawU64(envelope.slot, "envelope.slot"),
    transactionIndex: envelope.transactionIndex,
    eventIndex: envelope.eventIndex,
    signature: envelope.signature,
  };
}

function validateEnvelope(envelope: ManagedEventEnvelope): void {
  if (!envelope || typeof envelope !== "object") {
    throw projectionError("INVALID_EVENT", "event envelope is required");
  }
  requireKey(envelope.signature, "envelope.signature");
  cursorOf(envelope);
  for (const [name, value] of [
    ["transactionIndex", envelope.transactionIndex],
    ["eventIndex", envelope.eventIndex],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw projectionError("INVALID_EVENT", `envelope.${name} must be a non-negative safe integer`);
    }
  }
  if (!["processed", "confirmed", "finalized"].includes(envelope.commitment)) {
    throw projectionError("INVALID_EVENT", "unsupported event commitment");
  }
  if (typeof envelope.transactionSucceeded !== "boolean") {
    throw projectionError("INVALID_EVENT", "transactionSucceeded must be boolean");
  }
  if (!envelope.event || typeof envelope.event !== "object" || typeof envelope.event.type !== "string") {
    throw projectionError("INVALID_EVENT", "decoded managed event is required");
  }
}

function compareCursor(left: EventCursor, right: EventCursor): number {
  const leftSlot = bigint(left.slot, "cursor.slot");
  const rightSlot = bigint(right.slot, "cursor.slot");
  if (leftSlot !== rightSlot) return leftSlot < rightSlot ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex < right.transactionIndex ? -1 : 1;
  if (left.eventIndex !== right.eventIndex) return left.eventIndex < right.eventIndex ? -1 : 1;
  return left.signature.localeCompare(right.signature);
}

function eventKey(envelope: ManagedEventEnvelope): string {
  return `${envelope.signature}:${envelope.eventIndex}`;
}

function eventFingerprint(envelope: ManagedEventEnvelope): string {
  return JSON.stringify({ slot: envelope.slot, transactionIndex: envelope.transactionIndex, event: envelope.event });
}

function reject(
  code: ProjectionErrorCode,
  message: string,
  projection: ManagedBasketProjection | null,
): ApplyEventResult {
  return { status: "rejected", error: projectionError(code, message), projection: projection ? cloneProjection(projection) : null };
}

function staleHoldings(holdings: HoldingsProjection, reason: Extract<HoldingsProjection, { status: "stale" }>['reason']): HoldingsProjection {
  const lastConfirmed = holdings.status === "confirmed" ? holdings : holdings.lastConfirmed;
  return { status: "stale", lastConfirmed: lastConfirmed ? cloneHoldings({ ...lastConfirmed, status: "confirmed" }) as ConfirmedHoldings : null, reason };
}

function latestProposal(projection: ManagedBasketProjection): ManagedProposalProjection | null {
  const proposal = projection.proposals.at(-1);
  return proposal && (proposal.status === "proposed" || proposal.status === "approved") ? proposal : null;
}

function checkBasket(projection: ManagedBasketProjection, basket: unknown): void {
  if (basket !== projection.basket) throw projectionError("BASKET_MISMATCH", "event basket does not match projection");
}

function currentHash(proposal: ManagedProposalProjection): string {
  return proposal.proposalHash ?? proposal.commitmentHash;
}

function assertProposalIdentity(
  proposal: ManagedProposalProjection,
  nonce: unknown,
  commitmentHash: unknown,
  proposalHash: unknown,
): void {
  if (
    nonce !== proposal.nonce ||
    requireHash(commitmentHash, "event.commitment_hash") !== proposal.commitmentHash
  ) {
    throw projectionError("PROPOSAL_MISMATCH", "event does not identify the active proposal");
  }
  const hash = requireHash(proposalHash, "event.proposal_hash");
  if (proposal.proposalHash !== null && hash !== proposal.proposalHash) {
    throw projectionError("PROPOSAL_MISMATCH", "event final proposal hash does not match guardian approval");
  }
  // The Anchor event uses a zero sentinel before approval because no final
  // executable hash exists yet. commitment_hash still identifies the proposal.
  if (proposal.proposalHash === null && hash !== ZERO_HASH) {
    throw projectionError("PROPOSAL_MISMATCH", "unapproved terminal event must use the zero proposal-hash sentinel");
  }
}

function findProposalIndex(projection: ManagedBasketProjection, nonce: RawU64): number {
  return projection.proposals.findIndex((proposal) => proposal.nonce === nonce);
}

function updateProposal(
  projection: ManagedBasketProjection,
  index: number,
  update: (proposal: ManagedProposalProjection) => ManagedProposalProjection,
): void {
  const proposals = projection.proposals.map((proposal, currentIndex) =>
    currentIndex === index ? update(cloneProposal(proposal)) : cloneProposal(proposal),
  );
  projection.proposals = proposals;
}

function markBalanceMutation(projection: ManagedBasketProjection, slot: RawU64): void {
  projection.lastBalanceChangeSlot = slot;
  const confirmed = projection.holdings.status === "confirmed" ? projection.holdings : projection.holdings.lastConfirmed;
  if (!confirmed || bigint(confirmed.contextSlot, "holdings.contextSlot") < bigint(slot, "balance-change slot")) {
    projection.holdings = staleHoldings(projection.holdings, "balance_event_after_snapshot");
    return;
  }
  if (
    confirmed.allocationVersion !== projection.allocationVersion ||
    confirmed.totalSupplyRaw !== projection.totalSupplyRaw
  ) {
    projection.holdings = staleHoldings(projection.holdings, "snapshot_state_mismatch");
    return;
  }
  projection.holdings = cloneHoldings(confirmed);
}

function createProjection(event: Extract<ManagedProgramEvent, { type: "ManagedBasketCreated" }>, cursor: EventCursor): ManagedBasketProjection {
  const basket = requireKey(event.basket, "basket");
  const creator = requireKey(event.creator, "creator");
  const manager = requireKey(event.manager, "manager");
  const guardian = requireKey(event.guardian, "guardian");
  const shareMint = requireKey(event.share_mint, "share_mint");
  const identityNftMint = requireKey(event.identity_nft_mint, "identity_nft_mint");
  const constituentMints = addressPair(event.constituent_mints, "constituent_mints");
  const targetWeightsBps = validateWeights(event.target_weights_bps, "target_weights_bps");
  const allocationVersion = canonicalRawU64(event.allocation_version, "allocation_version");
  const totalSupplyRaw = canonicalRawU64(event.total_supply_raw, "total_supply_raw");
  if (manager === guardian) throw projectionError("INVALID_EVENT", "manager and guardian must be distinct");
  if (allocationVersion !== "0" || totalSupplyRaw === "0") {
    throw projectionError("INVALID_EVENT", "created basket must have version zero and positive share supply");
  }
  return {
    basket,
    creator,
    manager,
    guardian,
    shareMint,
    identityNftMint,
    constituentMints,
    targetWeightsBps,
    allocationVersion,
    totalSupplyRaw,
    latestProposalNonce: null,
    lastBalanceChangeSlot: cursor.slot,
    proposals: [],
    holdings: { status: "stale", lastConfirmed: null, reason: "awaiting_chain_snapshot" },
    lastEvent: cursor,
  };
}

function validateProposalEvent(
  projection: ManagedBasketProjection,
  event: Extract<ManagedProgramEvent, { type: "RebalanceProposed" }>,
  cursor: EventCursor,
): ManagedProposalProjection {
  const nonce = canonicalRawU64(event.nonce, "nonce");
  const baseVersion = canonicalRawU64(event.base_version, "base_version");
  if (baseVersion !== projection.allocationVersion) {
    throw projectionError("STALE_VERSION", "proposal base_version does not equal the latest executed version");
  }
  if (projection.latestProposalNonce !== null && bigint(nonce, "nonce") <= bigint(projection.latestProposalNonce, "latestProposalNonce")) {
    throw projectionError("NON_MONOTONIC_NONCE", "proposal nonce must increase monotonically");
  }
  const commitmentHash = requireHash(event.commitment_hash, "commitment_hash");
  const inputMint = requireKey(event.input_mint, "input_mint");
  const outputMint = requireKey(event.output_mint, "output_mint");
  const inputIndex = projection.constituentMints.indexOf(inputMint);
  const outputIndex = projection.constituentMints.indexOf(outputMint);
  if (inputIndex < 0 || outputIndex < 0 || inputIndex === outputIndex) {
    throw projectionError("INVALID_EVENT", "proposal pair must use two distinct fixed constituents");
  }
  const maxInputRaw = canonicalRawU64(event.max_input_raw, "max_input_raw");
  const approvalDeadlineSlot = canonicalRawU64(event.approval_deadline_slot, "approval_deadline_slot");
  const noticeDurationSlots = canonicalRawU64(event.notice_duration_slots, "notice_duration_slots");
  const executionWindowSlots = canonicalRawU64(event.execution_window_slots, "execution_window_slots");
  if (
    maxInputRaw === "0" ||
    noticeDurationSlots === "0" ||
    executionWindowSlots === "0" ||
    bigint(approvalDeadlineSlot, "approval_deadline_slot") <= bigint(cursor.slot, "proposal slot")
  ) {
    throw projectionError("INVALID_EVENT", "proposal amounts and timing must be positive and unexpired");
  }
  return {
    nonce,
    baseVersion,
    commitmentHash,
    proposalHash: null,
    inputMint,
    outputMint,
    maxInputRaw,
    minOutputRaw: null,
    targetWeightsBps: validateWeights(event.target_weights_bps, "target_weights_bps"),
    proposedAtSlot: cursor.slot,
    approvalDeadlineSlot,
    noticeDurationSlots,
    executionWindowSlots,
    approvedAtSlot: null,
    executeAfterSlot: null,
    expiresAtSlot: null,
    status: "proposed",
    execution: null,
  };
}

function reduceEvent(
  current: ManagedBasketProjection | null,
  envelope: ManagedEventEnvelope,
  cursor: EventCursor,
): ManagedBasketProjection {
  const event = envelope.event;
  if (event.type === "ManagedBasketCreated") {
    if (current) throw projectionError("BASKET_ALREADY_CREATED", "basket creation event was already applied");
    if (event.basket !== requireKey(event.basket, "basket")) throw projectionError("INVALID_EVENT", "invalid basket key");
    return createProjection(event, cursor);
  }
  if (!current) throw projectionError("BASKET_NOT_CREATED", "managed basket must be created before its events");
  const next = cloneProjection(current);
  checkBasket(next, event.basket);
  if (compareCursor(cursor, next.lastEvent) <= 0) {
    throw projectionError("OUT_OF_ORDER_EVENT", "event cursor must advance monotonically");
  }

  switch (event.type) {
    case "ManagedSharesMinted": {
      const minted = canonicalRawU64(event.shares_minted_raw, "shares_minted_raw");
      const deposits = rawPair(event.deposit_amounts_raw, "deposit_amounts_raw", true);
      const newSupply = canonicalRawU64(event.total_supply_raw, "total_supply_raw");
      if (minted === "0" || bigint(newSupply, "total_supply_raw") !== bigint(next.totalSupplyRaw, "current supply") + bigint(minted, "shares_minted_raw")) {
        throw projectionError("INVALID_SUPPLY", "mint event supply must equal current supply plus minted shares");
      }
      next.totalSupplyRaw = newSupply;
      markBalanceMutation(next, cursor.slot);
      break;
    }
    case "ManagedSharesRedeemed": {
      const burned = canonicalRawU64(event.shares_burned_raw, "shares_burned_raw");
      rawPair(event.amounts_out_raw, "amounts_out_raw");
      const newSupply = canonicalRawU64(event.total_supply_raw, "total_supply_raw");
      if (
        burned === "0" ||
        bigint(burned, "shares_burned_raw") > bigint(next.totalSupplyRaw, "current supply") ||
        bigint(newSupply, "total_supply_raw") !== bigint(next.totalSupplyRaw, "current supply") - bigint(burned, "shares_burned_raw")
      ) {
        throw projectionError("INVALID_SUPPLY", "redeem event supply must equal current supply minus burned shares");
      }
      next.totalSupplyRaw = newSupply;
      markBalanceMutation(next, cursor.slot);
      break;
    }
    case "RebalanceProposed": {
      if (latestProposal(next)) throw projectionError("INVALID_EVENT_TRANSITION", "another proposal is still active");
      const proposal = validateProposalEvent(next, event, cursor);
      next.latestProposalNonce = proposal.nonce;
      next.proposals = [...next.proposals.map(cloneProposal), proposal];
      break;
    }
    case "PriceBoundApproved": {
      const proposal = latestProposal(next);
      if (!proposal || proposal.status !== "proposed") throw projectionError("NO_PENDING_PROPOSAL", "no unapproved proposal is active");
      const nonce = canonicalRawU64(event.nonce, "nonce");
      if (nonce !== proposal.nonce || requireHash(event.commitment_hash, "commitment_hash") !== proposal.commitmentHash) {
        throw projectionError("PROPOSAL_MISMATCH", "price approval does not match the active commitment");
      }
      const maxInputRaw = canonicalRawU64(event.max_input_raw, "max_input_raw");
      const minOutputRaw = canonicalRawU64(event.min_output_raw, "min_output_raw");
      const approvedAtSlot = canonicalRawU64(event.approved_at_slot, "approved_at_slot");
      const executeAfterSlot = canonicalRawU64(event.execute_after_slot, "execute_after_slot");
      const expiresAtSlot = canonicalRawU64(event.expires_at_slot, "expires_at_slot");
      const expectedExecuteAfter = bigint(approvedAtSlot, "approved_at_slot") + bigint(proposal.noticeDurationSlots, "notice_duration_slots");
      const expectedExpiry = expectedExecuteAfter + bigint(proposal.executionWindowSlots, "execution_window_slots");
      if (
        approvedAtSlot !== cursor.slot ||
        bigint(approvedAtSlot, "approved_at_slot") > bigint(proposal.approvalDeadlineSlot, "approval_deadline_slot") ||
        maxInputRaw !== proposal.maxInputRaw ||
        minOutputRaw === "0" ||
        bigint(executeAfterSlot, "execute_after_slot") !== expectedExecuteAfter ||
        bigint(expiresAtSlot, "expires_at_slot") !== expectedExpiry ||
        bigint(expiresAtSlot, "expires_at_slot") <= bigint(executeAfterSlot, "execute_after_slot")
      ) {
        throw projectionError("INVALID_EVENT_TRANSITION", "approval price bound or derived timing is invalid");
      }
      const proposalHash = requireHash(event.proposal_hash, "proposal_hash");
      const index = findProposalIndex(next, proposal.nonce);
      updateProposal(next, index, (old) => ({
        ...old,
        proposalHash,
        minOutputRaw,
        approvedAtSlot,
        executeAfterSlot,
        expiresAtSlot,
        status: "approved",
      }));
      break;
    }
    case "RebalanceCancelled":
    case "RebalanceExpired": {
      const proposal = latestProposal(next);
      if (!proposal) throw projectionError("NO_PENDING_PROPOSAL", "no active proposal can transition to a terminal state");
      assertProposalIdentity(proposal, event.nonce, event.commitment_hash, event.proposal_hash);
      if (event.type === "RebalanceExpired") {
        const deadline = proposal.status === "approved" ? proposal.expiresAtSlot : proposal.approvalDeadlineSlot;
        if (deadline === null || bigint(cursor.slot, "event slot") <= bigint(deadline, "proposal expiry")) {
          throw projectionError("INVALID_EVENT_TRANSITION", "proposal cannot expire before its applicable deadline");
        }
      }
      const index = findProposalIndex(next, proposal.nonce);
      updateProposal(next, index, (old) => ({ ...old, status: event.type === "RebalanceCancelled" ? "cancelled" : "expired" }));
      break;
    }
    case "RebalanceExecuted": {
      const proposal = latestProposal(next);
      if (!proposal || proposal.status !== "approved" || proposal.proposalHash === null) {
        throw projectionError("NO_PENDING_PROPOSAL", "no approved proposal can execute");
      }
      const nonce = canonicalRawU64(event.nonce, "nonce");
      const proposalHash = requireHash(event.proposal_hash, "proposal_hash");
      if (nonce !== proposal.nonce || proposalHash !== proposal.proposalHash) {
        throw projectionError("PROPOSAL_MISMATCH", "execution does not match the final approved proposal");
      }
      const fromVersion = canonicalRawU64(event.from_version, "from_version");
      const toVersion = canonicalRawU64(event.to_version, "to_version");
      const inputMint = requireKey(event.input_mint, "input_mint");
      const outputMint = requireKey(event.output_mint, "output_mint");
      const inputRaw = canonicalRawU64(event.input_raw, "input_raw");
      const outputRaw = canonicalRawU64(event.output_raw, "output_raw");
      const targetWeightsBps = validateWeights(event.target_weights_bps, "target_weights_bps");
      const executedAtSlot = canonicalRawU64(event.executed_at_slot, "executed_at_slot");
      const totalSupplyRaw = canonicalRawU64(event.total_supply_raw, "total_supply_raw");
      const postBalancesRaw = rawPair(event.post_balances_raw, "post_balances_raw", true);
      const expectedToVersion = bigint(next.allocationVersion, "allocation_version") + 1n;
      const inputIndex = next.constituentMints.indexOf(inputMint);
      const outputIndex = next.constituentMints.indexOf(outputMint);
      if (
        fromVersion !== next.allocationVersion ||
        bigint(toVersion, "to_version") !== expectedToVersion ||
        bigint(proposal.baseVersion, "base_version") !== bigint(fromVersion, "from_version") ||
        inputMint !== proposal.inputMint ||
        outputMint !== proposal.outputMint ||
        inputRaw !== proposal.maxInputRaw ||
        proposal.minOutputRaw === null ||
        bigint(outputRaw, "output_raw") < bigint(proposal.minOutputRaw, "min_output_raw") ||
        inputRaw === "0" ||
        outputRaw === "0" ||
        executedAtSlot !== cursor.slot ||
        bigint(cursor.slot, "event slot") < bigint(proposal.executeAfterSlot!, "execute_after_slot") ||
        bigint(cursor.slot, "event slot") > bigint(proposal.expiresAtSlot!, "expires_at_slot") ||
        totalSupplyRaw !== next.totalSupplyRaw ||
        targetWeightsBps[0] !== proposal.targetWeightsBps[0] ||
        targetWeightsBps[1] !== proposal.targetWeightsBps[1] ||
        inputIndex < 0 ||
        outputIndex < 0 ||
        inputIndex === outputIndex
      ) {
        throw projectionError("INVALID_EXECUTION", "execution does not satisfy its approved proposal or version bounds");
      }

      const previousConfirmed = next.holdings.status === "confirmed" ? next.holdings : next.holdings.lastConfirmed;
      if (previousConfirmed && bigint(previousConfirmed.contextSlot, "snapshot slot") < bigint(cursor.slot, "execution slot")) {
        const before = previousConfirmed.holdingsRaw.map((value) => bigint(value, "snapshot raw amount"));
        const after = postBalancesRaw.map((value) => bigint(value, "post balance raw amount"));
        if (
          before[inputIndex] - bigint(inputRaw, "input_raw") !== after[inputIndex] ||
          before[outputIndex] + bigint(outputRaw, "output_raw") !== after[outputIndex]
        ) {
          throw projectionError("INVALID_EXECUTION", "event post balances do not reconcile with the last confirmed snapshot");
        }
      }

      next.allocationVersion = toVersion;
      next.targetWeightsBps = targetWeightsBps;
      const index = findProposalIndex(next, proposal.nonce);
      updateProposal(next, index, (old) => ({
        ...old,
        status: "executed",
        execution: {
          inputRaw,
          outputRaw,
          executedAtSlot,
          fromVersion,
          toVersion,
          reportedPostBalancesRaw: postBalancesRaw,
        },
      }));
      markBalanceMutation(next, cursor.slot);
      break;
    }
  }
  next.lastEvent = cursor;
  return next;
}

function validateSnapshot(snapshot: ChainAccountSnapshot): void {
  if (!snapshot || typeof snapshot !== "object") throw projectionError("INVALID_SNAPSHOT", "account snapshot is required");
  requireKey(snapshot.basket, "snapshot.basket");
  canonicalRawU64(snapshot.contextSlot, "snapshot.contextSlot");
  canonicalRawU64(snapshot.allocationVersion, "snapshot.allocationVersion");
  canonicalRawU64(snapshot.totalSupplyRaw, "snapshot.totalSupplyRaw");
  addressPair(snapshot.constituentMints, "snapshot.constituentMints");
  rawPair(snapshot.holdingsRaw, "snapshot.holdingsRaw");
  if (snapshot.commitment !== "confirmed" && snapshot.commitment !== "finalized") {
    throw projectionError("INVALID_SNAPSHOT", "only confirmed or finalized account snapshots are eligible");
  }
}

/**
 * Confirmed-event projection and RPC account reconciliation for Managed V2.
 * This class is read-only: it has no wallet, keypair, transaction builder, or
 * signer dependency. Unconfirmed/failed events are ignored and can never
 * change the portfolio version or holdings.
 */
export class ManagedEventProjection {
  private readonly baskets = new Map<string, ManagedBasketProjection>();
  private readonly processedEventFingerprints = new Map<string, string>();

  apply(envelope: ManagedEventEnvelope): ApplyEventResult {
    const basketKey = envelope?.event?.basket;
    const current = typeof basketKey === "string" ? this.baskets.get(basketKey) ?? null : null;
    try {
      validateEnvelope(envelope);
    } catch (error) {
      const typed = error as ProjectionError;
      return reject(typed.code ?? "INVALID_EVENT", typed.message ?? "invalid event envelope", current);
    }

    if (!envelope.transactionSucceeded) {
      return { status: "ignored_failed_transaction", projection: current ? cloneProjection(current) : null };
    }
    if (envelope.commitment === "processed") {
      return { status: "ignored_unconfirmed", projection: current ? cloneProjection(current) : null };
    }

    const id = eventKey(envelope);
    const fingerprint = eventFingerprint(envelope);
    const previousFingerprint = this.processedEventFingerprints.get(id);
    if (previousFingerprint !== undefined) {
      if (previousFingerprint !== fingerprint) {
        return reject("EVENT_ID_COLLISION", "same signature/event index was supplied with different event data", current);
      }
      return { status: "duplicate", projection: current ? cloneProjection(current) : null };
    }

    try {
      const cursor = cursorOf(envelope);
      const next = reduceEvent(current, envelope, cursor);
      this.baskets.set(next.basket, next);
      this.processedEventFingerprints.set(id, fingerprint);
      return { status: "applied", projection: cloneProjection(next) };
    } catch (error) {
      const typed = error as ProjectionError;
      return reject(typed.code ?? "INVALID_EVENT", typed.message ?? "managed event rejected", current);
    }
  }

  /** Apply actual balances only from a confirmed/finalized RPC account snapshot. */
  reconcile(snapshot: ChainAccountSnapshot): ReconcileSnapshotResult {
    const current = snapshot && typeof snapshot.basket === "string" ? this.baskets.get(snapshot.basket) ?? null : null;
    try {
      validateSnapshot(snapshot);
      if (!current) throw projectionError("BASKET_NOT_CREATED", "cannot reconcile before the confirmed creation event");
      if (snapshot.basket !== current.basket) throw projectionError("BASKET_MISMATCH", "snapshot basket does not match projection");
      const mints = addressPair(snapshot.constituentMints, "snapshot.constituentMints");
      if (mints[0] !== current.constituentMints[0] || mints[1] !== current.constituentMints[1]) {
        throw projectionError("INVALID_SNAPSHOT", "snapshot constituent order does not match the immutable basket order");
      }
      if (bigint(snapshot.contextSlot, "snapshot.contextSlot") < bigint(current.lastBalanceChangeSlot, "lastBalanceChangeSlot")) {
        throw projectionError("STALE_SNAPSHOT", "snapshot predates the latest projected balance mutation");
      }
      if (snapshot.allocationVersion !== current.allocationVersion || snapshot.totalSupplyRaw !== current.totalSupplyRaw) {
        throw projectionError("SNAPSHOT_STATE_MISMATCH", "snapshot version or share supply does not match confirmed events");
      }
      const next = cloneProjection(current);
      const holdings: ConfirmedHoldings = {
        status: "confirmed",
        holdingsRaw: rawPair(snapshot.holdingsRaw, "snapshot.holdingsRaw"),
        contextSlot: canonicalRawU64(snapshot.contextSlot, "snapshot.contextSlot"),
        commitment: snapshot.commitment,
        allocationVersion: canonicalRawU64(snapshot.allocationVersion, "snapshot.allocationVersion"),
        totalSupplyRaw: canonicalRawU64(snapshot.totalSupplyRaw, "snapshot.totalSupplyRaw"),
      };
      next.holdings = holdings;
      this.baskets.set(next.basket, next);
      return { status: "applied", projection: cloneProjection(next) };
    } catch (error) {
      const typed = error as ProjectionError;
      const code = typed.code ?? "INVALID_SNAPSHOT";
      return {
        status: "rejected",
        error: projectionError(code, typed.message ?? "chain snapshot rejected"),
        projection: current ? cloneProjection(current) : null,
      };
    }
  }

  get(basket: string): ManagedBasketProjection | null {
    const projection = this.baskets.get(basket);
    return projection ? cloneProjection(projection) : null;
  }
}
