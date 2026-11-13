# shellcheck shell=bash
# Sourced by gate-impact.sh, and the one place an adapter runs and the base worktree
# is made. The adapter is always the base's copy: a branch must not choose the code
# that tells this mechanism how little to check. Requires gate_git.

GATE_WORKTREES=()

# gate_adapter_worktree <commit> <path> <empty-hooks-dir> - a detached worktree of
# <commit> at <path>, outside the repository. The hooks directory is empty so the
# checkout runs none of the repository's hooks.
gate_adapter_worktree() {
  GATE_WORKTREES+=("$2")
  gate_git -c "core.hooksPath=$3" worktree add --quiet --detach "$2" "$1" >/dev/null 2>&1
}

# gate_adapter_cleanup - safe to call on any exit path, and more than once.
gate_adapter_cleanup() {
  local path failed=0
  for path in ${GATE_WORKTREES[@]+"${GATE_WORKTREES[@]}"}; do
    gate_git worktree remove --force "$path" >/dev/null 2>&1 && continue
    rm -rf "$path"
    failed=1
  done
  # Only this run's own failure prunes. A bare prune would drop the user's stale entries too.
  if [ "$failed" -eq 1 ]; then gate_git worktree prune >/dev/null 2>&1 || true; fi
  GATE_WORKTREES=()
}

# gate_adapter_run <command> <worktree> <tree> <commit> <out> - runs the adapter from
# <worktree> to describe <tree>, returns its exit. No GIT_* variable and no stdin
# reach it, and its stdout goes to stderr: only the file it writes is its answer.
gate_adapter_run() {
  (
    explicit_head_clear_env || exit 125
    cd "$2" || exit 125
    export SPECNAUT_IMPACT_TREE="$3" SPECNAUT_IMPACT_COMMIT="$4" SPECNAUT_IMPACT_OUT="$5"
    export SPECNAUT_IMPACT_SCHEMA=1 SPECNAUT_IMPACT_REPO="$REPO_ROOT"
    exec bash -c "$1"
  ) </dev/null >&2
}
