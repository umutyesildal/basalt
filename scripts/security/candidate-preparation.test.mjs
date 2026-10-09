import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../../deploy/prepare-candidate.sh", import.meta.url));
const sha = "a".repeat(40);
const mockSecret = "private-test-value-must-never-be-printed";
const genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const programs = {
  basket: "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k",
  factory: "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF",
  whitelist: "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS",
};
const dockerMock = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const input = fs.readFileSync(0, "utf8");
const stateFile = process.env.MOCK_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
const fail = name => {
  if (process.env.MOCK_FAIL === name) {
    process.stderr.write(process.env.MOCK_SECRET + "\n");
    process.exit(1);
  }
};
fs.appendFileSync(process.env.MOCK_CALLS, JSON.stringify({
  args, cwd: process.cwd(),
  sql: input.replace(/PASSWORD '[^']+'/g, "PASSWORD '[redacted]'"),
  inheritedPassword: process.env.POSTGRES_PASSWORD ?? null,
}) + "\n");
if (args[0] === "context") {
  console.log(process.env.MOCK_DOCKER_ENDPOINT || "unix:///var/run/docker.sock"); process.exit(0);
}
if (args[0] === "--host") args.splice(0, 2);
if (args[0] === "inspect") { console.log("sha256:" + "f".repeat(64)); process.exit(0); }
if (args[0] === "image" && args[1] === "inspect") {
  console.log(JSON.stringify([{ Id: "sha256:" + "f".repeat(64) }])); process.exit(0);
}
if (args[0] === "image" && args[1] === "save") { fail("image"); process.stdout.write("retained-backend-image"); process.exit(0); }
if (args[0] !== "compose") throw Error("unexpected Docker operation");
const pos = args.findIndex(x => x === "ps" || x === "exec");
if (pos < 0) throw Error("unexpected Compose operation");
const op = args.slice(pos);
if (op[0] === "ps") { console.log("b".repeat(64)); process.exit(0); }
if (op[3] === "pg_dump") { fail("dump"); state.dumped = true; save(); process.stdout.write("PGDMP-online-snapshot"); process.exit(0); }
if (op[3] === "pg_restore") {
  if (op.includes("--list")) {
    fail("toc");
    console.log(process.env.MOCK_EMPTY_TOC ? "; empty" : "1; 1259 42 TABLE public baskets basalt\n2; 0 42 TABLE DATA public baskets basalt");
    process.exit(0);
  }
  fail("restore");
  state.restored = true; save();
  if (process.env.MOCK_TAMPER_DUMP) fs.appendFileSync(process.env.MOCK_OUTPUT + "/foliox.dump", "tampered");
  process.exit(0);
}
if (op[3] !== "psql") throw Error("unexpected Postgres command");
const db = op[op.indexOf("-d") + 1];
const tag = /-- basalt:([a-z-]+)/.exec(input)?.[1];
if (tag === "source-identity") console.log((process.env.MOCK_SOURCE_DB || "foliox") + "|basalt");
else if (tag === "candidate-exists") console.log(state.roleExists || state.databaseExists ? "t" : "f");
else if (tag === "create-role") { fail("role"); state.roleExists = true; save(); }
else if (tag === "source-write-guard") console.log(process.env.MOCK_SOURCE_WRITABLE ? "f" : "t");
else if (tag === "create-database") { state.databaseExists = true; save(); }
else if (tag === "candidate-schema") console.log(db);
else if (tag === "restored-owners") console.log(process.env.MOCK_BAD_OWNER ? "f" : "t");
else if (tag === "identity-create") {
  fail("identity");
  const values = /VALUES \('([^']+)',current_database\(\),'foliox','([^']+)','([^']+)','([^']+)','([^']+)'::jsonb\)/.exec(input);
  if (!values) throw Error("identity values not found");
  state.identity = { candidateId: values[1], databaseName: db, sourceDatabase: "foliox", sourceSha: values[2],
    backupSha256: values[3], genesisHash: values[4], programIds: JSON.parse(values[5]) }; save();
} else if (tag === "identity-verify") console.log(process.env.MOCK_BAD_IDENTITY ? "f" : "t");
else if (tag === "manifest") {
  console.log(JSON.stringify({ schemaVersion: 1, ...state.identity,
    snapshotAt: /'snapshotAt','([^']+)'/.exec(input)[1],
    backupFile: /'backupFile','([^']+)'/.exec(input)[1] }));
} else throw Error("unknown SQL tag: " + tag);
`;

function fixture(t, initial = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "basalt-candidate-prep-")));
  chmodSync(base, 0o700);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const project = join(base, "source");
  const deploy = join(project, "deploy");
  const backups = join(base, "backups");
  const bin = join(base, "bin");
  for (const path of [deploy, join(project, "backend"), backups, bin]) mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(join(deploy, ".env"), "POSTGRES_PASSWORD=" + mockSecret + "\nAPI_DOMAIN=test.invalid\n");
  writeFileSync(join(deploy, "docker-compose.yml"), "services: {}\n");
  writeFileSync(join(project, "backend", ".env.production"), "SOCIAL_AUTH_SECRET=" + mockSecret + "\n");
  writeFileSync(join(project, "backend", "source.ts"), "export const current = true;\n");
  writeFileSync(join(project, "release-source-sha"), "b".repeat(40) + "\n");
  for (const excluded of ["node_modules", ".git", ".cache", "release-backups", "keys", ".e2e", ".e2e-devnet", ".mimosa", ".anchor"]) {
    mkdirSync(join(project, "backend", excluded));
    writeFileSync(join(project, "backend", excluded, "private.txt"), mockSecret);
  }
  writeFileSync(join(project, "backend", "id.json"), mockSecret);
  writeFileSync(join(bin, "docker"), dockerMock.replace("#!/usr/bin/env node", "#!" + process.execPath), { mode: 0o700 });
  const stateFile = join(base, "state.json");
  const callsFile = join(base, "calls.jsonl");
  writeFileSync(stateFile, JSON.stringify(initial));
  const output = join(backups, "case_1");
  function run(extra = {}, args = null, cwd = deploy) {
    return spawnSync("bash", [script, ...(args ?? [
      "--source-sha=" + sha, "--candidate-id=case_1", "--directory=" + output,
    ])], {
      cwd, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PATH: bin + ":" + process.env.PATH,
        POSTGRES_PASSWORD: "unexpected-inherited-password",
        MOCK_SECRET: mockSecret, MOCK_STATE: stateFile, MOCK_CALLS: callsFile, MOCK_OUTPUT: output, ...extra },
    });
  }
  return {
    base, project, deploy, backups, output, run,
    state: () => JSON.parse(readFileSync(stateFile, "utf8")),
    calls: () => existsSync(callsFile) ? readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [],
  };
}
function assertPrivateOutput(result) {
  assert.ok(!result.stdout.includes(mockSecret));
  assert.ok(!result.stderr.includes(mockSecret));
  assert.ok(!result.stdout.includes("unexpected-inherited-password"));
  assert.ok(!result.stderr.includes("unexpected-inherited-password"));
}
function assertNoLiveMutation(calls) {
  for (const call of calls) {
    assert.ok(!call.args.some(x => ["stop", "restart", "down", "up", "rm", "build"].includes(x)));
    assert.ok(!call.args.some(x => x === "--clean" || x === "--create"));
    assert.ok(!/\bDROP\s+(DATABASE|ROLE|TABLE|SCHEMA)\b/i.test(call.sql));
    const db = call.args[call.args.indexOf("-d") + 1];
    if (db === "foliox" && call.args.includes("psql")) {
      assert.ok(!/\b(CREATE|ALTER|INSERT|UPDATE|DELETE|REVOKE|GRANT|TRUNCATE)\b/i.test(
        call.sql.replace(/'[^']*'/g, "")), "source SQL must remain read-only");
    }
  }
}

test("prepares private, checksummed rollback material and an exactly bound restricted candidate", t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assertPrivateOutput(result);
  assert.match(result.stdout, /candidate\.json/);
  assert.match(result.stdout, /not deployment approval/);
  const manifest = JSON.parse(readFileSync(join(f.output, "candidate.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), [
    "schemaVersion", "candidateId", "databaseName", "sourceDatabase", "sourceSha",
    "backupSha256", "programIds", "genesisHash", "snapshotAt", "backupFile",
  ].sort());
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.candidateId, "case_1");
  assert.equal(manifest.databaseName, "basalt_candidate_case_1");
  assert.equal(manifest.sourceDatabase, "foliox");
  assert.equal(manifest.sourceSha, sha);
  assert.equal(manifest.genesisHash, genesis);
  assert.deepEqual(manifest.programIds, programs);
  assert.match(manifest.snapshotAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  assert.equal(manifest.backupFile, "foliox.dump");
  assert.equal(manifest.backupSha256, createHash("sha256").update(readFileSync(join(f.output, "foliox.dump"))).digest("hex"));
  assert.equal(statSync(f.output).mode & 0o777, 0o700);
  for (const file of ["candidate.json", "candidate.env", "foliox.dump", "backup.toc", "source.tar.gz",
    "backend-image.tar.gz", "compose.env", "backend.env.production", "preparation.log", "SHA256SUMS"]) {
    assert.equal(statSync(join(f.output, file)).mode & 0o777, 0o600, file);
  }
  const env = readFileSync(join(f.output, "candidate.env"), "utf8");
  assert.match(env, /^CANDIDATE_DATABASE_URL=postgresql:\/\/basalt_candidate_case_1:[a-f0-9]{64}@postgres:5432\/basalt_candidate_case_1\nRELEASE_SOURCE_SHA=/);
  assert.equal(readFileSync(join(f.output, "previous-release-source-sha"), "utf8"), "b".repeat(40) + "\n");
  const archive = readFileSync(join(f.output, "source.toc"), "utf8");
  assert.ok(archive.includes("backend/source.ts"));
  assert.ok(archive.includes("deploy/docker-compose.yml"));
  for (const excluded of ["node_modules", ".git", ".cache", "release-backups", "keys", ".env", ".e2e", ".e2e-devnet", ".mimosa", ".anchor", "id.json"]) assert.ok(!archive.includes(excluded), excluded);
  const calls = f.calls();
  assertNoLiveMutation(calls);
  assert.ok(calls.every(x => x.inheritedPassword === null));
  for (const call of calls.filter(x => x.args.includes("compose"))) {
    assert.equal(call.cwd, f.deploy);
    assert.ok(call.args.includes(join(f.deploy, ".env")));
  }
  const dump = calls.find(x => x.args.includes("pg_dump"));
  assert.ok(dump.args.includes("--format=custom"));
  assert.ok(dump.args.includes("--lock-wait-timeout=10s"));
  const restore = calls.find(x => x.args.includes("pg_restore") && !x.args.includes("--list"));
  for (const flag of ["--exit-on-error", "--no-owner", "--no-privileges", "--single-transaction", "--role=basalt_candidate_case_1"]) assert.ok(restore.args.includes(flag));
  assert.equal(restore.args[restore.args.indexOf("-d") + 1], manifest.databaseName);
  const role = calls.find(x => x.sql.includes("-- basalt:create-role")).sql;
  for (const flag of ["NOSUPERUSER", "NOCREATEDB", "NOCREATEROLE", "NOINHERIT", "NOREPLICATION", "NOBYPASSRLS"]) assert.ok(role.includes(flag));
  const identity = calls.find(x => x.sql.includes("-- basalt:identity-create")).sql;
  assert.match(identity, /OWNER TO basalt/);
  assert.match(identity, /GRANT SELECT ON public.release_candidate_identity/);
  assert.match(identity, /current_database\(\)/);
});

test("validates arguments and cwd before any Docker operation", t => {
  const f = fixture(t);
  for (const args of [
    [], ["--source-sha=" + sha, "--candidate-id=a';DROP_ROLE", "--directory=" + f.output],
    ["--source-sha=" + "A".repeat(40), "--candidate-id=x", "--directory=" + f.output],
    ["--source-sha=" + sha, "--candidate-id=x", "--directory=relative"],
    ["--source-sha=" + sha, "--candidate-id=" + "x".repeat(41), "--directory=" + f.output],
    ["--source-sha=" + sha, "--candidate-id=x", "--directory=" + f.output, "--source-sha=" + sha],
  ]) {
    const result = f.run({}, args);
    assert.notEqual(result.status, 0); assertPrivateOutput(result);
  }
  assert.notEqual(f.run({}, null, f.project).status, 0);
  assert.equal(f.calls().length, 0);
});

test("rejects existing directories, source-tree backups, writable parents and symlink paths", t => {
  const f = fixture(t);
  mkdirSync(f.output);
  assert.notEqual(f.run().status, 0);
  const inside = join(f.project, "candidate");
  assert.notEqual(f.run({}, ["--source-sha=" + sha, "--candidate-id=x", "--directory=" + inside]).status, 0);
  chmodSync(f.backups, 0o777);
  const fresh = join(f.backups, "fresh");
  assert.notEqual(f.run({}, ["--source-sha=" + sha, "--candidate-id=x", "--directory=" + fresh]).status, 0);
  chmodSync(f.backups, 0o700);
  const link = join(f.base, "link");
  symlinkSync(f.backups, link);
  assert.notEqual(f.run({}, ["--source-sha=" + sha, "--candidate-id=x", "--directory=" + join(link, "new")]).status, 0);
  assert.equal(f.calls().length, 0);
});

for (const existing of ["roleExists", "databaseExists"]) {
  test("rejects an existing candidate " + existing + " before backup or writes", t => {
    const f = fixture(t, { [existing]: true });
    const result = f.run();
    assert.notEqual(result.status, 0); assertPrivateOutput(result);
    assert.ok(existsSync(f.output));
    assert.ok(!f.calls().some(x => x.args.includes("pg_dump") || x.sql.includes("-- basalt:create-role")));
    assertNoLiveMutation(f.calls());
  });
}

for (const failure of ["image", "dump", "toc", "restore", "identity"]) {
  test("preserves partial material and secrets on " + failure + " failure", t => {
    const f = fixture(t);
    const result = f.run({ MOCK_FAIL: failure });
    assert.notEqual(result.status, 0); assertPrivateOutput(result);
    assert.match(result.stderr, /private material retained/);
    assert.ok(existsSync(f.output));
    assert.ok(!existsSync(join(f.output, "candidate.json")));
    assertNoLiveMutation(f.calls());
    if (failure === "restore" || failure === "identity") {
      assert.ok(existsSync(join(f.output, "foliox.dump")));
      assert.ok(existsSync(join(f.output, "backend-image.tar.gz")));
      assert.equal(f.state().roleExists, true);
      assert.equal(f.state().databaseExists, true);
    }
  });
}

for (const [flag, stage] of [
  ["MOCK_EMPTY_TOC", "consistent online backup"],
  ["MOCK_SOURCE_WRITABLE", "restricted candidate role"],
  ["MOCK_BAD_OWNER", "candidate identity"],
  ["MOCK_BAD_IDENTITY", "candidate identity"],
  ["MOCK_TAMPER_DUMP", "restricted restore"],
]) {
  test("fails closed for " + flag + " without publication or cleanup", t => {
    const f = fixture(t);
    const result = f.run({ [flag]: "1" });
    assert.notEqual(result.status, 0); assertPrivateOutput(result);
    assert.match(result.stderr, new RegExp(stage));
    assert.ok(!existsSync(join(f.output, "candidate.json")));
    assertNoLiveMutation(f.calls());
    if (flag === "MOCK_EMPTY_TOC") assert.equal(f.state().roleExists, undefined);
    if (flag === "MOCK_SOURCE_WRITABLE") {
      assert.equal(f.state().roleExists, true);
      assert.equal(f.state().databaseExists, undefined);
    }
  });
}

test("rejects a remote Docker endpoint and a mismatched live source identity", t => {
  const f = fixture(t);
  const result = f.run({ MOCK_DOCKER_ENDPOINT: "tcp://remote.invalid:2375" });
  assert.notEqual(result.status, 0);
  assert.equal(f.calls().length, 1);
  const f2 = fixture(t);
  assert.notEqual(f2.run({ MOCK_SOURCE_DB: "other" }).status, 0);
  assert.ok(!f2.calls().some(x => x.args.includes("pg_dump")));
});

test("a second attempt cannot overwrite the prepared role or retained evidence", t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const original = readFileSync(join(f.output, "candidate.json"), "utf8");
  const second = join(f.backups, "second");
  const result = f.run({}, ["--source-sha=" + sha, "--candidate-id=case_1", "--directory=" + second]);
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(f.output, "candidate.json"), "utf8"), original);
  assert.equal(f.calls().filter(x => x.sql.includes("-- basalt:create-role")).length, 1);
  assertNoLiveMutation(f.calls());
});

test("help describes preparation and never invokes Docker", t => {
  const f = fixture(t);
  const result = f.run({}, ["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Candidate evidence is not deployment approval/);
  assert.match(result.stdout, /deploy\/\.env/);
  assert.equal(f.calls().length, 0);
});

test("actual PostgreSQL full custom restore preserves restricted ownership and protected identity", {
  skip: !process.env.CANDIDATE_PREPARATION_TEST_DATABASE_URL,
}, t => {
  const baseUrl = new URL(process.env.CANDIDATE_PREPARATION_TEST_DATABASE_URL);
  const suffix = "pgproof_" + process.pid + "_" + Date.now().toString(36);
  const sourceDb = "basalt_preparation_source_" + suffix;
  const targetDb = "basalt_preparation_target_" + suffix;
  const role = "basalt_candidate_" + suffix;
  const created = [];
  let roleCreated = false;
  const dbUrl = db => {
    const url = new URL(baseUrl);
    url.pathname = "/" + db;
    return url.href;
  };
  const execute = (program, args, input, allowFailure = false) => {
    const result = spawnSync(program, args, { input, encoding: "utf8", timeout: 30_000 });
    if (!allowFailure) assert.equal(result.status, 0, result.stderr || String(result.error));
    return result;
  };
  const sql = (db, text, allowFailure = false) =>
    execute("psql", [dbUrl(db), "-X", "-w", "-v", "ON_ERROR_STOP=1", "-At"], text, allowFailure);
  const restore = dump => execute("pg_restore", [
    "-w", "--dbname=" + dbUrl(targetDb), "--exit-on-error", "--no-owner", "--no-privileges",
    "--no-comments", "--single-transaction", "--role=" + role,
  ], dump, true);
  try {
    sql(baseUrl.pathname.slice(1), 'CREATE ROLE "' + role + '" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;');
    roleCreated = true;
    for (const db of [sourceDb, targetDb]) {
      sql(baseUrl.pathname.slice(1), 'CREATE DATABASE "' + db + '" TEMPLATE template0;');
      created.push(db);
    }
    sql(sourceDb, [
      "ALTER SCHEMA public OWNER TO CURRENT_USER;",
      "REVOKE ALL ON SCHEMA public FROM PUBLIC;",
      "COMMENT ON SCHEMA public IS 'custom source comment that candidate cannot own';",
      "CREATE TABLE public.baskets(id BIGSERIAL PRIMARY KEY, value TEXT NOT NULL);",
      "INSERT INTO public.baskets(value) VALUES ('preserved');",
      "CREATE VIEW public.basket_values AS SELECT value FROM public.baskets;",
      "CREATE FUNCTION public.basket_count() RETURNS BIGINT LANGUAGE SQL AS 'SELECT count(*) FROM public.baskets';",
    ].join("\n"));
    sql(targetDb, [
      "ALTER SCHEMA public OWNER TO CURRENT_USER;",
      "REVOKE ALL ON SCHEMA public FROM PUBLIC;",
      'GRANT USAGE, CREATE ON SCHEMA public TO "' + role + '";',
    ].join("\n"));
    const dumpResult = spawnSync("pg_dump", [
      "--dbname=" + dbUrl(sourceDb), "-w", "--format=custom", "--no-owner", "--no-privileges",
    ], { timeout: 30_000 });
    assert.equal(dumpResult.status, 0, dumpResult.stderr.toString());
    const dump = dumpResult.stdout;
    const restoreSql = execute("pg_restore", ["--no-owner", "--no-privileges", "--no-comments", "--file=-"], dump).stdout;
    assert.ok(!/\bCREATE SCHEMA public\b/.test(restoreSql), "full dump must retain initdb public schema");
    const toc = execute("pg_restore", ["--list"], dump).stdout;
    assert.match(toc, /TABLE public baskets/);
    const result = restore(dump);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sql(targetDb, "SELECT value FROM public.baskets;").stdout.trim(), "preserved");
    assert.equal(sql(targetDb, "SELECT public.basket_count();").stdout.trim(), "1");
    assert.equal(sql(targetDb, "SELECT bool_and(pg_get_userbyid(relowner) = '" + role + "') FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','S','v');").stdout.trim(), "t");
    sql(targetDb, [
      "CREATE TABLE public.release_candidate_identity(candidate_id TEXT PRIMARY KEY);",
      "INSERT INTO public.release_candidate_identity VALUES ('protected');",
      "REVOKE ALL ON public.release_candidate_identity FROM PUBLIC;",
      'GRANT SELECT ON public.release_candidate_identity TO "' + role + '";',
    ].join("\n"));
    assert.equal(sql(targetDb, 'SET ROLE "' + role + '"; SELECT candidate_id FROM public.release_candidate_identity;').stdout.trim().split("\n").at(-1), "protected");
    const forbidden = sql(targetDb, 'SET ROLE "' + role + '"; UPDATE public.release_candidate_identity SET candidate_id = \'forged\';', true);
    assert.notEqual(forbidden.status, 0);
    assert.match(forbidden.stderr, /permission denied/);
    const dropSchema = sql(targetDb, 'SET ROLE "' + role + '"; DROP SCHEMA public CASCADE;', true);
    assert.notEqual(dropSchema.status, 0);
    assert.match(dropSchema.stderr, /must be owner/);
    sql(targetDb, 'SET ROLE "' + role + '"; INSERT INTO public.baskets(value) VALUES (\'candidate-only\');');
    assert.equal(sql(sourceDb, "SELECT COUNT(*) FROM public.baskets;").stdout.trim(), "1");
    assert.equal(sql(targetDb, "SELECT COUNT(*) FROM public.baskets;").stdout.trim(), "2");
    // Non-default privileged extensions must fail under the restricted role,
    // preserving the source and aborting the candidate transaction.
    const available = sql(sourceDb, "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'file_fdw');").stdout.trim();
    if (available === "t") {
      sql(sourceDb, "CREATE EXTENSION file_fdw;");
      const extensionDump = spawnSync("pg_dump", [
        "--dbname=" + dbUrl(sourceDb), "-w", "--format=custom", "--no-owner", "--no-privileges",
      ], { timeout: 30_000 });
      assert.equal(extensionDump.status, 0, extensionDump.stderr.toString());
      const extensionTarget = targetDb + "_ext";
      sql(baseUrl.pathname.slice(1), 'CREATE DATABASE "' + extensionTarget + '" TEMPLATE template0;');
      created.push(extensionTarget);
      sql(extensionTarget, 'ALTER SCHEMA public OWNER TO CURRENT_USER; REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO "' + role + '";');
      const denied = execute("pg_restore", [
        "--dbname=" + dbUrl(extensionTarget), "--exit-on-error", "--no-owner", "--no-privileges",
        "--no-comments", "--single-transaction", "--role=" + role,
      ], extensionDump.stdout, true);
      assert.notEqual(denied.status, 0);
      assert.match(denied.stderr, /permission denied|must be superuser/);
      assert.equal(sql(extensionTarget, "SELECT to_regclass('public.baskets') IS NULL;").stdout.trim(), "t");
      assert.equal(sql(sourceDb, "SELECT COUNT(*) FROM public.baskets;").stdout.trim(), "1");
    }
  } finally {
    // Fixture-owned disposable objects only; the preparation helper never cleans.
    for (const db of created.reverse()) sql(baseUrl.pathname.slice(1), 'DROP DATABASE "' + db + '";', true);
    if (roleCreated) sql(baseUrl.pathname.slice(1), 'DROP ROLE "' + role + '";', true);
  }
});
