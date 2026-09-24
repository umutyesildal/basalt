import { describe, expect, it } from "vitest";
import { ManagedEventProjection } from "../src/managed/projection.js";
import type {
  ChainAccountSnapshot,
  ManagedBasketCreatedEvent,
  ManagedEventEnvelope,
  ManagedProgramEvent,
  PriceBoundApprovedEvent,
  RebalanceExecutedEvent,
  RebalanceProposedEvent,
} from "../src/managed/types.js";

const BASKET = "Basket11111111111111111111111111111111111";
const CREATOR = "Creator111111111111111111111111111111111";
const MANAGER = "Manager111111111111111111111111111111111";
const GUARDIAN = "Guardian1111111111111111111111111111111";
const SHARE_MINT = "Share11111111111111111111111111111111111";
const NFT_MINT = "Identity111111111111111111111111111111111";
const MINT_A = "MintA11111111111111111111111111111111111";
const MINT_B = "MintB11111111111111111111111111111111111";
const HASH_COMMIT = "ab".repeat(32);
const HASH_FINAL = "cd".repeat(32);
const HASH_OTHER = "ef".repeat(32);
const ZERO_HASH = "00".repeat(32);

function envelope(
  event: ManagedProgramEvent,
  slot: string,
  eventIndex = 0,
  signature = `sig-${slot}-${eventIndex}`,
  extra: Partial<ManagedEventEnvelope> = {},
): ManagedEventEnvelope {
  return {
    signature,
    slot,
    transactionIndex: 0,
    eventIndex,
    commitment: "confirmed",
    transactionSucceeded: true,
    event,
    ...extra,
  };
}

function created(overrides: Partial<ManagedBasketCreatedEvent> = {}): ManagedBasketCreatedEvent {
  return {
    type: "ManagedBasketCreated",
    basket: BASKET,
    creator: CREATOR,
    manager: MANAGER,
    guardian: GUARDIAN,
    share_mint: SHARE_MINT,
    identity_nft_mint: NFT_MINT,
    constituent_mints: [MINT_A, MINT_B],
    target_weights_bps: [5_000, 5_000],
    allocation_version: "0",
    total_supply_raw: "100",
    ...overrides,
  };
}

function proposal(overrides: Partial<RebalanceProposedEvent> = {}): RebalanceProposedEvent {
  return {
    type: "RebalanceProposed",
    basket: BASKET,
    nonce: "0",
    base_version: "0",
    commitment_hash: HASH_COMMIT,
    input_mint: MINT_A,
    output_mint: MINT_B,
    max_input_raw: "40",
    target_weights_bps: [2_500, 7_500],
    approval_deadline_slot: "50",
    notice_duration_slots: "10",
    execution_window_slots: "20",
    ...overrides,
  };
}

function approval(overrides: Partial<PriceBoundApprovedEvent> = {}): PriceBoundApprovedEvent {
  return {
    type: "PriceBoundApproved",
    basket: BASKET,
    nonce: "0",
    commitment_hash: HASH_COMMIT,
    proposal_hash: HASH_FINAL,
    max_input_raw: "40",
    min_output_raw: "35",
    approved_at_slot: "5",
    execute_after_slot: "15",
    // Core contract: expiry follows the notice period plus the execution window.
    expires_at_slot: "35",
    ...overrides,
  };
}

function execution(overrides: Partial<RebalanceExecutedEvent> = {}): RebalanceExecutedEvent {
  return {
    type: "RebalanceExecuted",
    basket: BASKET,
    nonce: "0",
    proposal_hash: HASH_FINAL,
    from_version: "0",
    to_version: "1",
    input_mint: MINT_A,
    output_mint: MINT_B,
    input_raw: "40",
    output_raw: "35",
    target_weights_bps: [2_500, 7_500],
    executed_at_slot: "15",
    total_supply_raw: "100",
    post_balances_raw: ["60", "135"],
    ...overrides,
  };
}

function snapshot(overrides: Partial<ChainAccountSnapshot> = {}): ChainAccountSnapshot {
  return {
    basket: BASKET,
    contextSlot: "1",
    commitment: "confirmed",
    allocationVersion: "0",
    totalSupplyRaw: "100",
    constituentMints: [MINT_A, MINT_B],
    holdingsRaw: ["100", "100"],
    ...overrides,
  };
}

function initializedProjection(): ManagedEventProjection {
  const projection = new ManagedEventProjection();
  expect(projection.apply(envelope(created(), "1")).status).toBe("applied");
  expect(projection.reconcile(snapshot()).status).toBe("applied");
  return projection;
}

function applyProposalAndApproval(projection: ManagedEventProjection): void {
  expect(projection.apply(envelope(proposal(), "2")).status).toBe("applied");
  expect(projection.apply(envelope(approval(), "5")).status).toBe("applied");
}

describe("Managed Basket V2 event projection", () => {
  it("keeps proposal and approval separate from target version and confirmed actual holdings", () => {
    const projection = initializedProjection();
    const before = projection.get(BASKET)!;
    applyProposalAndApproval(projection);
    const after = projection.get(BASKET)!;

    expect(after.allocationVersion).toBe("0");
    expect(after.targetWeightsBps).toEqual([5_000, 5_000]);
    expect(after.proposals).toMatchObject([
      {
        status: "approved",
        commitmentHash: HASH_COMMIT,
        proposalHash: HASH_FINAL,
        approvedAtSlot: "5",
        executeAfterSlot: "15",
        expiresAtSlot: "35",
      },
    ]);
    expect(after.holdings).toEqual(before.holdings);
    expect(after.holdings).toMatchObject({ status: "confirmed", holdingsRaw: ["100", "100"], contextSlot: "1" });
  });

  it("advances version only on a confirmed successful execution and waits for RPC holdings reconciliation", () => {
    const projection = initializedProjection();
    applyProposalAndApproval(projection);
    const result = projection.apply(envelope(execution(), "15"));

    expect(result.status).toBe("applied");
    const afterExecution = projection.get(BASKET)!;
    expect(afterExecution.allocationVersion).toBe("1");
    expect(afterExecution.targetWeightsBps).toEqual([2_500, 7_500]);
    expect(afterExecution.totalSupplyRaw).toBe("100");
    expect(afterExecution.proposals[0]).toMatchObject({
      status: "executed",
      execution: { inputRaw: "40", outputRaw: "35", reportedPostBalancesRaw: ["60", "135"] },
    });
    expect(afterExecution.holdings).toMatchObject({
      status: "stale",
      reason: "balance_event_after_snapshot",
      lastConfirmed: { holdingsRaw: ["100", "100"], contextSlot: "1" },
    });

    const beforeSnapshot = projection.reconcile(snapshot({
      contextSlot: "14",
      allocationVersion: "0",
      holdingsRaw: ["60", "135"],
    }));
    expect(beforeSnapshot.status).toBe("rejected");
    if (beforeSnapshot.status === "rejected") expect(beforeSnapshot.error.code).toBe("STALE_SNAPSHOT");
    expect(projection.get(BASKET)!.holdings.status).toBe("stale");

    const reconciled = projection.reconcile(snapshot({
      contextSlot: "15",
      allocationVersion: "1",
      holdingsRaw: ["60", "135"],
    }));
    expect(reconciled.status).toBe("applied");
    expect(projection.get(BASKET)!.holdings).toMatchObject({
      status: "confirmed",
      holdingsRaw: ["60", "135"],
      allocationVersion: "1",
      contextSlot: "15",
    });
  });

  it("does not infer confirmed holdings from event deltas or accept an RPC snapshot for another state", () => {
    const projection = new ManagedEventProjection();
    projection.apply(envelope(created(), "1"));
    expect(projection.get(BASKET)!.holdings).toMatchObject({ status: "stale", lastConfirmed: null });

    const wrongSupply = projection.reconcile(snapshot({ contextSlot: "2", totalSupplyRaw: "101" }));
    expect(wrongSupply.status).toBe("rejected");
    if (wrongSupply.status === "rejected") expect(wrongSupply.error.code).toBe("SNAPSHOT_STATE_MISMATCH");

    const wrongOrder = projection.reconcile(snapshot({
      contextSlot: "2",
      constituentMints: [MINT_B, MINT_A],
      holdingsRaw: ["200", "100"],
    }));
    expect(wrongOrder.status).toBe("rejected");
    if (wrongOrder.status === "rejected") expect(wrongOrder.error.code).toBe("INVALID_SNAPSHOT");

    const unconfirmed = projection.reconcile(snapshot({ contextSlot: "2", commitment: "processed" as "confirmed" }));
    expect(unconfirmed.status).toBe("rejected");
  });

  it("treats mint and redeem events as supply changes, then requires fresh account snapshots for holdings", () => {
    const projection = initializedProjection();
    const minted = projection.apply(envelope({
      type: "ManagedSharesMinted",
      basket: BASKET,
      holder: CREATOR,
      shares_minted_raw: "10",
      deposit_amounts_raw: ["10", "10"],
      total_supply_raw: "110",
    }, "2"));
    expect(minted.status).toBe("applied");
    expect(projection.get(BASKET)!.totalSupplyRaw).toBe("110");
    expect(projection.get(BASKET)!.holdings).toMatchObject({
      status: "stale",
      lastConfirmed: { holdingsRaw: ["100", "100"] },
    });

    const afterMint = projection.reconcile(snapshot({
      contextSlot: "2",
      totalSupplyRaw: "110",
      holdingsRaw: ["110", "110"],
    }));
    expect(afterMint.status).toBe("applied");

    const redeemed = projection.apply(envelope({
      type: "ManagedSharesRedeemed",
      basket: BASKET,
      holder: CREATOR,
      shares_burned_raw: "10",
      amounts_out_raw: ["10", "10"],
      total_supply_raw: "100",
    }, "3"));
    expect(redeemed.status).toBe("applied");
    expect(projection.get(BASKET)!.totalSupplyRaw).toBe("100");
    expect(projection.get(BASKET)!.holdings.status).toBe("stale");
    expect(projection.reconcile(snapshot({ contextSlot: "3", holdingsRaw: ["100", "100"] })).status).toBe("applied");
  });

  it("deduplicates replayed events and detects conflicting data under the same event identity", () => {
    const projection = new ManagedEventProjection();
    const createdEvent = envelope(created(), "1", 0, "same-signature");
    expect(projection.apply(createdEvent).status).toBe("applied");
    expect(projection.apply(createdEvent).status).toBe("duplicate");

    const collision = envelope(created({ total_supply_raw: "101" }), "1", 0, "same-signature");
    const result = projection.apply(collision);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.error.code).toBe("EVENT_ID_COLLISION");
    expect(projection.get(BASKET)!.totalSupplyRaw).toBe("100");
  });

  it("ignores processed and failed-transaction events without consuming their identities", () => {
    const projection = initializedProjection();
    const event = envelope(proposal(), "2", 0, "proposal-signature", { commitment: "processed" });
    expect(projection.apply(event).status).toBe("ignored_unconfirmed");
    expect(projection.get(BASKET)!.proposals).toHaveLength(0);

    const confirmed = { ...event, commitment: "confirmed" as const };
    expect(projection.apply(confirmed).status).toBe("applied");

    const failedExecution = envelope(execution(), "15", 0, "failed-fill", { transactionSucceeded: false });
    expect(projection.apply(failedExecution).status).toBe("ignored_failed_transaction");
    const state = projection.get(BASKET)!;
    expect(state.allocationVersion).toBe("0");
    expect(state.targetWeightsBps).toEqual([5_000, 5_000]);
    expect(state.proposals[0].status).toBe("proposed");
    expect(state.holdings).toMatchObject({ status: "confirmed", holdingsRaw: ["100", "100"] });
  });

  it("rejects stale base versions and keeps state available for the next valid proposal", () => {
    const projection = initializedProjection();
    applyProposalAndApproval(projection);
    projection.apply(envelope(execution(), "15"));

    const stale = projection.apply(envelope(proposal({
      nonce: "1",
      base_version: "0",
      commitment_hash: HASH_OTHER,
      approval_deadline_slot: "80",
    }), "16"));
    expect(stale.status).toBe("rejected");
    if (stale.status === "rejected") expect(stale.error.code).toBe("STALE_VERSION");
    expect(projection.get(BASKET)!.allocationVersion).toBe("1");
    expect(projection.get(BASKET)!.proposals).toHaveLength(1);

    const current = projection.apply(envelope(proposal({
      nonce: "1",
      base_version: "1",
      commitment_hash: HASH_OTHER,
      approval_deadline_slot: "80",
    }), "16", 1));
    expect(current.status).toBe("applied");
    expect(projection.get(BASKET)!.proposals.at(-1)?.baseVersion).toBe("1");
  });

  it("rejects out-of-order event delivery and does not allow proposal/approval to overwrite newer actual state", () => {
    const projection = initializedProjection();
    const current = projection.get(BASKET)!;
    const outOfOrder = projection.apply(envelope(proposal(), "1", 0, "older-proposal"));
    expect(outOfOrder.status).toBe("rejected");
    if (outOfOrder.status === "rejected") expect(outOfOrder.error.code).toBe("OUT_OF_ORDER_EVENT");
    expect(projection.get(BASKET)).toEqual(current);

    applyProposalAndApproval(projection);
    expect(projection.get(BASKET)!.holdings).toEqual(current.holdings);
  });

  it("rejects invalid final hashes, timing, execution bounds and non-positive post-balances", () => {
    const cases: Array<{ event: ManagedProgramEvent; expected: string }> = [
      { event: approval({ commitment_hash: HASH_OTHER }), expected: "PROPOSAL_MISMATCH" },
      { event: approval({ execute_after_slot: "14" }), expected: "INVALID_EVENT_TRANSITION" },
    ];
    for (const testCase of cases) {
      const projection = initializedProjection();
      projection.apply(envelope(proposal(), "2"));
      const result = projection.apply(envelope(testCase.event, "5"));
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.error.code).toBe(testCase.expected);
      expect(projection.get(BASKET)!.proposals[0].status).toBe("proposed");
    }

    const projection = initializedProjection();
    applyProposalAndApproval(projection);
    const invalidExecution = projection.apply(envelope(execution({
      proposal_hash: HASH_OTHER,
      output_raw: "34",
      post_balances_raw: ["0", "134"],
    }), "15"));
    expect(invalidExecution.status).toBe("rejected");
    expect(projection.get(BASKET)!.allocationVersion).toBe("0");
    expect(projection.get(BASKET)!.proposals[0].status).toBe("approved");
    expect(projection.get(BASKET)!.holdings.status).toBe("confirmed");
  });

  it("uses inclusive approval and fill deadlines, and expires only after the execution window", () => {
    const atApprovalDeadline = initializedProjection();
    atApprovalDeadline.apply(envelope(proposal(), "2"));
    const approved = atApprovalDeadline.apply(envelope(approval({
      approved_at_slot: "50",
      execute_after_slot: "60",
      expires_at_slot: "80",
    }), "50"));
    expect(approved.status).toBe("applied");

    const fillAtExpiry = initializedProjection();
    applyProposalAndApproval(fillAtExpiry);
    const executed = fillAtExpiry.apply(envelope(execution({
      executed_at_slot: "35",
    }), "35"));
    expect(executed.status).toBe("applied");
    expect(fillAtExpiry.get(BASKET)!.allocationVersion).toBe("1");

    const expireAfterWindow = initializedProjection();
    applyProposalAndApproval(expireAfterWindow);
    const atExpiry = expireAfterWindow.apply(envelope({
      type: "RebalanceExpired",
      basket: BASKET,
      nonce: "0",
      commitment_hash: HASH_COMMIT,
      proposal_hash: HASH_FINAL,
    }, "35"));
    expect(atExpiry.status).toBe("rejected");
    const afterExpiry = expireAfterWindow.apply(envelope({
      type: "RebalanceExpired",
      basket: BASKET,
      nonce: "0",
      commitment_hash: HASH_COMMIT,
      proposal_hash: HASH_FINAL,
    }, "36"));
    expect(afterExpiry.status).toBe("applied");
    expect(expireAfterWindow.get(BASKET)!.proposals[0].status).toBe("expired");
  });

  it("expires and cancels proposals without changing executed target or actual holdings", () => {
    const cancelled = initializedProjection();
    const before = cancelled.get(BASKET)!;
    cancelled.apply(envelope(proposal(), "2"));
    const cancel = cancelled.apply(envelope({
      type: "RebalanceCancelled",
      basket: BASKET,
      nonce: "0",
      commitment_hash: HASH_COMMIT,
      proposal_hash: ZERO_HASH,
    }, "3"));
    expect(cancel.status).toBe("applied");
    expect(cancelled.get(BASKET)!.proposals[0].status).toBe("cancelled");
    expect(cancelled.get(BASKET)!.targetWeightsBps).toEqual(before.targetWeightsBps);
    expect(cancelled.get(BASKET)!.holdings).toEqual(before.holdings);

    const expired = initializedProjection();
    expired.apply(envelope(proposal(), "2"));
    const earlyExpiry = expired.apply(envelope({
      type: "RebalanceExpired",
      basket: BASKET,
      nonce: "0",
      commitment_hash: HASH_COMMIT,
      proposal_hash: ZERO_HASH,
    }, "49"));
    expect(earlyExpiry.status).toBe("rejected");
    const atDeadline = expired.apply(envelope({
      type: "RebalanceExpired",
      basket: BASKET,
      nonce: "0",
      commitment_hash: HASH_COMMIT,
      proposal_hash: ZERO_HASH,
    }, "50"));
    expect(atDeadline.status).toBe("rejected");
    const expiry = expired.apply(envelope({
      type: "RebalanceExpired",
      basket: BASKET,
      nonce: "0",
      commitment_hash: HASH_COMMIT,
      proposal_hash: ZERO_HASH,
    }, "51"));
    expect(expiry.status).toBe("applied");
    expect(expired.get(BASKET)!.proposals[0].status).toBe("expired");
    expect(expired.get(BASKET)!.allocationVersion).toBe("0");
    expect(expired.get(BASKET)!.holdings).toMatchObject({ status: "confirmed", holdingsRaw: ["100", "100"] });
  });

  it("uses decimal strings beyond Number.MAX_SAFE_INTEGER and rejects numeric raw inputs", () => {
    const large = "9007199254740993";
    const projection = new ManagedEventProjection();
    const result = projection.apply(envelope(created({ total_supply_raw: large }), "1"));
    expect(result.status).toBe("applied");
    expect(projection.get(BASKET)!.totalSupplyRaw).toBe(large);

    const bad = projection.apply(envelope(created({
      basket: "OtherBasket111111111111111111111111111111",
      total_supply_raw: 9_007_199_254_740_993 as unknown as string,
    }), "2"));
    expect(bad.status).toBe("rejected");
    if (bad.status === "rejected") expect(bad.error.code).toBe("INVALID_RAW_U64");
  });
});
