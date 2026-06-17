#!/usr/bin/env bash
# Local launchd-fired PR triage run.
#
# Looks for open PRs on mkrlabs/specnaut that don't have a 🤖 marker review
# yet, and fires `claude -p` headless to review the diff against project
# conventions. The review is posted as a PR comment, not a blocking review.
#
# Wired up via ~/Library/LaunchAgents/com.specflow.triage-pr.plist
# (StartInterval = 1800s = every 30 min). Logs land in
# ~/Library/Logs/specnaut/triage-pr.log.
#
# Run manually with: bash scripts/triage-pr-local.sh
set -euo pipefail

cd "$(dirname "$0")/../../.."
REPO_ROOT="$(pwd)"

LOG_DIR="$HOME/Library/Logs/specnaut"
mkdir -p "$LOG_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/cmux.app/Contents/Resources/bin:$PATH"

echo "=== specnaut-triage-pr START $(date -Iseconds) (cwd=$REPO_ROOT) ==="

# Cheap precheck: if no open PR needs triage, exit immediately. Most fires
# will hit this no-op path so the routine costs ~nothing when the board is
# calm.
NEEDS_TRIAGE=$(gh pr list --repo mkrlabs/specnaut --state open --json number,comments \
  --jq '[.[] | select(([.comments[] | select(.body | startswith("🤖 specnaut-triage-pr review:"))] | length) == 0) | .number] | join(",")')

if [[ -z "$NEEDS_TRIAGE" ]]; then
  echo "no open PRs need triage — exiting"
  echo "=== specnaut-triage-pr END $(date -Iseconds) ==="
  exit 0
fi

echo "PRs needing triage: $NEEDS_TRIAGE"

PROMPT="You are running as a scheduled PR triage routine for the Specnaut project. Your job: review any open PRs on mkrlabs/specnaut that don't yet have a triage review, and post a structured review comment.

Open PR numbers needing review (comma-separated): $NEEDS_TRIAGE

For each PR number:

1. \`gh pr view <num> --repo mkrlabs/specnaut --json title,body,headRefName,baseRefName,additions,deletions,changedFiles,files\` to get metadata.
2. \`gh pr diff <num> --repo mkrlabs/specnaut\` to read the full diff.
3. Cross-reference against project conventions:
   - \`AGENTS.md\` — project vision, locked decisions, hexagonal layering rules
   - \`.claude/agents/architect.md\` — architectural patterns (the architect agent's contract)
   - \`CLAUDE.md\` — collaboration rules
4. For non-trivial changes that touch boundaries (new ports, new harnesses, changes to template bundling, install/release flow), dispatch the \`architect\` subagent for a design opinion.

Then post ONE review comment per PR via \`gh pr comment <num> --repo mkrlabs/specnaut --body \"<review>\"\` with this exact structure (always include the marker prefix on the FIRST line):

\`\`\`
🤖 specnaut-triage-pr review:

**Verdict**: <ship-it | needs-changes | needs-architect | needs-info>

**Summary**: <1-2 sentences on what the PR does>

**Findings**:
- <bullet for each concrete issue, linking file:line if applicable>
- <or 'no blocking issues' if clean>

**Notes** (optional):
- <anything the human reviewer should know>
\`\`\`

In French in the freeform sentences (Verdict labels stay in English so they're stable for any future tooling).

Hard constraints:
- Do NOT approve or merge the PR yourself.
- Do NOT push commits to the PR branch.
- Do NOT close any PR.
- The review is advisory — leave the merge decision to Kevin.
- One comment per PR. The marker prefix '🤖 specnaut-triage-pr review:' MUST be on the first line so future runs skip already-reviewed PRs.

End with a single-line final report:
\`triage summary — reviewed: <list>, deferred-to-architect: <list>, errors: <list>\`

If the comma-separated list at the top is empty, report \`No PRs to triage — nothing to do.\`"

echo "" | claude -p "$PROMPT" --model claude-sonnet-4-6 2>&1 || echo "ERROR claude -p exit code $?"
echo "=== specnaut-triage-pr END $(date -Iseconds) ==="
