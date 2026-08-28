#!/bin/bash
# The five-leg fresh-seed soak — the repo's release safety gate for the
# freeze scanner (verification protocol §2.2). The boundary-diff harness
# and the unit suite are REGRESSION nets; only this run is a safety
# argument, and it has proven the distinction twice: v2.5.5's F11/F12 and
# v2.7.0's stray-`-->` regression were invisible to both nets and caught
# here, by seeds nothing had ever run.
#
# Usage:
#   scripts/soak/fiveleg.sh <seed-base> [label]
#
#   seed-base   REQUIRED, and must be fresh — re-running old seeds re-walks
#               the same space and proves nothing new. Legs use seed-base,
#               +100, +200, +300 (the census leg is exhaustive; no seed).
#   label       log prefix, default "soak".
#
# Leg 5 is the P1 conformance sweep under ORACLE_RAW=1, added 2026-08-26.
# It is the only leg that gates the (P) identity instruments; raw mode used
# to be a log-only mode nobody ran in CI.
#
# What FAILS leg 5, as of 2026-08-28: engine divergence, a snapshot-gate
# firing, and the per-document BLINDNESS floor. What no longer fails it: a
# raw-mode firing outside the E1-E6 allowlist. That classifier was demoted
# this batch to a label read by zero assertions — 133 firings are
# deliberately unlabelled — because the allowlist had been refuted twice.
# The line that used to be here said otherwise, and a script describing a
# gate the code stopped implementing is the same defect class this batch
# spent itself on.
#
# Env overrides (defaults = the standard gate; the scaled release gate used
# FUZZ1=33334 FUZZ2=50000 for 400k/600k legs):
#   SHARDS (12)  FUZZ1 (12500)  FUZZ2 (30000)  FUZZ3 (8000)  ORACLE (4000)
#   CENSUS_STRIDE (1)  CENSUS_NAME_K (3)
#
# CENSUS_STRIDE is 1, which is FULL cut schedules — the value it had before
# 2026-08-28 and the value `spliceExhaustive.test.ts` has always described as
# the gate's. It went to 3 in the same commit that fixed two other knobs for
# running CI's values, and nothing said so: the gate quietly sampled every
# third cut at K=4 for one release. Restored 2026-08-29 with the F28 batch.
# Set CENSUS_STRIDE=3 by hand if a release cannot afford the wall clock — the
# point is that skipping two thirds of the cut schedules is a decision someone
# makes at the prompt, not a default that reads as the full census.
#
# ORACLE default is 4000 because the blindness floor is STRUCTURALLY INERT
# below it: the guard is `documentsProbed >= 1000`, `documentsProbed` is
# bounded by ORACLE_RUNS, and the old default of 800 could therefore never
# reach it — the leg ran, printed the number, and gated on nothing. 4000 is
# also where the threshold was calibrated and what every gate run this week
# already used by hand. Cost at 4000 is ~10 min across twelve shards
# against a two-hour gate, so this is a correction, not a new spend.
#
# Logs land in .soak-logs/<label>-*.log (gitignored). On macOS the script
# re-execs itself under `caffeinate -dimsu`; note that caffeinate does NOT
# survive a lid close — an overnight run on a closed laptop dies to
# wall-clock timeouts (measured 2026-08-25: 12 shards × 43364 s, all
# spurious).
#
# bash, not zsh, and that is load-bearing rather than taste: not every
# machine this runs on has zsh at all, which is the real reason a split gate
# used to be hand-assembled instead of driven from this script. A gate script that
# only runs on one of the two machines the gate runs on is not a gate script.
# bash 3.2 is the floor (macOS ships it), so no associative arrays and no
# `${var,,}`.
set -uo pipefail

if [ -z "${SOAK_CAFFEINATED:-}" ] && command -v caffeinate > /dev/null 2>&1; then
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
ORACLE=${ORACLE:-4000}
CENSUS_STRIDE=${CENSUS_STRIDE:-1}
CENSUS_NAME_K=${CENSUS_NAME_K:-3}
# Comma-separated leg subset; default is all five. `LEGS=census` on the
# larger box and `LEGS=fuzz,dir,scanner,oracle` on the other is the standard
# split.
# Legs share nothing but the tree, and the census leg is seed-free exhaustive
# sharding, so a split run is byte-equivalent to a single-machine one.
LEGS=${LEGS:-fuzz,dir,scanner,census,oracle}

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/packages/engine"
VITEST=../../node_modules/.bin/vitest
OUT="$ROOT/.soak-logs"
mkdir -p "$OUT"
FAIL=0

run_leg() {
  local name=$1 file=$2 env1=$3 env2=$4
  # LEGS selects a subset, because the gate has been split across two
  # machines for every release since 2.8.1 and the split was hand-assembled
  # from this script's env lines each time — the ad-hoc pattern the header
  # complains about, applied to the script that complains about it. A
  # SKIPPED leg is announced: a run that silently did four fifths of the
  # work and printed ALL CLEAN is the failure this whole batch is about.
  if [[ ",$LEGS," != *",$name,"* ]]; then
    echo "[$LABEL] $name SKIPPED (LEGS=$LEGS)"
    return
  fi
  echo "[$LABEL] $name"
  local pids=()
  for i in $(seq 0 $((SHARDS - 1))); do
    env $(eval echo "$env1") $(eval echo "$env2") "$VITEST" --run "$file" \
      > "$OUT/$LABEL-$name-$i.log" 2>&1 &
    pids+=($!)
  done
  # Per-leg, NOT cumulative. `FAIL` is the run's verdict and must persist, but
  # reporting it per leg made every leg after a failure look failed: gate290's
  # oracle leg was 12/12 green and printed `fail=1` because census had already
  # set it. A leg's line has to answer for that leg, or a clean leg reads as a
  # second defect and someone goes looking for it.
  local legfail=0
  for pid in "${pids[@]}"; do wait "$pid" || { legfail=1; FAIL=1; }; done
  echo "[$LABEL] $name fail=$legfail"
}

run_leg fuzz src/components/incrementalParse/spliceFuzz.test.ts \
  'FUZZ_RUNS=$FUZZ1' 'FUZZ_SEED=$((SEED + i))'
run_leg dir src/components/incrementalParse/boundaryDirection.test.ts \
  'FUZZ_RUNS=$FUZZ2' 'FUZZ_SEED=$((SEED + 100 + i))'
run_leg scanner src/components/collectDefLabels.fuzz.test.ts \
  'FUZZ_RUNS=$FUZZ3' 'FUZZ_SEED=$((SEED + 200 + i))'
# The census leg's defaults are the CI ones — K=2, name band K=2, configs
# ROTATED one per document. Every value below has to be passed, and until
# 2026-08-28 two of them were not, so the "gate" ran a slightly larger CI
# check: no run anywhere had put one document under more than one of the
# six configs, and P3's only known finding class (the F24 family, which
# needs three-line documents) was unreachable in every configuration the
# repo actually executed. `EXHAUSTIVE_CONFIG_MODE=cross` is the one the
# test file's own header calls load-bearing; it is worth nothing until it
# is HERE.
run_leg census src/components/incrementalParse/spliceExhaustive.test.ts \
  'EXHAUSTIVE_K=4 EXHAUSTIVE_STRIDE=$CENSUS_STRIDE EXHAUSTIVE_NAME_K=$CENSUS_NAME_K EXHAUSTIVE_CONFIG_MODE=cross' \
  'EXHAUSTIVE_SHARD=$i/$SHARDS'
run_leg oracle src/components/incrementalParse/oracleConformance.test.ts \
  'ORACLE_RAW=1 ORACLE_RUNS=$ORACLE' 'ORACLE_SEED=$((SEED + 300 + i))'

if [ "$FAIL" -eq 0 ]; then echo "[$LABEL] ALL CLEAN (legs: $LEGS)"; else echo "[$LABEL] FAILURES — inspect $OUT/$LABEL-*.log"; fi
for f in "$OUT"/$LABEL-*.log; do
  printf "%-28s %s\n" "$(basename "$f")" "$(grep -oE 'Tests +[0-9]+ (failed|passed)' "$f" | tail -1)"
done
exit $FAIL
