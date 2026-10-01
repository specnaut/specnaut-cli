#!/usr/bin/env bash
# Run the PUBLISHED binary end to end, once, in a throwaway directory.
#
# Usage: smoke-published.sh <tag> [binary]     (binary defaults to `specnaut`)
#
# Every other smoke assertion runs against the source tree: scripts/smoke/
# scaffolds through `deno run src/main.ts`, and CI's `smoke` workflow does the
# same. None of them ever executes the artefact users download. This does —
# the binary `specnaut self-update` just installed — and asks the three things
# a user would notice first:
#
#   1. `specnaut init` scaffolds a project and exits 0;
#   2. the scaffold carries the files every harness run depends on, and its
#      lock records THIS release's templates version — a binary built from a
#      stale bundle passes 1 and fails here;
#   3. `specnaut check --project` on that fresh scaffold exits 0.
#
# Exit 0 = all three held. Exit 1 = one did not; the reason is printed.
# Exit 2 = usage.
set -uo pipefail

TAG="${1:-}"
BIN="${2:-specnaut}"
[ -n "$TAG" ] || { echo "usage: smoke-published.sh <tag> [binary]" >&2; exit 2; }
want="${TAG#v}"

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
fail() { echo "❌ published-binary smoke: $*"; exit 1; }

git -C "$dir" init -q || fail "could not create a throwaway git repository"

( cd "$dir" && $BIN init --here --no-git --ai claude --backlog local ) > "$dir/.init.log" 2>&1 ||
  { tail -20 "$dir/.init.log"; fail "\`specnaut init\` exited non-zero"; }

for f in AGENTS.md .claude/skills/specnaut/SKILL.md .claude/skills/board/SKILL.md \
  .claude/skills/ship/SKILL.md .specnaut/workflow.yml .specnaut/installed.lock; do
  [ -f "$dir/$f" ] || fail "the scaffold is missing $f"
done

got="$(sed -n 's/^templates_version:[[:space:]]*//p' "$dir/.specnaut/installed.lock" | head -1)"
[ "$got" = "$want" ] || fail "the lock records templates $got, expected $want — the binary carries a stale bundle"

( cd "$dir" && $BIN check --project ) > "$dir/.check.log" 2>&1 ||
  { tail -20 "$dir/.check.log"; fail "\`specnaut check --project\` exited non-zero on a fresh scaffold"; }

echo "✓ published binary: init, scaffold (templates $want) and check --project all pass"
