/** Deployment readiness is independent of permissionless on-chain redemption. */
import type { SubsystemStatus } from "./server.js";

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEVNET_PROGRAMS = ["FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS", "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF", "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k"].sort();
const samePrograms = (value: unknown) => Array.isArray(value) && JSON.stringify([...value].sort()) === JSON.stringify(DEVNET_PROGRAMS);

type Health = {
  ts: string;
  version: string;
  subsystems: SubsystemStatus;
  db: {
    connected: boolean;
    degraded?: boolean;
    basketCount?: number;
    currentValuations?: number;
    currentBalances?: Record<string,unknown>;
    history?: {
      pendingSignatures: number;
      quarantinedSignatures: number;
      scansPending: number;
      indexedPrograms: number;
      programIds: string[];
      finalizedThroughSlot: string | null;
      missingCoverage: number;
      rebuildRequiredBaskets: number;
      automaticActivationEnabled: boolean;
    };
  };
};

/** Liveness remains /health. Disabled required workers cannot pass release checks. */
export function readinessReport(input: unknown, buildSha = process.env.BASALT_BUILD_SHA): { status: number; payload: unknown } {
  const health = input as Health;
  const systems = health.subsystems;
  const discovery = systems.indexer.discovery;
  const networkVerified = discovery?.genesisHash === DEVNET_GENESIS && samePrograms(discovery.programIds);
  const checks = {
    network: networkVerified,
    database: health.db.connected === true && health.db.degraded !== true,
    schema: systems.db.schemaApplied === true,
    indexer: systems.indexer.enabled && systems.indexer.running,
    navEngine: systems.navEngine.enabled && systems.navEngine.running,
    userSnapshot: systems.userSnapshot.enabled && systems.userSnapshot.running,
    feeCrank: !systems.feeCrank.enabled || systems.feeCrank.running,
  };
  const ready = Object.values(checks).every(value => value === true);
  const history = health.db.history;
  const discoveryAge = discovery?.completedAt ? new Date(health.ts).getTime() - new Date(discovery.completedAt).getTime() : NaN;
  const slot = discovery?.finalizedSlot;
  const coverage = history?.finalizedThroughSlot;
  const freshDiscovery = Number.isSafeInteger(slot) && slot! >= 0 && Number.isFinite(discoveryAge) && discoveryAge >= 0 && discoveryAge <= 5 * 60_000;
  const validCoverage = typeof coverage === "string" && /^(0|[1-9]\d*)$/.test(coverage) && freshDiscovery && BigInt(coverage) >= BigInt(slot!);
  const projectionReady = ready && history !== undefined && history.indexedPrograms === 3 &&
    samePrograms(history.programIds) && history.missingCoverage === 0 && validCoverage &&
    history.pendingSignatures === 0 && history.quarantinedSignatures === 0 &&
    history.scansPending === 0 && history.rebuildRequiredBaskets === 0 &&
    history.automaticActivationEnabled === false;
  return {
    status: ready ? 200 : 503,
    payload: {
      ok: ready, ready, ts: health.ts, version: health.version,
      sourceSha: buildSha && /^[a-f0-9]{40}$/.test(buildSha) ? buildSha : null,
      checks,
      network: { cluster: networkVerified ? "devnet" : null, genesisHash: discovery?.genesisHash ?? null, programIds: discovery?.programIds ?? [] },
      discovery: { finalizedSlot: slot ?? null, completedAt: discovery?.completedAt ?? null, fresh: freshDiscovery },
      // A running service may honestly serve incomplete indexed reference data.
      // Operators must inspect these fields; HTTP 200 never certifies a recovery.
      projectionReady,
      data: {
        basketCount: health.db.basketCount ?? null,
        currentValuations: health.db.currentValuations ?? null,
        currentBalances: health.db.currentBalances ?? null,
        history: history ?? null,
      },
    },
  };
}
