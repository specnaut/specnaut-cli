#!/usr/bin/env bash
# Bootstrap a Vite project once, copy it into 8 sibling dirs, run
# `specflow init --here --ai <harness>` on each, then print an inspect summary
# per harness. Useful for eyeballing layout differences across harnesses.
# Usage: compare-harnesses.sh <name>
set -euo pipefail

NAME="${1:?usage: compare-harnesses.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESSES=(claude cursor codex gemini windsurf copilot opencode antigravity)

bash "$SCRIPT_DIR/bootstrap-vite.sh" "$NAME"

for h in "${HARNESSES[@]}"; do
  variant="$NAME-$h"
  rm -rf "$ROOT/test/$variant"
  cp -R "$ROOT/test/$NAME" "$ROOT/test/$variant"
  echo
  echo "=== init --ai $h ==="
  bash "$SCRIPT_DIR/run-init.sh" "$variant" "$h"
done

echo
echo "=== layout summaries ==="
for h in "${HARNESSES[@]}"; do
  bash "$SCRIPT_DIR/inspect.sh" "$NAME-$h"
done
