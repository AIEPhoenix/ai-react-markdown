#!/bin/bash
# The fresh-seed soak — the repo's release safety gate for the freeze
# scanner and the incremental paths (verification protocol §2.2). The
# boundary-diff harness and the unit suite are REGRESSION nets; only this
# run is a safety argument, and it has proven the distinction twice:
# v2.5.5's F11/F12 and v2.7.0's stray-`-->` regression were invisible to
# both nets and caught here, by seeds nothing had ever run.
#
# The converse is also on record. A safety argument covers what its legs
# cover and nothing else: on 2026-09-02 the two LaTeX preprocessor entry
# points diverged by a newline and this script printed ALL CLEAN, because
# no leg compared them. Leg 6 exists because of that day. When the next
# hole is found, the fix is another leg, not more runs of these.
#
# The file was `fiveleg.sh` until 2026-09-03, when the sixth leg landed. A
# gate whose name states a leg count it no longer runs is the same defect
# class as a header describing a check the code stopped implementing, which
# this script's own comments spend several paragraphs on. `pnpm soak` is
# unchanged and remains the name to type.
#
# Usage:
#   scripts/soak/soak.sh <seed-base> [label]
#
#   seed-base   REQUIRED, and must be fresh — re-running old seeds re-walks
#               the same space and proves nothing new. Legs use seed-base,
#               +100, +200, +300, +400 (the census leg is exhaustive; no
#               seed).
#   label       log prefix, default "soak".
#
# Leg 5 is the P1 conformance sweep under ORACLE_RAW=1, added 2026-08-26.
# It is the only leg that gates the (P) identity instruments; raw mode used
# to be a log-only mode nobody ran in CI.
#
# Leg 6 is the LaTeX preprocessor's two entry points against each other,
# added 2026-09-03. It closes a hole this gate had from the start: the fuzz
# leg fuzzes incremental PARSING, and nothing here fuzzed
# `preprocessLaTeX` against `createIncrementalLatexPreprocessor`. On
# 2026-09-02 those two diverged by a newline for a full day while this
# script printed ALL CLEAN; the divergence was found by someone designing
# an unrelated fix. The leg is cheap — string transforms, no parse — so
# FUZZ4 is large relative to the others.
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
#   SHARDS (cores-2)  FUZZ1 (12500)  FUZZ2 (30000)  FUZZ3 (8000)
#   FUZZ4 (40000)  ORACLE (4000)
#   CENSUS_STRIDE (1)  CENSUS_NAME_K (3)  CENSUS_NAME_STRIDE (1)
#   FALLBACK_ORACLE_SAMPLE (20)
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
# SHARDS defaults to the detected core count minus two, resolved at start and
# printed on the run's first line. The previous default was a fixed 12, which
# left most of a larger machine idle; a vitest shard uses roughly one core.
# The two spare cores cover the shards' main threads and keep the machine
# responsive during the run.
#
# Core detection, in order:
#   1. `nproc`                      Linux, WSL, Git Bash, Cygwin. Tried first
#                                   because it honours cgroup/taskset affinity;
#                                   inside a container the other probes report
#                                   the host's cores.
#   2. `getconf _NPROCESSORS_ONLN`  macOS and most POSIX systems.
#   3. `sysctl -n hw.logicalcpu`    macOS fallback.
#   4. `$NUMBER_OF_PROCESSORS`      Windows; inherited by every bash layer.
#                                   Reports the current processor group, so it
#                                   reads low above 64 cores. That errs toward
#                                   fewer shards.
#   5. PowerShell `[Environment]::ProcessorCount`
#                                   Windows fallback when the variable is
#                                   unset. `wmic` is not used; it was removed
#                                   in Windows 11 24H2.
# If every probe fails, SHARDS is 12 (the previous default). The fallback is
# applied by the caller, not inside detect_cores, so it is not reduced by two.
#
# SHARDS is clamped to [1, 100]. The lower bound prevents zero shards on a
# two-core machine. The upper bound follows from the seed layout: the legs
# use SEED+i, SEED+100+i, SEED+200+i, SEED+300+i and SEED+400+i, so at 101 or
# more shards the fuzz leg's seeds overlap the direction leg's, and both legs
# use the same arbitraries and would generate the same documents. Widen the
# per-leg offsets before raising the cap. (Leg 6 draws from its own
# generators, so its band could safely overlap — but a rule that holds for
# four of five bands and not the fifth is a rule nobody can apply.)
#
# Memory usually limits the shard count before CPU does. If it does on a
# given machine, set SHARDS by hand.
#
# Logs land in a unique .soak-logs/<run-id>/ directory (gitignored), with a
# manifest and result beside the shard logs. On macOS the script
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
ALL_LEGS="fuzz,dir,scanner,census,oracle,latex"

die() { echo "soak: $*" >&2; exit 2; }
require_uint() {
  local name=$1 value=$2 min=${3:-0} max=${4:-2147483647}
  case "$value" in ''|*[!0-9]*) die "$name must be an integer in [$min,$max], got '$value'" ;; esac
  [ "$value" -ge "$min" ] 2>/dev/null && [ "$value" -le "$max" ] 2>/dev/null || \
    die "$name must be in [$min,$max], got '$value'"
}
case "$LABEL" in ''|*[!A-Za-z0-9._-]*|.*) die "label must match [A-Za-z0-9][A-Za-z0-9._-]*" ;; esac
require_uint SEED "$SEED" 0 2147483148
# Probe order and clamp range are explained in the header. bash 3.2 compatible.
# Prints the core count and returns 0, or prints nothing and returns 1. The
# fallback of 12 is applied by the caller.
detect_cores() {
  local n=""
  if command -v nproc > /dev/null 2>&1; then
    n=$(nproc 2> /dev/null)
    if [ -n "$n" ]; then echo "$n"; return 0; fi
  fi
  if command -v getconf > /dev/null 2>&1; then
    n=$(getconf _NPROCESSORS_ONLN 2> /dev/null)
    if [ -n "$n" ]; then echo "$n"; return 0; fi
  fi
  if command -v sysctl > /dev/null 2>&1; then
    n=$(sysctl -n hw.logicalcpu 2> /dev/null)
    if [ -n "$n" ]; then echo "$n"; return 0; fi
  fi
  if [ -n "${NUMBER_OF_PROCESSORS:-}" ]; then
    echo "$NUMBER_OF_PROCESSORS"
    return 0
  fi
  for ps in powershell.exe pwsh.exe powershell pwsh; do
    if command -v "$ps" > /dev/null 2>&1; then
      n=$("$ps" -NoProfile -NonInteractive -Command '[Environment]::ProcessorCount' 2> /dev/null)
      # Strip the CRLF a Windows shell appends.
      n=$(printf '%s' "$n" | tr -d '\r\n')
      if [ -n "$n" ]; then echo "$n"; return 0; fi
    fi
  done
  return 1
}

if [ -n "${SHARDS:-}" ]; then
  SHARDS_SOURCE="SHARDS env"
else
  CORES=$(detect_cores | head -1 | tr -dc '0-9')
  if [ -z "$CORES" ] || [ "$CORES" -lt 1 ]; then
    # 12, not 12-2: the previous default.
    SHARDS=12
    SHARDS_SOURCE="core detection failed, default"
  else
    SHARDS=$((CORES - 2))
    SHARDS_SOURCE="$CORES cores - 2"
  fi
fi
require_uint SHARDS "$SHARDS" 0 2147483647
if [ "$SHARDS" -lt 1 ]; then
  SHARDS=1
  SHARDS_SOURCE="$SHARDS_SOURCE, clamped up to 1"
fi
if [ "$SHARDS" -gt 100 ]; then
  SHARDS=100
  SHARDS_SOURCE="$SHARDS_SOURCE, clamped down to 100 (seed-band collision)"
fi
FUZZ1=${FUZZ1:-12500}
FUZZ2=${FUZZ2:-30000}
FUZZ3=${FUZZ3:-8000}
# Leg 6 does string transforms only — no parse, no plugin chain — so a run
# costs roughly two orders of magnitude less than a splice sample. Measured
# 2026-09-03 on a 16-core machine: the whole leg at this size is 2 min 57 s
# wall across 14 shards, about 2.5% of a two-hour gate.
#
# If you time it and get triple that, check whether the script was EDITED
# while running. bash reads a script incrementally by byte offset, so an
# in-place edit makes the running shell resume at a stale offset: measured
# here once, it re-ran a leg and then tried to execute half a path.
FUZZ4=${FUZZ4:-40000}
ORACLE=${ORACLE:-4000}
CENSUS_STRIDE=${CENSUS_STRIDE:-1}
CENSUS_NAME_K=${CENSUS_NAME_K:-3}
# The name band has its OWN cut stride, defaulting to 3 at K>=3, and the gate
# never passed it either — a second value behind the same door as
# EXHAUSTIVE_CONFIG_MODE, found while auditing the first. Unlike
# CENSUS_STRIDE nothing had ever claimed the gate ran it at 1, so this is a
# coverage decision rather than a correction. Measured 2026-08-29 on one
# shard at K=3 cross: 397 s at stride 3, 1077 s at stride 1 — 2.7x the time
# for 2.8x the cut schedules (936k -> 2.62M), about +11 min on a ~140 min
# shard. Worth it on the band that reaches tag names, which is where F13,
# F19 and F28 all lived.
CENSUS_NAME_STRIDE=${CENSUS_NAME_STRIDE:-1}
# FALLBACK_ORACLE_SAMPLE: on fallback frames (where the engine ran the full
# pipeline itself), the fuzz and census legs run the oracle on every Nth
# frame, selected by content hash, instead of every frame. On those frames
# the engine and the oracle run the same pipeline on the same input, so the
# comparison only checks the engine's usedIncremental report; sampling keeps
# that check at 1/20. Measured 2026-09-03: census leg -45%, fuzz leg -35%.
# Set to 1 for every-frame comparison, which is what the legs do when the
# variable is unset (CI and preflight). Exported so both legs see one value.
export FALLBACK_ORACLE_SAMPLE=${FALLBACK_ORACLE_SAMPLE:-20}
# Seconds between per-shard progress heartbeats. Every leg's hot loop calls
# `soakBeat().tick()`; unset means the mechanism is inert, which is why CI
# and preflight are unaffected. Read the beats with
# `scripts/soak/soak-watch.sh <run-id>` — a separate READ-ONLY script, so the
# progress machinery cannot break the gate.
#
# Before this existed, a shard log was three lines of banner for four hours
# whether it was at 5%, at 95%, or wedged. The percentage is convenient; the
# timestamp is the point, because "slow" and "dead" were indistinguishable.
export SOAK_HEARTBEAT=${SOAK_HEARTBEAT:-30}
# Comma-separated leg subset; default is all six. `LEGS=census` on the
# larger box and `LEGS=fuzz,dir,scanner,oracle,latex` on the other is the
# standard split.
# Legs share nothing but the tree, and the census leg is seed-free exhaustive
# sharding, so a split run is byte-equivalent to a single-machine one.
LEGS=${LEGS-fuzz,dir,scanner,census,oracle,latex}

# Validate and canonicalize the requested set before starting any process.
case "$LEGS" in ''|,*|*,|*,,*) die "LEGS must be a non-empty comma-separated list without empty members" ;; esac
REQUESTED_LEGS=$LEGS
SEEN_LEGS=""
OLD_IFS=$IFS
IFS=,
set -- $LEGS
IFS=$OLD_IFS
for requested in "$@"; do
  case ",$ALL_LEGS," in *,$requested,*) ;; *) die "unknown leg '$requested' (valid: $ALL_LEGS)" ;; esac
  case ",$SEEN_LEGS," in *,$requested,*) die "duplicate leg '$requested'" ;; esac
  [ -z "$SEEN_LEGS" ] && SEEN_LEGS=$requested || SEEN_LEGS="$SEEN_LEGS,$requested"
done
NORMALIZED_LEGS=""
OLD_IFS=$IFS
IFS=,
set -- $ALL_LEGS
IFS=$OLD_IFS
for candidate in "$@"; do
  case ",$REQUESTED_LEGS," in
    *,$candidate,*) [ -z "$NORMALIZED_LEGS" ] && NORMALIZED_LEGS=$candidate || NORMALIZED_LEGS="$NORMALIZED_LEGS,$candidate" ;;
  esac
done
LEGS=$NORMALIZED_LEGS
MODE=subset
[ "$LEGS" = "$ALL_LEGS" ] && MODE=full

require_uint SHARDS "$SHARDS" 1 100
require_uint FUZZ1 "$FUZZ1" 1
require_uint FUZZ2 "$FUZZ2" 1
require_uint FUZZ3 "$FUZZ3" 1
require_uint FUZZ4 "$FUZZ4" 1
require_uint ORACLE "$ORACLE" 1
require_uint CENSUS_STRIDE "$CENSUS_STRIDE" 1
require_uint CENSUS_NAME_K "$CENSUS_NAME_K" 1
require_uint CENSUS_NAME_STRIDE "$CENSUS_NAME_STRIDE" 1
require_uint FALLBACK_ORACLE_SAMPLE "$FALLBACK_ORACLE_SAMPLE" 1
require_uint SOAK_HEARTBEAT "$SOAK_HEARTBEAT" 0

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/packages/engine"
VITEST=../../node_modules/.bin/vitest
OUT="$ROOT/.soak-logs"
mkdir -p "$OUT"
FAIL=0
RUN_KIND=${RUN_KIND:-fresh}
case "$RUN_KIND" in fresh|replay) ;; *) die "RUN_KIND must be fresh or replay" ;; esac
PROFILE=${SOAK_PROFILE:-release}
case "$PROFILE" in release|smoke) ;; *) die "SOAK_PROFILE must be release or smoke" ;; esac
if [ "$PROFILE" = release ]; then
  [ "$RUN_KIND" = fresh ] || die "release profile requires RUN_KIND=fresh"
  [ "$FUZZ1" -ge 12500 ] || die "release profile requires FUZZ1>=12500"
  [ "$FUZZ2" -ge 30000 ] || die "release profile requires FUZZ2>=30000"
  [ "$FUZZ3" -ge 8000 ] || die "release profile requires FUZZ3>=8000"
  [ "$FUZZ4" -ge 40000 ] || die "release profile requires FUZZ4>=40000"
  [ "$ORACLE" -ge 4000 ] || die "release profile requires ORACLE>=4000"
  [ "$CENSUS_STRIDE" -eq 1 ] || die "release profile requires CENSUS_STRIDE=1"
  [ "$CENSUS_NAME_K" -ge 3 ] || die "release profile requires CENSUS_NAME_K>=3"
  [ "$CENSUS_NAME_STRIDE" -eq 1 ] || die "release profile requires CENSUS_NAME_STRIDE=1"
  [ "$FALLBACK_ORACLE_SAMPLE" -le 20 ] || die "release profile requires FALLBACK_ORACLE_SAMPLE<=20"
  [ -z "$(git status --porcelain)" ] || die "release profile requires a clean worktree (use SOAK_PROFILE=smoke for development)"
fi
COMMIT_SHORT=$(git rev-parse --short HEAD)
STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
RUN_ID=${RUN_ID:-$LABEL-$STAMP-$COMMIT_SHORT-$$}
case "$RUN_ID" in ''|*[!A-Za-z0-9._-]*|.*) die "RUN_ID must match [A-Za-z0-9][A-Za-z0-9._-]*" ;; esac
RUN_DIR="$OUT/$RUN_ID"
STATE_DIR="$ROOT/.soak-state"
mkdir -p "$STATE_DIR"
PARAMETERS=$(printf '{"fuzz1":%s,"fuzz2":%s,"fuzz3":%s,"fuzz4":%s,"oracle":%s,"censusK":4,"censusStride":%s,"censusNameK":%s,"censusNameStride":%s,"censusConfigMode":"cross","fallbackOracleSample":%s}' \
  "$FUZZ1" "$FUZZ2" "$FUZZ3" "$FUZZ4" "$ORACLE" "$CENSUS_STRIDE" "$CENSUS_NAME_K" "$CENSUS_NAME_STRIDE" "$FALLBACK_ORACLE_SAMPLE")
RUN_DIR=$(node "$ROOT/scripts/soak/soak-metadata.mjs" create \
  --run-dir "$RUN_DIR" --run-id "$RUN_ID" --label "$LABEL" --mode "$MODE" --run-kind "$RUN_KIND" \
  --seed "$SEED" --legs "$LEGS" --shards "$SHARDS" --cores "${CORES:-$SHARDS}" --profile "$PROFILE" \
  --parameters "$PARAMETERS" --state-dir "$STATE_DIR") || exit 2
STARTED_AT=$(node -e "console.log(require(process.argv[1]).startedAt)" "$RUN_DIR/manifest.json")
LEG_RESULTS=""

# The shard count is machine-dependent; print it so logs can be compared.
echo "[$LABEL] run-id=$RUN_ID mode=$MODE kind=$RUN_KIND profile=$PROFILE"
echo "[$LABEL] SHARDS=$SHARDS ($SHARDS_SOURCE)  seed-base=$SEED  legs=$LEGS  fallback-oracle-sample=$FALLBACK_ORACLE_SAMPLE"
echo "[$LABEL] logs=$RUN_DIR"

run_leg() {
  local name=$1 file=$2
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
    case "$name" in
      fuzz) FUZZ_RUNS="$FUZZ1" FUZZ_SEED=$((SEED + i)) "$VITEST" --run "$file" > "$RUN_DIR/$name-$i.log" 2>&1 & ;;
      dir) FUZZ_RUNS="$FUZZ2" FUZZ_SEED=$((SEED + 100 + i)) "$VITEST" --run "$file" > "$RUN_DIR/$name-$i.log" 2>&1 & ;;
      scanner) FUZZ_RUNS="$FUZZ3" FUZZ_SEED=$((SEED + 200 + i)) "$VITEST" --run "$file" > "$RUN_DIR/$name-$i.log" 2>&1 & ;;
      census) EXHAUSTIVE_K=4 EXHAUSTIVE_STRIDE="$CENSUS_STRIDE" EXHAUSTIVE_NAME_K="$CENSUS_NAME_K" \
        EXHAUSTIVE_NAME_STRIDE="$CENSUS_NAME_STRIDE" EXHAUSTIVE_CONFIG_MODE=cross EXHAUSTIVE_SHARD="$i/$SHARDS" \
        "$VITEST" --run "$file" > "$RUN_DIR/$name-$i.log" 2>&1 & ;;
      oracle) ORACLE_RAW=1 ORACLE_RUNS="$ORACLE" ORACLE_SEED=$((SEED + 300 + i)) "$VITEST" --run "$file" > "$RUN_DIR/$name-$i.log" 2>&1 & ;;
      latex) FUZZ_RUNS="$FUZZ4" FUZZ_SEED=$((SEED + 400 + i)) "$VITEST" --run "$file" > "$RUN_DIR/$name-$i.log" 2>&1 & ;;
    esac
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
  local status=passed
  [ "$legfail" -eq 0 ] || status=failed
  [ -z "$LEG_RESULTS" ] || LEG_RESULTS="$LEG_RESULTS,"
  LEG_RESULTS="$LEG_RESULTS\"$name\":{\"status\":\"$status\",\"expectedShards\":$SHARDS}"
}

run_leg fuzz src/components/incrementalParse/spliceFuzz.test.ts
run_leg dir src/components/incrementalParse/boundaryDirection.test.ts
run_leg scanner src/components/collectDefLabels.fuzz.test.ts
# The census leg's defaults are the CI ones — K=2, name band K=2, configs
# ROTATED one per document. Every value below has to be passed, and until
# 2026-08-28 two of them were not, so the "gate" ran a slightly larger CI
# check: no run anywhere had put one document under more than one of the
# six configs, and P3's only known finding class (the F24 family, which
# needs three-line documents) was unreachable in every configuration the
# repo actually executed. `EXHAUSTIVE_CONFIG_MODE=cross` is the one the
# test file's own header calls load-bearing; it is worth nothing until it
# is HERE.
run_leg census src/components/incrementalParse/spliceExhaustive.test.ts
run_leg oracle src/components/incrementalParse/oracleConformance.test.ts
run_leg latex src/preprocessors/latexEntryEquivalence.fuzz.test.ts

STATUS=passed
[ "$FAIL" -eq 0 ] || STATUS=failed
node "$ROOT/scripts/soak/soak-metadata.mjs" finish --run-dir "$RUN_DIR" --run-id "$RUN_ID" --mode "$MODE" \
  --run-kind "$RUN_KIND" --status "$STATUS" --started-at "$STARTED_AT" --legs-json "{$LEG_RESULTS}" || FAIL=1
if [ "$FAIL" -ne 0 ]; then
  echo "[$LABEL] FAILURES — inspect $RUN_DIR/*.log"
elif [ "$MODE" = full ]; then
  echo "[$LABEL] ALL CLEAN (legs: $LEGS)"
else
  echo "[$LABEL] SUBSET CLEAN — not a complete release gate (legs: $LEGS)"
fi
for f in "$RUN_DIR"/*.log; do
  printf "%-28s %s\n" "$(basename "$f")" "$(grep -oE 'Tests +[0-9]+ (failed|passed)' "$f" | tail -1)"
done
exit $FAIL
