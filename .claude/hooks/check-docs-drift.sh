#!/usr/bin/env bash
# Stop-event hook: warn when user-visible CLI source changed but no doc
# surface was touched. Soft warn-only — exits 0 always; emits a
# `hookSpecificOutput.additionalContext` JSON payload only when drift is
# detected so the next turn can dispatch the product-owner subagent in
# its "docs upkeep" mode.
#
# This hook lives in the SPECFLOW REPO ITSELF (not in the bundled
# templates) — its job is to catch drift between the binary's behavior
# and the docs that describe it (docs/llms.md, README.md, slash-command
# help, SKILL.md files).
set -euo pipefail

# Files Claude Code touched in this turn — staged, unstaged, and
# untracked. Empty diff = nothing to check; exit silently.
changed=$(
  {
    git diff --name-only HEAD 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
  } | sort -u
) || exit 0

[ -z "$changed" ] && exit 0

# User-visible source: anything that affects what the user sees when
# they run the binary. Slash-command source is intentionally excluded
# here — those files are themselves a doc surface and editing one is
# self-documenting.
uv_pat='^(src/cli/parser\.ts|src/cli/handlers/.*\.ts|src/cli/help\.ts)$'

# Doc surfaces we expect to be kept in sync with the binary.
ds_pat='^(docs/llms\.md|README\.md|templates/core/commands/specflow\.[a-z]+\.md|templates/core/skills/[^/]+/SKILL\.md)$'

uv_changed=$(echo "$changed" | grep -E "$uv_pat" || true)
ds_changed=$(echo "$changed" | grep -E "$ds_pat" || true)

# Warn only when CLI source changed but NO doc surface was touched.
if [ -z "$uv_changed" ] || [ -n "$ds_changed" ]; then
  exit 0
fi

# Build a comma-joined list of changed user-visible files for the
# message — keeps the additionalContext concise.
uv_list=$(echo "$uv_changed" | paste -sd, -)

cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "docs-drift watch: user-visible CLI source changed but no doc surface was updated. Changed files: ${uv_list}. If this is a real user-visible change (new/removed CLI flag, new/changed handler output, new/changed error message, new/changed public command), dispatch the product-owner subagent in its docs-upkeep mode (it owns docs/llms.md, README.md, templates/core/commands/specflow.*.md, and templates/core/skills/*/SKILL.md). The PO will report drift with a concrete patch suggestion or confirm docs are in sync. If the change is purely internal refactor with no user-facing impact, ignore this watch."
  }
}
JSON
