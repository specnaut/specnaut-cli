---
name: claude-plugin-boundary
description: Which Specflow templates go to the specflow-plugin plugin vs stay binary-owned — decision from issue #73 design
type: decision
---

Plugin content is user-scoped and project-agnostic. The dividing rule:

**Rule: anything that requires project-state (reads .specflow/installed.lock, has
conditional-render markers, or is meant to be per-project customized) stays binary-owned.**

**Why:** Plugin hooks and skills cannot vary per backlog backend, cannot reference
$(pwd)/.specflow/installed.lock, and cannot be conditionally rendered.

**How to apply:**
- Commands/agents/skills with no backend dependency: "both" (plugin = canonical latest, binary = project snapshot with short slash-command)
- backlog.md command, backlog SKILL.md, backlog scripts: binary only (conditional render + lock reads)
- All hooks (protect-generated.sh, check-backlog-prereqs.sh, log-subagent.sh): binary only until plugin hook path resolution is documented
- All harness-specific static files (CLAUDE.md, settings.json, loop.md, dispatch-agent.sh): binary only (reference project-local paths)
- spec-root, agent-memory, project-root files: binary only (project-stateful by definition)

Plugin skills are namespaced (/specflow-plugin:specify); binary-scaffolded project skills keep the short form (/specify). Both coexist.
