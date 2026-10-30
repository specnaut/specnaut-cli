#!/usr/bin/env bash
# The merge mode of this project — its one reader (spec 036, plan § 5, FR-002).
#
# Prints exactly `auto` or `manual` on stdout; a one-line note on stderr says
# why. Two callers, neither of which parses the file itself:
#   - the Specnaut chain (phases/auto-chain.md), which applies a per-run
#     instruction first and asks this script only when there is none;
#   - the landing hook (.specnaut/hooks/guard-merge.sh), which calls
#     `--strict` and enforces the file alone (D3).
#
#   (default)  the first top-level `merge:` line of the working tree's
#              .specnaut/workflow.yml. No file or no key → auto. An
#              unrecognised value → manual: a setting that cannot be read
#              resolves to the reading that does not push.
#   --strict   manual if ANY copy says anything but `auto` — the working
#              tree, HEAD's committed copy, or the base branch's (local and
#              origin) — and within a copy every `merge:` line counts,
#              indented or quoted. A model that rewrites the file in its
#              worktree, or commits that rewrite, has not changed the base
#              (§ 11 F2). Comment lines are never settings. A base it
#              cannot read — base-branch.sh exit 3, or no ref of that name
#              locally or on origin — is manual: the guard fails closed.
#
# Usage: merge-mode.sh [--strict]
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0

strict=0
case "${1:-}" in
  "") ;;
  --strict) strict=1 ;;
  *) echo "usage: merge-mode.sh [--strict]" >&2; exit 2 ;;
esac

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# The project this script is installed in, not the git toplevel: a project
# without its own .git inside another repository reads its own workflow.yml.
case $here in
  */.specnaut/scripts/bash) root=${here%/.specnaut/scripts/bash} ;;
  *) if ! root=$(git --no-pager rev-parse --show-toplevel 2>/dev/null); then root=$PWD; fi ;;
esac
rel=.specnaut/workflow.yml

if [ "$strict" = 0 ]; then
  v=""
  if [ -f "$root/$rel" ]; then
    v=$(awk '/^merge:/ { v = $0; sub(/^merge:[[:space:]]*/, "", v); sub(/[[:space:]#].*$/, "", v); print v; exit }' "$root/$rel")
  fi
  case "$v" in
    "") echo "merge-mode: auto (no merge: key in $rel)" >&2; echo auto ;;
    auto) echo "merge-mode: auto ($rel)" >&2; echo auto ;;
    manual) echo "merge-mode: manual ($rel)" >&2; echo manual ;;
    *) echo "merge-mode: manual (unrecognised: $v)" >&2; echo manual ;;
  esac
  exit 0
fi

# Every `merge:` value in one copy, one per line (empty value printed as "").
values() {
  awk '/^[[:space:]]*["'"'"']?merge["'"'"']?[[:space:]]*:/ {
    v = $0; sub(/^[^:]*:[[:space:]]*/, "", v); sub(/[[:space:]#].*$/, "", v); print v
  }'
}

# Reads one copy from stdin; prints the offending value and fails if non-auto.
copy_is_auto() {
  local v
  while IFS= read -r v; do
    if [ "$v" != auto ]; then printf '%s' "${v:-<empty>}"; return 1; fi
  done < <(values)
  return 0
}

verdict() { # <label> — reads the copy on stdin
  local bad
  if ! bad=$(copy_is_auto); then
    echo "merge-mode: manual ($1 says merge: $bad)" >&2
    echo manual
    exit 0
  fi
}

[ -f "$root/$rel" ] && verdict "the working tree" < "$root/$rel"

# `<rev>:./<path>` is relative to -C, so a project below the toplevel reads its own copy.
blob() { git --no-pager -C "$root" cat-file -e "$1:./$rel" 2>/dev/null && git --no-pager -C "$root" cat-file blob "$1:./$rel"; }

if git --no-pager -C "$root" rev-parse --verify --quiet HEAD >/dev/null; then
  if b=$(blob HEAD); then verdict HEAD <<<"$b"; fi
fi

# The base's copy is the one a model cannot rewrite from its worktree, so a
# base this cannot read is not a copy that agrees: it fails closed (cli#711).
if ! base=$(cd "$root" && bash "$here/base-branch.sh" 2>/dev/null); then
  echo "merge-mode: manual (the base branch is unknown — its copy of $rel cannot be read)" >&2
  echo manual
  exit 0
fi
found=0
for ref in "refs/heads/$base" "refs/remotes/origin/$base"; do
  git --no-pager -C "$root" show-ref --verify --quiet "$ref" || continue
  found=1
  if b=$(blob "$ref"); then verdict "$ref" <<<"$b"; fi
done
if [ "$found" = 0 ]; then
  echo "merge-mode: manual (no copy of the base '$base' — neither refs/heads/$base nor origin's)" >&2
  echo manual
  exit 0
fi

echo "merge-mode: auto (every copy of $rel agrees, or none sets merge:)" >&2
echo auto
