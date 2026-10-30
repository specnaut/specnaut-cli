# shellcheck shell=bash
# Sourced by audit.sh, in place: WHAT the audit reads — the three git
# collections, their union in $CHANGED, and origin_note() for the report text.
# It runs where audit.sh sources it, under audit.sh's `set -euo pipefail`, and
# reads $SRC_ROOT and $SINCE. Beside audit.sh like _surfaces.sh — never
# $SMOKE_DIR, which smoke-audit.sh points at a synthetic suite.
#
# --- The collection: one git prefix, one pathspec, three sources (#564) ---
#
# `core.quotePath=false`: by default git renders a non-ASCII path as an escaped,
# double-quoted string, which matches no glob in SURFACES and left through the
# unmapped bucket — a green gate over a file nothing asserts on (#549).
#
# It lives in a SHARED prefix rather than being typed on each collection line.
# Hoisting only the pathspec would leave this flag with two literal copies, and
# #549 is the shipped incident proving what one missing copy costs.
#
# `core.excludesFile=/dev/null`: `--exclude-standard` below reads THREE sources
# — per-directory .gitignore files, $GIT_DIR/info/exclude, and the user's
# machine-global excludes file. The third has nothing to do with this repository,
# and inheriting it makes the verdict a property of the laptop rather than of the
# tree, in the false-green direction. `info/exclude` stays honoured: it is
# repo-local and deliberate, the same class as .gitignore.
GIT_SRC=(git -C "$SRC_ROOT" -c core.quotePath=false -c core.excludesFile=/dev/null)

# The audited surface, ONCE. Every collection below consumes this array, so the
# tracked and untracked halves are scoped identically by construction rather
# than by discipline.
#
# `smoke-audit.sh` restates these prefixes as literals on purpose — see the
# comment beside them there. Do not "fix" that duplication: it is the only
# independent opinion about what this array should contain, and #551 is what it
# would have caught.
SURFACE_PATHSPEC=('templates/core/' 'templates/harness-specific/' 'templates/manifest.json' 'src/cli/')

# `git diff <a>..<b>` compares two COMMITS. A file that has never been committed
# is in neither, so until #564 the gate ran blind on exactly the files it exists
# to catch: a wholly new surface file has no assertion by definition, and the
# audit stayed quiet for the whole time it was being written.
#
# Three sources, unioned — never substituted:
#   1. tracked, changed since the baseline  — the original collection, untouched
#   2. staged but not committed             — `git add` is the next keystroke
#                                             after `touch`; without this the
#                                             feature's value window is ~zero
#   3. untracked and not ignored            — the ticket's own case
#
# Rejected, and why. The record lives here, beside the code, not only in a
# commit body nobody greps three cycles from now:
#
#   - `git status --porcelain` as a REPLACEMENT for source 1. It reports
#     working-tree-vs-HEAD, not $SINCE..HEAD, so every file changed in the range
#     but clean in the tree — most of a normal run — would vanish. Its
#     "one source of truth" appeal is real but it is truth about the wrong
#     question. Unioned in, it is source 3 with a harder parse.
#   - Refusing to run at all when an untracked surface file is present. Loud,
#     but it provides no detection whatsoever — only a demand that the operator
#     commit first — and it makes the audit unusable while editing, which is
#     when a coverage gap is cheapest to fix.
#   - Giving source 3 a `--diff-filter` counterpart. It needs none: a path git
#     has never recorded can only ever be an addition, so `--others` yields
#     exactly the `A` subset the filter would have selected. That equivalence is
#     by construction on the FILTER axis — and NOT on the path axis, which is
#     why `--full-name` is here and why the toplevel assertion above exists.
#
# De-duplicated with awk, not `sort -u`: `git rm --cached` on a path committed
# after the baseline puts it in BOTH source 1 and source 3, and the report's
# order is fixed on purpose (two runs on one tree must print identically).
# A failing query is NOT an empty tree. The original collection ended
# `2>/dev/null || true`, so a fatal `git` produced the same empty string a clean
# repository does — and an empty CHANGED prints
# `✓ no user-visible surface changes` and exits 0. A green gate produced by a
# broken query is this ticket's own defect class, and the idiom was about to be
# copied onto two new sources. `_common.sh` already settled the rule for this
# situation in the opposite direction: a failed read is a finding, not an empty
# file.
#
# Exit 2, not 1: "could not run" is not "found nothing", and
# .specnaut/release/preflight.sh already branches on that difference. The rc is
# captured at TOP LEVEL — `exit` inside a `$( )` would only leave the subshell,
# and the assignment would carry on with a partial result.
_collection_failed() {
  echo "audit.sh: the $1 collection failed (git exit $2)." >&2
  echo "  A failed query and a clean tree produce the same empty result, and the" >&2
  echo "  verdict would have been GREEN. Refusing to report success." >&2
  exit 2
}
_rc=0
_tracked_changed=$("${GIT_SRC[@]}" diff --name-only --diff-filter=AMR "$SINCE..HEAD" -- \
  "${SURFACE_PATHSPEC[@]}" 2>/dev/null) || _rc=$?
[ "$_rc" -eq 0 ] || _collection_failed "tracked-since-baseline" "$_rc"
_rc=0
STAGED_SET=$("${GIT_SRC[@]}" diff --name-only --diff-filter=AMR --cached HEAD -- \
  "${SURFACE_PATHSPEC[@]}" 2>/dev/null) || _rc=$?
[ "$_rc" -eq 0 ] || _collection_failed "staged" "$_rc"
_rc=0
UNTRACKED_SET=$("${GIT_SRC[@]}" ls-files --others --exclude-standard --full-name -- \
  "${SURFACE_PATHSPEC[@]}" 2>/dev/null) || _rc=$?
[ "$_rc" -eq 0 ] || _collection_failed "untracked" "$_rc"

# `length`, not `NF`. Both drop the blank lines an empty source contributes, but
# `NF` also drops a line that is entirely blanks — safe only because every
# SURFACE_PATHSPEC entry happens to begin with a non-blank byte, which is a
# different decision-table row's invariant. `length` depends on nothing.
#
# This one has NO test, and that is stated rather than papered over: a path whose
# entire rendering is blanks cannot exist under a pathspec whose every entry
# starts with a non-blank byte, so the two filters are indistinguishable on any
# tree reachable today. The red battery confirmed it — swapping `length` back to
# `NF` leaves the suite green. The change is precision, not a fix, and it stops
# the filter depending on a fact stated four hundred lines away.
#
# The filter is load-bearing, not tidiness: without it the first blank line
# survives, CHANGED is non-empty on a genuinely clean tree, and the report says
# "every surface change has a matching smoke assertion" where it should say
# "no user-visible surface changes since <tag>".
# shellcheck disable=SC2034 # audit.sh reads it: the coverage scan walks it
CHANGED=$(printf '%s\n%s\n%s\n' "$_tracked_changed" "$STAGED_SET" "$UNTRACKED_SET" \
  | awk 'length && !seen[$0]++')

# A path's ORIGIN, for the report TEXT only (#564). It touches no counter and no
# term in the verdict `if` at the bottom of this file: an uncommitted file with
# no assertion is fatal through exactly the path a committed one is. What this
# buys is that the report says WHICH — otherwise a brand-new file prints
# identically to a landed one, and the natural repair for a red gate naming a
# file that was never meant to exist is to add an assertion for it.
#
# Written as `case` over a newline-wrapped string rather than `printf | grep -qxF`:
# this script runs under `set -euo pipefail`, and `grep -q` exits at the first
# match, SIGPIPE-ing its producer — the hazard already documented at audit.sh's
# coverage grep.
origin_note() {
  # An empty argument would make needle == haystack against an empty set and
  # print `(untracked)` for nothing. The only thing preventing that today is a
  # `[ -z "$f" ] && continue` in audit.sh's coverage loop.
  [ -n "${1:-}" ] || return 0
  case "$1" in
    # `ls-files --others` emits an untracked directory that is ITSELF a git
    # repository as `<dir>/`, with a trailing slash and its contents suppressed.
    # It reaches the unmapped bucket and is fatal there either way; naming the
    # cause is what stops the maintainer's repair being a .gitignore entry,
    # which would hide the tree rather than map it.
    */) printf ' (untracked nested repository — its contents are not enumerated)'; return 0 ;;
  esac
  case "
$UNTRACKED_SET
" in
    *"
$1
"*) printf ' (untracked)'; return 0 ;;
  esac
  case "
$STAGED_SET
" in
    *"
$1
"*) printf ' (staged, not committed)'; return 0 ;;
  esac
  # Explicit, because two of the five call sites are bare assignments
  # (`unmapped_list=…`, `outside_list=…`) where a simple command consisting only
  # of assignments takes the substitution's status — so under `set -e` one added
  # trailing command in here would abort the audit mid-scan.
  return 0
}
