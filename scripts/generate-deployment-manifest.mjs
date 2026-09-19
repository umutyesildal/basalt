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
const AUTHORITY_MODELS = new Set(["single-key", "multisig", "immutable", "unknown"]);
const AUTHORITY_SOURCES = new Set(["operator-declaration", "unknown"]);
const TIMELOCK_STATUSES = new Set(["not-configured", "configured", "verified", "unknown"]);
const REHEARSAL_STATUSES = new Set(["not-run", "passed", "failed", "unknown"]);
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function usage() {
  return `Usage: node scripts/generate-deployment-manifest.mjs [options]

Options:
  --output <path|->             Write JSON to a file (default: stdout)
  --environment <name>          Environment label (default: devnet)
  --cluster <name>              Solana cluster (default: devnet)
  --rpc-url <url>               Record the RPC endpoint without contacting it
  --generated-at <iso>          Fixed ISO timestamp; otherwise SOURCE_DATE_EPOCH/current time
  --commit <sha>                Override the detected git commit
  --upgrade-authority <key>     Operator-declared shared upgrade authority (vault for multisig)
  --deployed-slot <number>      Operator-declared shared deployed slot
  --authority-model <model>     unknown | single-key | multisig | immutable
  --authority-source <source>   unknown | operator-declaration (RPC proof is not accepted here)
  --multisig-address <key>      Multisig configuration address; never use as upgrade authority
  --threshold <number>          Multisig approval threshold (minimum 2)
  --signer-count <number>       Multisig member count (minimum 3)
  --signer <role=pubkey>        Disclosed signer; repeat once per member
  --timelock-status <status>    unknown | not-configured | configured
  --timelock-delay-seconds <n>  Declared global on-chain time lock
  --announcement-seconds <n>    Declared public announcement period
  --governance-policy-url <url> Public governance policy URL
  --rehearsal-status <status>   not-run | passed | failed | unknown
  --rehearsal-transaction <sig> Local/test rehearsal transaction identifier
  --rehearsal-verified-at <iso> Rehearsal verification timestamp
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
    authorityModel: "unknown",
    authoritySource: "unknown",
    multisigAddress: null,
    threshold: null,
    signerCount: null,
    signers: [],
    timelockStatus: "unknown",
    timelockDelaySeconds: null,
    announcementPeriodSeconds: null,
    governancePolicyUrl: null,
    rehearsalStatus: "not-run",
    rehearsalTransaction: null,
    rehearsalVerifiedAt: null,
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
    if (arg === "--signer") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a role=pubkey value`);
      const separator = value.indexOf("=");
      if (separator <= 0 || separator === value.length - 1) throw new Error("signer must use role=pubkey");
      options.signers.push({ role: value.slice(0, separator), publicKey: value.slice(separator + 1) });
      index += 1;
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
      ["--authority-model", "authorityModel"],
      ["--authority-source", "authoritySource"],
      ["--multisig-address", "multisigAddress"],
      ["--threshold", "threshold"],
      ["--signer-count", "signerCount"],
      ["--timelock-status", "timelockStatus"],
      ["--timelock-delay-seconds", "timelockDelaySeconds"],
      ["--announcement-seconds", "announcementPeriodSeconds"],
      ["--governance-policy-url", "governancePolicyUrl"],
      ["--rehearsal-status", "rehearsalStatus"],
      ["--rehearsal-transaction", "rehearsalTransaction"],
      ["--rehearsal-verified-at", "rehearsalVerifiedAt"],
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
  for (const [field, label, minimum] of [
    ["threshold", "threshold", 2],
    ["signerCount", "signer count", 3],
    ["timelockDelaySeconds", "timelock delay seconds", 0],
    ["announcementPeriodSeconds", "announcement period seconds", 0],
  ]) {
    if (options[field] === null) continue;
    if (!/^\d+$/.test(options[field])) throw new Error(`${label} must be a non-negative integer`);
    options[field] = Number(options[field]);
    if (!Number.isSafeInteger(options[field]) || options[field] < minimum) {
      throw new Error(`${label} must be a safe integer greater than or equal to ${minimum}`);
    }
  }
  if (options.generatedAt !== null && Number.isNaN(Date.parse(options.generatedAt))) {
    throw new Error(`generated-at is not a valid ISO timestamp: ${options.generatedAt}`);
  }
  if (options.rehearsalVerifiedAt !== null && Number.isNaN(Date.parse(options.rehearsalVerifiedAt))) {
    throw new Error(`rehearsal-verified-at is not a valid ISO timestamp: ${options.rehearsalVerifiedAt}`);
  }
  if (!AUTHORITY_MODELS.has(options.authorityModel)) throw new Error(`invalid authority model: ${options.authorityModel}`);
  if (!AUTHORITY_SOURCES.has(options.authoritySource)) {
    throw new Error("authority source must be unknown or operator-declaration; this offline generator cannot claim RPC verification");
  }
  if (!TIMELOCK_STATUSES.has(options.timelockStatus)) throw new Error(`invalid timelock status: ${options.timelockStatus}`);
  if (options.timelockStatus === "verified") {
    throw new Error("this offline generator cannot mark a timelock verified");
  }
  if (!REHEARSAL_STATUSES.has(options.rehearsalStatus)) throw new Error(`invalid rehearsal status: ${options.rehearsalStatus}`);
  if (options.upgradeAuthority !== null && !PUBKEY_RE.test(options.upgradeAuthority)) throw new Error("upgrade authority must be a base58 public key");
  if (options.multisigAddress !== null && !PUBKEY_RE.test(options.multisigAddress)) throw new Error("multisig address must be a base58 public key");
  for (const signer of options.signers) {
    if (!signer.role.trim()) throw new Error("signer role must be non-empty");
    if (!PUBKEY_RE.test(signer.publicKey)) throw new Error(`signer ${signer.role} must have a base58 public key`);
  }
  if (new Set(options.signers.map(({ role }) => role)).size !== options.signers.length) throw new Error("signer roles must be unique");
  if (new Set(options.signers.map(({ publicKey }) => publicKey)).size !== options.signers.length) throw new Error("signer public keys must be unique");

  if (options.authorityModel === "single-key") {
    if (!options.upgradeAuthority) throw new Error("single-key authority model requires --upgrade-authority");
    if (options.multisigAddress || options.threshold !== null || options.signerCount !== null || options.signers.length > 0) {
      throw new Error("single-key authority model cannot include multisig fields");
    }
  } else if (options.authorityModel === "multisig") {
    if (!options.upgradeAuthority) throw new Error("multisig authority model requires the vault --upgrade-authority");
    if (!options.multisigAddress || options.threshold === null || options.signerCount === null) {
      throw new Error("multisig authority model requires --multisig-address, --threshold, and --signer-count");
    }
    if (options.threshold >= options.signerCount) throw new Error("multisig threshold must be lower than signer count");
    if (options.signers.length !== options.signerCount) throw new Error("multisig signer disclosures must equal signer count");
    if (options.multisigAddress === options.upgradeAuthority) {
      throw new Error("multisig account and vault upgrade-authority addresses must differ");
    }
  } else if (options.authorityModel === "immutable") {
    if (options.upgradeAuthority) throw new Error("immutable authority model requires a null upgrade authority");
    if (options.multisigAddress || options.threshold !== null || options.signerCount !== null || options.signers.length > 0) {
      throw new Error("immutable authority model cannot include multisig fields");
    }
  } else if (options.multisigAddress || options.threshold !== null || options.signerCount !== null || options.signers.length > 0) {
    throw new Error("unknown authority model cannot include multisig fields");
  }

  const hasTimelockValues = options.timelockDelaySeconds !== null || options.announcementPeriodSeconds !== null;
  if (options.timelockStatus === "configured") {
    if (options.timelockDelaySeconds === null || options.announcementPeriodSeconds === null || !options.governancePolicyUrl) {
      throw new Error("configured timelock requires delay, announcement period, and governance policy URL");
    }
  } else if (hasTimelockValues) {
    throw new Error("timelock values require --timelock-status configured");
  }
  if (options.governancePolicyUrl !== null) {
    try {
      new URL(options.governancePolicyUrl);
    } catch {
      throw new Error("governance policy URL must be an absolute URL");
    }
  }
  if (options.rehearsalStatus === "passed") {
    if (!options.rehearsalTransaction || !options.rehearsalVerifiedAt) {
      throw new Error("passed rehearsal requires transaction and verified-at evidence");
    }
  } else if (options.rehearsalStatus === "not-run" && (options.rehearsalTransaction || options.rehearsalVerifiedAt)) {
    throw new Error("not-run rehearsal cannot include transaction evidence");
  }

  const hasDeclaration = Boolean(
    options.upgradeAuthority || options.deployedSlot !== null || options.authorityModel !== "unknown" ||
    options.multisigAddress || options.timelockStatus !== "unknown" || options.governancePolicyUrl ||
    options.rehearsalStatus !== "not-run",
  );
  if (hasDeclaration && options.authoritySource === "unknown") options.authoritySource = "operator-declaration";
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
    if (match) programs[match[1]] = {
      programId: match[2],
      upgradeAuthority: null,
      upgradeAuthorityModel: "unknown",
      authoritySource: "unknown",
      authorityVerifiedAt: null,
      deployedSlot: null,
    };
  }
  for (const name of PROGRAM_NAMES) {
    if (!programs[name]) programs[name] = {
      programId: null,
      upgradeAuthority: null,
      upgradeAuthorityModel: "unknown",
      authoritySource: "unknown",
      authorityVerifiedAt: null,
      deployedSlot: null,
    };
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
    program.upgradeAuthorityModel = options.authorityModel;
    program.authoritySource = options.authoritySource;
    program.authorityVerifiedAt = null;
    program.deployedSlot = options.deployedSlot;
  }
  const limitations = [
    "This manifest records local source, configuration, dependency, and optional artifact evidence; it is not a signed attestation.",
    "Governance values supplied to this offline generator are operator declarations, never RPC verification.",
    "Upgrade authority and deployed slot remain null until explicitly supplied or a separate post-deploy RPC verifier records them.",
    "ELF hashes are included only for target/deploy/*.so files present when the manifest is generated.",
    "Image digests are included only when BASALT_IMAGE_DIGESTS is supplied; no registry is contacted.",
    "Program IDs are read from Anchor.toml for the selected cluster and do not prove that matching programs are deployed there.",
  ];

  return {
    schemaVersion: 2,
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
      status: options.authoritySource === "operator-declaration" ? "attested-inputs" : "not-attested",
      upgradeAuthority: options.upgradeAuthority,
      deployedSlot: options.deployedSlot,
      governance: {
        authorityModel: options.authorityModel,
        authoritySource: options.authoritySource,
        authorityVerifiedAt: null,
        multisigAddress: options.multisigAddress,
        threshold: options.threshold,
        signerCount: options.signerCount,
        signers: options.signers,
        timelock: {
          status: options.timelockStatus,
          delaySeconds: options.timelockDelaySeconds,
          announcementPeriodSeconds: options.announcementPeriodSeconds,
          policyUrl: options.governancePolicyUrl,
        },
        transferRehearsal: {
          status: options.rehearsalStatus,
          transaction: options.rehearsalTransaction,
          verifiedAt: options.rehearsalVerifiedAt ? new Date(options.rehearsalVerifiedAt).toISOString() : null,
        },
      },
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
