#!/usr/bin/env bash
# Bootstrap the Specnaut semantic label set on the configured GitLab project.
# Idempotent: creates only missing labels; never edits or deletes existing
# ones (preserves user customisation of color / description).
#
# Usage: ensure-labels.sh
#
# Exit codes:
#   0  success (every label either created or already present)
#   1  unexpected failure (auth, network, glab missing, etc.)
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

# `glab label list` paginates by default. `--per-page 200` covers any
# realistic project; output uses the table format whose first column is
# the label name. We tolerate a leading "•" / "*" bullet some glab
# versions print and strip ANSI colors with `sed`.
EXISTING=$(
  glab label list --repo "$PROJECT_ID" --per-page 200 2>/dev/null \
    | sed -E 's/\x1b\[[0-9;]*m//g' \
    | awk 'NR>1 && NF { sub(/^[•*]\s*/, ""); print $1 }' \
    | tr -d '\r' \
    || true
)

ensure_label() {
  local name="$1" color="$2" desc="$3"
  if echo "$EXISTING" | grep -qxF "$name"; then
    echo "  ok (already present): $name"
  else
    glab label create --repo "$PROJECT_ID" -n "$name" --color "#$color" --description "$desc" >/dev/null
    echo "  created: $name"
  fi
}

echo "Bootstrapping Specnaut semantic labels on $PROJECT_ID …"
ensure_label "security"    "b60205" "Security-sensitive work (auth, secrets, RCE, supply chain)"
ensure_label "refactor"    "0e8a16" "Internal cleanup with no behavior change"
ensure_label "docs"        "0075ca" "Documentation-only change"
ensure_label "tech-debt"   "fbca04" "Known shortcut to repay later"
ensure_label "dx"          "5319e7" "Developer experience (tooling, onboarding, ergonomics)"
ensure_label "performance" "e99695" "Latency, throughput, or memory improvements"
ensure_label "dependency"  "cccccc" "Dependency bump or vendoring"
echo "done."
