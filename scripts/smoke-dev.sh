#!/usr/bin/env bash
# smoke-dev.sh — Basalt devnet canlı duman testi (tekrarlanabilir sürüm).
#
# Akış:
#   0. Ön kontroller: .env.devnet var mı, :3000/:3001 boş mu.
#   1. backend/.env.devnet yükle → backend'i `npx tsx src/index.ts` ile arka
#      planda başlat, /api/v1/health 200 + db.connected + basketCount olana dek bekle.
#   2. app'i NEXT_PUBLIC_API/NEXT_PUBLIC_CLUSTER=devnet ile BUILD et, sonra
#      `npm run start -- -p 3000` ile ayağa kaldır, 200 olana dek bekle.
#   3. Rota matrisini curl'le denetle (basket pubkey'i /api/v1/baskets?limit=1
#      yanıtlarından DİNAMİK alınır — sabit pubkey'e bağlanma).
#   4. /api/v1/events?basket=<pubkey>&limit=1 → 200 kontrolü.
#   5. EXIT trap'i ile backend + app süreç ağaçlarını kapat (set -m ile her job
#      kendi süreç grubunda: grup sinyali npm→sh→next zincirini tamamen öldürür),
#      port'ların boşaldığını doğrula, PASS/FAIL özeti bas, uygun exit koduyla çık.
#
# Kullanım (repo kökünden):
#   bash scripts/smoke-dev.sh
#
# Not: env değerleri (DATABASE_URL, RPC_URL, ...) ASLA stdout'a basılmaz;
# backend/app logları tmp dosyaya yazılır, hata durumunda yalnızca sır
# içerebilecek satırlar filtrelenerek kuyruk gösterilir.
set -euo pipefail
# Her arka plan job'ı kendi süreç grubunda başlasın — cleanup'ta grup bazlı
# kill, npm/npx altında fidalan süreç ağacını da kapatır (macOS'ta setsid yok).
set -m

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
APP_DIR="$REPO_ROOT/app"
ENV_FILE="$BACKEND_DIR/.env.devnet"

BACKEND_PORT=3001
APP_PORT=3000
BACKEND_URL="http://localhost:$BACKEND_PORT"
APP_URL="http://localhost:$APP_PORT"
BACKEND_WAIT_SECS=60
APP_WAIT_SECS=90

BACKEND_PID=""
APP_PID=""
BACKEND_LOG="$(mktemp /tmp/basalt-smoke-backend.XXXXXXXX)"
BUILD_LOG="$(mktemp /tmp/basalt-smoke-build.XXXXXXXX)"
APP_LOG="$(mktemp /tmp/basalt-smoke-app.XXXXXXXX)"
HTTP_LOG="$(mktemp /tmp/basalt-smoke-http.XXXXXXXX)"

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=()

# --- helpers ------------------------------------------------------------------

# Sır içerebilecek satırları süz (env değerlerini loglara sızmamak için).
filter_secrets() {
  local line redacted
  while IFS= read -r line; do
    redacted="$line"
    if [[ -n "${DATABASE_URL:-}" && "$redacted" == *"$DATABASE_URL"* ]]; then
      redacted="${redacted//$DATABASE_URL/<redacted:DATABASE_URL>}"
    fi
    if [[ -n "${RPC_URL:-}" && "$redacted" == *"$RPC_URL"* ]]; then
      redacted="${redacted//$RPC_URL/<redacted:RPC_URL>}"
    fi
    printf '%s\n' "$redacted"
  done
}

log()  { printf '%s\n' "$*"; }
step() { log ""; log "==> $*"; }

record_pass() { PASS_COUNT=$((PASS_COUNT + 1)); log "  PASS  $*"; }
record_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILURES+=("$*")
  log "  FAIL  $*"
}

# Verilen URL 200 dönene kadar bekle; süre dolarsa 1 döndür.
wait_for_http_200() {
  local url="$1" max_secs="$2" waited=0 code=""
  while (( waited < max_secs )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)"
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

port_listeners() {
  lsof -nP -i ":$1" -sTCP:LISTEN 2>/dev/null | tail -n +2 || true
}

cleanup() {
  step "Temizlik: süreçler kapatılıyor"
  local pid alive
  for pid in "${APP_PID:-}" "${BACKEND_PID:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      # Negatif PID = süreç grubu (set -m sayesinde job kendi grubunun lideri).
      kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    fi
  done
  # Kibar kapanışa en fazla 10 sn tanı.
  for _ in $(seq 1 10); do
    alive=0
    for pid in "${APP_PID:-}" "${BACKEND_PID:-}"; do
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then alive=1; fi
    done
    [[ "$alive" == 0 ]] && break
    sleep 1
  done
  # Hâlâ yaşıyorsa zorla (önce grup, sonra lider).
  for pid in "${APP_PID:-}" "${BACKEND_PID:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -9 -- -"$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    fi
  done
  # Port'ların boşaldığını doğrula. Başta boş olduklarını doğruladığımız için
  # kalan dinleyici (varsa) bizim artıklarımızdır — son çare onları da öldür.
  local leftover_pids=""
  leftover_pids="$(lsof -t -nP -i ":$APP_PORT" -i ":$BACKEND_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$leftover_pids" ]]; then
    log "  WARN  kapanma sonrası :$APP_PORT/:$BACKEND_PORT üzerinde dinleyici kaldı, zorla sonlandırılıyor: $(printf '%s' "$leftover_pids" | tr '\n' ' ')"
    # shellcheck disable=SC2086
    kill -9 $leftover_pids 2>/dev/null || true
    sleep 1
  fi
  if [[ -z "$(lsof -t -nP -i ":$APP_PORT" -i ":$BACKEND_PORT" -sTCP:LISTEN 2>/dev/null || true)" ]]; then
    log "  OK    :$APP_PORT ve :$BACKEND_PORT boşaldı (dinleyici kalmadı)"
  else
    log "  FAIL  portlar hâlâ meşgul — elle müdahale gerekebilir"
    port_listeners "$APP_PORT" | filter_secrets || true
    port_listeners "$BACKEND_PORT" | filter_secrets || true
  fi
  rm -f "$BACKEND_LOG" "$BUILD_LOG" "$APP_LOG" "$HTTP_LOG"
}
trap cleanup EXIT

# --- 0) ön kontroller -----------------------------------------------------------

step "Ön kontroller"
if [[ ! -f "$ENV_FILE" ]]; then
  log "HATA: $ENV_FILE bulunamadı" >&2
  exit 2
fi
if [[ ! -d "$BACKEND_DIR" || ! -d "$APP_DIR" ]]; then
  log "HATA: backend/ veya app/ dizini bulunamadı (repo kökünden çalıştırın)" >&2
  exit 2
fi
for port in "$BACKEND_PORT" "$APP_PORT"; do
  if [[ -n "$(lsof -t -nP -i ":$port" -sTCP:LISTEN 2>/dev/null || true)" ]]; then
    log "HATA: :$port hâlihazırda kullanımda — test öncesi boş olmalı" >&2
    port_listeners "$port" | filter_secrets >&2 || true
    exit 2
  fi
done
record_pass "ön kontroller (env dosyası var, :3000 ve :3001 boş)"

# --- 1) env yükle + backend -----------------------------------------------------

step "backend/.env.devnet yükleniyor (değerler bastırılmıyor)"
set -a
# shellcheck disable=SC1091
. "$ENV_FILE"
set +a
record_pass "env yüklendi ($(grep -cE '^[A-Z_]+=' "$ENV_FILE") anahtar)"

step "backend başlatılıyor: npx tsx src/index.ts (log: $BACKEND_LOG)"
(
  cd "$BACKEND_DIR"
  exec npx tsx src/index.ts
) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
log "backend pid: $BACKEND_PID (süreç grubu lideri)"

step "backend health bekleniyor: GET $BACKEND_URL/api/v1/health (max ${BACKEND_WAIT_SECS}sn, 200 + db.connected + basketCount)"
BACKEND_HEALTH_OK=0
for _ in $(seq 1 "$BACKEND_WAIT_SECS"); do
  code="$(curl -s -o "$HTTP_LOG" -w '%{http_code}' --max-time 5 "$BACKEND_URL/api/v1/health" || true)"
  if [[ "$code" == "200" ]] && grep -q '"connected":true' "$HTTP_LOG" && grep -q '"basketCount"' "$HTTP_LOG"; then
    BACKEND_HEALTH_OK=1
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    log "HATA: backend süreci beklenmedik şekilde öldü; log kuyruğu:"
    tail -n 20 "$BACKEND_LOG" | filter_secrets >&2 || true
    exit 3
  fi
  sleep 1
done
if (( BACKEND_HEALTH_OK == 1 )); then
  # Özet yalnızca yapısal alanlar içerir (bağlantı dizgesi yok).
  HEALTH_SUMMARY="$(python3 - "$HTTP_LOG" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    h = json.load(f)
subs = h.get("subsystems", {})
def flag(name):
    s = subs.get(name, {})
    return f"{name}={'running' if s.get('running') else ('enabled' if s.get('enabled') else 'off')}"
db = h.get("db", {})
print(f"db.connected={db.get('connected')} basketCount={db.get('basketCount')} "
      f"{flag('indexer')} {flag('navEngine')} {flag('feeCrank')}")
PY
)" || HEALTH_SUMMARY="(özet ayrıştırılamadı)"
  record_pass "backend health 200 ($HEALTH_SUMMARY)"
else
  record_fail "backend health ${BACKEND_WAIT_SECS}sn içinde 200+db.connected olmadı"
  log "backend log kuyruğu:"
  tail -n 20 "$BACKEND_LOG" | filter_secrets >&2 || true
fi

# --- 2) app build + start -------------------------------------------------------

step "app build: NEXT_PUBLIC_API=$BACKEND_URL NEXT_PUBLIC_CLUSTER=devnet npm run build (log: $BUILD_LOG)"
if (
  cd "$APP_DIR"
  NEXT_PUBLIC_API="$BACKEND_URL" NEXT_PUBLIC_CLUSTER=devnet npm run build
) >"$BUILD_LOG" 2>&1; then
  record_pass "app build başarılı"
  log "build özeti (son 6 satır):"
  tail -n 6 "$BUILD_LOG" | sed 's/^/        /'
else
  record_fail "app build başarısız"
  log "build log kuyruğu:"
  tail -n 30 "$BUILD_LOG" >&2 || true
fi

if (( FAIL_COUNT == 0 )); then
  step "app start: npm run start -- -p $APP_PORT (log: $APP_LOG)"
  (
    cd "$APP_DIR"
    NEXT_PUBLIC_API="$BACKEND_URL" NEXT_PUBLIC_CLUSTER=devnet exec npm run start -- -p "$APP_PORT"
  ) >"$APP_LOG" 2>&1 &
  APP_PID=$!
  log "app pid: $APP_PID (süreç grubu lideri)"

  step "app hazır olana dek bekleniyor: GET $APP_URL/ (max ${APP_WAIT_SECS}sn)"
  if wait_for_http_200 "$APP_URL/" "$APP_WAIT_SECS"; then
    record_pass "app $APP_URL/ 200"
  else
    record_fail "app ${APP_WAIT_SECS}sn içinde 200 olmadı"
    log "app log kuyruğu:"
    tail -n 20 "$APP_LOG" >&2 || true
  fi

  # --- 3) dinamik basket pubkey ---------------------------------------------

  step "basket pubkey dinamik alınıyor: GET $BACKEND_URL/api/v1/baskets?limit=1"
  BASKETS_JSON="$(curl -s --max-time 10 "$BACKEND_URL/api/v1/baskets?limit=1" || true)"
  BASKET_PUBKEY="$(printf '%s' "$BASKETS_JSON" | python3 -c 'import json,sys
d = json.load(sys.stdin)
rows = d.get("data") or []
print(rows[0]["pubkey"] if rows else "")' 2>/dev/null || true)"
  if [[ -n "$BASKET_PUBKEY" ]]; then
    record_pass "dinamik basket pubkey alındı: $BASKET_PUBKEY"
  else
    record_fail "/api/v1/baskets?limit=1 yanıtı boş/ayrıştırılamadı (hiç basket indekslenmemiş olabilir)"
    BASKET_PUBKEY=""
  fi

  # --- 4) rota matrisi --------------------------------------------------------

  step "rota matrisi denetleniyor (app: :$APP_PORT)"
  STATIC_ROUTES=(
    "/" "/explore" "/feed" "/leaderboard" "/portfolio" "/market"
    "/stocks" "/etfs" "/create" "/legal"
    "/robots.txt" "/sitemap.xml" "/llms.txt" "/basalt-agent-guide.md"
  )

  for route in "${STATIC_ROUTES[@]}"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$APP_URL$route" || true)"
    if [[ "$code" == "200" ]]; then
      record_pass "$route → 200"
    else
      record_fail "$route → $code (beklenen 200)"
    fi
  done

  if [[ -n "$BASKET_PUBKEY" ]]; then
    for route in "/api/agent/basket/$BASKET_PUBKEY" "/basket/$BASKET_PUBKEY"; do
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$APP_URL$route" || true)"
      if [[ "$code" == "200" ]]; then
        record_pass "$route → 200"
      else
        record_fail "$route → $code (beklenen 200)"
      fi
    done

    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$APP_URL/olmayan-sayfa-404" || true)"
    if [[ "$code" == "404" ]]; then
      record_pass "/olmayan-sayfa-404 → 404 (doğru)"
    else
      record_fail "/olmayan-sayfa-404 → $code (beklenen 404)"
    fi

    # --- 5) events rotası -----------------------------------------------------

    code="$(curl -s -o "$HTTP_LOG" -w '%{http_code}' --max-time 20 \
      "$BACKEND_URL/api/v1/events?basket=$BASKET_PUBKEY&limit=1" || true)"
    if [[ "$code" == "200" ]]; then
      EVENTS_SUMMARY="$(python3 - "$HTTP_LOG" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
except Exception:
    print("(gövde ayrıştırılamadı)")
    raise SystemExit
rows = d.get("data") or d.get("events") or []
first = rows[0] if rows else {}
t = first.get("type") or first.get("eventType") or "-"
print(f"events={len(rows)} ilk={t}")
PY
)" || EVENTS_SUMMARY="(özet ayrıştırılamadı)"
      record_pass "GET /api/v1/events?basket=<pubkey>&limit=1 → 200 ($EVENTS_SUMMARY)"
    else
      record_fail "GET /api/v1/events?basket=<pubkey>&limit=1 → $code (beklenen 200)"
    fi
  else
    log "  SKIP  basket'e bağlı rotalar ve events (pubkey alınamadı)"
    record_fail "/api/agent/basket/<pubkey> → atlandı (pubkey yok)"
    record_fail "/basket/<pubkey> → atlandı (pubkey yok)"
    record_fail "/api/v1/events?basket=<pubkey>&limit=1 → atlandı (pubkey yok)"
  fi
fi

# --- 6) özet --------------------------------------------------------------------

log ""
log "=============================================="
log " SMOKE ÖZETI: PASS=$PASS_COUNT FAIL=$FAIL_COUNT"
if (( FAIL_COUNT > 0 )); then
  for f in ${FAILURES[@]+"${FAILURES[@]}"}; do
    log "  - $f"
  done
fi
log "=============================================="
if (( FAIL_COUNT > 0 )); then
  exit 1
fi
log "SONUÇ: PASS"
