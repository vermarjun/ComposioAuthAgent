#!/usr/bin/env bash
#
# Run the whole stack locally, supervised.
#
#   scripts/dev.sh
#
# Run it in a terminal you keep open: it traps EXIT and kills its process group,
# so backgrounding it from a script tears the whole stack down when that script
# is reaped. To run detached, start xypro and `bun run src/server.ts` separately.
#
# The deployed box gets this from systemd. Locally, xypro has died mid-session
# more than once and taken every run with it — "agent stopped without emitting a
# packet" is what that looks like from the outside, which reads as a broken
# agent rather than a missing dependency. So it is watched here too.

set -uo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

XYPRO_URL="${XYPRO_BASE_URL:-http://127.0.0.1:1455/v1}"
XYPRO_DIR="${XYPRO_DIR:-$HOME/Desktop/xypro}"

cleanup() { kill 0 2>/dev/null; }
trap cleanup EXIT INT TERM

start_xypro() {
  if [ -f "$XYPRO_DIR/proxy/dist/index.js" ]; then
    ( cd "$XYPRO_DIR" && node proxy/dist/index.js >>/tmp/xypro.log 2>&1 ) &
  else
    xypro serve >>/tmp/xypro.log 2>&1 &
  fi
}

if ! curl -sf "$XYPRO_URL/models" >/dev/null 2>&1; then
  echo "[dev] starting xypro"
  start_xypro
  for _ in $(seq 1 30); do
    curl -sf "$XYPRO_URL/models" >/dev/null 2>&1 && break
    sleep 1
  done
fi
curl -sf "$XYPRO_URL/models" >/dev/null 2>&1 \
  && echo "[dev] xypro answering on $XYPRO_URL" \
  || echo "[dev] WARNING: xypro not answering; runs will fail"

# Watch the endpoint, not just the process: it can stay alive and stop serving.
(
  while true; do
    sleep 15
    if ! curl -sf "$XYPRO_URL/models" >/dev/null 2>&1; then
      echo "[dev] xypro stopped answering; restarting"
      pkill -f "proxy/dist/index.js" 2>/dev/null
      sleep 1
      start_xypro
      sleep 6
    fi
  done
) &

echo "[dev] starting control plane on :${PORT:-8080}"
bun run src/server.ts
