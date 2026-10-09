#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyRustParents } from "./verify-rust-parents.mjs";
export function evaluateRustAudit(report, policy, { now = new Date(), lockfileBytes, sourceText = "" } = {}) {
  if (!report?.database?.["last-commit"] || !Array.isArray(report?.vulnerabilities?.list) || !report.warnings || policy.version !== 1) throw new Error("Malformed Rust audit evidence/policy");
  const blockers = [];
  const actualHash = createHash("sha256").update(lockfileBytes).digest("hex");
  if (policy.lockfileSha256 !== actualHash) blockers.push("Cargo.lock changed: refresh reachability review before accepting exceptions");
  if (/ed25519_dalek|curve25519_dalek|\b(?:Keypair|SecretKey|thread_rng|set_logger|memmap2|OrdSet|sized_chunks)\b/.test(sourceText)) blockers.push("New Rust signing, collection, logger or mmap API invalidates reachability assumptions");
  const findings = [...report.vulnerabilities.list, ...Object.values(report.warnings).flat()];
  const accepted = [];
  for (const finding of findings) {
    const matches = policy.exceptions.filter(e => e.advisory === finding.advisory.id && e.package === finding.package.name && e.version === finding.package.version && e.checksum === finding.package.checksum);
    const exception = matches.length === 1 ? matches[0] : null;
    const expiry = exception && Date.parse(`${exception.expiresAt}T00:00:00Z`), reviewed = exception && Date.parse(`${exception.reviewedAt}T00:00:00Z`);
    if (!exception || !exception.owner || !exception.justification || !Number.isFinite(expiry) || !Number.isFinite(reviewed) || expiry <= now.getTime() || expiry - reviewed > 30 * 86400000 || reviewed > now.getTime()) blockers.push(`${finding.advisory.id} ${finding.package.name}@${finding.package.version}: no current exact scoped exception`);
    else accepted.push({ advisory: exception.advisory, package: exception.package, version: exception.version, kind: finding.kind ?? "vulnerability", expiresAt: exception.expiresAt });
  }
  return { databaseCommit: report.database["last-commit"], findings: findings.length, accepted, blockers, mainnetApproved: false };
}
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith(".rs") ? [readFileSync(join(dir, entry.name), "utf8")] : []).join("\n");
}
export function main() {
  verifyRustParents(); // Path dependencies have no Cargo.lock checksum; verify every upstream byte.
  const audit = spawnSync(process.env.BASALT_CARGO_AUDIT ?? "cargo-audit", ["audit", "--json", ...(process.env.BASALT_RUSTSEC_DB ? ["--db", process.env.BASALT_RUSTSEC_DB] : [])], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (audit.error || ![0, 1].includes(audit.status)) throw new Error("Pinned cargo-audit unavailable or registry audit failed");
  const report = JSON.parse(audit.stdout);
  const policy = JSON.parse(readFileSync(new URL("./rust-audit-exceptions.json", import.meta.url), "utf8"));
  const result = evaluateRustAudit(report, policy, { lockfileBytes: readFileSync("Cargo.lock"), sourceText: sources("programs") + sources("crates") });
  console.log(JSON.stringify(result, null, 2)); return result.blockers.length ? 1 : 0;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.exitCode = main(); } catch { console.error("rust-audit: failed closed; pinned tool, current database and valid evidence required"); process.exitCode = 1; }
}
