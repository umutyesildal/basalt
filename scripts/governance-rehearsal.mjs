#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function assertLoopbackRpc(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RPC URL must be an absolute http(s) URL");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("RPC URL protocol must be http or https");
  }
  if (url.username || url.password) throw new Error("RPC URL credentials are forbidden");
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("governance rehearsal is restricted to localhost/127.0.0.1/::1");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("RPC URL must not contain a path, query, or fragment");
  }
  return url;
}

export function validateRehearsalArgs({ rpcUrl, programSo, programKeypair }) {
  const url = assertLoopbackRpc(rpcUrl);
  if (!programSo || !programSo.endsWith(".so")) throw new Error("program artifact must be an explicit .so path");
  if (!programKeypair || !programKeypair.endsWith(".json")) {
    throw new Error("program id keypair must be an explicit .json path");
  }
  return { rpcUrl: url.toString(), programSo, programKeypair };
}

export function assertNoFinalCommand(args) {
  if (args.includes("--final")) throw new Error("irreversible finalization is forbidden in rehearsal");
  return args;
}

export function parseProgramShow(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("program show output must be a JSON object");
  }
  const authority = parsed.authority ?? parsed.upgradeAuthority ?? null;
  const programDataAddress = parsed.programdataAddress ?? parsed.programDataAddress ?? null;
  if (authority !== null && !PUBKEY_RE.test(authority)) throw new Error("program show authority is invalid");
  if (!PUBKEY_RE.test(programDataAddress ?? "")) throw new Error("program show ProgramData address is missing or invalid");
  return { authority, programDataAddress };
}

export function parseExecutableAccount(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const account = parsed?.account ?? parsed;
  if (!account || typeof account !== "object" || account.executable !== true) {
    throw new Error("program account is not executable");
  }
  return true;
}

export function validateAuthorityTransition({
  operator,
  governance,
  before,
  transferred,
  oldOperatorRejected,
  rolledBack,
}) {
  if (!PUBKEY_RE.test(operator) || !PUBKEY_RE.test(governance) || operator === governance) {
    throw new Error("operator and governance placeholder must be distinct public keys");
  }
  if (before.authority !== operator) throw new Error("initial authority is not the operator");
  if (transferred.authority !== governance) throw new Error("authority was not transferred to governance placeholder");
  if (oldOperatorRejected !== true) throw new Error("former operator was not proven unauthorized");
  if (rolledBack.authority !== operator) throw new Error("authority was not rolled back to operator");
  if (
    before.programDataAddress !== transferred.programDataAddress ||
    before.programDataAddress !== rolledBack.programDataAddress
  ) {
    throw new Error("ProgramData address changed during rehearsal");
  }
  return true;
}

function usage() {
  return `Usage:
  node scripts/governance-rehearsal.mjs assert-loopback <rpc-url>
  node scripts/governance-rehearsal.mjs url-port <rpc-url>
  node scripts/governance-rehearsal.mjs assert-show <json-file> <authority> [programdata]
  node scripts/governance-rehearsal.mjs assert-executable <json-file>
`;
}

export function main(argv) {
  const [command, ...args] = argv;
  if (command === "assert-loopback") {
    if (args.length !== 1) throw new Error("assert-loopback requires one RPC URL");
    process.stdout.write(`${assertLoopbackRpc(args[0]).toString()}\n`);
    return;
  }
  if (command === "url-port") {
    if (args.length !== 1) throw new Error("url-port requires one RPC URL");
    const url = assertLoopbackRpc(args[0]);
    if (!url.port) throw new Error("the ephemeral validator RPC URL requires an explicit port");
    process.stdout.write(`${url.port}\n`);
    return;
  }
  if (command === "assert-show") {
    if (args.length < 2 || args.length > 3) throw new Error("assert-show requires file, authority, and optional ProgramData");
    const actual = parseProgramShow(readFileSync(args[0], "utf8"));
    if (actual.authority !== args[1]) throw new Error(`expected authority ${args[1]}, got ${actual.authority}`);
    if (args[2] && actual.programDataAddress !== args[2]) {
      throw new Error(`expected ProgramData ${args[2]}, got ${actual.programDataAddress}`);
    }
    process.stdout.write(`${actual.programDataAddress}\n`);
    return;
  }
  if (command === "assert-executable") {
    if (args.length !== 1) throw new Error("assert-executable requires one account JSON file");
    parseExecutableAccount(readFileSync(args[0], "utf8"));
    return;
  }
  throw new Error(usage());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`governance-rehearsal: ${error.message}\n`);
    process.exit(1);
  }
}
