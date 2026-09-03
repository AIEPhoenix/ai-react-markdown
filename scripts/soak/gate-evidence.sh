#!/usr/bin/env bash
# Re-run the COMPARATIVE measurements that justify the raw-mode gate's
# exemption set (the 2026-08-28 audit, "the gate trusted a footer key any
# document can write"). Prints a table; asserts
# nothing.
#
# Why this is a script and not a test. The numbers here compare the gate
# against a version of ITSELF that no longer exists in the source, so they
# cannot be assertions — and a number that cannot be an assertion decays the
# moment its harness is deleted, which "delete every scratch file before
# committing" guarantees. The three-way rule this repo settled on:
#
#   numbers that GATE            -> assertions
#   numbers that JUSTIFY a gate  -> a committed script (here)
#   nothing that matters         -> a deleted scratch file or a console.log
#
# The harness is `src/**/*.evidence.ts`, outside the package's vitest
# `include`, so preflight never sees it and it never enters the test count.
#
# Usage:
#   scripts/soak/gate-evidence.sh                  # landed configuration
#   EVIDENCE_SUPPRESSION_RUNS=200 \
#   EVIDENCE_RECALL_RUNS=100 \
#   EVIDENCE_ENTRY_SEEDS=10 scripts/soak/gate-evidence.sh    # quick smoke
#
# Runtime at the landed sizes is ~15-20 min, nearly all of it the exemption
# harness: six arms x two corpora x two boundary modes, each re-parsing
# every probe position twice. The floor harnesses (`coverageFloor`,
# `latexEntryFloor`) add a couple of minutes between them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/packages/engine"

exec ../../node_modules/.bin/vitest run \
  --config vitest.evidence.config.ts \
  --reporter=dot \
  "$@"
