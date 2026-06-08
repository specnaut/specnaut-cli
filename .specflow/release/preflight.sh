#!/usr/bin/env bash
# Specflow CLI release preflight. Exit ≠ 0 ⇒ release aborts.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "▶ branch check"
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || { echo "❌ not on main (on $branch)"; exit 1; }

echo "▶ working tree clean"
[ -z "$(git status --porcelain)" ] || { echo "❌ working tree dirty"; git status --short; exit 1; }

echo "▶ in sync with origin/main"
git fetch origin main --quiet
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "❌ local main diverges from origin"; exit 1; }

echo "▶ CI green on HEAD"
sha="$(git rev-parse HEAD)"
# The headSha filter is critical — a bare `--limit 1` would happily return the
# previous commit's green run while the current commit's CI is still pending.
# Search up to 20 recent runs to handle PRs landing rapidly back-to-back.
conclusion="$(gh run list --workflow ci --branch main --limit 20 --json headSha,conclusion,status --jq "[.[] | select(.headSha == \"$sha\" and .status == \"completed\")] | .[0].conclusion")"
[ "$conclusion" = "success" ] || { echo "❌ CI not green on $sha (got: ${conclusion:-no-completed-run})"; exit 1; }

echo "▶ smoke audit"
# audit.sh prints `0 coverage gap(s)` / `0 stale assertion(s)` but does NOT exit
# non-zero on failures (verified 2026-05-26). Capture output and parse — the
# preflight is the gate that gives the audit its teeth.
audit_out="$(bash .claude/skills/test-sandbox/scripts/audit.sh)"
echo "$audit_out"
gaps="$(echo "$audit_out" | grep -oE '[0-9]+ coverage gap' | grep -oE '^[0-9]+' || echo "0")"
stale="$(echo "$audit_out" | grep -oE '[0-9]+ stale assertion' | grep -oE '^[0-9]+' || echo "0")"
[ "$gaps" -eq 0 ] && [ "$stale" -eq 0 ] || { echo "❌ smoke audit found $gaps gap(s) + $stale stale assertion(s) — fix before releasing"; exit 1; }

echo "▶ deno task bundle (re-sync)"
deno task bundle
[ -z "$(git status --porcelain src/templates_bundle.ts)" ] || { echo "❌ bundle drifted — commit the regenerated src/templates_bundle.ts first"; exit 1; }

echo "▶ deno task test"
deno task test

echo "✅ preflight passed"
