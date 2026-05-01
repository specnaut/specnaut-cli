#!/usr/bin/env bash
# Wipe a single test scenario or the entire test/ tree.
# Usage:
#   clean.sh           # removes the whole test/ tree
#   clean.sh <name>    # removes just test/<name>/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

if [ $# -eq 0 ]; then
  rm -rf "$ROOT/test"
  echo "✓ wiped test/"
else
  rm -rf "$ROOT/test/$1"
  echo "✓ removed test/$1"
fi
