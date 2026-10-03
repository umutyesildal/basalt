#!/usr/bin/env bash
# Build entrypoint-bearing V0 programs separately. A workspace build can unify
# the factory's `cpi` dependency features and emit no-entrypoint dependency .so
# files over deployable artifacts. Never substitute a host `cargo build`.
set -euo pipefail

BASALT_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
BASALT_SBF_BUILDER="${BASALT_CARGO_BUILD_SBF:-cargo-build-sbf}"
# Resolve an explicit relative binary path before changing to the repo root.
if [[ "$BASALT_SBF_BUILDER" == */* && "$BASALT_SBF_BUILDER" != /* ]]; then
  BASALT_SBF_BUILDER="$(pwd -P)/$BASALT_SBF_BUILDER"
fi

for BASALT_ARG in "$@"; do
  case "$BASALT_ARG" in
    --workspace|--all|--exclude|--exclude=*|--package|--package=*|-p|-p?*|--manifest-path|--manifest-path=*|--sbf-out-dir|--sbf-out-dir=*|--)
      printf 'Refusing build-selection/output override: %s\n' "$BASALT_ARG" >&2
      exit 2
      ;;
  esac
done
if ! command -v "$BASALT_SBF_BUILDER" >/dev/null 2>&1; then
  printf 'SBF builder not found: %s\nSet BASALT_CARGO_BUILD_SBF to the actual executable path.\n' "$BASALT_SBF_BUILDER" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf 'python3 is required to validate the SBF ELF artifacts.\n' >&2
  exit 1
fi

cd "$BASALT_REPO_ROOT"
BASALT_STAGE_ROOT="$BASALT_REPO_ROOT/target/xstocks-sbf"
BASALT_DEPLOY_ROOT="$BASALT_REPO_ROOT/target/deploy"
mkdir -p "$BASALT_STAGE_ROOT"
BASALT_LOCK_DIR="$BASALT_STAGE_ROOT/.build-v0.lock"
if ! mkdir "$BASALT_LOCK_DIR" 2>/dev/null; then
  printf 'Another isolated build is active, or its lock remains: %s\n' "$BASALT_LOCK_DIR" >&2
  printf 'Do not run builds concurrently. Remove a stale empty lock only after verifying no build is running.\n' >&2
  exit 1
fi
cleanup() { rmdir "$BASALT_LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

validate_sbf() {
  python3 - "$1" <<'PY'
import hashlib
from pathlib import Path
import struct
import sys

path = Path(sys.argv[1])
try:
    data = path.read_bytes()
except OSError as error:
    raise SystemExit(f"Missing/unreadable SBF artifact {path}: {error}")
if len(data) <= 4_096:
    raise SystemExit(f"Rejected {path.name}: {len(data)} bytes, too small for a V0 program")
if data[:4] != b"\x7fELF" or data[4] != 2 or data[5] != 1 or data[6] != 1:
    raise SystemExit(f"Rejected {path.name}: expected a 64-bit little-endian ELF")
elf_type, machine = struct.unpack_from("<HH", data, 16)
entry = struct.unpack_from("<Q", data, 24)[0]
if elf_type != 3 or machine not in (247, 263):
    raise SystemExit(f"Rejected {path.name}: expected ET_DYN / EM_BPF(247) or EM_SBPF(263), got {elf_type} / {machine}")
if entry == 0:
    raise SystemExit(f"Rejected {path.name}: zero entrypoint (likely a CPI/no-entrypoint build)")
print(f"Validated {path.name}: {len(data):,} bytes, entry 0x{entry:x}, sha256 {hashlib.sha256(data).hexdigest()}")
PY
}

# Distinct invocations and output directories are essential. Preserve PATH and
# RUSTC from the caller; compiler/tool flags precede the fixed manifest/output.
for BASALT_PROGRAM in whitelist basket basket_factory; do
  BASALT_MANIFEST="$BASALT_REPO_ROOT/programs/$BASALT_PROGRAM/Cargo.toml"
  BASALT_OUT_DIR="$BASALT_STAGE_ROOT/$BASALT_PROGRAM"
  [[ -f "$BASALT_MANIFEST" ]] || { printf 'Missing manifest: %s\n' "$BASALT_MANIFEST" >&2; exit 1; }
  mkdir -p "$BASALT_OUT_DIR"
  # Prevent an old valid file from disguising a builder that emitted nothing.
  # Leave every other output and all keypair files untouched.
  rm -f "$BASALT_OUT_DIR/$BASALT_PROGRAM.so"
  printf 'Building SBF program: %s\n' "$BASALT_PROGRAM"
  "$BASALT_SBF_BUILDER" "$@" \
    --manifest-path "$BASALT_MANIFEST" \
    --sbf-out-dir "$BASALT_OUT_DIR"
  validate_sbf "$BASALT_OUT_DIR/$BASALT_PROGRAM.so"
done

# Promote only after ALL three builds and validations succeed. Copy only the
# named .so files, never wildcard output or generated deployment keypairs.
mkdir -p "$BASALT_DEPLOY_ROOT"
for BASALT_PROGRAM in whitelist basket basket_factory; do
  BASALT_PROMOTION="$(mktemp "$BASALT_DEPLOY_ROOT/.${BASALT_PROGRAM}.so.XXXXXX")"
  if ! cp "$BASALT_STAGE_ROOT/$BASALT_PROGRAM/$BASALT_PROGRAM.so" "$BASALT_PROMOTION"; then
    rm -f "$BASALT_PROMOTION"
    exit 1
  fi
  if ! mv -f "$BASALT_PROMOTION" "$BASALT_DEPLOY_ROOT/$BASALT_PROGRAM.so"; then
    rm -f "$BASALT_PROMOTION"
    exit 1
  fi
done
printf 'All three validated V0 SBF artifacts are ready in %s\n' "$BASALT_DEPLOY_ROOT"
