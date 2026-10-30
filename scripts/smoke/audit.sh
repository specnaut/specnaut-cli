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
# shellcheck disable=SC2046 # one variable name per word: the split is the point
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
# Its own file, beside this script like _common.sh — never $SMOKE_DIR, which
# smoke-audit.sh points at a synthetic suite.
. "$(dirname "$0")/_surfaces.sh"

# --- The collection: one git prefix, one pathspec, three sources (#564) ---
# Its own file, beside this script: it sets GIT_SRC, SURFACE_PATHSPEC, CHANGED,
# STAGED_SET and UNTRACKED_SET, and defines origin_note.
. "$(dirname "$0")/_audit_collect.sh"

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

# What identifies a changed file for coverage (plan.md §5 024-R1): its own file,
# reading only its argument. Beside this script, like _common.sh — never $SMOKE_DIR.
. "$(dirname "$0")/_coverage_token.sh"

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

# --- The stale-assertion and unread-capture scans -------------------------
# Its own file, beside this script: it sets stale_count and unread_count.
. "$(dirname "$0")/_audit_smoke_scans.sh"

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
