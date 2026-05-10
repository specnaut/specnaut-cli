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
#   0  audit ran (regardless of findings — stdout is the report)
#   2  baseline ref could not be resolved
#   3  not running inside a git work tree
#   1  unexpected error
#
# Heuristics live in `.claude/skills/test-sandbox/SKILL.md` ("Audit
# heuristics") so the rules and the script can drift together but are
# documented in exactly one place.
set -euo pipefail

SINCE=""
while [ $# -gt 0 ]; do
  case "$1" in
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

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "audit.sh: not inside a git work tree" >&2
  exit 3
fi

ROOT="$(git rev-parse --show-toplevel)"
SMOKE_DIR="$ROOT/.claude/skills/test-sandbox/scripts"

if [ -z "$SINCE" ]; then
  SINCE=$(git -C "$ROOT" tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-version:refname | head -1 || true)
  if [ -z "$SINCE" ]; then
    echo "audit.sh: no v*.*.* tag found and no --since override" >&2
    exit 2
  fi
fi

if ! git -C "$ROOT" rev-parse --verify "$SINCE^{commit}" >/dev/null 2>&1; then
  echo "audit.sh: ref '$SINCE' could not be resolved" >&2
  exit 2
fi

HEAD_SHORT=$(git -C "$ROOT" rev-parse --short HEAD)
BASE_SHORT=$(git -C "$ROOT" rev-parse --short "$SINCE^{commit}")

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
  'templates/core/skills/specflow/phases/*.md|smoke-features.sh|phase-doc'
  'templates/core/skills/backlog/scripts/github/*|smoke-backlog-github.sh|github-backlog-script'
  'templates/core/skills/backlog/scripts/gitlab/*|smoke-backlog-gitlab.sh|gitlab-backlog-script'
  'templates/core/skills/backlog/scripts/local/*|smoke-backlog-local.sh|local-backlog-script'
  'templates/core/hooks/*|smoke-hooks.sh|bundled-hook'
  'templates/core/specflow/scripts/*/*|smoke-features.sh|specflow-helper-script'
  'templates/core/specflow/LABELS.md|smoke-features.sh smoke-backlog-github.sh smoke-backlog-gitlab.sh|labels-doc'
)

CHANGED=$(git -C "$ROOT" diff --name-only --diff-filter=AMR "$SINCE..HEAD" -- \
  'templates/core/' 'templates/manifest.json' 'src/cli/' 2>/dev/null || true)

gaps_count=0
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
      continue # outside the audit's surface map (tests, scripts/, plugin/, etc.)
    fi
    base="$(basename "$f")"
    covered=0
    for s in $smokes; do
      if [ -f "$SMOKE_DIR/$s" ] && grep -qF "$base" "$SMOKE_DIR/$s"; then
        covered=1
        break
      fi
    done
    if [ "$covered" -eq 0 ]; then
      gaps_count=$((gaps_count + 1))
      printf '  - %s\n      kind: %s\n      expected coverage in: %s\n' "$f" "$kind" "$smokes"
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
  # Strip trailing slash — directory references in `[ -d ... ]` checks are
  # not stale signals; they're shape assertions on the runtime tree.
  case "$rt" in */) return 0 ;; esac
  case "$rt" in
    .claude/agents/*.md)
      local n="${rt#.claude/agents/}"
      [ -f "$ROOT/templates/core/agents/$n" ] && return 0
      find "$ROOT/templates/harness-specific" -path "*/agents/$n" 2>/dev/null | grep -q .
      ;;
    .claude/commands/*.md)
      local n="${rt#.claude/commands/}"
      [ -f "$ROOT/templates/core/commands/$n" ] && return 0
      find "$ROOT/templates/harness-specific" -path "*/commands/$n" 2>/dev/null | grep -q .
      ;;
    .claude/skills/*/SKILL.md)
      local n="${rt#.claude/skills/}"
      n="${n%/SKILL.md}"
      [ -f "$ROOT/templates/core/skills/$n/SKILL.md" ] && return 0
      find "$ROOT/templates/harness-specific" -path "*/skills/$n/SKILL.md" 2>/dev/null | grep -q .
      ;;
    .claude/skills/specflow/phases/*.md)
      local n="${rt#.claude/skills/specflow/phases/}"
      [ -f "$ROOT/templates/core/skills/specflow/phases/$n" ]
      ;;
    .claude/hooks/*)
      local n="${rt#.claude/hooks/}"
      [ -e "$ROOT/templates/core/hooks/$n" ] && return 0
      find "$ROOT/templates/harness-specific" -path "*/hooks/$n" 2>/dev/null | grep -q .
      ;;
    .claude/scripts/*)
      local n="${rt#.claude/scripts/}"
      [ -e "$ROOT/templates/core/scripts/$n" ] && return 0
      find "$ROOT/templates/harness-specific" -path "*/scripts/$n" 2>/dev/null | grep -q .
      ;;
    .claude/loop.md)
      [ -f "$ROOT/templates/core/loop.md" ] && return 0
      find "$ROOT/templates/harness-specific" -name "loop.md" 2>/dev/null | grep -q .
      ;;
    .claude/settings.json|.claude/settings.local.json)
      return 0 # merged at init time from per-harness logic; no single source file
      ;;
    .specflow/scripts/backlog/*)
      local n="${rt#.specflow/scripts/backlog/}"
      find "$ROOT/templates/core/skills/backlog/scripts" -name "$(basename "$n")" 2>/dev/null | grep -q .
      ;;
    .specflow/scripts/bash/*|.specflow/scripts/powershell/*)
      local n="${rt#.specflow/scripts/}"
      [ -e "$ROOT/templates/core/specflow/scripts/$n" ]
      ;;
    .specflow/LABELS.md)
      [ -f "$ROOT/templates/core/specflow/LABELS.md" ]
      ;;
    .specflow/installed.lock|.specflow/backlog-config.yml|.specflow/feature.json|.specflow/logs/*|.specflow/specs/*|.specflow/backlog.md|.specflow/backlog/*)
      return 0 # generated at runtime, not in source tree
      ;;
    *)
      return 0 # outside the resolver's known map — don't false-flag
      ;;
  esac
}

stale_count=0
for smoke in "$SMOKE_DIR"/smoke-*.sh; do
  [ -f "$smoke" ] || continue
  smoke_name="$(basename "$smoke")"
  while IFS= read -r path_ref; do
    [ -z "$path_ref" ] && continue
    if ! resolves "$path_ref"; then
      stale_count=$((stale_count + 1))
      printf '  - %s references %s\n      no source file under templates/core/\n' "$smoke_name" "$path_ref"
    fi
  done < <(grep -hoE "(\\.specflow|\\.claude)/[A-Za-z0-9._/-]+" "$smoke" 2>/dev/null | sort -u)
done

if [ "$stale_count" -eq 0 ]; then
  echo "  ✓ no stale assertions detected"
fi

echo
echo "## Summary"
echo "  $gaps_count coverage gap(s)"
echo "  $stale_count stale assertion(s)"
echo
if [ "$gaps_count" -gt 0 ] || [ "$stale_count" -gt 0 ]; then
  echo "Add the missing assertions or prune the stale ones, then re-run."
  echo "(audit.sh never edits smoke scripts autonomously — that is on you.)"
fi
