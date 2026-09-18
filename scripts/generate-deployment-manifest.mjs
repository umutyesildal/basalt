#!/usr/bin/env node

/**
 * Generate a deployment/artifact attestation for the current checkout.
 *
 * The output is deliberately JSON-only and uses stable key ordering. Set
 * SOURCE_DATE_EPOCH or pass --generated-at when a byte-for-byte reproducible
 * manifest is required. The generator never signs or uploads the manifest.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const DEFAULT_OUTPUT = "-";
const LOCKFILES = [
  ["root", "package-lock.json"],
  ["app", "app/package-lock.json"],
  ["backend", "backend/package-lock.json"],
];
const PROGRAM_NAMES = ["whitelist", "basket_factory", "basket"];

function usage() {
  return `Usage: node scripts/generate-deployment-manifest.mjs [options]

Options:
  --output <path|->             Write JSON to a file (default: stdout)
  --environment <name>          Environment label (default: devnet)
  --cluster <name>              Solana cluster (default: devnet)
  --rpc-url <url>               Record the RPC endpoint without contacting it
  --generated-at <iso>          Fixed ISO timestamp; otherwise SOURCE_DATE_EPOCH/current time
  --commit <sha>                Override the detected git commit
  --upgrade-authority <key>     Record the shared upgrade authority placeholder/value
  --deployed-slot <number>      Record the shared deployed slot placeholder/value
  --no-elf                      Do not scan target/deploy/*.so
  --help                        Show this help

Optional image digests can be supplied as JSON through BASALT_IMAGE_DIGESTS:
  {"backend":"sha256:...","frontend":"sha256:..."}
`;
}

function parseArgs(argv) {
  const options = {
    output: DEFAULT_OUTPUT,
    environment: "devnet",
    cluster: "devnet",
    rpcUrl: null,
    generatedAt: null,
    commit: null,
    upgradeAuthority: null,
    deployedSlot: null,
    includeElf: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--no-elf") {
      options.includeElf = false;
      continue;
    }
    const valueOptions = new Map([
      ["--output", "output"],
      ["--environment", "environment"],
      ["--cluster", "cluster"],
      ["--rpc-url", "rpcUrl"],
      ["--generated-at", "generatedAt"],
      ["--commit", "commit"],
      ["--upgrade-authority", "upgradeAuthority"],
      ["--deployed-slot", "deployedSlot"],
    ]);
    const key = valueOptions.get(arg);
    if (!key) throw new Error(`Unknown option: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    options[key] = value;
    index += 1;
  }

  if (!options.environment || !options.cluster) {
    throw new Error("environment and cluster must be non-empty");
  }
  if (options.deployedSlot !== null) {
    if (!/^\d+$/.test(options.deployedSlot)) throw new Error("deployed slot must be a non-negative integer");
    options.deployedSlot = Number(options.deployedSlot);
    if (!Number.isSafeInteger(options.deployedSlot)) throw new Error("deployed slot exceeds JavaScript safe integer range");
  }
  if (options.generatedAt !== null && Number.isNaN(Date.parse(options.generatedAt))) {
    throw new Error(`generated-at is not a valid ISO timestamp: ${options.generatedAt}`);
  }
  return options;
}

function command(commandName, args) {
  try {
    return execFileSync(commandName, args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function gitValue(args) {
  return command("git", args);
}

function readVersion(commandName, args, environmentName) {
  const override = process.env[environmentName];
  return override || command(commandName, args);
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function parseAnchorPrograms(anchorPath, cluster) {
  const text = readFileSync(anchorPath, "utf8");
  const section = new RegExp(`\\[programs\\.${cluster.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(text)?.[1] ?? "";
  const programs = {};
  for (const line of section.split("\n")) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/.exec(line);
    if (match) programs[match[1]] = { programId: match[2], upgradeAuthority: null, deployedSlot: null };
  }
  for (const name of PROGRAM_NAMES) {
    if (!programs[name]) programs[name] = { programId: null, upgradeAuthority: null, deployedSlot: null };
  }
  return Object.fromEntries(Object.entries(programs).sort(([a], [b]) => a.localeCompare(b)));
}

function generatedAt(options) {
  if (options.generatedAt) return new Date(options.generatedAt).toISOString();
  if (process.env.SOURCE_DATE_EPOCH) {
    const seconds = Number(process.env.SOURCE_DATE_EPOCH);
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer");
    return new Date(seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function lockManifest() {
  return Object.fromEntries(LOCKFILES.map(([name, relativePath]) => {
    const absolutePath = resolve(repoRoot, relativePath);
    return [name, { path: relativePath, sha256: existsSync(absolutePath) ? sha256(absolutePath) : null }];
  }));
}

function elfManifest() {
  const artifactDirectory = resolve(repoRoot, "target/deploy");
  if (!existsSync(artifactDirectory)) return [];
  return readdirSync(artifactDirectory)
    .filter((file) => file.endsWith(".so"))
    .sort()
    .map((file) => {
      const relativePath = relative(repoRoot, join(artifactDirectory, file));
      return { path: relativePath, sha256: sha256(resolve(repoRoot, relativePath)) };
    });
}

function imageManifest() {
  const raw = process.env.BASALT_IMAGE_DIGESTS;
  if (!raw) return [];
  let values;
  try {
    values = JSON.parse(raw);
  } catch (error) {
    throw new Error(`BASALT_IMAGE_DIGESTS must be valid JSON: ${error.message}`);
  }
  if (!values || Array.isArray(values) || typeof values !== "object") throw new Error("BASALT_IMAGE_DIGESTS must be a JSON object");
  return Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([name, digest]) => ({ name, digest }));
}

function buildManifest(options) {
  const commit = options.commit || gitValue(["rev-parse", "HEAD"]);
  const dirtyText = gitValue(["status", "--porcelain"]);
  const programs = parseAnchorPrograms(resolve(repoRoot, "Anchor.toml"), options.cluster);
  for (const program of Object.values(programs)) {
    program.upgradeAuthority = options.upgradeAuthority;
    program.deployedSlot = options.deployedSlot;
  }
  const limitations = [
    "This manifest records local source, configuration, dependency, and optional artifact evidence; it is not a signed attestation.",
    "Upgrade authority and deployed slot remain null until a post-deploy RPC verification records them.",
    "ELF hashes are included only for target/deploy/*.so files present when the manifest is generated.",
    "Image digests are included only when BASALT_IMAGE_DIGESTS is supplied; no registry is contacted.",
    "Program IDs are read from Anchor.toml for the selected cluster and do not prove that matching programs are deployed there.",
  ];

  return {
    schemaVersion: 1,
    project: "basalt",
    generatedAt: generatedAt(options),
    git: {
      commit,
      dirty: Boolean(dirtyText),
    },
    deployment: {
      environment: options.environment,
      cluster: options.cluster,
      rpcUrl: options.rpcUrl,
      status: options.upgradeAuthority && options.deployedSlot !== null ? "attested-inputs" : "not-attested",
      upgradeAuthority: options.upgradeAuthority,
      deployedSlot: options.deployedSlot,
    },
    programs,
    toolchain: {
      node: readVersion("node", ["--version"], "BASALT_NODE_VERSION"),
      npm: readVersion("npm", ["--version"], "BASALT_NPM_VERSION"),
      rustc: readVersion("rustc", ["--version"], "BASALT_RUSTC_VERSION"),
      cargo: readVersion("cargo", ["--version"], "BASALT_CARGO_VERSION"),
      solanaCli: readVersion("solana", ["--version"], "BASALT_SOLANA_VERSION"),
      anchor: readVersion("anchor", ["--version"], "BASALT_ANCHOR_VERSION"),
    },
    dependencies: {
      locks: lockManifest(),
    },
    artifacts: {
      elf: options.includeElf ? elfManifest() : [],
      images: imageManifest(),
    },
    limitations,
  };
}

function writeOutput(output, outputPath) {
  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (outputPath === "-") {
    process.stdout.write(json);
    return;
  }
  const absolutePath = resolve(repoRoot, outputPath);
  writeFileSync(absolutePath, json, "utf8");
  process.stderr.write(`Wrote ${relative(repoRoot, absolutePath)}\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  writeOutput(buildManifest(options), options.output);
} catch (error) {
  process.stderr.write(`generate-deployment-manifest: ${error.message}\n`);
  process.exit(1);
}
