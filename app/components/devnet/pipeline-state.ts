/** Local UI coordination only. Token transfers stay in the existing transaction flow. */
export type PipelineAction = "claim" | "create" | "mint" | "redeem";
export type PipelineStatus =
  | "idle" | "preparing-alt" | "simulating" | "awaiting-signature"
  | "confirming" | "confirmed" | "submitted" | "failed" | "rejected";

export interface PipelineLease {
  readonly id: number;
  readonly owner: string;
  readonly action: PipelineAction;
}

export interface PipelineSnapshot {
  readonly lease: PipelineLease;
  readonly phase: "preparing" | "executing" | "submitted";
  readonly signature: string | null;
}

/**
 * Acquire before the first await. React state alone cannot stop two clicks in
 * the same render. A wallet change never clears a sent transaction's lease.
 * Only an actual terminal flow result or resolution of its exact submitted
 * signature can release an executing lease. Reset/idle cannot release it.
 */
export function createPipelineGuard() {
  let nextId = 0;
  let current: PipelineSnapshot | null = null;
  const matches = (lease: PipelineLease) => current?.lease === lease;

  return {
    get blocked(): boolean { return current !== null; },
    snapshot(): PipelineSnapshot | null {
      return current ? { ...current } : null;
    },
    begin(owner: string, action: PipelineAction): PipelineLease | null {
      if (current || !owner) return null;
      const lease = Object.freeze({ id: ++nextId, owner, action });
      current = { lease, phase: "preparing", signature: null };
      return lease;
    },
    start(lease: PipelineLease): boolean {
      if (!matches(lease) || current?.phase !== "preparing") return false;
      current = { ...current, phase: "executing" };
      return true;
    },
    /** A failed preflight read/hash may release only before flow.run starts. */
    failPreparation(lease: PipelineLease): boolean {
      if (!matches(lease) || current?.phase !== "preparing") return false;
      current = null;
      return true;
    },
    /** Observe the existing hook's actual state, rather than a stale await result. */
    observe(lease: PipelineLease, state: { status: PipelineStatus; signature: string | null }): boolean {
      if (!matches(lease) || !current || current.phase === "preparing") return false;
      // A submitted signature must be reconciled explicitly. Ignore resets,
      // late hook state and unrelated transaction outcomes while it is pending.
      if (current.phase === "submitted") return false;
      if (current.signature && state.signature !== current.signature) return false;
      if (state.status === "submitted") {
        if (state.signature) current = { ...current, phase: "submitted", signature: state.signature };
        return false;
      }
      if (state.status === "confirming" && state.signature) {
        current = { ...current, signature: state.signature };
        return false;
      }
      if (state.status === "confirmed" && !state.signature) return false;
      if (state.status === "confirmed" || state.status === "failed" || state.status === "rejected") {
        current = null;
        return true;
      }
      return false;
    },
    /** Call only after RPC reports confirmed/finalized or an onchain error. */
    resolveSubmitted(lease: PipelineLease, signature: string, outcome: "confirmed" | "failed"): boolean {
      if (!matches(lease) || current?.phase !== "submitted" || !signature || current.signature !== signature) return false;
      // TypeScript rejects pending outcomes; retain the guard if untyped callers
      // accidentally pass an unknown/null confirmation result at runtime.
      if (outcome !== "confirmed" && outcome !== "failed") return false;
      current = null;
      return true;
    },
  };
}

export function pipelinePresentation(status: PipelineStatus, options: {
  preparing?: boolean;
  setupProgress?: { step: number; total: number } | null;
} = {}): {
  label: string;
  phase: "idle" | "preparing" | "wallet" | "confirming" | "done" | "pending" | "error";
  blocked: boolean;
} {
  if (options.preparing) return { label: "Preparing your transaction", phase: "preparing", blocked: true };
  switch (status) {
    case "preparing-alt": return {
      label: options.setupProgress ? `Setting up your basket (${options.setupProgress.step}/${options.setupProgress.total})` : "Setting up your basket",
      phase: "preparing", blocked: true,
    };
    case "simulating": return { label: "Checking your transaction", phase: "preparing", blocked: true };
    case "awaiting-signature": return { label: "Confirm in your wallet", phase: "wallet", blocked: true };
    case "confirming": return { label: "Confirming your transaction", phase: "confirming", blocked: true };
    case "submitted": return { label: "Transaction sent", phase: "pending", blocked: true };
    case "confirmed": return { label: "Done", phase: "done", blocked: false };
    case "failed": return { label: "Could not finish", phase: "error", blocked: false };
    case "rejected": return { label: "Request cancelled", phase: "error", blocked: false };
    default: return { label: "Ready", phase: "idle", blocked: false };
  }
}
