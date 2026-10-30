# shellcheck shell=bash
# Sourced by audit.sh: the surface map, and nothing else. It is data — which
# smoke script must mention a changed file — so it lives apart from the
# collection and the verdict that read it.
#
# Each entry: <glob>|<smoke-script-list>|<kind>. The audit walks the diff,
# matches each changed file against the first glob it fits, and asserts that
# at least one of the listed smoke scripts mentions the file's basename. If
# none do, that's a coverage gap.
SURFACES=(
  'templates/core/agents/*.md|smoke-features.sh smoke-agents.sh smoke-contracts.sh smoke-all-harnesses.sh|bundled-agent'
  'templates/core/commands/*.md|smoke-features.sh|bundled-command'
  'templates/core/skills/*/SKILL.md|smoke-features.sh smoke-agents.sh smoke-contracts.sh|bundled-skill'
  'templates/core/skills/specnaut/phases/*.md|smoke-features.sh|phase-doc'
  # Spec 037 moved the pipeline phases under /task. Listed before the
  # `task/*.md` backlog-doc glob below, which `case` would otherwise let
  # swallow them — its `*` traverses `/`.
  'templates/core/skills/task/phases/*.md|smoke-features.sh smoke-agents.sh smoke-contracts.sh smoke-merge.sh smoke-task.sh|phase-doc'
  'templates/core/skills/ship/SKILL.md|smoke-tag-release.sh|bundled-skill'
  'templates/core/skills/ship/phases/*.md|smoke-tag-release.sh|ship-doc'
  'templates/core/skills/ship/scripts/*|smoke-tag-release.sh|tag-release-script'
  'templates/core/skills/task/scripts/github/*|smoke-backlog-github.sh|github-backlog-script'
  'templates/core/skills/task/scripts/gitlab/*|smoke-backlog-gitlab.sh|gitlab-backlog-script'
  'templates/core/skills/task/scripts/local/*|smoke-backlog-local.sh|local-backlog-script'
  # #563: this directory had NO glob and NO smoke, so every script the
  # cloud backend ships was asserted on by nothing — and the coverage scan
  # could not report it, because an unclaimed directory is invisible to a
  # map keyed on claims.
  'templates/core/skills/task/scripts/cloud/*|smoke-backlog-cloud.sh|cloud-backlog-script'
  'templates/core/hooks/*|smoke-hooks.sh|bundled-hook'
  'templates/core/specnaut/scripts/*/*|smoke-features.sh smoke-agents.sh smoke-contracts.sh smoke-merge.sh smoke-gates.sh|specnaut-helper-script'
  'templates/core/specnaut/LABELS.md|smoke-features.sh smoke-backlog-github.sh smoke-backlog-gitlab.sh|labels-doc'
  # Categories that ship and were claimed by no glob. Explicit, NOT
  # `templates/core/specnaut/*.md` or `skills/*/*.md`: `case` globs traverse
  # `/`, so those swallow the whole scaffolded memory tree and turn 150
  # documents into gaps against a smoke that never claimed them.
  'templates/core/root/*|smoke-features.sh smoke-agents.sh smoke-contracts.sh smoke-all-harnesses.sh|project-root-file'
  # Named, not `task/scripts/*`: that glob would claim the four backend
  # directories above if it were ever moved ahead of them.
  'templates/core/skills/task/scripts/collect-audit-scope.sh|smoke-task.sh|skill-script'
  # cli#711: the body every backend's close-shipped.sh sources. One source,
  # installed by all four backends, so each backend's smoke runs it.
  'templates/core/skills/task/scripts/_close_shipped.sh|smoke-backlog-github.sh smoke-backlog-gitlab.sh smoke-backlog-local.sh smoke-backlog-cloud.sh|backlog-shared-body'
  'templates/core/skills/status-audit/scripts/*|smoke-features.sh smoke-contracts.sh|skill-script'
  # #562 split two contracts out of the board skill (now `/task`, spec 037).
  # The map used to name `groom.md` alone, so a sibling doc added beside it was
  # UNMAPPED — nothing asserted about it and nothing said so. A glob covers the
  # next one too. smoke-features.sh is listed for backlog.md, the backend
  # sections it asserts on.
  'templates/core/skills/task/*.md|smoke-backlog-github.sh smoke-features.sh smoke-contracts.sh|backlog-skill-doc'
  # cli#679: the integrations reference the always-on AGENTS.md points at.
  'templates/core/skills/specnaut-facts/integrations.md|smoke-features.sh smoke-contracts.sh|skill-reference-doc'
  'templates/core/specnaut/templates/*|smoke-features.sh smoke-agents.sh smoke-contracts.sh|scaffold-template'
  'templates/core/specnaut/backlog.md|smoke-backlog-local.sh|specnaut-root-doc'
  'templates/core/specnaut/logs/README.md|smoke-features.sh|specnaut-root-doc'
  # A per-project declaration file, named individually rather than as
  # `templates/core/specnaut/*.yml`. There are two today, and a glob
  # here would claim the next one silently — which is the opposite of what
  # the unmapped class is for.
  'templates/core/specnaut/gates.yml|smoke-features.sh smoke-merge.sh|specnaut-config'
  'templates/core/specnaut/workflow.yml|smoke-features.sh smoke-merge.sh|specnaut-config'
  # Harness-specific artefacts. The pathspec ignored this whole tree until
  # #551 — twelve shipped files, including all three bundled hooks, that the
  # coverage scan had never once looked at while its success line claimed
  # otherwise.
  'templates/harness-specific/*/hooks/*|smoke-hooks.sh|bundled-hook'
  # The two hook registries (spec 036). Named before the catch-all below, which
  # would send them to smoke-features.sh — the hook checks moved out of it.
  'templates/harness-specific/claude/settings.json|smoke-hooks.sh|hook-registration'
  'templates/harness-specific/codex/hooks.json|smoke-hooks.sh|hook-registration'
  'templates/harness-specific/*/scripts/*|smoke-features.sh|harness-script'
  'templates/harness-specific/*/*|smoke-features.sh smoke-all-harnesses.sh|harness-file'
)
