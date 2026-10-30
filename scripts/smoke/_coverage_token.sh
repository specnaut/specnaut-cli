# shellcheck shell=bash
# Sourced by audit.sh: the coverage token of one changed source file. It reads
# nothing but its argument (its `_rest`/`_n` scratch is its own), which is why
# it lives on its own: the rest of audit.sh is collection and verdict.
#
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
# NOT the bare skill name. `backlog-reference-contract` is named in
# smoke-contracts.sh's #442 block, inside an assertion whose subject is the
# /task SKILL.md — delete the skill and that assertion still passes — so the
# bare name would report covered exactly the file this fix exists for. Both
# plan-time audits found that independently.
#
# What this measures is a MENTION, not an assertion (024-R4). Verifying that
# an assertion's subject is the file would mean parsing the smoke, which is
# the line this suite has declined to cross every time it has come up.
coverage_token() {
  local _rest _n
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
        # Shared by every harness that registers hooks, installed once (spec 036).
        shared/hooks/*) echo ".specnaut/hooks/${_rest#shared/hooks/}" ;;
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
