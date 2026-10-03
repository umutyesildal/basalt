import { describe, expect, it } from "vitest";
import { createPipelineGuard, pipelinePresentation } from "./pipeline-state";

describe("devnet pipeline single submission", () => {
  it("locks synchronously before asynchronous preparation or a second click", async () => {
    const gate = createPipelineGuard();
    const first = gate.begin("wallet A", "mint")!;
    expect(gate.begin("wallet A", "mint")).toBeNull();
    expect(gate.begin("wallet A", "claim")).toBeNull();
    await Promise.resolve();
    expect(gate.blocked).toBe(true);
    expect(gate.snapshot()?.lease).toBe(first);
  });

  it("allows correction after a preparatory read fails without releasing started flows", () => {
    const gate = createPipelineGuard();
    const first = gate.begin("wallet A", "create")!;
    expect(gate.failPreparation(first)).toBe(true);
    const retry = gate.begin("wallet A", "create")!;
    expect(retry.id).toBeGreaterThan(first.id);
    expect(gate.start(retry)).toBe(true);
    expect(gate.failPreparation(retry)).toBe(false);
    expect(gate.blocked).toBe(true);
  });

  it("ignores stale terminal state during preparation and idle resets after starting", () => {
    const gate = createPipelineGuard();
    const lease = gate.begin("wallet A", "mint")!;
    expect(gate.observe(lease, { status: "confirmed", signature: "older signature" })).toBe(false);
    expect(gate.start(lease)).toBe(true);
    for (const status of ["idle", "simulating", "awaiting-signature"] as const) {
      expect(gate.observe(lease, { status, signature: null })).toBe(false);
      expect(gate.blocked).toBe(true);
    }
  });

  it.each(["failed", "rejected"] as const)("releases an unsent %s result for user correction", (status) => {
    const gate = createPipelineGuard();
    const lease = gate.begin("wallet A", "mint")!;
    gate.start(lease);
    expect(gate.observe(lease, { status, signature: null })).toBe(true);
    expect(gate.begin("wallet A", "mint")).not.toBeNull();
  });

  it.each(["confirmed", "failed"] as const)("releases a known transaction only for its actual %s outcome", (status) => {
    const gate = createPipelineGuard();
    const lease = gate.begin("wallet A", "redeem")!;
    gate.start(lease);
    gate.observe(lease, { status: "confirming", signature: "redeem signature" });
    expect(gate.observe(lease, { status, signature: "unrelated signature" })).toBe(false);
    expect(gate.observe(lease, { status, signature: "redeem signature" })).toBe(true);
    expect(gate.blocked).toBe(false);
  });

  it("keeps an ambiguous submitted send blocked across wallet swaps and refresh/reset", () => {
    const gate = createPipelineGuard();
    const lease = gate.begin("wallet A", "mint")!;
    gate.start(lease);
    gate.observe(lease, { status: "submitted", signature: "mint signature" });
    expect(gate.snapshot()?.phase).toBe("submitted");
    expect(gate.begin("wallet B", "mint")).toBeNull();
    expect(gate.begin("wallet B", "redeem")).toBeNull();
    expect(gate.failPreparation(lease)).toBe(false);
    expect(gate.observe(lease, { status: "idle", signature: null })).toBe(false);
    expect(gate.observe(lease, { status: "failed", signature: null })).toBe(false);
    expect(gate.observe(lease, { status: "confirmed", signature: "mint signature" })).toBe(false);
    expect(gate.blocked).toBe(true);
  });

  it.each(["confirmed", "failed"] as const)("resolves a submitted signature from an explicit %s status lookup", (outcome) => {
    const gate = createPipelineGuard();
    const lease = gate.begin("wallet A", "create")!;
    gate.start(lease);
    gate.observe(lease, { status: "submitted", signature: "creation signature" });
    expect(gate.resolveSubmitted(lease, "other signature", outcome)).toBe(false);
    expect(gate.resolveSubmitted(lease, "creation signature", outcome)).toBe(true);
    expect(gate.begin("wallet B", "create")).not.toBeNull();
  });

  it("does not release for unknown/pending status or a fabricated copy of a lease", () => {
    const gate = createPipelineGuard();
    const lease = gate.begin("wallet A", "mint")!;
    gate.start(lease);
    gate.observe(lease, { status: "submitted", signature: "mint signature" });
    expect(gate.resolveSubmitted({ ...lease }, "mint signature", "confirmed")).toBe(false);
    expect(gate.resolveSubmitted(lease, "mint signature", "pending" as "confirmed")).toBe(false);
    expect(gate.blocked).toBe(true);
  });

  it("does not let an old completed request release a newer operation", () => {
    const gate = createPipelineGuard();
    const first = gate.begin("wallet A", "claim")!;
    gate.start(first);
    gate.observe(first, { status: "confirmed", signature: "claim signature" });
    const current = gate.begin("wallet A", "mint")!;
    gate.start(current);
    expect(gate.observe(first, { status: "confirmed", signature: "claim signature" })).toBe(false);
    expect(gate.failPreparation(first)).toBe(false);
    expect(gate.snapshot()?.lease).toBe(current);
  });

  it("retains an existing signature when a stale sign error arrives", () => {
    const gate = createPipelineGuard();
    const lease = gate.begin("wallet A", "mint")!;
    gate.start(lease);
    gate.observe(lease, { status: "confirming", signature: "mint signature" });
    expect(gate.observe(lease, { status: "rejected", signature: null })).toBe(false);
    expect(gate.observe(lease, { status: "failed", signature: null })).toBe(false);
    expect(gate.blocked).toBe(true);
  });
});

describe("devnet pipeline progress", () => {
  it("keeps a submitted result blocked even after active polling ends", () => {
    expect(pipelinePresentation("submitted")).toEqual({ label: "Transaction sent", phase: "pending", blocked: true });
    expect(pipelinePresentation("confirmed").blocked).toBe(false);
  });

  it("uses a human action for the wallet and distinguishes preparation from confirmation", () => {
    expect(pipelinePresentation("awaiting-signature")).toEqual({ label: "Confirm in your wallet", phase: "wallet", blocked: true });
    expect(pipelinePresentation("preparing-alt", { setupProgress: { step: 1, total: 2 } }).label).toBe("Setting up your basket (1/2)");
    expect(pipelinePresentation("confirming").phase).toBe("confirming");
    expect(pipelinePresentation("confirmed", { preparing: true }).blocked).toBe(true);
  });
});
