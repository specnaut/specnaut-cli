#!/usr/bin/env bash
# The merge mode of this project — its one reader (spec 036, plan § 5, FR-002).
#
# Prints exactly `auto` or `manual` on stdout; a one-line note on stderr says
# why. Three callers, none of which parses the file itself:
#   - the Specnaut chain (phases/auto-chain.md), which applies a per-run
#     instruction first and asks this script only when there is none;
#   - the landing hook (.specnaut/hooks/guard-merge.sh), which calls
#     `--strict` and enforces the file alone (D3) — and `--strict --project
#     <dir>` for each folder a `cd` on the line names (cli#710);
#   - the landing hold (merge-hold.sh, beside this script), which calls
#     `--strict` inside land-feature.sh and remove-spec.sh (spec 048).
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
#   --project <dir>
#              read <dir>'s .specnaut/workflow.yml (and, with --strict, its
#              HEAD and base copies) instead of this script's own project.
#              Only this script and its own base-branch.sh run: nothing that
#              lives under <dir> does, so a cloned repository's scripts are
#              never executed by the hook that names it. A <dir> that cannot
#              be entered is manual.
#
# Every git call disables core.fsmonitor — the one read-path setting that
# runs a program — since <dir>'s .git/config is not this project's to trust.
#
# Usage: merge-mode.sh [--strict] [--project <dir>]
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0
usage() { echo "usage: merge-mode.sh [--strict] [--project <dir>]" >&2; exit 2; }
g() { git --no-pager -c core.fsmonitor=false "$@"; }

strict=0 project=""
while [ "$#" -gt 0 ]; do
  case $1 in
    --strict) strict=1 ;;
    --project) { [ "$#" -ge 2 ] && [ -n "$2" ]; } || usage; project=$2; shift ;;
    *) usage ;;
  esac
  shift
done

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# The project this script is installed in, not the git toplevel: a project
# without its own .git inside another repository reads its own workflow.yml.
if [ -n "$project" ]; then
  if ! root=$(cd -- "$project" 2>/dev/null && pwd -P); then
    echo "merge-mode: manual (cannot enter $project)" >&2
    echo manual
    exit 0
  fi
else
  case $here in
    */.specnaut/scripts/bash) root=${here%/.specnaut/scripts/bash} ;;
    *) if ! root=$(g rev-parse --show-toplevel 2>/dev/null); then root=$PWD; fi ;;
  esac
fi
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
blob() { g -C "$root" cat-file -e "$1:./$rel" 2>/dev/null && g -C "$root" cat-file blob "$1:./$rel"; }

if g -C "$root" rev-parse --verify --quiet HEAD >/dev/null; then
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
  g -C "$root" show-ref --verify --quiet "$ref" || continue
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
