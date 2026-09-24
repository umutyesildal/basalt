#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROGRAM_ID="CZ3eG8JutryawXTcA1h97PMrhAGuWzsrYSgssMH43cKL"
PROGRAM_SO="${MANAGED_V2_PROGRAM_SO:-$ROOT/target/deploy/managed_basket.so}"
LEDGER_DIR="${MANAGED_V2_LAB_LEDGER:-/private/tmp/basalt-managed-v2-wallet-lab}"
RPC_PORT="${MANAGED_V2_RPC_PORT:-8899}"
FAUCET_PORT="${MANAGED_V2_FAUCET_PORT:-9900}"

if [[ "$LEDGER_DIR" != /private/tmp/* ]]; then
  echo "Lab ledger must be under /private/tmp." >&2
  exit 2
fi
if [[ ! -f "$PROGRAM_SO" ]]; then
  echo "Missing Managed V2 SBF artifact: $PROGRAM_SO" >&2
  echo "Build it before starting the local lab." >&2
  exit 2
fi
if lsof -nP -iTCP:"$RPC_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "RPC port $RPC_PORT is already in use; refusing to replace a running validator." >&2
  exit 2
fi
mkdir -p "$LEDGER_DIR"
echo "Managed V2 wallet lab on http://127.0.0.1:$RPC_PORT"
echo "After connecting a wallet, run: npx tsx scripts/managed-v2-wallet-fixture.ts <wallet-pubkey>"
echo "Then open /managed/lab in an app started with NEXT_PUBLIC_CLUSTER=localnet."
exec env COPYFILE_DISABLE=1 TAR_OPTIONS=--no-mac-metadata solana-test-validator --ledger "$LEDGER_DIR" --rpc-port "$RPC_PORT" --faucet-port "$FAUCET_PORT" --reset --bpf-program "$PROGRAM_ID" "$PROGRAM_SO"
