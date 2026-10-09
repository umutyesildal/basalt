import assert from "node:assert/strict";
import test from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const configuration = JSON.parse(readFileSync(join(sourceRoot, "app/vercel.json"), "utf8"));
const files = ["package.json", "package-lock.json", "app/package.json", "backend/package.json", "app/scripts/vercel-install.mjs", "vendor/basalt-bigint-buffer-1.0.0.tgz"];
function fixture() {
  const location = mkdtempSync(join(tmpdir(), "basalt-frozen-install-"));
  for (const file of files) {
    mkdirSync(dirname(join(location, file)), { recursive: true });
    copyFileSync(join(sourceRoot, file), join(location, file));
  }
  const bin = join(location, "test-bin"), output = join(location, "observed.json");
  mkdirSync(bin);
  writeFileSync(join(bin, "npx"), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.PROBE_OUTPUT,JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),peers:process.env.NPM_CONFIG_LEGACY_PEER_DEPS}));\n`, { mode: 0o700 });
  return { location, bin, output };
}

test("Vercel command installs exact canonical root workspace from both possible cwd layouts", () => {
  const f = fixture();
  try {
    for (const cwd of [f.location, join(f.location, "app")]) {
      const result = spawnSync(String(configuration.installCommand), [], { cwd, shell: true, encoding: "utf8", env: {
        NODE_ENV: "test", PATH: `${f.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, PROBE_OUTPUT: f.output, NPM_CONFIG_LEGACY_PEER_DEPS: "true",
      } });
      assert.equal(result.status, 0, result.stderr);
      const observed = JSON.parse(readFileSync(f.output, "utf8"));
      assert.equal(observed.cwd, realpathSync(f.location));
      assert.equal(observed.peers, "false");
      assert.deepEqual(observed.args, ["--yes", "--package=npm@11.6.2", "--", "npm", "ci", "--legacy-peer-deps=false", "--include=dev", "--no-audit", "--no-fund"]);
    }
  } finally { rmSync(f.location, { recursive: true, force: true }); }
});

test("missing root codec input fails before any install instead of using the standalone app lock", () => {
  const f = fixture();
  try {
    rmSync(join(f.location, "vendor/basalt-bigint-buffer-1.0.0.tgz"));
    const result = spawnSync(String(configuration.installCommand), [], { cwd: join(f.location, "app"), shell: true, encoding: "utf8", env: {
      NODE_ENV: "test", PATH: `${f.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, PROBE_OUTPUT: f.output,
    } });
    assert.notEqual(result.status, 0);
    assert.throws(() => readFileSync(f.output));
  } finally { rmSync(f.location, { recursive: true, force: true }); }
});
