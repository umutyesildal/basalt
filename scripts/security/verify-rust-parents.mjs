#!/usr/bin/env node
/** Check every vendored byte against checksum-verified upstream registry archives.
 * The only permitted upstream changes are the three reviewed manifest lines.
 * No archive is extracted to the filesystem and no network access is required.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const patches = {
  'solana-logger': ['[dependencies.env_logger]', '0.9.3', '=0.10.2'],
  'solana-sdk': ['[dependencies.memmap2]', '0.5.10', '=0.9.11'],
  'solana-frozen-abi': ['[target."cfg(not(target_os = \\"solana\\"))".dependencies.memmap2]', '0.5.10', '=0.9.11'],
};
function fail(message) { throw new Error(`Rust parent provenance: ${message}`); }
function regularBytes(path) {
  if (!lstatSync(path).isFile()) fail(`expected a regular file: ${path}`);
  return readFileSync(path);
}
function tarFiles(archive, prefix) {
  const bytes = gunzipSync(archive, { maxOutputLength: 4 * 1024 * 1024 });
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (!bytes.subarray(offset).every(byte => byte === 0)) fail('nonzero data after archive terminator');
      return files;
    }
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = field(0, 100);
    const sizeText = field(124, 12).trim();
    const checksumText = field(148, 8).trim();
    if (!/^[0-7]+$/.test(sizeText) || !/^[0-7]+$/.test(checksumText)) fail('invalid archive numeric fields');
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    const size = parseInt(sizeText, 8);
    if (checksum !== parseInt(checksumText, 8) || !Number.isSafeInteger(size)) fail('invalid archive header');
    if (field(345, 155) || !name.startsWith(`${prefix}/`) || name.split('/').some(part => part === '..' || part === '.') || ![0, 48].includes(header[156])) fail('unexpected archive entry');
    const local = name.slice(prefix.length + 1);
    if (!local || files.has(local) || offset + 512 + size > bytes.length) fail('duplicate/truncated archive entry');
    files.set(local, bytes.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  fail('missing archive terminator');
}
function treeFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail(`symlink in source tree: ${path}`);
    if (stat.isDirectory()) files.push(...treeFiles(path));
    else if (stat.isFile()) files.push(path);
    else fail(`nonregular source entry: ${path}`);
  }
  return files;
}
function activePatchBindings(cargo) {
  // Use the standard TOML parser rather than interpreting comments, quoted keys,
  // strings or repeated sections with a text search. No source text is executed.
  const parsed = spawnSync('python3', ['-c', 'import json,sys,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))'], {
    input: cargo, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  if (parsed.error || parsed.status !== 0) fail('valid Cargo TOML and Python 3.11+ parser required');
  const bindings = JSON.parse(parsed.stdout).patch?.['crates-io'];
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) || Object.keys(bindings).length !== 3) fail('root patch binding missing/ambiguous');
  for (const name of Object.keys(patches)) {
    const binding = bindings[name];
    if (!binding || typeof binding !== 'object' || Array.isArray(binding) || Object.keys(binding).length !== 1 || binding.path !== `vendor/rust/${name}-1.18.26`) fail(`${name} root patch binding missing/ambiguous`);
  }
}
export function verifyRustParents(root = resolve(fileURLToPath(new URL('../..', import.meta.url)))) {
  const base = join(root, 'vendor/rust');
  const manifest = JSON.parse(regularBytes(join(base, 'manifest.json')));
  if (manifest.schemaVersion !== 1 || manifest.upstreamRepository !== 'https://github.com/solana-labs/solana' || manifest.upstreamTag !== 'v1.18.26' || manifest.packages?.length !== 3) fail('unexpected manifest scope');
  if (manifest.license?.path !== 'LICENSE-APACHE' || manifest.license.source !== 'https://raw.githubusercontent.com/solana-labs/solana/v1.18.26/LICENSE' || sha256(regularBytes(join(base, 'LICENSE-APACHE'))) !== manifest.license.sha256) fail('license provenance changed');
  const cargo = regularBytes(join(root, 'Cargo.toml')).toString('utf8');
  activePatchBindings(cargo);
  const seen = new Set(), verified = [];
  for (const entry of manifest.packages) {
    const patch = patches[entry.name];
    if (!patch || seen.has(entry.name) || entry.version !== '1.18.26') fail('unexpected/duplicate parent');
    seen.add(entry.name);
    const prefix = `${entry.name}-1.18.26`;
    if (entry.directory !== prefix || entry.upstreamArchive !== `upstream/${prefix}.crate`) fail('unexpected parent path');
    const archive = regularBytes(join(base, entry.upstreamArchive));
    if (!/^[a-f0-9]{64}$/.test(entry.upstreamArchiveSha256) || sha256(archive) !== entry.upstreamArchiveSha256) fail(`${entry.name} registry archive checksum mismatch`);
    const files = tarFiles(archive, prefix);
    const vcs = JSON.parse(files.get('.cargo_vcs_info.json'));
    if (vcs.git.sha1 !== entry.upstreamCommit || vcs.path_in_vcs !== entry.upstreamPath) fail(`${entry.name} VCS provenance mismatch`);
    const before = `${patch[0]}\nversion = "${patch[1]}"`, after = `# Basalt 2026-10-09: reviewed host dependency pin; upstream Rust sources unchanged.\n${patch[0]}\nversion = "${patch[2]}"`;
    if (entry.replacements?.length !== 1 || entry.replacements[0].file !== 'Cargo.toml' || entry.replacements[0].before !== before || entry.replacements[0].after !== after) fail(`${entry.name} exceeds approved manifest patch`);
    const original = files.get('Cargo.toml').toString('utf8');
    if (original.split(before).length !== 2) fail(`${entry.name} upstream dependency changed`);
    files.set('Cargo.toml', Buffer.from(original.replace(before, after)));
    const directory = join(base, prefix), actual = treeFiles(directory);
    if (actual.length !== files.size) fail(`${entry.name} extra or missing source files`);
    for (const path of actual) {
      const expected = files.get(relative(directory, path).split('\\').join('/'));
      if (!expected || !regularBytes(path).equals(expected)) fail(`${entry.name} changed source: ${relative(directory, path)}`);
    }
    verified.push({ package: entry.name, version: entry.version, upstreamArchiveSha256: entry.upstreamArchiveSha256, verifiedFiles: files.size });
  }
  return { schemaVersion: 1, sourceChanges: 0, manifestDependencyChanges: 3, parents: verified };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { console.log(JSON.stringify(verifyRustParents(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
