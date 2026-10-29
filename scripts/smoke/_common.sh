# shellcheck shell=bash
# Shared header for every script under scripts/smoke/. Source it; do not run it.
#
#   . "$(dirname "$0")/_common.sh"
#
# ─── Why this file exists ────────────────────────────────────────────────
# Fifteen scripts used to open with the same four lines:
#
#   ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
#   CLI="$ROOT/apps/specnaut-cli"
#
# — a climb that hardcoded both the workspace layout AND each file's own
# depth. It is why relocating the suite was a fifteen-file edit, and why
# the suite could not run from a bare clone of this repository. Correcting
# it fifteen times would have reproduced the defect one directory deeper.
# This file is the single home for that decision (plan.md §5 R1).
#
# ─── bash 3.2 ────────────────────────────────────────────────────────────
# macOS ships bash 3.2 and the maintainer runs this suite there.
# smoke-all-harnesses.sh:19-21 already pays that cost deliberately. So:
# no `declare -A`, no `mapfile`, no `${var,,}`, no `+=` on strings.
# Code written to bash 4 passes CI on ubuntu-latest and breaks silently on
# the one machine the interactive scenarios exist for.

# --- Paths ---------------------------------------------------------------
# Derived from THIS file's location, never from the caller's cwd. A caller
# standing anywhere gets the same answer, which is what lets smoke-audit.sh
# point the audit at a synthetic tree without relocating anything.
SMOKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$(cd "$SMOKE_DIR/../.." && pwd)"
SRC_ROOT="$CLI"
SANDBOX_ROOT="$CLI/sandbox"
# audit.sh may be pointed at a foreign smoke directory (--smoke-dir); it
# compares against this to know whether SUITE_FILES applies.
DEFAULT_SMOKE_DIR="$SMOKE_DIR"

# --- What counts as code (plan.md §5 023-R1, 023-R2, 023-R3) -------------
# A comment is not an assertion. The two guards that must tell shell code
# from commentary — audit.sh's coverage match and run-all.sh's boundary
# check — ask this; neither carries its own expression.
#
# The rule, why it is not `sed 's/#.*$//'`, and its heredoc blind spot are
# written down ONCE in README.md ("What counts as a mention"). They are not
# restated here: 023-R6 names that file as their home, and an earlier
# revision of this comment had already drifted from it on a figure.
#
# Contract, which callers depend on and which therefore belongs here:
#   * removes a SUFFIX of the line, never an interior span
#   * preserves line numbering (blanks, never deletes)
#   * returns non-zero if the file cannot be read — callers must treat that
#     as a finding, not as an empty file
smoke_code_lines() {
  [ -n "${1:-}" ] || { echo "smoke_code_lines: needs a file" >&2; return 2; }
  [ -r "$1" ] || { echo "smoke_code_lines: cannot read '$1'" >&2; return 2; }
  # Read via redirection, never as an operand: a path is data here, and a
  # filename is not going to be mistaken for an option.
  awk -v SQ="'" -v DQ='"' '
    {
      # Scan for the cut INDEX; never accumulate the kept text. Building the
      # output character by character is quadratic, and this runs once per
      # file per caller and once per (changed file x candidate smoke) in
      # audit.sh — measured at 1.75s for a 200KB line and 7.2s for 400KB.
      # Fast path: no hash on the line means nothing to decide. On this
      # suite that is most lines, and it keeps the character scan off every
      # line that could never be a comment.
      if (index($0, "#") == 0) { print; next }
      cut = 0; sq = 0; dq = 0; n = length($0)
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        # Backslash escapes the next character everywhere except inside
        # single quotes, where shell treats it literally.
        if (c == "\\" && sq == 0) { i++; continue }
        if (c == SQ && dq == 0) { sq = 1 - sq; continue }
        if (c == DQ && sq == 0) { dq = 1 - dq; continue }
        if (c == "#" && sq == 0 && dq == 0) {
          p = (i == 1) ? " " : substr($0, i - 1, 1)
          if (p == " " || p == "\t") { cut = i; break }
        }
      }
      print (cut ? substr($0, 1, cut - 1) : $0)
    }
  ' < "$1"
}

# --- Suite membership (plan.md §5 R3) ------------------------------------
# The one answer to "which scripts constitute the suite". run-all.sh runs
# SUITE_FILES; audit.sh enumerates what it scans from the smoke directory
# itself and checks THIS list against that enumeration, so a script that
# exists but is not listed is a finding rather than a silent omission.
#
# There is deliberately no second list here. An earlier revision declared a
# `SCAN_FILES` alongside this one; when audit.sh moved to enumerating the
# directory, that declaration kept its documentation and lost its only
# reader — a second spelling of membership that had stopped meaning
# anything while still reading like the source of truth.
SUITE_FILES="smoke-toolbox.sh
smoke-features.sh
smoke-merge.sh
smoke-gates.sh
smoke-task.sh
smoke-backlog-local.sh
smoke-backlog-github.sh
smoke-backlog-gitlab.sh
smoke-backlog-cloud.sh
smoke-hooks.sh
smoke-picker.sh
smoke-all-harnesses.sh
smoke-tag-release.sh
smoke-audit.sh"

# --- Failure ------------------------------------------------------------
die() { echo "❌ $*" >&2; exit 1; }

# --- Scenario names (plan.md §5 R11) ------------------------------------
# Every scenario name reaches `rm -rf "$SANDBOX_ROOT/$NAME"`, and clean.sh
# with no argument wipes the whole sandbox tree. Until run-all.sh existed
# every caller passed a literal, so nothing could go wrong; run-all.sh is
# the first programmatic caller, and `--only <name>` is the obvious next
# affordance. Validate once, here, rather than in sixteen places later.
smoke_require_name() {
  case "${1:-}" in
    "" ) die "scenario name required" ;;
    .|.. ) die "invalid scenario name: '$1'" ;;
    *[!A-Za-z0-9._-]* ) die "invalid scenario name: '$1' (allowed: A-Z a-z 0-9 . _ -)" ;;
  esac
}

# Absolute path of a scenario tree, name-checked.
scenario_dir() { smoke_require_name "${1:-}"; echo "$SANDBOX_ROOT/$1"; }

# --- Assertion harness (plan.md §5 R4) ----------------------------------
# Nine scripts each carried their own pass/fail/counter and printed one of
# twelve different closing banners. FR-013 requires that a red run NAME the
# assertion that failed; that needs one shape, not twelve.
fails=0
pass() { echo "✓ $1"; }
fail() { echo "❌ $1${2:+ — $2}"; fails=$((fails + 1)); }

# check "<description>" "<shell expression>"
# The expression is a literal from the script body — never external input.
check() {
  if eval "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1" "command: $2"; fi
}

# --- The context file (cli#680) -----------------------------------------
# One spelling of "a harness context file is a relative link to the root
# AGENTS.md", for every script that asserts one. `-L`, not `-f`: `-f` follows
# the link, and a plain copy of AGENTS.md would pass it.
# check_context_link "<label>" <file> <target>
check_context_link() {
  local got
  if [ ! -L "$2" ]; then fail "$1" "$2 is not a symlink"; return; fi
  got="$(readlink "$2")"
  if [ "$got" != "$3" ]; then fail "$1" "$2 points at '$got', not '$3'"; return; fi
  pass "$1"
}

# check_context_file <backend> — from a claude scaffold's root (#612, cli#680):
# `.claude/CLAUDE.md` links to AGENTS.md, no root CLAUDE.md is written, and
# AGENTS.md describes the backend it was given — the local index on `local`
# only, the backlog config on every other — with no retired path and no
# unrendered backend marker.
check_context_file() {
  check_context_link ".claude/CLAUDE.md is a relative symlink to the root AGENTS.md (cli#680)" \
    .claude/CLAUDE.md ../AGENTS.md
  check "no root CLAUDE.md is written (cli#680)" '[ ! -e CLAUDE.md ]'
  if [ "$1" = local ]; then
    check "AGENTS.md points a local project at its backlog index" \
      'grep -q "\.specnaut/backlog\.md" AGENTS.md && [ -f .specnaut/backlog.md ]'
  else
    check "AGENTS.md does not send a $1 project to the local index" \
      '! grep -q "\.specnaut/backlog\.md" AGENTS.md'
    check "AGENTS.md points at the backlog config it was given" \
      'grep -q "\.specnaut/backlog-config\.yml" AGENTS.md'
  fi
  check "AGENTS.md does not cite the retired .claude/commands/" \
    '! grep -q "\.claude/commands/" AGENTS.md'
  check "AGENTS.md carries no unrendered backend markers" '! grep -q "backend=" AGENTS.md'
}

# finish "<LABEL>" — the single closing banner. Exits 0 clean, 1 with fails.
finish() {
  echo
  if [ "$fails" -eq 0 ]; then
    echo "═══ $1: ALL CHECKS PASSED ═══"
    exit 0
  fi
  echo "═══ $1: $fails CHECK(S) FAILED ═══"
  exit 1
}
