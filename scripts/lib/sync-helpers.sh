# Shared helpers for `scripts/sync-to-*.sh` — Specflow's marketplace
# / fork sync scripts.
#
# Source from a sync script with:
#   . "$(dirname "$0")/lib/sync-helpers.sh"
#
# All helpers assume the caller has already run `set -euo pipefail` and
# defined any required configuration variables.
#
# Sync-script convention (Epic #270 / C3 #285):
#
#   - **Deterministic** — running the script twice in a row against the
#     same source state produces an identical destination state (no
#     timestamps, no random IDs, no machine-dependent paths). Rsync
#     with `--delete` and jq-based JSON patches are both deterministic;
#     avoid anything that injects `date +%s`, `uuidgen`, or `$RANDOM`.
#
#   - **Skip-on-missing-token** — if the auth secret is unset, emit a
#     `::warning::` and exit 2. The release.yml workflow translates
#     exit 2 into a non-blocking skip, the same way `HOMEBREW_TAP_TOKEN`
#     and `WIKI_SSH_KEY` skip when absent.
#
#   - **DRY_RUN mode** — set `DRY_RUN=1` to print all destructive
#     actions without performing them (no clone, no push, no PR).
#     Useful for local development and as a smoke test in CI before
#     turning on the real sync.
#
#   - **Idempotent PR creation** — if a PR with the same head branch
#     already exists on the destination, the script logs and exits 0
#     rather than failing (the same content has already been pushed
#     by a previous run; nothing to do).
#
# When adding a new sync script for a new harness, follow this
# convention. The helpers below cover the boilerplate so each new
# script focuses on the harness-specific bits (rsync excludes,
# JSON patches, file paths).

# require_gh_token <SECRET_NAME>
#
# Validate that GH_TOKEN is set (CI passes the per-harness secret as
# GH_TOKEN before invoking the script). If unset AND we're not in
# DRY_RUN, emit a workflow warning and exit 2 so the calling workflow
# step can translate it into a non-blocking skip.
#
# Arguments:
#   $1 — secret name (for the warning message, e.g. CODEX_SYNC_TOKEN)
require_gh_token() {
  local secret_name="${1:-GH_TOKEN}"
  if [ -z "${GH_TOKEN:-}" ] && [ -z "${DRY_RUN:-}" ]; then
    echo "::warning::${secret_name} (GH_TOKEN) not set — skipping sync" >&2
    exit 2
  fi
}

# mktemp_workdir <label>
#
# Make a temp directory and set up a trap to clean it up on script
# exit. Prints the directory path so the caller can capture it:
#
#   WORK_DIR=$(mktemp_workdir specflow-codex-sync)
#
# Arguments:
#   $1 — label (for the mktemp -t prefix)
mktemp_workdir() {
  local label="${1:-specflow-sync}"
  local dir
  dir="$(mktemp -d -t "${label}-XXXXXX")"
  # shellcheck disable=SC2064 # we want $dir expanded NOW, not at trap time
  trap "rm -rf '$dir'" EXIT
  printf '%s' "$dir"
}

# git_bot_identity
#
# Set the local git user.email and user.name to the Specflow sync
# bot identity. Must be called from inside the destination clone
# (after `cd` into it).
git_bot_identity() {
  git config user.email "specflow-bot@mkrlabs.dev"
  git config user.name "Specflow Sync Bot"
}

# create_pr_idempotent <repo> <branch> <title> <body>
#
# Open a PR on <repo> from <branch> against main. If a PR with the
# same head already exists, log it and exit 0 rather than failing
# (an earlier run already pushed the same content; nothing to do).
#
# Arguments:
#   $1 — repo (e.g. mkrlabs/openai-codex-plugins)
#   $2 — branch (e.g. specflow-sync/v1.8.0)
#   $3 — PR title
#   $4 — PR body (multi-line OK)
create_pr_idempotent() {
  local repo="$1" branch="$2" title="$3" body="$4"
  if ! gh pr create --repo "$repo" --base main --head "$branch" \
    --title "$title" --body "$body" 2>/dev/null; then
    echo "PR already exists for $branch on $repo; skipping create."
  fi
}
