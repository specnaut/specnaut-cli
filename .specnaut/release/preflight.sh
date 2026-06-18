#!/usr/bin/env bash
# Specnaut CLI release preflight. Exit ≠ 0 ⇒ release aborts.
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
# The headSha filter avoids racing on the previous commit's green run. The
# polling loop tolerates a fresh push where CI hasn't completed yet —
# symmetric to postflight's release.yml polling. 10 × 30s = up to 5 min;
# the preflight's `deno task test` runs for ~10-25 s on its own so this
# rarely fires.
conclusion=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  conclusion="$(gh run list --workflow ci --branch main --limit 20 --json headSha,conclusion,status --jq "[.[] | select(.headSha == \"$sha\" and .status == \"completed\")] | .[0].conclusion")"
  [ -n "$conclusion" ] && [ "$conclusion" != "null" ] && break
  echo "  waiting for ci run on $sha to complete ($i/10)…"
  sleep 30
done
[ "$conclusion" = "success" ] || { echo "❌ CI not green on $sha (got: ${conclusion:-no-completed-run-after-5min})"; exit 1; }

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
