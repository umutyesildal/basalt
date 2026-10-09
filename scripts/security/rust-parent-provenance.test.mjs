import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRustParents } from './verify-rust-parents.mjs';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
function fixture(run) {
  const scratch = mkdtempSync(join(tmpdir(), 'basalt-rust-provenance-'));
  try {
    cpSync(join(root, 'vendor'), join(scratch, 'vendor'), { recursive: true });
    cpSync(join(root, 'Cargo.toml'), join(scratch, 'Cargo.toml'));
    return run(scratch);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
test('all vendored upstream bytes match archives except the three permitted manifest lines', () => {
  const result = verifyRustParents(root);
  assert.equal(result.sourceChanges, 0);
  assert.equal(result.manifestDependencyChanges, 3);
  assert.equal(result.parents.reduce((sum, item) => sum + item.verifiedFiles, 0), 187);
  assert.deepEqual(result.parents.map(item => item.package).sort(), ['solana-frozen-abi', 'solana-logger', 'solana-sdk']);
});
test('provenance guard rejects edited upstream Rust source', () => fixture(scratch => {
  const path = join(scratch, 'vendor/rust/solana-sdk-1.18.26/src/lib.rs');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n// unreviewed change\n');
  assert.throws(() => verifyRustParents(scratch), /changed source: src\/lib.rs/);
}));
test('provenance guard rejects a broader manifest patch even if its declaration is altered', () => fixture(scratch => {
  const path = join(scratch, 'vendor/rust/manifest.json');
  const manifest = JSON.parse(readFileSync(path));
  manifest.packages[0].replacements[0].after = '[dependencies.env_logger]\nversion = "=0.11.11"';
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => verifyRustParents(scratch), /exceeds approved manifest patch/);
}));
test('provenance guard rejects corrupted registry archives before inspecting sources', () => fixture(scratch => {
  const path = join(scratch, 'vendor/rust/upstream/solana-sdk-1.18.26.crate');
  const bytes = readFileSync(path); bytes[bytes.length - 1] ^= 1; writeFileSync(path, bytes);
  assert.throws(() => verifyRustParents(scratch), /registry archive checksum mismatch/);
}));
test('provenance guard rejects injected source files and symlinks', () => fixture(scratch => {
  const path = join(scratch, 'vendor/rust/solana-logger-1.18.26/injected.rs');
  writeFileSync(path, 'unreviewed source');
  assert.throws(() => verifyRustParents(scratch), /extra or missing source files/);
  rmSync(path); symlinkSync(join(scratch, 'Cargo.toml'), path);
  assert.throws(() => verifyRustParents(scratch), /symlink in source tree/);
}));
test('provenance guard rejects missing Cargo patch bindings', () => fixture(scratch => {
  const path = join(scratch, 'Cargo.toml');
  writeFileSync(path, readFileSync(path, 'utf8').replace('solana-logger = { path = "vendor/rust/solana-logger-1.18.26" }', ''));
  assert.throws(() => verifyRustParents(scratch), /root patch binding missing\/ambiguous/);
}));
test('provenance guard rejects changed upstream license or VCS declaration', () => fixture(scratch => {
  const path = join(scratch, 'vendor/rust/manifest.json');
  const manifest = JSON.parse(readFileSync(path));
  manifest.packages[1].upstreamCommit = '0'.repeat(40); writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => verifyRustParents(scratch), /VCS provenance mismatch/);
  manifest.packages[1].upstreamCommit = JSON.parse(readFileSync(join(root, 'vendor/rust/manifest.json'))).packages[1].upstreamCommit;
  writeFileSync(path, JSON.stringify(manifest));
  writeFileSync(join(scratch, 'vendor/rust/LICENSE-APACHE'), 'missing license');
  assert.throws(() => verifyRustParents(scratch), /license provenance changed/);
}));

test('provenance guard rejects commented-out Cargo patch declarations', () => fixture(scratch => {
  const path = join(scratch, 'Cargo.toml');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^(solana-[^\n]+ = \{ path = [^\n]+)/gm, '# $1'));
  assert.throws(() => verifyRustParents(scratch), /root patch binding missing\/ambiguous/);
}));
test('provenance guard rejects matching declarations outside the active patch section', () => fixture(scratch => {
  const path = join(scratch, 'Cargo.toml');
  writeFileSync(path, readFileSync(path, 'utf8').replace('[patch.crates-io]', '[workspace.metadata.inactive-patches]'));
  assert.throws(() => verifyRustParents(scratch), /root patch binding missing\/ambiguous/);
}));
test('provenance guard rejects duplicate active Cargo declarations or sections', () => fixture(scratch => {
  const path = join(scratch, 'Cargo.toml'), original = readFileSync(path, 'utf8');
  writeFileSync(path, original + '\nsolana-logger = { path = "vendor/rust/solana-logger-1.18.26" }\n');
  assert.throws(() => verifyRustParents(scratch), /valid Cargo TOML/);
  writeFileSync(path, original + '\n[patch.crates-io]\n');
  assert.throws(() => verifyRustParents(scratch), /valid Cargo TOML/);
}));
