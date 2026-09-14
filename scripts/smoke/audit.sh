#!/usr/bin/env bash
# Audit smoke-test coverage by diffing the working tree against the last
# release tag. Reports two lists:
#
#   1. Coverage gaps   — user-visible surface changed since <baseline> but
#                        no smoke-*.sh references the new file's basename.
#   2. Stale assertions — smoke scripts mention runtime paths whose source
#                         counterpart under templates/core/ no longer exists.
#
# Output only — never edits smoke scripts. The maintainer decides what to do
# with each finding (add a check, prune a stale one, or accept the gap).
#
# Usage:
#   audit.sh                 # diff against the most recent v*.*.* tag
#   audit.sh --since <ref>   # override baseline (e.g. another tag, sha, branch)
#
# Exit codes:
#   0  clean — no stale assertion, no un-allow-listed coverage gap
#   1  findings, or an unexpected error
#   2  could not run — the baseline ref did not resolve, or a collection query
#      failed. NOT a findings verdict: an unanswerable question is not a clean
#      tree, and this script refuses to report one as the other.
#   3  --src-root is not a usable work tree — not a git repository, or not that
#      repository's toplevel (`git ls-files` is cwd-relative where `git diff` is
#      root-relative, so a subdirectory makes the two halves of the collection
#      name different things)
#
# The exit code IS the verdict (plan.md §5 R5). It used to be 0 regardless
# of findings, with `.specnaut/release/preflight.sh` re-deriving pass/fail by
# grepping this script's stdout — two spellings of one rule, and the caller
# held the authoritative one. A caller that must parse a report to learn
# whether it failed is a caller that will eventually parse it wrong.
#
# Heuristics live in `scripts/smoke/README.md` ("Audit heuristics"), beside
# this script. They used to live in the monorepo-root test-sandbox skill,
# which meant a clone of this repository had the gate but not its rules.
set -euo pipefail

# Path resolution has one home (plan.md §5 R1); this script's source tree is
# an explicit PARAMETER with a default (R2), never an ambient value.
#
# It used to be derived from the CALLER'S cwd via `git rev-parse
# --show-toplevel`, so the same invocation answered differently depending on
# where you stood. Deriving it from this file's own location instead would
# only have swapped one invisible input for another — and would have broken
# smoke-audit.sh, which points the audit at a synthetic tree. Injection
# removes the class rather than moving it.
. "$(dirname "$0")/_common.sh"

SINCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --smoke-dir)
      SMOKE_DIR="${2:-}"
      [ -n "$SMOKE_DIR" ] || { echo "audit.sh: --smoke-dir needs a directory" >&2; exit 1; }
      [ -d "$SMOKE_DIR" ] || { echo "audit.sh: --smoke-dir '$SMOKE_DIR' is not a directory" >&2; exit 1; }
      SMOKE_DIR="$(cd "$SMOKE_DIR" && pwd)"
      shift 2
      ;;
    --src-root)
      SRC_ROOT="${2:-}"
      [ -n "$SRC_ROOT" ] || { echo "audit.sh: --src-root needs a directory" >&2; exit 1; }
      [ -d "$SRC_ROOT" ] || { echo "audit.sh: --src-root '$SRC_ROOT' is not a directory" >&2; exit 1; }
      SRC_ROOT="$(cd "$SRC_ROOT" && pwd)"
      shift 2
      ;;
    --since)
      SINCE="${2:-}"
      [ -n "$SINCE" ] || { echo "audit.sh: --since needs a ref" >&2; exit 1; }
      shift 2
      ;;
    -h|--help)
      sed -n '2,/^set -/p' "$0" | sed 's/^# \{0,1\}//;/^set -/d'
      exit 0
      ;;
    *)
      echo "audit.sh: unknown flag '$1' (try --help)" >&2
      exit 1
      ;;
  esac
done

# The source tree is a PARAMETER, and git has three environment variables that
# quietly override one. `git -C <dir>` does NOT beat an ambient `GIT_DIR`:
# measured on this repository, exporting GIT_DIR at another repo made this
# script take that repo's tag as the baseline and report 28 TRACKED files as
# "(untracked)", with ten fabricated coverage gaps. The header above states the
# rule this restores — "an explicit PARAMETER with a default (R2), never an
# ambient value" — and until #564 gave the collection a second git query the
# breach was invisible, because only the baseline lookup could see it.
#
# Unset once, here, rather than neutralised per invocation: six `git -C` calls
# in this file sit outside the shared prefix, one of them the toplevel
# assertion immediately below, and an enumeration of call sites is exactly the
# shape that goes blind when the seventh is added.
#
# The list comes from GIT ITSELF. The first version of this line named three
# variables by hand and the review found it missing two that repoint the script
# identically — `GIT_COMMON_DIR` (refs, config and objects) and
# `GIT_OBJECT_DIRECTORY`. Replacing an enumeration hazard with a shorter
# enumeration is not a fix. `--local-env-vars` needs no repository, cannot go
# stale, and covers fifteen variables including all five reachable here.
unset $(git rev-parse --local-env-vars 2>/dev/null)

if ! git -C "$SRC_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "audit.sh: '$SRC_ROOT' is not a git work tree" >&2
  exit 3
fi

# --src-root must be the TOPLEVEL, not merely somewhere inside a work tree
# (#564). `git diff --name-only` emits root-relative paths; `git ls-files`
# emits cwd-relative ones. From a subdirectory the two halves of the
# collection below speak different vocabularies -- the tracked half matches a
# SURFACES glob and the untracked half does not, so it lands in the unmapped
# bucket naming a path that does not exist. `--full-name` fixes the
# rendering; this fixes the class, and it is the same discipline the header
# states for $SRC_ROOT itself: an explicit parameter, never an ambient value.
#
# Exit 3 already means "--src-root is not usable" and
# .specnaut/release/preflight.sh already branches on it, so no fourth code.
# Both sides are resolved with `pwd -P`: on macOS /tmp is a symlink to
# /private/tmp, and `git rev-parse --show-toplevel` answers physically while
# `cd && pwd` answers logically.
_toplevel="$(git -C "$SRC_ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$_toplevel" ] \
  || [ "$(cd "$SRC_ROOT" && pwd -P)" != "$(cd "$_toplevel" && pwd -P)" ]; then
  echo "audit.sh: --src-root '$SRC_ROOT' is not the toplevel of its work tree" >&2
  echo "  toplevel is: ${_toplevel:-<unresolved>}" >&2
  exit 3
fi

# --- What gets scanned (plan.md §5 R3) ----------------------------------
# Membership is ENUMERATED from $SMOKE_DIR, and SUITE_FILES is checked
# against that enumeration rather than trusted as a second list.
#
# Two lists that must agree is the duplication this table exists to forbid.
# One list plus a check is not: the check is what turns "somebody added a
# smoke and never wired it into the suite" from a silent omission into a
# finding. `--smoke-dir` points this at a foreign directory (only the
# meta-test does), and there the declaration does not apply.
scanned_files=""
for _f in "$SMOKE_DIR"/smoke-*.sh; do
  [ -f "$_f" ] || continue
  scanned_files="$scanned_files$(basename "$_f")
"
done
[ -f "$SMOKE_DIR/_common.sh" ] && scanned_files="${scanned_files}_common.sh
"

membership_drift=""
if [ "$SMOKE_DIR" = "$DEFAULT_SMOKE_DIR" ]; then
  for _f in $(printf '%s' "$scanned_files" | grep -v '^_common.sh$' || true); do
    case "
$SUITE_FILES
" in
      *"
$_f
"*) ;;
      *) membership_drift="$membership_drift  - $_f exists but is not in SUITE_FILES — run-all.sh never runs it
" ;;
    esac
  done
  for _f in $SUITE_FILES; do
    [ -f "$SMOKE_DIR/$_f" ] || membership_drift="$membership_drift  - $_f is in SUITE_FILES but does not exist
"
  done
fi

if [ -z "$SINCE" ]; then
  SINCE=$(git -C "$SRC_ROOT" tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-version:refname | head -1 || true)
  if [ -z "$SINCE" ]; then
    echo "audit.sh: no v*.*.* tag found and no --since override" >&2
    exit 2
  fi
fi

if ! git -C "$SRC_ROOT" rev-parse --verify "$SINCE^{commit}" >/dev/null 2>&1; then
  echo "audit.sh: ref '$SINCE' could not be resolved" >&2
  exit 2
fi

# Guarded for the same reason the collections below are (#564). These were bare
# substitutions, so a repository whose HEAD does not resolve — a dangling
# symbolic-ref, an unborn branch — killed the script under `set -e` with git's
# own raw fatal and exit 128. That is a code no caller understands:
# .specnaut/release/preflight.sh branches on 1, 2 and 3, and would have read 128
# as an unexpected error rather than "this tree cannot be audited".
_rc=0
HEAD_SHORT=$(git -C "$SRC_ROOT" rev-parse --short HEAD 2>/dev/null) || _rc=$?
BASE_SHORT=$(git -C "$SRC_ROOT" rev-parse --short "$SINCE^{commit}" 2>/dev/null) || _rc=$?
if [ "$_rc" -ne 0 ]; then
  echo "audit.sh: cannot resolve HEAD or '$SINCE' in '$SRC_ROOT' (git exit $_rc)." >&2
  echo "  Nothing can be compared, so there is no verdict to report." >&2
  exit 2
fi

echo "test-sandbox audit"
echo "  baseline: $SINCE ($BASE_SHORT)"
echo "  head:     HEAD ($HEAD_SHORT)"
echo

# --- Surface map ----------------------------------------------------------
# Each entry: <glob>|<smoke-script-list>|<kind>. The audit walks the diff,
# matches each changed file against the first glob it fits, and asserts that
# at least one of the listed smoke scripts mentions the file's basename. If
# none do, that's a coverage gap.
SURFACES=(
  'templates/core/agents/*.md|smoke-features.sh smoke-all-harnesses.sh|bundled-agent'
  'templates/core/commands/*.md|smoke-features.sh|bundled-command'
  'templates/core/skills/*/SKILL.md|smoke-features.sh|bundled-skill'
  'templates/core/skills/specnaut/phases/*.md|smoke-features.sh|phase-doc'
  'templates/core/skills/ship/SKILL.md|smoke-tag-release.sh|bundled-skill'
  'templates/core/skills/ship/phases/*.md|smoke-tag-release.sh|ship-doc'
  'templates/core/skills/ship/scripts/*|smoke-tag-release.sh|tag-release-script'
  'templates/core/skills/board/scripts/github/*|smoke-backlog-github.sh|github-backlog-script'
  'templates/core/skills/board/scripts/gitlab/*|smoke-backlog-gitlab.sh|gitlab-backlog-script'
  'templates/core/skills/board/scripts/local/*|smoke-backlog-local.sh|local-backlog-script'
  # #563: this directory had NO glob and NO smoke, so every script the
  # cloud backend ships was asserted on by nothing — and the coverage scan
  # could not report it, because an unclaimed directory is invisible to a
  # map keyed on claims.
  'templates/core/skills/board/scripts/cloud/*|smoke-backlog-cloud.sh|cloud-backlog-script'
  'templates/core/hooks/*|smoke-hooks.sh|bundled-hook'
  'templates/core/specnaut/scripts/*/*|smoke-features.sh|specnaut-helper-script'
  'templates/core/specnaut/LABELS.md|smoke-features.sh smoke-backlog-github.sh smoke-backlog-gitlab.sh|labels-doc'
  # Categories that ship and were claimed by no glob. Explicit, NOT
  # `templates/core/specnaut/*.md` or `skills/*/*.md`: `case` globs traverse
  # `/`, so those swallow the whole scaffolded memory tree and turn 150
  # documents into gaps against a smoke that never claimed them.
  'templates/core/root/*|smoke-features.sh smoke-all-harnesses.sh|project-root-file'
  'templates/core/skills/using-specnaut/references/*|smoke-features.sh|skill-reference'
  'templates/core/skills/code-audit/scripts/*|smoke-features.sh|skill-script'
  # #562 split two contracts out of the board skill. The map used to name
  # `groom.md` alone, so a sibling doc added beside it was UNMAPPED — nothing
  # asserted about it and nothing said so. A glob covers the next one too.
  'templates/core/skills/board/*.md|smoke-backlog-github.sh|board-skill-doc'
  'templates/core/specnaut/templates/*|smoke-features.sh|scaffold-template'
  'templates/core/specnaut/backlog.md|smoke-backlog-local.sh|specnaut-root-doc'
  'templates/core/specnaut/logs/README.md|smoke-features.sh|specnaut-root-doc'
  # A per-project declaration file, named individually rather than as
  # `templates/core/specnaut/*.yml`. There is exactly one today, and a glob
  # here would claim the next one silently — which is the opposite of what
  # the unmapped class is for.
  'templates/core/specnaut/gates.yml|smoke-features.sh|specnaut-config'
  # Harness-specific artefacts. The pathspec ignored this whole tree until
  # #551 — twelve shipped files, including all three bundled hooks, that the
  # coverage scan had never once looked at while its success line claimed
  # otherwise.
  'templates/harness-specific/*/hooks/*|smoke-hooks.sh|bundled-hook'
  'templates/harness-specific/*/scripts/*|smoke-features.sh|harness-script'
  'templates/harness-specific/*/*|smoke-features.sh smoke-all-harnesses.sh|harness-file'
)

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
# match, SIGPIPE-ing its producer — the hazard already documented at the
# coverage grep below.
origin_note() {
  # An empty argument would make needle == haystack against an empty set and
  # print `(untracked)` for nothing. The only thing preventing that today is a
  # `[ -z "$f" ] && continue` in a different loop, a hundred lines away.
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

# --- Coverage-gap allowlist (plan.md §5 R13) ----------------------------
ALLOWLIST="$SMOKE_DIR/coverage-allowlist.txt"

# Echo the recorded reason if $1 is allow-listed; return 1 otherwise.
# An entry with no reason is NOT an entry — that is what stops the file
# degrading into a list of paths somebody added to make the gate quiet.
allow_reason() {
  [ -f "$ALLOWLIST" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    entry="${line%%[[:space:]]*}"
    [ "$entry" = "$1" ] || continue
    reason="$(printf '%s' "${line#"$entry"}" | sed 's/^[[:space:]]*//')"
    [ -n "$reason" ] || return 1
    printf '%s' "$reason"
    return 0
  done < "$ALLOWLIST"
  return 1
}

# --- What identifies a changed file for coverage (plan.md §5 024-R1) -----
# Almost every surface is identified by its basename, and that is deliberate,
# not sloppiness this scan tolerates: the smokes' loop lists were written out
# with literal names SO THIS GREP COULD FIND THEM — said in as many words at
# smoke-backlog-gitlab.sh:33 and smoke-features.sh:74. Matching the runtime
# path a source file scaffolds to would be invisible to those loops; measured
# over the v3.1.0 window it reports 9 false gaps out of 44.
#
# One surface has a basename that identifies nothing. Every skill's file is
# named SKILL.md, a string this suite contains by the dozen, so the test was
# constant-true for all of them and 13 shipped skills were asserted on by
# nothing at all. There the token is the runtime path suffix.
#
# NOT the bare skill name. `backlog-reference-contract` is named at
# smoke-features.sh:591 inside an assertion whose subject is BOARD's SKILL.md
# — delete the skill and that assertion still passes — so the bare name would
# report covered exactly the file this fix exists for. Both plan-time audits
# found that independently.
#
# What this measures is a MENTION, not an assertion (024-R4). Verifying that
# an assertion's subject is the file would mean parsing the smoke, which is
# the line this suite has declined to cross every time it has come up.
coverage_token() {
  case "$1" in
    templates/harness-specific/*)
      # The runtime path, not the basename: CLAUDE.md, AGENTS.md and
      # settings.json all exist elsewhere in the bundle, so a basename token
      # matches assertions about a different file — the collapse #547 removed
      # for SKILL.md and #549 for logs/README.md, a third time.
      _rest="${1#templates/harness-specific/}"
      case "$_rest" in
        claude/*)  echo ".claude/${_rest#claude/}" ;;
        codex/*)   echo ".codex/${_rest#codex/}" ;;
        # cursor nests its rules a level deeper than the source tree does,
        # so a mechanical `.cursor/<rest>` token names a path that is never
        # written and can never match an assertion.
        cursor/specify-rules.mdc) echo ".cursor/rules/specify-rules.mdc" ;;
        cursor/*)  echo ".cursor/${_rest#cursor/}" ;;
        *)         echo "$_rest" ;;
      esac
      ;;
    templates/core/specnaut/logs/*)
      # `README.md` as a token matches assertions about OTHER READMEs — the
      # same collapse #547 removed for SKILL.md, one directory over. Emit the
      # runtime path suffix instead.
      echo "specnaut/logs/${1#templates/core/specnaut/logs/}"
      ;;
    templates/core/skills/*/SKILL.md)
      _n="${1#templates/core/skills/}"
      # `case` globs match `/`, so a hypothetical nested SKILL.md reaches here
      # too. Its token stays exact rather than collapsing to a name — a token
      # is all this is used for, so a longer one is precise, not wrong.
      echo "skills/${_n}"
      ;;
    *) basename "$1" ;;
  esac
}

gaps_count=0
allowed_count=0
unmapped_count=0
unmapped_list=""
outside_count=0
outside_list=""
echo "## Coverage scan"
echo
if [ -z "$CHANGED" ]; then
  echo "  ✓ no user-visible surface changes since $SINCE"
else
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    matched_glob=""
    smokes=""
    kind=""
    for entry in "${SURFACES[@]}"; do
      glob="${entry%%|*}"
      rest="${entry#*|}"
      candidate_smokes="${rest%%|*}"
      candidate_kind="${rest##*|}"
      # shellcheck disable=SC2254
      case "$f" in
        $glob)
          matched_glob="$glob"
          smokes="$candidate_smokes"
          kind="$candidate_kind"
          break
          ;;
      esac
    done
    if [ -z "$matched_glob" ]; then
      # Reported, counted, and FATAL (#549, Kevin's call over the recommendation
      # to keep it advisory). It used to `continue` in silence, then became
      # non-fatal on the reasoning that "a new category with no recourse would
      # block legitimate work". That premise was false: the recourse is the one
      # an uncovered mapped file already has — an allow-list entry carrying a
      # written reason, which 022-R13 refuses to accept without one.
      #
      # Cost accepted: a genuinely new category of shipped file blocks until
      # someone maps it or writes down why it is exempt. Cost refused: a file
      # nothing asserts on leaving through a green gate, which is how a
      # non-ASCII path escaped this scan entirely.
      # Named category exemptions, in code rather than the allow-list because
      # that file matches exact paths and these are whole trees — a hundred
      # entries would make it the dumping ground 022-R13 exists to prevent.
      case "$f" in
        # manifest.json is the bundle's own category index, not a user-facing
        # surface — it changes on essentially every release and no smoke could
        # meaningfully "cover" it.
        templates/manifest.json) ;;
        # The scaffolded knowledge base is copied verbatim and read by agents,
        # never executed. A smoke can assert the tree arrives; asserting each
        # document's prose is a category error.
        templates/core/specnaut/memory/*) ;;
        # Product source. #544 added src/cli/ to the pathspec precisely so
        # these changes would be VISIBLE here, and that decision stands — but
        # they must not be FATAL: the smoke suite tests scaffolded output, not
        # this repository's TypeScript, which the 1400-test deno suite covers.
        # So they are counted separately: reported, never silent, never fatal.
        src/cli/*)
          outside_count=$((outside_count + 1))
          outside_list="$outside_list  - $f$(origin_note "$f")
"
          ;;
        *)
          # Everything else the pathspec above collected. It used to say
          # `templates/core/*` here, which silently excluded `src/cli/` — a
          # path the diff DOES collect. So the section that exists to make the
          # map's blind spots visible had a blind spot of its own, and the
          # audit reported "every surface change has a matching smoke
          # assertion" about CLI changes it had never mapped.
          # The allow-list is the escape hatch for this class too (#549 AC4).
          # Making the bucket fatal without consulting it would leave the
          # documented recourse unimplemented — and the witness for it passing
          # because the rule was never reached, not because it works.
          if reason="$(allow_reason "$f")"; then
            allowed_count=$((allowed_count + 1))
            printf '  ~ %s%s (unmapped, allow-listed)\n      reason: %s\n' "$f" "$(origin_note "$f")" "$reason"
          else
            unmapped_count=$((unmapped_count + 1))
            unmapped_list="$unmapped_list  - $f$(origin_note "$f")
"
          fi
          ;;
      esac
      continue # nothing else reaches here: the pathspec bounds what is scanned
    fi
    base="$(coverage_token "$f")"
    covered=0
    for s in $smokes; do
      [ -f "$SMOKE_DIR/$s" ] || continue
      # A comment is not an assertion (plan.md §5 023-R1). The definition of
      # "code in a smoke script" has one home, in _common.sh; this is one of
      # its two askers. It used to be a bare `grep -qF "$base" "$SMOKE_DIR/$s"`
      # over the whole file, so a basename occurring only in a comment — even
      # one saying the file is deliberately uncovered — counted as coverage.
      #
      # Captured into a variable rather than piped into `grep -q`: this script
      # runs under `set -euo pipefail`, and `grep -q` exits at the first match,
      # SIGPIPE-ing the producer. pipefail would then report 141 for a run that
      # FOUND the string — turning every covered file into a gap, sometimes,
      # depending on how fast the producer got there.
      # Guarded: this script runs under `set -e`, so an unreadable smoke would
      # abort the whole audit with the helper's rc 2 — a code this file's own
      # header reserves for "baseline ref could not be resolved", and which
      # .specnaut/release/preflight.sh branches on. Skipping the smoke leaves
      # the file uncovered, so the run still fails, with the right code and a
      # named reason.
      if ! code="$(smoke_code_lines "$SMOKE_DIR/$s")"; then
        echo "audit.sh: cannot read $s — it vouches for nothing" >&2
        continue
      fi
      if grep -qF -- "$base" <<<"$code"; then
        covered=1
        break
      fi
    done
    if [ "$covered" -eq 0 ]; then
      if reason="$(allow_reason "$f")"; then
        allowed_count=$((allowed_count + 1))
        printf '  ~ %s%s (allow-listed)\n      reason: %s\n' "$f" "$(origin_note "$f")" "$reason"
      else
        gaps_count=$((gaps_count + 1))
        printf '  - %s%s\n      kind: %s\n      expected coverage in: %s\n' "$f" "$(origin_note "$f")" "$kind" "$smokes"
      fi
    fi
  done <<<"$CHANGED"
  if [ "$gaps_count" -eq 0 ]; then
    echo "  ✓ every surface change has a matching smoke assertion"
  fi
fi

echo
echo "## Stale-assertion scan"
echo

# Map each runtime path to its candidate source paths under templates/.
# If NO candidate exists, the smoke is asserting against a moved/deleted file.
# Returns 0 (path resolves) or 1 (stale).
#
# `.claude/...` paths can scaffold from EITHER templates/core/ OR
# templates/harness-specific/<harness>/ (the harness-specific tree wins on
# overlap). The resolver checks both.
resolves() {
  local rt="$1"
  # Captured rather than piped into `grep -q`: this script runs under
  # `set -euo pipefail`, and `grep -q` exits at the first match, SIGPIPE-ing
  # `find`. pipefail then reports 141 for a run that FOUND the file, and the
  # caller reads that as "does not resolve" — a stale-assertion finding
  # manufactured out of a path that resolves. Same hazard as the coverage grep
  # below; see the commit body for the witness.
  local hits
  # Strip trailing slash — directory references in `[ -d ... ]` checks are
  # not stale signals; they're shape assertions on the runtime tree.
  case "$rt" in */) return 0 ;; esac
  case "$rt" in
    .claude/agents/*.md)
      local n="${rt#.claude/agents/}"
      [ -f "$SRC_ROOT/templates/core/agents/$n" ] && return 0
      hits="$(find "$SRC_ROOT/templates/harness-specific" -path "*/agents/$n" 2>/dev/null || true)"
      [ -n "$hits" ]
      ;;
    .claude/commands/*.md)
      local n="${rt#.claude/commands/}"
      [ -f "$SRC_ROOT/templates/core/commands/$n" ] && return 0
      hits="$(find "$SRC_ROOT/templates/harness-specific" -path "*/commands/$n" 2>/dev/null || true)"
      [ -n "$hits" ]
      ;;
    .claude/skills/*/SKILL.md)
      local n="${rt#.claude/skills/}"
      n="${n%/SKILL.md}"
      [ -f "$SRC_ROOT/templates/core/skills/$n/SKILL.md" ] && return 0
      hits="$(find "$SRC_ROOT/templates/harness-specific" -path "*/skills/$n/SKILL.md" 2>/dev/null || true)"
      [ -n "$hits" ]
      ;;
    .claude/skills/*/phases/*.md)
      # Owner-generic since spec 033: a phase document belongs to whichever
      # skill owns it, not to `specnaut`. A pattern naming one owner reports
      # every other skill's documents as stale assertions.
      local rest="${rt#.claude/skills/}"
      [ -f "$SRC_ROOT/templates/core/skills/$rest" ]
      ;;
    .claude/hooks/*)
      local n="${rt#.claude/hooks/}"
      [ -e "$SRC_ROOT/templates/core/hooks/$n" ] && return 0
      hits="$(find "$SRC_ROOT/templates/harness-specific" -path "*/hooks/$n" 2>/dev/null || true)"
      [ -n "$hits" ]
      ;;
    .claude/scripts/*)
      local n="${rt#.claude/scripts/}"
      [ -e "$SRC_ROOT/templates/core/scripts/$n" ] && return 0
      hits="$(find "$SRC_ROOT/templates/harness-specific" -path "*/scripts/$n" 2>/dev/null || true)"
      [ -n "$hits" ]
      ;;
    .claude/loop.md)
      [ -f "$SRC_ROOT/templates/core/loop.md" ] && return 0
      hits="$(find "$SRC_ROOT/templates/harness-specific" -name "loop.md" 2>/dev/null || true)"
      [ -n "$hits" ]
      ;;
    .claude/settings.json|.claude/settings.local.json)
      return 0 # merged at init time from per-harness logic; no single source file
      ;;
    .specnaut/scripts/backlog/*)
      local n="${rt#.specnaut/scripts/backlog/}"
      hits="$(find "$SRC_ROOT/templates/core/skills/board/scripts" -name "$(basename "$n")" 2>/dev/null || true)"
      [ -n "$hits" ]
      ;;
    .specnaut/scripts/bash/*|.specnaut/scripts/powershell/*)
      local n="${rt#.specnaut/scripts/}"
      [ -e "$SRC_ROOT/templates/core/specnaut/scripts/$n" ]
      ;;
    .specnaut/LABELS.md)
      [ -f "$SRC_ROOT/templates/core/specnaut/LABELS.md" ]
      ;;
    .specnaut/installed.lock|.specnaut/backlog-config.yml|.specnaut/feature.json|.specnaut/logs/*|.specnaut/specs/*|.specnaut/backlog.md|.specnaut/backlog/*)
      return 0 # generated at runtime, not in source tree
      ;;
    *)
      return 0 # outside the resolver's known map — don't false-flag
      ;;
  esac
}

stale_count=0
# Enumerated above, and it includes _common.sh: a path assertion hoisted into
# the shared header would otherwise be invisible to the very scan that exists
# to catch stale ones.
for smoke_name in $scanned_files; do
  smoke="$SMOKE_DIR/$smoke_name"
  # The audit's own meta-test plants deliberately-fake `.claude/agents/baseline-*.md`
  # references inside heredocs to verify the staleness scan reports them. Audit-ing
  # the auditor would always flag those as a false positive — skip it.
  [ "$smoke_name" = "smoke-audit.sh" ] && continue
  while IFS= read -r path_ref; do
    [ -z "$path_ref" ] && continue
    if ! resolves "$path_ref"; then
      # A path the smoke ONLY ever asserts the absence of is not stale — it is
      # the correct assertion for a deliberately removed artefact, and the
      # scan used to forbid writing it. `#533` retired two command shims and
      # the right check became `[ ! -e … ]`; flagging that as staleness leaves
      # a removal with no assertion at all, which is how a file comes back.
      #
      # Counted per occurrence, not per line: one line legitimately asserts
      # that groom.md is present in its new home AND absent from its old one.
      esc="$(printf '%s' "$path_ref" | sed 's/[.[\*^$]/\\&/g')"
      # `|| true` on both: this script runs under `set -euo pipefail`, and a
      # grep that matches nothing exits 1, which pipefail propagates and `set
      # -e` turns into an abort. The first version had it only where a match
      # was guaranteed, so the scan died on the first path nothing negated —
      # printing its header, no findings, and no summary. Zero findings and a
      # dead scan look identical unless you count the summary lines.
      total="$( { grep -oF -- "$path_ref" "$smoke" || true; } | wc -l | tr -d ' ')"
      negated="$( { grep -oE "! *-[efdsx] +$esc|! *grep[^&|]*$esc" "$smoke" || true; } | wc -l | tr -d ' ')"
      if [ "$total" = "$negated" ]; then
        continue
      fi
      stale_count=$((stale_count + 1))
      printf '  - %s references %s\n      no source file under templates/core/\n' "$smoke_name" "$path_ref"
    fi
  done < <(grep -hoE "(\\.specnaut|\\.claude)/[A-Za-z0-9._/-]+" "$smoke" 2>/dev/null | sort -u)
done

if [ "$stale_count" -eq 0 ]; then
  echo "  ✓ no stale assertions detected"
fi

echo
echo "## Unread-capture scan"
echo
# An assertion that cannot fail is worth less than no assertion, because it
# reads as coverage. #546 shipped three of them into the ticket whose subject
# was assertions that do not assert, and every one was found by hand-mutating
# the code until it was supposed to go red. Nothing in the suite, in
# shellcheck, or in two plan-time audits saw any of them.
#
# This is one lexical shape of that class, and the only one a grep can decide:
# a `name=$(...)` capture whose ONLY reader is inside a `fail` call. A `fail`
# runs after the assertion has already decided, so such a value never
# influenced a verdict — it is a diagnostic wearing an assertion's clothes.
# That is exactly the `clean_out` defect #546's AC4 fixed by hand.
#
# 024-R4 still binds: this proves a captured value is READ somewhere, not that
# the comparison it feeds is meaningful. The finding says "captured but never
# read outside fail" and claims nothing more. Mutation testing is the complete
# answer and a far larger ticket (#550, Out of scope).
unread_count=0
# The stale scan's list plus run-all.sh: it carries `fail` calls of its own
# (the FR-001 boundary check), so it can hold this defect. It is left out of
# $scanned_files because that list drives the path-staleness scan, and
# widening it there would change a second, unrelated verdict.
capture_files="$scanned_files"
[ -f "$SMOKE_DIR/run-all.sh" ] && capture_files="${capture_files}run-all.sh
"
# DEFAULT_SMOKE_DIR, not SMOKE_DIR. `--smoke-dir` points the audit at a
# synthetic tree of fixtures; the scan's own program is not a fixture and does
# not live there. Resolving it through SMOKE_DIR made awk fail silently on
# every meta-test run, the pipeline produce nothing, and the section print
# "✓ every captured value is read outside a fail diagnostic" — a scan that
# could not find itself reporting clean. Caught by 3k going red, which is the
# only reason the control was built.
CAPTURE_AWK="$DEFAULT_SMOKE_DIR/unread-captures.awk"
if [ ! -r "$CAPTURE_AWK" ]; then
  echo "  - $CAPTURE_AWK is missing or unreadable — the unread-capture scan did NOT run"
  unread_count=$((unread_count + 1))
  capture_files=""
fi
for smoke_name in $capture_files; do
  smoke="$SMOKE_DIR/$smoke_name"
  # Same reason smoke-audit.sh is skipped by the stale scan: its heredocs
  # carry deliberately-defective shell as fixtures for THIS check.
  [ "$smoke_name" = "smoke-audit.sh" ] && continue
  if ! code="$(smoke_code_lines "$smoke")"; then
    echo "  - $smoke_name could not be read — the unread-capture scan did NOT inspect it"
    unread_count=$((unread_count + 1))
    continue
  fi
  scan_rc=0
  scan_out="$(printf '%s\n' "$code" | awk -f "$CAPTURE_AWK" 2>&1 | sort -t'|' -k2 -n)" || scan_rc=$?
  if [ "$scan_rc" -ne 0 ]; then
    echo "  - the unread-capture scan errored on $smoke_name (awk rc=$scan_rc) — it did NOT inspect it"
    unread_count=$((unread_count + 1))
    continue
  fi
  while IFS='|' read -r nm lineno failreads; do
    [ -n "$nm" ] || continue
    unread_count=$((unread_count + 1))
    printf '  - %s:%s captures $%s, read %s time(s) and only inside a fail\n' \
      "$smoke_name" "$lineno" "$nm" "$failreads"
    printf '      a fail runs after the assertion decided, so the value never reached a verdict\n'
  done <<EOF
$scan_out
EOF
done

if [ "$unread_count" -eq 0 ]; then
  echo "  ✓ every captured value is read outside a fail diagnostic"
fi

echo
echo "## Unmapped surface"
echo
if [ "$unmapped_count" -eq 0 ]; then
  echo "  ✓ every changed file the pathspec collects fell under a mapped glob"
else
  printf '%s' "$unmapped_list"
  echo "      ↳ no glob in the SURFACES map matches these, so NOTHING was"
  echo "        asserted about them. Map them in SURFACES, or allow-list each"
  echo "        with a written reason — an entry without one is ignored."
fi

# --- Allowlist staleness (plan.md §5 R13) -------------------------------
# An allow-listed path whose file is gone is the allowlist's own version of a
# stale assertion: it silently grants an exemption nothing needs any more.
if [ "$outside_count" -gt 0 ]; then
  echo
  echo "  Outside the scaffolded surface — reported, not fatal:"
  printf '%s' "$outside_list"
  echo "      ↳ product source. The smoke suite tests scaffolded output; this"
  echo "        repository's TypeScript is covered by \`deno task test\`."
fi

echo
echo "## Suite membership"
echo
if [ -n "$membership_drift" ]; then
  printf '%s' "$membership_drift"
else
  echo "  ✓ SUITE_FILES matches the scripts on disk"
fi

echo
echo "## Allowlist scan"
echo
stale_allow_count=0
if [ -f "$ALLOWLIST" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    entry="${line%%[[:space:]]*}"
    reason="$(printf '%s' "${line#"$entry"}" | sed 's/^[[:space:]]*//')"
    if [ -z "$entry" ]; then
      echo "  - a line with no path (leading whitespace?) — ignored, and it excuses nothing"
      stale_allow_count=$((stale_allow_count + 1))
      continue
    fi
    if [ -z "$reason" ]; then
      echo "  - $entry is allow-listed with no reason — ignored, so the gap is still fatal"
      stale_allow_count=$((stale_allow_count + 1))
      continue
    fi
    if [ ! -e "$SRC_ROOT/$entry" ]; then
      echo "  - $entry no longer exists — prune this allowlist entry"
      stale_allow_count=$((stale_allow_count + 1))
    fi
  done < "$ALLOWLIST"
fi
[ "$stale_allow_count" -eq 0 ] && echo "  ✓ no stale allowlist entries"

echo
echo "## Summary"
echo "  $gaps_count coverage gap(s)"
[ "$allowed_count" -gt 0 ] && echo "  $allowed_count allow-listed gap(s) (not fatal)"
echo "  $stale_count stale assertion(s)"
echo "  $unread_count capture(s) read only inside a fail"
echo "  $stale_allow_count stale allowlist entr(y/ies)"
echo "  $unmapped_count unmapped surface change(s)"
[ "$outside_count" -gt 0 ] && echo "  $outside_count change(s) outside the scaffolded surface (not fatal)"
drift_count="$(printf '%s' "$membership_drift" | grep -c '^  - ' || true)"
echo "  $drift_count suite-membership drift(s)"
echo
# The exit code IS the verdict (plan.md §5 R5). No caller re-derives it.
if [ "$gaps_count" -gt 0 ] || [ "$stale_count" -gt 0 ] || [ "$stale_allow_count" -gt 0 ] \
   || [ "$drift_count" -gt 0 ] || [ "$unmapped_count" -gt 0 ] || [ "$unread_count" -gt 0 ]; then
  echo "Add the missing assertions, prune the stale ones, or allow-list a gap"
  echo "with a written reason in $(basename "$ALLOWLIST"), then re-run."
  echo "(audit.sh never edits smoke scripts autonomously — that is on you.)"
  exit 1
fi
exit 0
