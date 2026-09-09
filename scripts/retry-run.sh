#!/usr/bin/env bash
# Re-attempt a single acquisition run until it completes.
#
# The ChatGPT Codex plan behind xypro enforces a rolling quota, and once it is
# hit the backend answers 404 model_not_found for several minutes. That is not
# something a per-request retry can absorb, so this waits the window out.
#
#   scripts/retry-run.sh linear.app

set -uo pipefail
PLATFORM="${1:-linear.app}"
API="${API:-http://127.0.0.1:8080}"
ATTEMPTS="${ATTEMPTS:-25}"

for attempt in $(seq 1 "$ATTEMPTS"); do
  RID=$(curl -s -X POST "$API/api/runs" -H 'content-type: application/json' \
    -d "{\"platform\":\"$PLATFORM\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('run_id',''))")

  if [ -z "$RID" ]; then
    echo "attempt $attempt: could not start a run"
    sleep 60
    continue
  fi

  echo "attempt $attempt -> run $RID"
  STATUS=running
  for _ in $(seq 1 40); do
    sleep 15
    STATUS=$(curl -s "$API/api/runs/$RID" \
      | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])')
    [ "$STATUS" != "running" ] && break
  done

  echo "  status: $STATUS"
  if [ "$STATUS" = "done" ]; then
    echo "$RID" > /tmp/good_rid
    echo "SUCCESS $RID"
    exit 0
  fi
  sleep 90
done

echo "GAVE UP after $ATTEMPTS attempts"
exit 1
