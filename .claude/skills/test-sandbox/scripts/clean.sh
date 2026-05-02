#!/usr/bin/env bash
# Wipe a single sandbox scenario or the entire sandbox/ tree.
# Usage:
#   clean.sh           # removes the whole sandbox/ tree
#   clean.sh <name>    # removes just sandbox/<name>/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

if [ $# -eq 0 ]; then
  rm -rf "$ROOT/sandbox"
  echo "✓ wiped sandbox/"
else
  rm -rf "$ROOT/sandbox/$1"
  echo "✓ removed sandbox/$1"
fi
