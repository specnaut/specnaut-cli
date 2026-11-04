#!/usr/bin/env bash
# The merge mode of this project — its one reader (spec 036, plan § 5, FR-002).
#
# Prints exactly `auto` or `manual` on stdout; a one-line note on stderr says
# why. The Specnaut chain (phases/auto-chain.md) applies a per-run instruction
# first and asks this script only when there is none.
#
# Reads the first top-level `merge:` line of .specnaut/workflow.yml. No file or
# no key → auto. An unrecognised value → manual: a setting that cannot be read
# resolves to the reading that asks.
#
# Usage: merge-mode.sh
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0
if [ "$#" -ne 0 ]; then echo "usage: merge-mode.sh" >&2; exit 2; fi

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# The project this script is installed in, not the git toplevel: a project
# without its own .git inside another repository reads its own workflow.yml.
case $here in
  */.specnaut/scripts/bash) root=${here%/.specnaut/scripts/bash} ;;
  *) if ! root=$(git --no-pager -c core.fsmonitor=false rev-parse --show-toplevel 2>/dev/null); then root=$PWD; fi ;;
esac
rel=.specnaut/workflow.yml

v=""
if [ -f "$root/$rel" ]; then
  v=$(awk '/^merge:/ { v = $0; sub(/^merge:[[:space:]]*/, "", v); sub(/[[:space:]#].*$/, "", v); print v; exit }' "$root/$rel")
fi
case "$v" in
  "") echo "merge-mode: auto (no merge: key in $rel)" >&2; echo auto ;;
  auto) echo "merge-mode: auto ($rel)" >&2; echo auto ;;
  manual) echo "merge-mode: manual ($rel)" >&2; echo manual ;;
  *) echo "merge-mode: manual (unrecognised: $v)" >&2; echo manual ;;
esac
