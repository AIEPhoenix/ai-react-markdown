#!/bin/zsh
# The four-leg fresh-seed soak — the repo's release safety gate for the
# freeze scanner (verification protocol §2.2). The boundary-diff harness
# and the unit suite are REGRESSION nets; only this run is a safety
# argument, and it has proven the distinction twice: v2.5.5's F11/F12 and
# v2.7.0's stray-`-->` regression were invisible to both nets and caught
# here, by seeds nothing had ever run.
#
# Usage:
#   scripts/soak/fourleg.sh <seed-base> [label]
#
#   seed-base   REQUIRED, and must be fresh — re-running old seeds re-walks
#               the same space and proves nothing new. Legs use seed-base,
#               +100, +200 (the census leg is exhaustive; no seed).
#   label       log prefix, default "soak".
#
# Env overrides (defaults = the standard gate; the scaled release gate used
# FUZZ1=33334 FUZZ2=50000 for 400k/600k legs):
#   SHARDS (12)  FUZZ1 (12500)  FUZZ2 (30000)  FUZZ3 (8000)
#
# Logs land in .soak-logs/<label>-*.log (gitignored). The script re-execs
# itself under `caffeinate -dimsu`; note that caffeinate does NOT survive a
# lid close — an overnight run on a closed laptop dies to wall-clock
# timeouts (measured 2026-08-25: 12 shards × 43364 s, all spurious).
set -uo pipefail

if [ -z "${SOAK_CAFFEINATED:-}" ]; then
  exec caffeinate -dimsu env SOAK_CAFFEINATED=1 "$0" "$@"
fi

if [ $# -lt 1 ]; then
  echo "usage: $0 <seed-base> [label]  (seed-base must be FRESH — see header)" >&2
  exit 2
fi
SEED=$1
LABEL=${2:-soak}
SHARDS=${SHARDS:-12}
FUZZ1=${FUZZ1:-12500}
FUZZ2=${FUZZ2:-30000}
FUZZ3=${FUZZ3:-8000}
CENSUS_STRIDE=${CENSUS_STRIDE:-1}

ROOT=${0:a:h:h:h}
cd "$ROOT/packages/engine"
VITEST=../../node_modules/.bin/vitest
OUT="$ROOT/.soak-logs"
mkdir -p "$OUT"
FAIL=0

run_leg() {
  local name=$1 file=$2 env1=$3 env2=$4
  echo "[$LABEL] $name"
  local pids=()
  for i in $(seq 0 $((SHARDS - 1))); do
    env $(eval echo "$env1") $(eval echo "$env2") "$VITEST" --run "$file" \
      > "$OUT/$LABEL-$name-$i.log" 2>&1 &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid" || FAIL=1; done
  echo "[$LABEL] $name fail=$FAIL"
}

run_leg fuzz src/components/incrementalParse/spliceFuzz.test.ts \
  'FUZZ_RUNS=$FUZZ1' 'FUZZ_SEED=$((SEED + i))'
run_leg dir src/components/incrementalParse/boundaryDirection.test.ts \
  'FUZZ_RUNS=$FUZZ2' 'FUZZ_SEED=$((SEED + 100 + i))'
run_leg scanner src/components/collectDefLabels.fuzz.test.ts \
  'FUZZ_RUNS=$FUZZ3' 'FUZZ_SEED=$((SEED + 200 + i))'
run_leg census src/components/incrementalParse/spliceExhaustive.test.ts \
  'EXHAUSTIVE_K=4 EXHAUSTIVE_STRIDE=$CENSUS_STRIDE' 'EXHAUSTIVE_SHARD=$i/$SHARDS'

if [ "$FAIL" -eq 0 ]; then echo "[$LABEL] ALL CLEAN"; else echo "[$LABEL] FAILURES — inspect $OUT/$LABEL-*.log"; fi
for f in "$OUT"/$LABEL-*.log; do
  printf "%-28s %s\n" "${f:t}" "$(grep -oE 'Tests +[0-9]+ (failed|passed)' "$f" | tail -1)"
done
exit $FAIL
