#!/usr/bin/env bash
# Shared `--repo` flag parser for the in-repo Specflow backlog scripts.
#
# Project #4 ("Specflow") is org-owned by mkrlabs and now links three repos:
# `specflow`, `specflow-cloud`, `specflow-monorepo`. All three feed the same
# board with the same Status / Priority / Size / IssueType fields, so only the
# *repo* part of each call varies — everything else (project ID, field IDs,
# option IDs) stays hardcoded.
#
# Usage in a script:
#   . "$(dirname "$0")/_repo.sh"
#   resolve_repo "$@"
#   set -- "${REPO_REMAINING_ARGS[@]}"
#   # now $REPO is "mkrlabs/<short>" and $@ is the remaining positional args
#
# Defaults to `mkrlabs/specflow` for backwards-compat.

ALLOWED_REPOS=(specflow specflow-cloud specflow-monorepo)

resolve_repo() {
  REPO_SHORT="specflow"
  REPO_REMAINING_ARGS=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo)
        shift
        REPO_SHORT="${1:-}"
        ;;
      --repo=*)
        REPO_SHORT="${1#--repo=}"
        ;;
      *)
        REPO_REMAINING_ARGS+=("$1")
        ;;
    esac
    shift || true
  done

  case "$REPO_SHORT" in
    specflow | specflow-cloud | specflow-monorepo) ;;
    *)
      echo "--repo must be one of: ${ALLOWED_REPOS[*]} (got '$REPO_SHORT')" >&2
      return 2
      ;;
  esac

  REPO="mkrlabs/$REPO_SHORT"
}
