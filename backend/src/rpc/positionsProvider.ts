/** Provider capability routing for complete, authenticated finalized holder snapshots. */
import type { PositionsSyncRpc } from "../indexer/positionsSync.js";
import { readIndexerGenesisHash } from "../indexer/rpcIdentity.js";
import { createReadOnlyRpcConnection, guardedRpcFetch, isUnsupportedHolderQuery, RpcReadError } from "./requestBudget.js";

export const DEVNET_RPC_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const DEFAULT_COOLDOWN_MS = 15 * 60_000;
interface Capability { unsupportedUntil: number; lastSuccessAt: number | null; failures: number; skips: number }
export class PositionsProviderUnavailableError extends Error {
  constructor() { super("positions-holder-query-unsupported-cooldown"); this.name = "PositionsProviderUnavailableError"; }
}

/** One selected provider supplies the entire snapshot; responses are never combined. */
export class PositionsRpcRuntime {
  private readonly capabilities = new WeakMap<PositionsSyncRpc, Capability>();
  private primaryCapability: Capability | null = null;
  constructor(private readonly secondary?: PositionsSyncRpc, private readonly cooldownMs = DEFAULT_COOLDOWN_MS,
    private readonly now: () => number = Date.now) {
    if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 1 || cooldownMs > 86_400_000) throw new RpcReadError("invalid-positions-rpc-cooldown");
  }
  private capability(rpc: PositionsSyncRpc): Capability {
    let state = this.capabilities.get(rpc);
    if (!state) { state = { unsupportedUntil: 0, lastSuccessAt: null, failures: 0, skips: 0 }; this.capabilities.set(rpc, state); }
    return state;
  }
  select(primary: PositionsSyncRpc): PositionsSyncRpc {
    this.primaryCapability = this.capability(primary);
    const candidates = this.secondary && this.secondary !== primary ? [this.secondary, primary] : [primary];
    const selected = candidates.find(rpc => {
      const state = this.capability(rpc);
      if (state.unsupportedUntil > this.now()) { state.skips++; return false; }
      return true;
    });
    if (!selected) throw new PositionsProviderUnavailableError();
    const state = this.capability(selected);
    return {
      getAccountInfoAndContext: (address, config) => selected.getAccountInfoAndContext(address, config),
      getProgramAccounts: async (program, config) => {
        try {
          const result = await selected.getProgramAccounts(program, config);
          state.lastSuccessAt = this.now(); state.unsupportedUntil = 0;
          return result;
        } catch (error) {
          if (isUnsupportedHolderQuery(error)) {
            state.failures++; state.unsupportedUntil = this.now() + this.cooldownMs;
            throw new PositionsProviderUnavailableError();
          }
          throw error;
        }
      },
    };
  }
  evidence() {
    const describe = (state: Capability | null) => ({
      capability: !state ? "unknown" : state.unsupportedUntil > this.now() ? "unsupported-cooldown" : state.lastSuccessAt === null ? "unknown" : "supported",
      nextProbeAt: state && state.unsupportedUntil > this.now() ? new Date(state.unsupportedUntil).toISOString() : null,
      lastSuccessAt: state?.lastSuccessAt === null || !state ? null : new Date(state.lastSuccessAt).toISOString(),
      unsupportedFailures: state?.failures ?? 0, skippedDuringCooldown: state?.skips ?? 0,
    });
    return { secondaryConfigured: !!this.secondary, secondaryIdentity: this.secondary ? "verified-devnet" : "not-configured",
      cooldownMs: this.cooldownMs, primary: describe(this.primaryCapability), secondary: describe(this.secondary ? this.capability(this.secondary) : null) };
  }
}
let runtime = new PositionsRpcRuntime();
export async function configurePositionsProviderFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<void> {
  const raw = env.POSITIONS_RPC_UNSUPPORTED_COOLDOWN_MS;
  const cooldown = raw === undefined || raw === "" ? DEFAULT_COOLDOWN_MS : Number(raw);
  if ((raw && !/^\d+$/.test(raw)) || !Number.isSafeInteger(cooldown) || cooldown < 60_000 || cooldown > 86_400_000) throw new RpcReadError("invalid-positions-rpc-cooldown");
  const url = env.POSITIONS_RPC_URL?.trim();
  if (!url) { runtime = new PositionsRpcRuntime(undefined, cooldown); return; }
  // Verify before making any basket/holder request; failure disables startup, not authentication.
  let genesis: string;
  try { genesis = await readIndexerGenesisHash(url, guardedRpcFetch(url, fetchImpl)); }
  catch { throw new RpcReadError("positions-rpc-identity-unavailable"); }
  if (genesis !== DEVNET_RPC_GENESIS) throw new RpcReadError("positions-rpc-wrong-network");
  runtime = new PositionsRpcRuntime(createReadOnlyRpcConnection(url) as PositionsSyncRpc, cooldown);
}
export function positionsRpcForSnapshot(primary: PositionsSyncRpc): PositionsSyncRpc { return runtime.select(primary); }
export function positionsRpcEvidence() { return runtime.evidence(); }
