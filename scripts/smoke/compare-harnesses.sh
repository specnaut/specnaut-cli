#!/usr/bin/env bash
# Bootstrap a Vite project once, copy it into 8 sibling dirs, run
# `specnaut init --here --ai <harness>` on each, then print an inspect summary
# per harness. Useful for eyeballing layout differences across harnesses.
# Usage: compare-harnesses.sh <name>
set -euo pipefail

NAME="${1:?usage: compare-harnesses.sh <name>}"
. "$(dirname "$0")/_common.sh"
# `gemini` was in this list and is not a supported harness — `run-init.sh`
# would have failed on it. Same family as a banner asserting a count it does
# not compute. smoke-all-harnesses.sh carries the authoritative set.
HARNESSES=(claude cursor codex copilot opencode antigravity)

bash "$SMOKE_DIR/bootstrap-vite.sh" "$NAME"

for h in "${HARNESSES[@]}"; do
  variant="$NAME-$h"
  variant_dir="$(scenario_dir "$variant")"
  rm -rf "$variant_dir"
  cp -R "$(scenario_dir "$NAME")" "$variant_dir"
  echo
  echo "=== init --ai $h ==="
  bash "$SMOKE_DIR/run-init.sh" "$variant" "$h"
done

echo
echo "=== layout summaries ==="
for h in "${HARNESSES[@]}"; do
  bash "$SMOKE_DIR/inspect.sh" "$NAME-$h"
done
