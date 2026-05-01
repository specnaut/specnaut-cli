#!/usr/bin/env bash
# Bootstrap an empty greenfield project under test/<name>/ for Specflow UX
# testing. Stub package.json so it looks like a real (just-created) project.
# Usage: bootstrap-empty.sh <name>
set -euo pipefail

NAME="${1:?usage: bootstrap-empty.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
TEST_DIR="$ROOT/test/$NAME"

rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"
git init -q
cat >package.json <<EOF
{
  "name": "$NAME",
  "version": "0.0.0",
  "private": true
}
EOF

echo "✓ bootstrapped empty greenfield project at test/$NAME/"
