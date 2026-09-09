#!/usr/bin/env bash
#
# Grade both platform sets, in sequence, against a running instance.
#
#   scripts/eval-all.sh          # resume whatever is already scored
#   FRESH=1 scripts/eval-all.sh  # start both from zero
#
# Sequential on purpose: the two sets share one agent runtime, and running them
# together only means both take longer and contend for the same model.

set -uo pipefail
cd "$(dirname "$0")/.."

set -a; [ -f .env ] && . ./.env; set +a

export EVAL_CONCURRENCY="${EVAL_CONCURRENCY:-2}"
export EVAL_TIMEOUT_MS="${EVAL_TIMEOUT_MS:-600000}"
[ "${FRESH:-0}" = "1" ] && export EVAL_FRESH=1

for GOLD in golden.csv golden-composio100.csv; do
  echo
  echo "=============================================================="
  echo "  $GOLD"
  echo "=============================================================="
  EVAL_GOLD="$GOLD" bun run eval/run.ts
done

echo
echo "results written to eval/results.golden.json and eval/results.golden-composio100.json"
