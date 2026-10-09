#!/usr/bin/env node
/** Scan every reachable historical blob and the index without printing contents.
 * Known retired blobs are identified by Git hash and never opened. Their presence
 * in history is acknowledged permanently; their presence in the index is blocked.
 * General credential patterns remain covered by the separate redacted Gitleaks job.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { retiredKeys } from "./retired-keys.mjs";
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
/** Only actual binary headers qualify; a compiled-looking path alone never does. */
export function isRecognizedCompiledBinary(prefix, file) {
  const hex = prefix.subarray(0, 8).toString("hex");
  if (hex.startsWith("7f454c46")) return true; // ELF object/executable/shared library
  if (["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"].some(magic => hex.startsWith(magic))) return true; // Mach-O, including universal binaries
  if (hex === "213c617263683e0a") return true; // ar / Rust rlib archive
  if (/\.rmeta$/i.test(file) && hex.startsWith("72757374000000")) return true; // Rust metadata
  if (/\.bin$/i.test(file) && hex.startsWith("52534943")) return true; // Rust incremental cache (RSIC)
  if (/\.mp3$/i.test(file)) {
    if (prefix.subarray(0,3).toString("ascii") === "ID3") return true;
    // MPEG audio frame sync, valid layer/bitrate/sample-rate bits.
    return prefix.length >= 4 && prefix[0] === 255 && (prefix[1] & 224) === 224 && (prefix[1] & 6) !== 0 && (prefix[2] >> 4) > 0 && (prefix[2] >> 4) < 15 && (prefix[2] & 12) !== 12;
  }
  return false;
}
function blobPrefix(cwd, hash) {
  if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error("Invalid Git object ID");
  // Fixed shell text, Git-owned positional argument; only 16 bytes enter memory.
  return execFileSync("sh", ["-c", 'git cat-file blob "$1" | head -c 16', "secret-history-prefix", hash], {cwd, maxBuffer:64, stdio:["ignore","pipe","ignore"]});
}
export function hasSolanaKeypair(text) {
  const arrays = text.match(/\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g) ?? [];
  return arrays.some(array => { try { return JSON.parse(array).every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255); } catch { return false; } });
}
export function scanSecretHistory(cwd = process.cwd()) {
  if (git(cwd, ["rev-parse", "--is-shallow-repository"]).trim() !== "false") throw new Error("Full Git history is required (fetch-depth: 0)");
  const known = new Set(retiredKeys.map(key => key.gitBlob));
  const objects = new Map();
  for (const line of git(cwd, ["rev-list", "--objects", "--all"]).trim().split("\n")) {
    const space = line.indexOf(" "); if (space > 0) objects.set(line.slice(0, space), line.slice(space + 1));
  }
  const findings = [];
  for (const entry of git(cwd, ["ls-files", "--stage", "-z"]).split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t"), fields = entry.slice(0, tab).split(" "), file = entry.slice(tab + 1), hash = fields[1];
    if (known.has(hash)) findings.push({ kind: "retired-key-in-index", path: file, blob: hash });
    objects.set(hash, file);
  }
  for (const [hash, file] of objects) {
    if (known.has(hash)) continue; // Never read already exposed private material.
    if (git(cwd, ["cat-file", "-t", hash]).trim() !== "blob") continue;
    const info = git(cwd, ["cat-file", "-s", hash]).trim();
    if (Number(info) > 2 * 1024 * 1024) {
      // Fail closed for suspicious key/runtime paths regardless of content size.
      if (!/\.(?:png|jpe?g|webp|gif|ico|pdf|mp4|mov|woff2?|ttf|so|tgz|gz)$/i.test(file) && !isRecognizedCompiledBinary(blobPrefix(cwd,hash),file)) findings.push({ kind: "oversized-unscanned-text", path: file, blob: hash });
      continue;
    }
    const contents = git(cwd, ["cat-file", "blob", hash]);
    if (hasSolanaKeypair(contents)) findings.push({ kind: "unrecognized-solana-keypair", path: file, blob: hash });
    if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(contents)) findings.push({ kind: "private-key", path: file, blob: hash });
  }
  return { version: 1, historicalRetiredKeys: retiredKeys.map(key => ({ path: key.historicalPath, publicKey: key.publicKey, blob: key.gitBlob })), scannedObjects: objects.size, findings };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { const report = scanSecretHistory(); console.log(JSON.stringify(report, null, 2)); if (report.findings.length) process.exitCode = 1; }
  catch { console.error("secret-history: scan failed; full history and readable Git objects are required"); process.exitCode = 1; }
}
