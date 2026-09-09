#!/usr/bin/env bash
set -uo pipefail

# xypro proxies a ChatGPT Codex subscription into an OpenAI-shaped endpoint.
# It cannot log in headlessly, so the authenticated token directory is mounted
# in rather than created here.

start_xypro() {
  echo "[entrypoint] starting xypro"
  xypro serve >>/tmp/xypro.log 2>&1 &
  echo $!
}

wait_for_xypro() {
  for _ in $(seq 1 40); do
    if curl -sf "${XYPRO_BASE_URL}/models" >/dev/null 2>&1; then
      echo "[entrypoint] xypro answering on ${XYPRO_BASE_URL}"
      return 0
    fi
    sleep 1
  done
  echo "[entrypoint] xypro did not answer in 40s; see /tmp/xypro.log"
  return 1
}

if [ -z "${XYPRO_REMOTE:-}" ]; then
  if [ ! -d /root/.codex-proxy ]; then
    echo "[entrypoint] WARNING: no Codex credentials at /root/.codex-proxy."
    echo "[entrypoint] Run 'xypro auth' on a machine with a browser, then mount"
    echo "[entrypoint] the resulting ~/.codex-proxy here, or set XYPRO_REMOTE=1"
    echo "[entrypoint] and point XYPRO_BASE_URL at an already-authenticated proxy."
  fi

  XYPRO_PID=$(start_xypro)
  wait_for_xypro || true

  # A dead proxy fails every run with "Cannot connect to API", which reads as a
  # broken agent rather than a missing dependency. It has died mid-session
  # before, so it is supervised rather than merely started.
  (
    while true; do
      sleep 15
      if ! kill -0 "$XYPRO_PID" 2>/dev/null; then
        echo "[entrypoint] xypro exited; restarting"
        XYPRO_PID=$(start_xypro)
        wait_for_xypro || true
      elif ! curl -sf "${XYPRO_BASE_URL}/models" >/dev/null 2>&1; then
        echo "[entrypoint] xypro is up but not answering; restarting"
        kill "$XYPRO_PID" 2>/dev/null || true
        sleep 2
        XYPRO_PID=$(start_xypro)
        wait_for_xypro || true
      fi
    done
  ) &
fi

echo "[entrypoint] starting control plane"
exec bun run src/server.ts
