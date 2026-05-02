#!/usr/bin/env bash
# Bootstrap a Vite React-TS project under sandbox/<name>/ for Specflow UX testing.
# Skips `npm install` — deps are not needed to test specflow's filesystem ops,
# and skipping keeps the scenario fast and small.
# Usage: bootstrap-vite.sh <name>
set -euo pipefail

NAME="${1:?usage: bootstrap-vite.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SANDBOX_DIR="$ROOT/sandbox/$NAME"

rm -rf "$SANDBOX_DIR"
mkdir -p "$ROOT/sandbox"
cd "$ROOT/sandbox"

npm create vite@latest "$NAME" -- --template react-ts >/dev/null

echo "✓ bootstrapped Vite React-TS at sandbox/$NAME/"
echo "  (skipped npm install — not needed for specflow UX tests)"
