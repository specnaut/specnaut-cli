#!/usr/bin/env bash
# Bootstrap a Vite React-TS project under test/<name>/ for Specflow UX testing.
# Skips `npm install` — deps are not needed to test specflow's filesystem ops,
# and skipping keeps the scenario fast and small.
# Usage: bootstrap-vite.sh <name>
set -euo pipefail

NAME="${1:?usage: bootstrap-vite.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
TEST_DIR="$ROOT/test/$NAME"

rm -rf "$TEST_DIR"
mkdir -p "$ROOT/test"
cd "$ROOT/test"

npm create vite@latest "$NAME" -- --template react-ts >/dev/null

echo "✓ bootstrapped Vite React-TS at test/$NAME/"
echo "  (skipped npm install — not needed for specflow UX tests)"
