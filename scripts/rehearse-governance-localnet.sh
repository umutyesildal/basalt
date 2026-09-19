#!/usr/bin/env bash
set -euo pipefail

# This script proves upgrade-authority transfer and rollback mechanics with two
# disposable keypairs on a private validator. The governance keypair is a
# placeholder, not a Squads multisig, threshold, or time-lock proof.

usage() {
  cat <<'EOF'
Usage: scripts/rehearse-governance-localnet.sh \
  --rpc-url http://127.0.0.1:8899 \
  --program-so /absolute/path/program.so \
  --program-keypair /absolute/path/program-keypair.json

The script starts its own ephemeral solana-test-validator and accepts only a
loopback RPC URL. Run it separately for each program artifact. It never changes
devnet or mainnet and never makes a program immutable.
EOF
}

RPC_URL=""
PROGRAM_SO=""
PROGRAM_KEYPAIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rpc-url) RPC_URL="${2:-}"; shift 2 ;;
    --program-so) PROGRAM_SO="${2:-}"; shift 2 ;;
    --program-keypair) PROGRAM_KEYPAIR="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/governance-rehearsal.mjs"
node "$HELPER" assert-loopback "$RPC_URL" >/dev/null
node -e 'import(process.argv[1]).then(({validateRehearsalArgs}) => validateRehearsalArgs({rpcUrl:process.argv[2],programSo:process.argv[3],programKeypair:process.argv[4]})).catch((error)=>{console.error(error.message);process.exit(1)})' "file://$HELPER" "$RPC_URL" "$PROGRAM_SO" "$PROGRAM_KEYPAIR"

if [[ "$(node -e 'console.log(new URL(process.argv[1]).protocol)' "$RPC_URL")" != "http:" ]]; then
  printf 'The self-hosted validator requires an http loopback URL.\n' >&2
  exit 2
fi
if [[ ! -f "$PROGRAM_SO" || ! -f "$PROGRAM_KEYPAIR" ]]; then
  printf 'Program artifact and program-id keypair must already exist.\n' >&2
  exit 2
fi

for command_name in solana solana-keygen solana-test-validator node; do
  command -v "$command_name" >/dev/null || { printf 'Missing command: %s\n' "$command_name" >&2; exit 2; }
done

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/basalt-governance-rehearsal.XXXXXX")"
OPERATOR_KEYPAIR="$TEMP_DIR/operator.json"
GOVERNANCE_KEYPAIR="$TEMP_DIR/governance-placeholder.json"
VALIDATOR_PID=""
CURRENT_PROGRAM_ID=""
CURRENT_TRANSFERRED=0

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$CURRENT_TRANSFERRED" -eq 1 && -n "$CURRENT_PROGRAM_ID" ]]; then
    solana program set-upgrade-authority "$CURRENT_PROGRAM_ID" \
      --url "$RPC_URL" \
      --keypair "$GOVERNANCE_KEYPAIR" \
      --upgrade-authority "$GOVERNANCE_KEYPAIR" \
      --new-upgrade-authority "$OPERATOR_KEYPAIR" >/dev/null 2>&1 || true
  fi
  if [[ -n "$VALIDATOR_PID" ]]; then
    kill "$VALIDATOR_PID" >/dev/null 2>&1 || true
    wait "$VALIDATOR_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEMP_DIR"
  exit "$status"
}
trap cleanup EXIT INT TERM

solana-keygen new --no-bip39-passphrase --silent --force --outfile "$OPERATOR_KEYPAIR" >/dev/null
solana-keygen new --no-bip39-passphrase --silent --force --outfile "$GOVERNANCE_KEYPAIR" >/dev/null
OPERATOR_PUBKEY="$(solana-keygen pubkey "$OPERATOR_KEYPAIR")"
GOVERNANCE_PUBKEY="$(solana-keygen pubkey "$GOVERNANCE_KEYPAIR")"
PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
CURRENT_PROGRAM_ID="$PROGRAM_ID"

RPC_PORT="$(node "$HELPER" url-port "$RPC_URL")"
solana-test-validator \
  --reset \
  --ledger "$TEMP_DIR/ledger" \
  --bind-address 127.0.0.1 \
  --rpc-port "$RPC_PORT" >"$TEMP_DIR/validator.log" 2>&1 &
VALIDATOR_PID=$!

sleep 0.25
if ! kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
  printf 'Ephemeral validator failed to start; refusing to use any process already on %s.\n' "$RPC_URL" >&2
  exit 1
fi

for _attempt in $(seq 1 60); do
  if ! kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
    printf 'Ephemeral validator exited before becoming ready.\n' >&2
    exit 1
  fi
  if solana cluster-version --url "$RPC_URL" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
solana cluster-version --url "$RPC_URL" >/dev/null
kill -0 "$VALIDATOR_PID" >/dev/null
solana airdrop 20 "$OPERATOR_PUBKEY" --url "$RPC_URL" >/dev/null

solana program deploy "$PROGRAM_SO" \
  --url "$RPC_URL" \
  --keypair "$OPERATOR_KEYPAIR" \
  --program-id "$PROGRAM_KEYPAIR" \
  --upgrade-authority "$OPERATOR_KEYPAIR" >/dev/null

solana program show "$PROGRAM_ID" --url "$RPC_URL" --output json >"$TEMP_DIR/before.json"
solana account "$PROGRAM_ID" --url "$RPC_URL" --output json >"$TEMP_DIR/before-account.json"
PROGRAMDATA_ADDRESS="$(node "$HELPER" assert-show "$TEMP_DIR/before.json" "$OPERATOR_PUBKEY")"
node "$HELPER" assert-executable "$TEMP_DIR/before-account.json"

solana program set-upgrade-authority "$PROGRAM_ID" \
  --url "$RPC_URL" \
  --keypair "$OPERATOR_KEYPAIR" \
  --upgrade-authority "$OPERATOR_KEYPAIR" \
  --new-upgrade-authority "$GOVERNANCE_KEYPAIR" >/dev/null
CURRENT_TRANSFERRED=1

solana program show "$PROGRAM_ID" --url "$RPC_URL" --output json >"$TEMP_DIR/transferred.json"
solana account "$PROGRAM_ID" --url "$RPC_URL" --output json >"$TEMP_DIR/transferred-account.json"
node "$HELPER" assert-show "$TEMP_DIR/transferred.json" "$GOVERNANCE_PUBKEY" "$PROGRAMDATA_ADDRESS" >/dev/null
node "$HELPER" assert-executable "$TEMP_DIR/transferred-account.json"

if solana program set-upgrade-authority "$PROGRAM_ID" \
  --url "$RPC_URL" \
  --keypair "$OPERATOR_KEYPAIR" \
  --upgrade-authority "$OPERATOR_KEYPAIR" \
  --new-upgrade-authority "$OPERATOR_KEYPAIR" >"$TEMP_DIR/former-operator.log" 2>&1; then
  printf 'Former operator unexpectedly retained upgrade authority.\n' >&2
  exit 1
fi

solana program set-upgrade-authority "$PROGRAM_ID" \
  --url "$RPC_URL" \
  --keypair "$GOVERNANCE_KEYPAIR" \
  --upgrade-authority "$GOVERNANCE_KEYPAIR" \
  --new-upgrade-authority "$OPERATOR_KEYPAIR" >/dev/null
CURRENT_TRANSFERRED=0

solana program show "$PROGRAM_ID" --url "$RPC_URL" --output json >"$TEMP_DIR/rolled-back.json"
solana account "$PROGRAM_ID" --url "$RPC_URL" --output json >"$TEMP_DIR/rolled-back-account.json"
node "$HELPER" assert-show "$TEMP_DIR/rolled-back.json" "$OPERATOR_PUBKEY" "$PROGRAMDATA_ADDRESS" >/dev/null
node "$HELPER" assert-executable "$TEMP_DIR/rolled-back-account.json"

printf 'PASS: local authority transfer, former-operator rejection, executable state, ProgramData stability, and rollback verified for %s.\n' "$PROGRAM_ID"
printf 'NOTE: the disposable governance key is not proof of a multisig threshold or timelock.\n'
