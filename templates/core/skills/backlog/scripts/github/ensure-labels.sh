#!/usr/bin/env bash
# Bootstrap the Specflow semantic label set on the configured GitHub repo.
# Idempotent: creates only missing labels; never edits or deletes existing
# ones (preserves user customisation of color / description).
#
# Usage: ensure-labels.sh
#
# Exit codes:
#   0  success (every label either created or already present)
#   1  unexpected failure (auth, network, gh missing, etc.)
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

# Cache the existing label list once. Each `gh label create` call already
# fails fast on duplicate, but we want to skip the API hit entirely when
# the label is present — that's the idempotency guarantee.
EXISTING=$(gh label list --repo "$REPO" --limit 200 --json name --jq '.[].name' 2>/dev/null || true)

ensure_label() {
  local name="$1" color="$2" desc="$3"
  if echo "$EXISTING" | grep -qxF "$name"; then
    echo "  ok (already present): $name"
  else
    gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null
    echo "  created: $name"
  fi
}

echo "Bootstrapping Specflow semantic labels on $REPO …"
ensure_label "security"    "b60205" "Security-sensitive work (auth, secrets, RCE, supply chain)"
ensure_label "refactor"    "0e8a16" "Internal cleanup with no behavior change"
ensure_label "docs"        "0075ca" "Documentation-only change"
ensure_label "tech-debt"   "fbca04" "Known shortcut to repay later"
ensure_label "dx"          "5319e7" "Developer experience (tooling, onboarding, ergonomics)"
ensure_label "performance" "e99695" "Latency, throughput, or memory improvements"
ensure_label "dependency"  "cccccc" "Dependency bump or vendoring"

# `bug` is created by GitHub on every new repo. We don't re-create it,
# but we do warn if it's missing — that's an unusual configuration.
if echo "$EXISTING" | grep -qxF "bug"; then
  echo "  ok (already present): bug"
else
  echo "  warn: 'bug' label missing — usually a GitHub default. Check repo settings if you want it." >&2
fi
echo "done."
