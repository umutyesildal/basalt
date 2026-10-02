#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  atomicWriteJson,
  defaultEvidencePath,
  loadManifestDocument,
  assertPublicKey,
  assertRpcUrl,
  usage,
  verifyManifestAccounts,
} from "./deployment-verifier.mjs";

function parseArgs(argv) {
  const options = {
    manifest: null,
    rpcUrl: null,
    expectedAuthority: null,
    output: null,
    observedAt: null,
  };
  const valueOptions = new Map([
    ["--manifest", "manifest"],
    ["--rpc-url", "rpcUrl"],
    ["--expected-authority", "expectedAuthority"],
    ["--output", "output"],
    ["--observed-at", "observedAt"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      return null;
    }
    const key = valueOptions.get(arg);
    if (!key) throw new Error(`unknown option: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    options[key] = value;
    index += 1;
  }
  for (const field of ["manifest", "rpcUrl", "expectedAuthority"]) {
    if (!options[field]) throw new Error(`--${field.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)} is required`);
  }
  assertRpcUrl(options.rpcUrl);
  assertPublicKey(options.expectedAuthority, "expected authority");
  if (options.observedAt !== null && Number.isNaN(Date.parse(options.observedAt))) {
    throw new Error("--observed-at must be a valid ISO timestamp");
  }
  if (options.output === null) options.output = defaultEvidencePath(options.manifest);
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options === null) return 0;
  const manifestDocument = loadManifestDocument(options.manifest);
  const evidence = await verifyManifestAccounts({
    manifest: manifestDocument.manifest,
    sourceManifestSha256: manifestDocument.sha256,
    rpcUrl: options.rpcUrl,
    expectedAuthority: options.expectedAuthority,
    observedAt: options.observedAt ?? new Date().toISOString(),
  });
  // Verification is complete before this call. A failed RPC/account check
  // therefore cannot truncate or replace an existing evidence sidecar.
  atomicWriteJson(options.output, evidence);
  process.stdout.write(`Wrote RPC evidence sidecar: ${options.output}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => { if (code !== 0) process.exitCode = code; },
    (error) => {
      process.stderr.write(`verify-deployment-manifest: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
