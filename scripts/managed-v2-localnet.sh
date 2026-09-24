#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROGRAM_ID="CZ3eG8JutryawXTcA1h97PMrhAGuWzsrYSgssMH43cKL"
PROGRAM_SO="$(printenv MANAGED_V2_PROGRAM_SO || true)"
if [[ -z "$PROGRAM_SO" ]]; then PROGRAM_SO="$ROOT/target/deploy/managed_basket.so"; fi
RPC_PORT="$(printenv MANAGED_V2_RPC_PORT || true)"
if [[ -z "$RPC_PORT" ]]; then RPC_PORT=8899; fi
FAUCET_PORT="$(printenv MANAGED_V2_FAUCET_PORT || true)"
if [[ -z "$FAUCET_PORT" ]]; then FAUCET_PORT=9900; fi
RPC_URL="$(printenv MANAGED_V2_RPC_URL || true)"
if [[ -z "$RPC_URL" ]]; then RPC_URL="http://127.0.0.1:$RPC_PORT"; fi
STATE_DIR="$(printenv MANAGED_V2_STATE_DIR || true)"
if [[ -z "$STATE_DIR" ]]; then STATE_DIR="$(mktemp -d /private/tmp/basalt-managed-v2-proof.XXXXXXXX)"; fi
LEDGER_DIR="$STATE_DIR/ledger"
RUN_DIR="$STATE_DIR/run"
VALIDATOR_PID=""
VALIDATOR_LOG="$STATE_DIR/validator.log"
SKIP_BUILD="$(printenv MANAGED_V2_SKIP_BUILD || true)"
if [[ -z "$SKIP_BUILD" ]]; then SKIP_BUILD=0; fi
START_TIMEOUT="$(printenv MANAGED_V2_VALIDATOR_START_SECS || true)"
if [[ -z "$START_TIMEOUT" ]]; then START_TIMEOUT=300; fi
NOTICE_SLOTS="$(printenv MANAGED_V2_NOTICE_SLOTS || true)"
if [[ -z "$NOTICE_SLOTS" ]]; then NOTICE_SLOTS=216000; fi
WAIT_IN_PLACE="$(printenv MANAGED_V2_WAIT_IN_PLACE || true)"
if [[ -z "$WAIT_IN_PLACE" ]]; then
  if (( NOTICE_SLOTS <= 1000 )); then WAIT_IN_PLACE=1; else WAIT_IN_PLACE=0; fi
fi

if [[ "$STATE_DIR" != /private/tmp/* ]]; then
  echo "State directory must be under /private/tmp: $STATE_DIR" >&2
  exit 2
fi
if [[ "$RPC_URL" != "http://127.0.0.1:$RPC_PORT" && "$RPC_URL" != "http://localhost:$RPC_PORT" ]]; then
  echo "This proof only permits a local RPC endpoint." >&2
  exit 2
fi
if [[ ! "$NOTICE_SLOTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "MANAGED_V2_NOTICE_SLOTS must be a positive integer: $NOTICE_SLOTS" >&2
  exit 2
fi
if [[ "$WAIT_IN_PLACE" != "0" && "$WAIT_IN_PLACE" != "1" ]]; then
  echo "MANAGED_V2_WAIT_IN_PLACE must be 0 or 1: $WAIT_IN_PLACE" >&2
  exit 2
fi
if [[ "$NOTICE_SLOTS" != "216000" ]]; then
  echo "Using $NOTICE_SLOTS notice slots; this requires the explicit localnet-fast-notice test artifact." >&2
fi
mkdir -p "$STATE_DIR" "$RUN_DIR"
chmod 700 "$STATE_DIR" "$RUN_DIR"

if lsof -nP -iTCP:"$RPC_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "RPC port $RPC_PORT is already in use; refusing to stop another validator." >&2
  exit 2
fi
if lsof -nP -iTCP:"$FAUCET_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Faucet port $FAUCET_PORT is already in use; refusing to stop another process." >&2
  exit 2
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "Building managed_basket SBF program"
  (cd "$ROOT" && anchor build --program-name managed_basket)
fi
if [[ ! -f "$PROGRAM_SO" ]]; then
  echo "Missing $PROGRAM_SO; build the managed_basket SBF artifact first." >&2
  exit 2
fi
PROGRAM_SHA256="$(shasum -a 256 "$PROGRAM_SO" | awk '{print $1}')"

cleanup() {
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    kill -TERM "$VALIDATOR_PID" 2>/dev/null || true
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

start_validator() {
  local mode="$1"
  shift
  if [[ "$mode" == "fresh" ]]; then
    echo "Starting local validator ($mode) on $RPC_URL"
    COPYFILE_DISABLE=1 TAR_OPTIONS=--no-mac-metadata solana-test-validator --ledger "$LEDGER_DIR" --rpc-port "$RPC_PORT" --faucet-port "$FAUCET_PORT" --reset --bpf-program "$PROGRAM_ID" "$PROGRAM_SO" >"$VALIDATOR_LOG" 2>&1 &
  else
    echo "Starting local validator ($mode) on $RPC_URL"
    COPYFILE_DISABLE=1 TAR_OPTIONS=--no-mac-metadata solana-test-validator --ledger "$LEDGER_DIR" --rpc-port "$RPC_PORT" --faucet-port "$FAUCET_PORT" --warp-slot "$1" >"$VALIDATOR_LOG" 2>&1 &
  fi
  VALIDATOR_PID=$!
  local attempt
  for attempt in $(seq 1 "$START_TIMEOUT"); do
    if ! kill -0 "$VALIDATOR_PID" 2>/dev/null; then
      echo "Validator exited during startup; log follows:" >&2
      tail -n 40 "$VALIDATOR_LOG" >&2 || true
      return 1
    fi
    if curl -fsS --max-time 2 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[{"commitment":"confirmed"}]}' "$RPC_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Validator did not become ready; log follows:" >&2
  tail -n 40 "$VALIDATOR_LOG" >&2 || true
  return 1
}

stop_validator() {
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    echo "Stopping validator cleanly to retain its ledger"
    kill -TERM "$VALIDATOR_PID"
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi
  VALIDATOR_PID=""
}

start_validator fresh
echo "Preparing basket, second holder, and approved delayed change"
MANAGED_V2_RPC_URL="$RPC_URL" MANAGED_V2_STATE_DIR="$RUN_DIR" MANAGED_V2_NOTICE_SLOTS="$NOTICE_SLOTS" MANAGED_V2_PROGRAM_SHA256="$PROGRAM_SHA256" MANAGED_V2_PHASE=prepare "$ROOT/node_modules/.bin/tsx" --tsconfig "$ROOT/app/tsconfig.json" "$ROOT/scripts/managed-v2-proof.ts"

TARGET_SLOT="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(s.targetSlot));' "$RUN_DIR/run.json")"
if [[ ! "$TARGET_SLOT" =~ ^[0-9]+$ ]]; then
  echo "Invalid saved notice target slot: $TARGET_SLOT" >&2
  exit 1
fi
if [[ "$WAIT_IN_PLACE" == "1" ]]; then
  echo "Waiting for notice slot $TARGET_SLOT on the same validator ledger"
  while true; do
    CURRENT_SLOT="$(curl -fsS --max-time 2 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[{"commitment":"confirmed"}]}' "$RPC_URL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(r.error)process.exit(2);process.stdout.write(String(r.result));});')"
    if [[ "$CURRENT_SLOT" =~ ^[0-9]+$ ]] && (( CURRENT_SLOT >= TARGET_SLOT )); then break; fi
    sleep 1
  done
else
  stop_validator
  start_validator warped "$TARGET_SLOT"
fi
echo "Finishing delayed fill, checking share supply, and redeeming remaining holder shares"
MANAGED_V2_RPC_URL="$RPC_URL" MANAGED_V2_STATE_DIR="$RUN_DIR" MANAGED_V2_NOTICE_SLOTS="$NOTICE_SLOTS" MANAGED_V2_PROGRAM_SHA256="$PROGRAM_SHA256" MANAGED_V2_PHASE=finish "$ROOT/node_modules/.bin/tsx" --tsconfig "$ROOT/app/tsconfig.json" "$ROOT/scripts/managed-v2-proof.ts"

echo "Localnet proof result: $RUN_DIR/result.json"
echo "Temporary validator state: $STATE_DIR"
