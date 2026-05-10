#!/usr/bin/env bash
# Smoke test for `audit.sh` itself. Builds a self-contained synthetic repo
# under a tempdir, plants one of each finding type the audit is supposed to
# detect (a new bundled agent with no assertion, and a smoke that references
# a runtime path with no source counterpart), then runs `audit.sh --since
# <baseline-tag>` against the synthetic tree. Asserts both findings appear
# in the output. Exits 0 on full pass, 1 on any failure.
#
# This is the meta-test the AC of #176 calls for: "a planted 'new bundled
# file with no assertion' + a planted 'assertion referencing a deleted file'
# must both appear in the audit output."
#
# Usage: smoke-audit.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-audit.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SANDBOX="$ROOT/sandbox/$NAME"

trap 'rm -rf "$SANDBOX"' EXIT

rm -rf "$SANDBOX"
mkdir -p "$SANDBOX"
cd "$SANDBOX"

# --- Synthetic baseline state -------------------------------------------
git init -q -b main
git config user.email "smoke-audit@local"
git config user.name "smoke-audit"

mkdir -p templates/core/agents \
         templates/core/skills/backlog/scripts/github \
         templates/harness-specific/claude/hooks \
         .claude/skills/test-sandbox/scripts

# Baseline content the smoke ALREADY covers (so the audit has a happy path
# alongside the planted gap).
cat > templates/core/agents/baseline-agent.md <<'EOF'
---
name: baseline-agent
description: existed in the baseline tag and is referenced by the smoke.
---
EOF

cat > .claude/skills/test-sandbox/scripts/smoke-features.sh <<'EOF'
#!/usr/bin/env bash
# Synthetic smoke for the audit meta-test. Asserts the baseline agent is
# present. Does NOT mention the planted "new" agent — that's the gap.
set -euo pipefail
[ -f .claude/agents/baseline-agent.md ] || { echo "missing baseline"; exit 1; }
EOF
chmod +x .claude/skills/test-sandbox/scripts/smoke-features.sh

# Copy the real audit.sh into the synthetic tree so it operates on this
# tempdir's surface map and smoke set.
cp "$SCRIPT_DIR/audit.sh" .claude/skills/test-sandbox/scripts/audit.sh
chmod +x .claude/skills/test-sandbox/scripts/audit.sh

git add -A
git commit -q -m "baseline"
git tag vTEST-BASELINE

# --- Plant the two findings ---------------------------------------------
# 1. New bundled agent with no smoke assertion → coverage gap.
cat > templates/core/agents/new-fake-agent.md <<'EOF'
---
name: new-fake-agent
description: shipped after the baseline tag with zero smoke coverage.
---
EOF

# 2. Smoke that references a runtime path whose source is missing →
#    stale assertion. (`baseline-deleted-agent.md` never existed in
#    templates/core/agents/.)
cat > .claude/skills/test-sandbox/scripts/smoke-stale.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ -f .claude/agents/baseline-deleted-agent.md ] || { echo "stale ref"; exit 1; }
EOF
chmod +x .claude/skills/test-sandbox/scripts/smoke-stale.sh

git add -A
git commit -q -m "plant audit findings"

# --- Run the audit ------------------------------------------------------
out=$(bash .claude/skills/test-sandbox/scripts/audit.sh --since vTEST-BASELINE 2>&1 || true)

echo "$out"
echo
echo "── assertions ──"

fails=0
pass() { echo "✓ $1"; }
fail() { echo "❌ $1"; fails=$((fails + 1)); }

if grep -q "new-fake-agent.md" <<<"$out"; then
  pass "audit reports the planted coverage gap (new-fake-agent.md)"
else
  fail "audit did NOT report the planted coverage gap"
fi

if grep -q "baseline-deleted-agent.md" <<<"$out"; then
  pass "audit reports the planted stale assertion (baseline-deleted-agent.md)"
else
  fail "audit did NOT report the planted stale assertion"
fi

if grep -qE "1 coverage gap|^  1 coverage gap\(s\)$" <<<"$out"; then
  pass "audit summary counts exactly 1 coverage gap"
else
  fail "audit summary did NOT count exactly 1 coverage gap (expected 1, got something else)"
fi

if grep -qE "1 stale assertion|^  1 stale assertion\(s\)$" <<<"$out"; then
  pass "audit summary counts exactly 1 stale assertion"
else
  fail "audit summary did NOT count exactly 1 stale assertion"
fi

if [ "$fails" -eq 0 ]; then
  echo
  echo "═══ smoke-audit PASSED ═══"
  exit 0
else
  echo
  echo "═══ smoke-audit FAILED ($fails check(s)) ═══"
  exit 1
fi
