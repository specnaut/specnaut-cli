#!/usr/bin/env bash
# Summarize the specflow-output paths inside sandbox/<name>/.
# Usage: inspect.sh <name>
set -euo pipefail

NAME="${1:?usage: inspect.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SANDBOX_DIR="$ROOT/sandbox/$NAME"

if [ ! -d "$SANDBOX_DIR" ]; then
  echo "error: sandbox/$NAME does not exist" >&2
  exit 1
fi

cd "$SANDBOX_DIR"

echo "=== sandbox/$NAME ==="
for path in .claude .cursor .codex .gemini .windsurf .opencode .agent .agents \
  .github/instructions .specflow tasks AGENTS.md CLAUDE.md .gitignore; do
  if [ -e "$path" ]; then
    if [ -d "$path" ]; then
      count=$(find "$path" -type f | wc -l | tr -d ' ')
      echo "  $path/  ($count files)"
    else
      size=$(wc -c <"$path" | tr -d ' ')
      echo "  $path  ($size bytes)"
    fi
  fi
done
