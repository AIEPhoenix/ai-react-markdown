#!/bin/bash
# Read-only progress view over a running (or finished) soak.
#
# It opens nothing, writes nothing, and signals nothing — it reads the shard
# logs the gate is already producing and prints one screen. That separation
# is deliberate: `soak.sh` is the release gate, and its value comes from
# being simple enough to trust at a glance, so the progress machinery lives
# out here where a bug in it can waste your time but not your gate.
#
# Usage:
#   scripts/soak/soak-watch.sh [run-id] [-n SECONDS] [--stale SECONDS]
#
#   run-id   exact run directory name; a unique label prefix is also accepted
#   -n       repeat every SECONDS instead of printing once
#   --stale  a shard whose last beat is older than this is flagged,
#            default 300
#
# WHAT THE STALE COLUMN IS FOR. The percentage tells you a run is slow. The
# question actually being asked at hour three is whether it is slow or DEAD,
# and those look identical from the outside — which is what cost hours on
# 2026-09-02. `age` answers it: a live shard beats every 30 s or so, a wedged
# one stops and its age climbs without bound.
#
# Shards only beat when `SOAK_HEARTBEAT` is set, which `soak.sh` exports.
# Against a log from an older run, or from `vitest` invoked by hand, every
# row reads "no beats" — that is missing instrumentation, not a hang.
#
# bash 3.2 (macOS ships it): no associative arrays, no `${var,,}`.
set -uo pipefail

LABEL=soak
EVERY=0
STALE=300
while [ $# -gt 0 ]; do
  case "$1" in
    -n)
      EVERY=${2:-10}
      shift 2
      ;;
    --stale)
      STALE=${2:-300}
      shift 2
      ;;
    -h | --help)
      sed -n '2,28p' "$0"
      exit 0
      ;;
    *)
      LABEL=$1
      shift
      ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/.soak-logs"

resolve_run_dir() {
  if [ -d "$OUT/$LABEL" ] && [ -f "$OUT/$LABEL/manifest.json" ]; then
    RUN_DIR="$OUT/$LABEL"
    return 0
  fi
  local matches
  matches=$(find "$OUT" -maxdepth 1 -type d -name "$LABEL-*" 2>/dev/null | sort)
  local count
  count=$(printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' ')
  if [ "$count" -eq 1 ]; then RUN_DIR=$matches; return 0; fi
  if [ "$count" -gt 1 ]; then
    echo "multiple runs match '$LABEL'; pass an exact run-id:" >&2
    printf '%s\n' "$matches" | sed "s|$OUT/|  |" >&2
    return 2
  fi
  echo "no run directory matching $OUT/$LABEL" >&2
  return 1
}
resolve_run_dir || exit $?

render() {
  local now
  now=$(date +%s)
  local files
  files=$(ls "$RUN_DIR"/*.log 2>/dev/null)
  if [ -z "$files" ]; then
    echo "no logs matching $RUN_DIR/*.log"
    return 1
  fi

  printf '%-10s %5s  %-12s %8s %-16s %8s %9s  %s\n' LEG SHARD PHASE PCT DONE ELAPSED AGE STATE
  local total=0 running=0 finished=0 stale=0 failed=0
  # A single awk per file: the log can be hundreds of MB on a long census
  # shard, and `grep | tail` over all of them is the difference between an
  # instant readout and one you stop running.
  for f in $files; do
    local base rest leg shard line
    base=$(basename "$f" .log)
    rest=$base
    leg=${rest%-*}
    shard=${rest##*-}
    total=$((total + 1))

    # Last heartbeat and last vitest verdict, one pass.
    line=$(awk '
      /^\[hb\]/ { hb = $0 }
      / Tests +[0-9]+ (failed|passed)/ { if (match($0, /Tests +[0-9]+ (failed|passed)/)) verdict = substr($0, RSTART, RLENGTH) }
      END { print hb "\x01" verdict }
    ' "$f")
    local hb verdict
    hb=${line%%$'\001'*}
    verdict=${line#*$'\001'}

    local phase='-' pct='-' done='-' elapsed='-' age='-' state
    if [ -n "$hb" ]; then
      phase=$(printf '%s\n' "$hb" | sed -n 's/.*phase=\([^ ]*\).*/\1/p')
      pct=$(printf '%s\n' "$hb" | sed -n 's/.*pct=\([^ ]*\).*/\1/p')
      done=$(printf '%s\n' "$hb" | sed -n 's/.*done=\([^ ]*\).*/\1/p')
      elapsed=$(printf '%s\n' "$hb" | sed -n 's/.*elapsed=\([^ ]*\).*/\1/p')
      local epoch
      epoch=$(printf '%s\n' "$hb" | sed -n 's/.*epoch=\([0-9]*\).*/\1/p')
      [ -n "$epoch" ] && age=$((now - epoch))
      [ -n "$pct" ] && pct="$pct%"
    fi

    if [ -n "$verdict" ]; then
      case "$verdict" in
        *failed*)
          state="FAILED ($verdict)"
          failed=$((failed + 1))
          ;;
        *) state="done ($verdict)" ;;
      esac
      finished=$((finished + 1))
      age='-'
    elif [ -z "$hb" ]; then
      state='no beats'
      running=$((running + 1))
    elif [ "$age" != '-' ] && [ "$age" -gt "$STALE" ]; then
      # Counted as stale and NOT as running, so the four numbers in the
      # summary add up to the shard count. A subset that also appears in the
      # total it is a subset of reads as one more shard than exists, which is
      # the wrong direction to be wrong in when you are counting whether a
      # split run is all there.
      state="STALE > ${STALE}s"
      stale=$((stale + 1))
    else
      state='running'
      running=$((running + 1))
    fi

    printf '%-10s %5s  %-12s %8s %-16s %8s %9s  %s\n' \
      "$leg" "$shard" "${phase:--}" "${pct:--}" "${done:--}" "${elapsed:--}" "$([ "$age" = '-' ] && echo '-' || echo "${age}s")" "$state"
  done

  printf '\n%d shard log(s): %d running, %d stale, %d finished (%d FAILED)\n' \
    "$total" "$running" "$stale" "$finished" "$failed"
  if [ "$stale" -gt 0 ]; then
    printf 'A stale shard has stopped beating. It is wedged, swapping, or its machine went to sleep\n'
    printf '(caffeinate does NOT survive a lid close — see the note in soak.sh).\n'
  fi
  return 0
}

if [ "$EVERY" -le 0 ]; then
  render
  exit $?
fi
while :; do
  # `clear` only when it exists; a redirected watch should stay readable.
  if [ -t 1 ] && command -v clear > /dev/null 2>&1; then clear; fi
  printf '%s — %s every %ss (ctrl-c to stop)\n\n' "$LABEL" "$(date '+%H:%M:%S')" "$EVERY"
  render
  sleep "$EVERY"
done
