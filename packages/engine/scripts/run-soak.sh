#!/bin/zsh
# Release-gate soak for the incremental-parse engine — the three-leg
# protocol from the verification record (src/experiments/prefixFreeze/
# README.md), parallelized:
#
#   leg 1  splice fuzz     — SHARDS × (TOTAL/SHARDS) samples, one fast-check
#                            seed per shard (base seed + i). Same total
#                            sample budget as the historical single-chain
#                            50k run; independent chains parallelize where
#                            one chain cannot (samples are seed-sequential).
#   leg 2  direction battery — 20k prefixes, single chain (cheap).
#   leg 3  exhaustive census — K=4 stride=2, sharded EXHAUSTIVE_SHARD=i/N.
#
# Run from packages/engine, under caffeinate:
#   caffeinate -dims ./scripts/run-soak.sh
# Env knobs: SOAK_FUZZ_TOTAL (default 50000), SOAK_SHARDS (default 12),
# SOAK_SEED (default 20260750).
set -uo pipefail
VITEST=../../node_modules/.bin/vitest
SHARDS=${SOAK_SHARDS:-12}
TOTAL=${SOAK_FUZZ_TOTAL:-50000}
SEED=${SOAK_SEED:-20260750}
PER=$(( (TOTAL + SHARDS - 1) / SHARDS ))
FAIL=0

echo "[soak] leg 1/3: splice fuzz — ${SHARDS} shards × ${PER} samples (seeds ${SEED}..$((SEED + SHARDS - 1)))"
pids=()
for i in $(seq 0 $((SHARDS - 1))); do
  FUZZ_RUNS=$PER FUZZ_SEED=$((SEED + i)) "$VITEST" --run \
    src/components/incrementalParse/spliceFuzz.test.ts > "soak-fuzz-$i.log" 2>&1 &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid" || FAIL=1; done
echo "[soak] leg 1 cumulative fail=$FAIL"

echo "[soak] leg 2/3: 20k direction-battery prefixes"
FUZZ_RUNS=20000 "$VITEST" --run src/components/incrementalParse/boundaryDirection.test.ts \
  > soak-direction.log 2>&1 || FAIL=1
echo "[soak] leg 2 cumulative fail=$FAIL"

echo "[soak] leg 3/3: exhaustive census K=4 stride=2 — ${SHARDS} shards"
pids=()
for i in $(seq 0 $((SHARDS - 1))); do
  EXHAUSTIVE_K=4 EXHAUSTIVE_STRIDE=2 EXHAUSTIVE_SHARD=$i/$SHARDS "$VITEST" --run \
    src/components/incrementalParse/spliceExhaustive.test.ts > "soak-census-$i.log" 2>&1 &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid" || FAIL=1; done
echo "[soak] leg 3 cumulative fail=$FAIL"

if [ "$FAIL" -eq 0 ]; then
  echo "[soak] ALL CLEAN"
else
  echo "[soak] FAILURES — inspect soak-*.log"
fi
exit $FAIL
