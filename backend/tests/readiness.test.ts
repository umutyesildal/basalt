import {namespaceFixtures} from "./fixtures/program-namespaces";
import {registeredProgramIds} from "../src/config/programNamespaces";
import { describe, it, expect } from "vitest";
import { readinessReport, DEVNET_GENESIS, DEVNET_PROGRAMS } from "../src/api/readiness";

const good = () => ({ ts: "2026-10-09T12:00:00Z", version: "0.1.0",
  subsystems: { db: { connected: true, schemaApplied: true },
    indexer: { enabled: true, running: true, discovery: { programIds: DEVNET_PROGRAMS, genesisHash: DEVNET_GENESIS, finalizedSlot: 12, completedAt: "2026-10-09T11:59:00Z" } }, navEngine: { enabled: true, running: true },
    userSnapshot: { enabled: true, running: true }, feeCrank: { enabled: false, running: false } },
  db: { connected: true, basketCount: 9, currentValuations: 0,
    history: { indexedPrograms: 3, programIds: DEVNET_PROGRAMS, finalizedThroughSlot: "12", missingCoverage: 0, pendingSignatures: 0, quarantinedSignatures: 0,
      scansPending: 0, rebuildRequiredBaskets: 0, automaticActivationEnabled: false } } });
const payload = (data: unknown) => readinessReport(data, "a".repeat(40)).payload as any;
describe("release readiness", () => {
  it("reports service and projection readiness separately from valuation coverage", () => {
    const report = readinessReport(good(), "a".repeat(40));
    expect(report.status).toBe(200); expect(payload(good()).projectionReady).toBe(true);
    expect(payload(good()).data.currentValuations).toBe(0);
    expect(payload(good()).sourceSha).toBe("a".repeat(40));
  });
  it.each(["database", "schema", "indexer", "navEngine", "userSnapshot", "feeCrank"])("fails closed for unavailable %s", check => {
    const health = good();
    if (check === "database") health.db.connected = false;
    else if (check === "schema") health.subsystems.db.schemaApplied = false;
    else (health.subsystems as any)[check] = { enabled: check === "feeCrank", running: false };
    expect(readinessReport(health).status).toBe(503); expect(payload(health).projectionReady).toBe(false);
  });
  it("fails readiness for a degraded database despite a connected flag", () => {
    expect(readinessReport({ ...good(), db: { ...good().db, degraded: true } }).status).toBe(503);
  });
  it.each(["pendingSignatures", "quarantinedSignatures", "scansPending", "rebuildRequiredBaskets"])("never certifies %s as a complete projection", field => {
    const health = good(); (health.db.history as any)[field] = 1;
    expect(readinessReport(health).status).toBe(200); expect(payload(health).projectionReady).toBe(false);
  });
  it("never certifies stale/wrong/missing finalized discovery", () => {
    for (const update of [{ completedAt: null }, { completedAt: "2026-10-09T11:00:00Z" }, { finalizedSlot: null }, { finalizedSlot: 13 }]) {
      const health = good(); Object.assign(health.subsystems.indexer.discovery, update);
      expect(payload(health).projectionReady).toBe(false);
    }
    const wrong = good(); wrong.subsystems.indexer.discovery.genesisHash = "wrong";
    expect(readinessReport(wrong).status).toBe(503);
    const ids = good(); ids.db.history.programIds = ["wrong"];
    expect(payload(ids).projectionReady).toBe(false);
  });
  it("rejects missing coverage and missing or invalid provenance", () => {
    const health = good(); health.db.history.indexedPrograms = 2;
    expect(payload(health).projectionReady).toBe(false);
    expect((readinessReport(good(), "unknown").payload as any).sourceSha).toBeNull();
    const missing = { ...good(), db: { connected: true } };
    expect(payload(missing).projectionReady).toBe(false);
  });
});

it("requires the entire reviewed union while preserving global incompleteness",()=>{
 const health=good(),ids=registeredProgramIds(namespaceFixtures);
 health.subsystems.indexer.discovery.programIds=ids;health.db.history.programIds=ids;health.db.history.indexedPrograms=6;
 expect((readinessReport(health,"a".repeat(40),namespaceFixtures).payload as any).projectionReady).toBe(true);
 health.db.history.quarantinedSignatures=1;
 expect((readinessReport(health,"a".repeat(40),namespaceFixtures).payload as any).projectionReady).toBe(false);
 health.subsystems.indexer.discovery.programIds=ids.slice(0,3);
 expect(readinessReport(health,"a".repeat(40),namespaceFixtures).status).toBe(503);
});
