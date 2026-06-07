#!/usr/bin/env bash
# ===========================================
# Post-deploy smoke: BURN transfer path (read-only)
# ===========================================
#
# Verifies backend wallet endpoints and frontend bundle embed the jetton master
# after deploy. Does NOT send on-chain transfers.
#
# Usage:
#   ./scripts/post-deploy-burn-transfer-smoke.sh \
#     --base https://burnedchats.net \
#     --owner 0QBNxdjqjhQP2OPaZHSRj06NRTd4z6-Trd6BdZ0DX0_9WJPD \
#     --master-prefix kQBaK-MZ
#
# Environment (optional):
#   BASE_URL              — same as --base
#   BURN_SMOKE_TEST_OWNER — same as --owner
#   BURN_JETTON_MASTER_PREFIX — same as --master-prefix
#   TONCENTER_API_KEY     — only for optional --with-toncenter (never logged)
#
# Exit 0 when all checks pass; exit 1 on first failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOYMENTS_JSON="$REPO_ROOT/contracts/deployments/testnet.json"

DEFAULT_OWNER='0QBNxdjqjhQP2OPaZHSRj06NRTd4z6-Trd6BdZ0DX0_9WJPD'
DEFAULT_BASE='https://burnedchats.net'
DEFAULT_MASTER_PREFIX='kQBaK-MZ'

BASE_URL="${BASE_URL:-}"
OWNER="${BURN_SMOKE_TEST_OWNER:-}"
MASTER_PREFIX="${BURN_JETTON_MASTER_PREFIX:-}"
WITH_TONCENTER=0
JETTON_MASTER=''

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

usage() {
  cat <<'EOF'
Usage: post-deploy-burn-transfer-smoke.sh [options]

Options:
  --base URL              Deployment base URL (default: https://burnedchats.net)
  --owner ADDRESS         Testnet owner with known BURN balance
  --master-prefix PREFIX  First chars of jetton master in bundle (no full address in logs)
  --with-toncenter        Optional direct Ton Center get_wallet_address (needs repo + node)
  -h, --help              Show this help

Checks:
  1. GET /api/wallet/burn-balance → 200 + numeric balanceNano
  2. GET /api/wallet/jetton-wallet → 200 + non-empty jettonWalletAddress
  3. Frontend index-*.js bundle contains VITE_BURN_JETTON_MASTER and master prefix
  4. (optional) Ton Center runGetMethod get_wallet_address exit_code 0
EOF
}

log_ok() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $1" >&2
  exit 1
}

strip_trailing_slash() {
  local url="$1"
  while [[ "$url" == */ ]]; do
    url="${url%/}"
  done
  printf '%s' "$url"
}

read_jetton_master_from_deployments() {
  if [[ ! -f "$DEPLOYMENTS_JSON" ]]; then
    return 1
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -r '.addresses.jettonMaster // empty' "$DEPLOYMENTS_JSON"
    return 0
  fi
  grep -o '"jettonMaster"[[:space:]]*:[[:space:]]*"[^"]*"' "$DEPLOYMENTS_JSON" \
    | head -1 \
    | sed -E 's/.*"jettonMaster"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/'
}

resolve_master_prefix() {
  if [[ -n "$MASTER_PREFIX" ]]; then
    return 0
  fi
  local full
  full="$(read_jetton_master_from_deployments || true)"
  if [[ -n "$full" ]]; then
    JETTON_MASTER="$full"
    MASTER_PREFIX="${full:0:8}"
    return 0
  fi
  MASTER_PREFIX="$DEFAULT_MASTER_PREFIX"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_URL="$2"
      shift 2
      ;;
    --owner)
      OWNER="$2"
      shift 2
      ;;
    --master-prefix)
      MASTER_PREFIX="$2"
      shift 2
      ;;
    --with-toncenter)
      WITH_TONCENTER=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      log_fail "Unknown argument: $1 (use --help)"
      ;;
  esac
done

BASE_URL="$(strip_trailing_slash "${BASE_URL:-$DEFAULT_BASE}")"
OWNER="${OWNER:-$DEFAULT_OWNER}"
resolve_master_prefix

if [[ -z "$OWNER" ]]; then
  log_fail "owner address is required (--owner or BURN_SMOKE_TEST_OWNER)"
fi

if [[ -z "$MASTER_PREFIX" ]]; then
  log_fail "master prefix is required (--master-prefix or contracts/deployments/testnet.json)"
fi

if [[ -z "$JETTON_MASTER" ]]; then
  JETTON_MASTER="$(read_jetton_master_from_deployments || true)"
fi

echo "Burn transfer smoke: base=${BASE_URL} owner=<redacted> master-prefix=${MASTER_PREFIX}"

# --- 1. burn-balance ---
balance_url="${BASE_URL}/api/wallet/burn-balance?address=${OWNER}"
if ! balance_body="$(curl -fsS "$balance_url" 2>/dev/null)"; then
  log_fail "burn-balance: HTTP error (expected 200; got 404/502 or network failure)"
fi

if [[ "$balance_body" =~ \"balanceNano\"[[:space:]]*:[[:space:]]*\"([0-9]+)\" ]]; then
  log_ok "burn-balance: balanceNano present (numeric)"
else
  log_fail "burn-balance: missing or non-numeric balanceNano"
fi

# --- 2. jetton-wallet ---
wallet_url="${BASE_URL}/api/wallet/jetton-wallet?address=${OWNER}"
if ! wallet_body="$(curl -fsS "$wallet_url" 2>/dev/null)"; then
  log_fail "jetton-wallet: HTTP error (expected 200; got 404/502 or network failure)"
fi

if [[ "$wallet_body" =~ \"jettonWalletAddress\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
  jw="${BASH_REMATCH[1]}"
  if [[ -z "$jw" ]]; then
    log_fail "jetton-wallet: jettonWalletAddress is empty"
  fi
  log_ok "jetton-wallet: address present"
elif [[ "$wallet_body" =~ \"jettonWalletAddress\"[[:space:]]*:[[:space:]]*null ]]; then
  log_fail "jetton-wallet: jettonWalletAddress is null (wallet not resolved)"
else
  log_fail "jetton-wallet: jettonWalletAddress not found in response"
fi

# --- 3. frontend bundle ---
if ! index_html="$(curl -fsS "${BASE_URL}/" 2>/dev/null)"; then
  log_fail "frontend index: HTTP error fetching /"
fi

bundle_path="$(printf '%s' "$index_html" | grep -oE '/assets/index-[^"]+\.js' | head -1 || true)"
if [[ -z "$bundle_path" ]]; then
  log_fail "frontend bundle: index-*.js path not found in index.html"
fi

if ! bundle_body="$(curl -fsS "${BASE_URL}${bundle_path}" 2>/dev/null)"; then
  log_fail "frontend bundle: HTTP error fetching ${bundle_path}"
fi

if printf '%s' "$bundle_body" | grep -q 'VITE_BURN_JETTON_MASTER'; then
  log_ok "frontend bundle: VITE_BURN_JETTON_MASTER key present"
else
  log_fail "frontend bundle: VITE_BURN_JETTON_MASTER key missing (stale or misconfigured build)"
fi

if printf '%s' "$bundle_body" | grep -qF "$MASTER_PREFIX"; then
  log_ok "frontend bundle: jetton master prefix match yes"
else
  log_fail "frontend bundle: jetton master prefix match no"
fi

# --- 4. optional Ton Center get_wallet_address ---
if [[ "$WITH_TONCENTER" -eq 1 ]]; then
  if [[ -z "$JETTON_MASTER" ]]; then
    echo "[WARN] --with-toncenter skipped: jetton master address unavailable (no testnet.json)"
  elif [[ ! -d "$REPO_ROOT/frontend/node_modules/@ton/core" ]]; then
    echo "[WARN] --with-toncenter skipped: frontend/node_modules/@ton/core not found"
  else
    stack_boc="$(
      cd "$REPO_ROOT/frontend" && OWNER="$OWNER" node --input-type=module <<'NODE'
import { Address, beginCell } from '@ton/core';
const addr = Address.parse(process.env.OWNER ?? '');
const boc = beginCell().storeAddress(addr).endCell().toBoc({ idx: false }).toString('base64');
console.log(boc);
NODE
    )"

    ton_body="$(
      cd "$REPO_ROOT/frontend" && \
        JETTON_MASTER="$JETTON_MASTER" \
        STACK_BOC="$stack_boc" \
        TONCENTER_API_KEY="${TONCENTER_API_KEY:-}" \
        node --input-type=module <<'NODE'
const master = process.env.JETTON_MASTER ?? '';
const stackBoc = process.env.STACK_BOC ?? '';
const url = `${process.env.TONCENTER_ENDPOINT ?? 'https://testnet.toncenter.com/api/v2'}/runGetMethod`;
const headers = { 'Content-Type': 'application/json' };
if (process.env.TONCENTER_API_KEY) {
  headers['X-API-Key'] = process.env.TONCENTER_API_KEY;
}
const res = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    address: master,
    method: 'get_wallet_address',
    stack: [['tvm.Slice', stackBoc]],
  }),
});
const text = await res.text();
if (!res.ok) {
  process.exit(2);
}
const body = JSON.parse(text);
const exitCode = body?.result?.exit_code ?? body?.exit_code;
if (exitCode === 0 || exitCode === '0') {
  process.stdout.write('ok');
} else {
  process.exit(3);
}
NODE
    )" || ton_body=""

    if [[ "$ton_body" == "ok" ]]; then
      log_ok "toncenter get_wallet_address: exit_code 0"
    else
      log_fail "toncenter get_wallet_address: non-zero exit_code or request failed"
    fi
  fi
fi

log_ok "All burn transfer smoke checks passed"
exit 0
