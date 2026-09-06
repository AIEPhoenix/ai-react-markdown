#!/bin/bash
# Release gate: six verification legs, fixed logical work, bounded workers.
# Usage: scripts/soak/soak.sh <fresh-seed-base> [label]
# SHARDS=14 fixes the default random streams and census partition; WORKERS
# defaults to detected cores minus two and changes concurrency only.
# Release requires a clean tree, fresh seeds, SHARDS>=14, full-stride K=4
# census, six configs, P3 and BFS enabled, and standard random budgets.
# SOAK_PROFILE=smoke allows smaller budgets; RUN_KIND=replay reuses seeds.
# LEGS selects a subset. A subset is never a complete release gate.
# FAIL_FAST=1 stops remaining work after a task fails; 0 collects all failures.
# Reports, effective environment and worker CPU/RSS live in .soak-logs/<run-id>.
# Signal interruption writes a non-passing result and terminates child groups.
# On macOS caffeinate prevents idle sleep, but not sleep caused by lid close.
# bash 3.2 compatible; the Node runner owns subprocess scheduling and cleanup.
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

# Logical shards fix the work budget; workers only control concurrency.
SHARDS=${SHARDS:-14}
CORES=$(detect_cores | head -1 | tr -dc '0-9')
CORES=${CORES:-14}
DEFAULT_WORKERS=$((CORES - 2))
[ "$DEFAULT_WORKERS" -ge 1 ] || DEFAULT_WORKERS=1
WORKERS=${WORKERS:-$DEFAULT_WORKERS}
require_uint SHARDS "$SHARDS" 1 100
require_uint WORKERS "$WORKERS" 1 100
FAIL_FAST=${FAIL_FAST:-1}
require_uint FAIL_FAST "$FAIL_FAST" 0 1
CENSUS_K=${CENSUS_K:-4}
require_uint CENSUS_K "$CENSUS_K" 1 4
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
OUT="$ROOT/.soak-logs"
mkdir -p "$OUT"
RUN_KIND=${RUN_KIND:-fresh}
case "$RUN_KIND" in fresh|replay) ;; *) die "RUN_KIND must be fresh or replay" ;; esac
PROFILE=${SOAK_PROFILE:-release}
case "$PROFILE" in release|smoke) ;; *) die "SOAK_PROFILE must be release or smoke" ;; esac
if [ "$PROFILE" = release ]; then
  [ "$SHARDS" -ge 14 ] || die "release profile requires SHARDS>=14 (WORKERS controls concurrency)"
  [ "$CENSUS_K" -eq 4 ] || die "release profile requires CENSUS_K=4"
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
PARAMETERS=$(printf '{"fuzz1":%s,"fuzz2":%s,"fuzz3":%s,"fuzz4":%s,"oracle":%s,"censusK":%s,"censusStride":%s,"censusNameK":%s,"censusNameStride":%s,"censusConfigMode":"cross","fallbackOracleSample":%s}' \
  "$FUZZ1" "$FUZZ2" "$FUZZ3" "$FUZZ4" "$ORACLE" "$CENSUS_K" "$CENSUS_STRIDE" "$CENSUS_NAME_K" "$CENSUS_NAME_STRIDE" "$FALLBACK_ORACLE_SAMPLE")
RUN_DIR=$(node "$ROOT/scripts/soak/soak-metadata.mjs" create \
  --run-dir "$RUN_DIR" --run-id "$RUN_ID" --label "$LABEL" --mode "$MODE" --run-kind "$RUN_KIND" \
  --seed "$SEED" --legs "$LEGS" --shards "$SHARDS" --cores "${CORES:-$SHARDS}" --profile "$PROFILE" \
  --parameters "$PARAMETERS" --state-dir "$STATE_DIR" --workers "$WORKERS" --fail-fast "$FAIL_FAST") || exit 2
echo "[$LABEL] run-id=$RUN_ID mode=$MODE kind=$RUN_KIND profile=$PROFILE"
echo "[$LABEL] SHARDS=$SHARDS WORKERS=$WORKERS seed-base=$SEED legs=$LEGS"
echo "[$LABEL] logs=$RUN_DIR"
exec node "$ROOT/scripts/soak/soak-runner.mjs" "$RUN_DIR"
