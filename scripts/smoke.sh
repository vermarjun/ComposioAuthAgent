#!/usr/bin/env bash
#
# End-to-end check against a running instance — local or deployed.
#
#   scripts/smoke.sh                              # localhost, password from .env
#   scripts/smoke.sh https://box.example.com hunter2
#
# Run this against the deployed URL before handing the link to anyone, and
# paste the output somewhere. Nothing else proves the thing they are about to
# click actually works.

set -uo pipefail

API="${1:-http://127.0.0.1:8080}"
PASSWORD="${2:-${DASHBOARD_PASSWORD:-}}"
if [ -z "$PASSWORD" ] && [ -f "$(dirname "$0")/../.env" ]; then
  PASSWORD=$(grep -E '^DASHBOARD_PASSWORD=' "$(dirname "$0")/../.env" | cut -d= -f2-)
fi

JAR=$(mktemp)
PASS=0; FAIL=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
code() { curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -c "$JAR" "$@"; }

echo "smoke: $API"
echo

echo "health and gate"
H=$(curl -s -m 15 "$API/api/health")
echo "$H" | grep -q '"ok":true' && ok "health responds" || bad "health responds"
MODEL=$(echo "$H" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["model"]["providerID"]+"/"+d["model"]["modelID"])' 2>/dev/null || echo "?")
echo "        model $MODEL"

GATED=$(echo "$H" | grep -c '"auth_required":true')
if [ "$GATED" -gt 0 ]; then
  [ "$(code "$API/api/runs")" = "401" ] && ok "runs are gated when logged out" || bad "runs are gated when logged out"
  [ "$(code -X POST "$API/api/login" -H 'content-type: application/json' -d '{"password":"definitely-wrong"}')" = "401" ] \
    && ok "wrong password refused" || bad "wrong password refused"
  [ "$(code -X POST "$API/api/login" -H 'content-type: application/json' -d "{\"password\":\"$PASSWORD\"}")" = "200" ] \
    && ok "correct password accepted" || bad "correct password accepted"
  [ "$(code "$API/api/runs")" = "200" ] && ok "runs reachable once logged in" || bad "runs reachable once logged in"
else
  echo "        (no password configured; gate checks skipped)"
fi

echo
echo "input handling"
[ "$(code -X POST "$API/api/runs" -H 'content-type: application/json' -d '{"platform":"   "}')" = "400" ] \
  && ok "blank platform refused" || bad "blank platform refused"
[ "$(code -X POST "$API/api/runs" -H 'content-type: application/json' -d '{not json')" = "400" ] \
  && ok "malformed body refused" || bad "malformed body refused"
[ "$(code "$API/api/runs/nope")" = "404" ] && ok "unknown run is 404" || bad "unknown run is 404"

echo
echo "a real acquisition (linear.app — expect a minted credential)"
RID=$(curl -s -b "$JAR" -X POST "$API/api/runs" -H 'content-type: application/json' \
  -d '{"platform":"linear.app"}' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("run_id",""))' 2>/dev/null)
if [ -z "$RID" ]; then
  bad "run started"
else
  ok "run started ($RID)"
  STATUS=running
  for _ in $(seq 1 60); do
    sleep 5
    STATUS=$(curl -s -b "$JAR" "$API/api/runs/$RID" \
      | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])' 2>/dev/null || echo running)
    [ "$STATUS" != "running" ] && break
  done

  curl -s -b "$JAR" "$API/api/runs/$RID" > /tmp/smoke-run.json
  python3 - <<'PY' && ok "packet is a verified credential" || bad "packet is a verified credential"
import json, sys
r = json.load(open("/tmp/smoke-run.json"))
p = r.get("packet") or {}
a = p.get("acquisition") or {}
c = (p.get("composio_auth_config") or {}).get("credentials") or {}
v = p.get("verification") or {}
print(f"        path {a.get('path')}  status {a.get('status')}")
print(f"        client_id {c.get('client_id')}")
print(f"        verified  {v.get('result')}")
print(f"        evidence  {len(p.get('evidence') or [])} urls")
sys.exit(0 if (a.get("status") == "credentials_obtained"
               and c.get("client_id")
               and v.get("invalid_client") is False) else 1)
PY
fi

echo
echo "$PASS passed, $FAIL failed"
rm -f "$JAR"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
