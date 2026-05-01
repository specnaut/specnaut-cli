#!/usr/bin/env bash
# Local launchd-fired grooming run.
#
# Fires `claude -p` headless against this repo so the product-owner subagent
# can clarify any current Backlog items on GitHub Project #4 without a
# human in the loop.
#
# Wired up via ~/Library/LaunchAgents/com.specflow.groom-backlog.plist
# (StartInterval = 1800s = every 30 min). Logs land in
# ~/Library/Logs/specflow/groom-backlog.log.
#
# Run manually with: bash scripts/groom-backlog-local.sh
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

# Make sure logs dir exists when invoked outside launchd's StandardOutPath.
LOG_DIR="$HOME/Library/Logs/specflow"
mkdir -p "$LOG_DIR"

# Make sure gh + claude are on PATH when launched from a non-login shell.
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/cmux.app/Contents/Resources/bin:$PATH"

PROMPT='You are running as a scheduled grooming routine for the Specflow project. Your job: clarify any items currently in the Backlog column of GitHub Project #4 (mkrlabs/specflow), following the Product Owner contract defined at .claude/agents/product-owner.md.

Steps:
1. Run `.claude/skills/backlog/scripts/list.sh Backlog` to list current Backlog items.
2. For each item, run `.claude/skills/backlog/scripts/view.sh <num>` to read the issue body and existing comments.
3. **Skip rule**: if any existing comment starts with the marker `🤖 specflow-groom-backlog clarification:`, skip the item — it was already processed in a prior run.
4. Otherwise dispatch the `product-owner` subagent to clarify the item. It will either promote to Ready (with a clean Why/AC/Out-of-scope body), leave a 1–3 question clarification comment with the marker, or recommend triage.

Hard constraints (from .claude/agents/product-owner.md):
- Do NOT close any issue.
- Do NOT add new issues.
- Do NOT move any item to a status other than Ready.
- French in user-facing comments, English in issue bodies.

End with a single-line final report:
`groom summary — promoted: <list>, commented: <list>, skipped: <list>, recommended-triage: <list>`

If Backlog is empty, report: `Backlog is empty — nothing to do.`'

echo "=== specflow-groom-backlog START $(date -Iseconds) (cwd=$REPO_ROOT) ==="
echo "" | claude -p "$PROMPT" --model claude-sonnet-4-6 2>&1 || echo "ERROR claude -p exit code $?"
echo "=== specflow-groom-backlog END $(date -Iseconds) ==="
