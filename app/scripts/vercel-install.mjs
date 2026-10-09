/** Frozen canonical workspace install; cwd-independent for Vercel monorepo builds. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
const manifest = read("package.json"), lock = read("package-lock.json");
const codec = lock.packages?.["node_modules/bigint-buffer"];
if (!manifest.workspaces?.includes("app") || !manifest.workspaces?.includes("backend") ||
    lock.lockfileVersion !== 3 || lock.packages?.[""]?.name !== manifest.name ||
    manifest.dependencies?.["bigint-buffer"] !== "file:vendor/basalt-bigint-buffer-1.0.0.tgz" ||
    manifest.overrides?.["bigint-buffer"] !== "$bigint-buffer" || codec?.name !== "@basalt/bigint-buffer" ||
    codec.resolved !== manifest.dependencies["bigint-buffer"]) {
  throw new Error("Canonical workspace lock and bounded codec inputs are required.");
}
readFileSync(new URL("../../vendor/basalt-bigint-buffer-1.0.0.tgz", import.meta.url));
console.log("Installing the canonical root workspace with npm 11.6.2 and npm ci (default peers).");
const result = spawnSync("npx", ["--yes", "--package=npm@11.6.2", "--", "npm", "ci", "--legacy-peer-deps=false", "--include=dev", "--no-audit", "--no-fund"], {
  cwd: root, stdio: "inherit", env: { ...process.env, NPM_CONFIG_LEGACY_PEER_DEPS: "false" },
});
if (result.error) throw new Error("Could not start the frozen workspace install.");
process.exit(result.status ?? 1);
