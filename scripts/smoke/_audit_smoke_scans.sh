# shellcheck shell=bash
# Sourced by audit.sh, in place: the two scans that read the smoke scripts
# themselves rather than the changed files — stale runtime paths, and captures
# read only inside a `fail`. They print their sections and leave $stale_count
# and $unread_count for audit.sh's summary and verdict. They walk the
# $scanned_files audit.sh enumerated, so there is still one list.
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
  # manufactured out of a path that resolves. Same hazard as audit.sh's coverage
  # grep; see the commit body for the witness.
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
    .specnaut/hooks/*)
      [ -e "$SRC_ROOT/templates/harness-specific/shared/hooks/${rt#.specnaut/hooks/}" ]
      ;;
    .specnaut/scripts/backlog/*)
      local n="${rt#.specnaut/scripts/backlog/}"
      hits="$(find "$SRC_ROOT/templates/core/skills/task/scripts" -name "$(basename "$n")" 2>/dev/null || true)"
      [ -n "$hits" ]
      ;;
    .specnaut/scripts/audit/*)
      [ -e "$SRC_ROOT/templates/core/skills/task/scripts/${rt#.specnaut/scripts/audit/}" ]
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
# Enumerated by audit.sh, and it includes _common.sh: a path assertion hoisted into
# the shared header would otherwise be invisible to the very scan that exists
# to catch stale ones.
# shellcheck disable=SC2154 # audit.sh enumerates it before sourcing this file
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
# the code until it was supposed to go red. Nothing in the suite, in the
# ShellCheck run, or in two plan-time audits saw any of them.
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
