---
name: antigravity-harness-research
description: Canonical Antigravity directory layout — confirmed from primary source (antigravity-awesome-skills installer + docs), resolves the .agent vs .agents ambiguity
type: reference
---

## Rule
Antigravity uses `.agent/` (singular) for project-local files. OpenCode uses `.agents/` (plural). These two were confused in issue #2.

## Canonical project-local layout (confirmed from getting-started.md + antigravity-kit repo)

```
.agent/
  skills/<folder-name>/SKILL.md   ← SKILL.md file in named subfolder
  agents/<name>.md                 ← flat markdown with YAML frontmatter (name, description, tools, model, skills)
  workflows/<name>.md              ← slash-command style markdown with $ARGUMENTS
  rules/GEMINI.md                  ← behavior rules (equivalent of .cursor/rules or CLAUDE.md)
```

## Source
- `sickn33/antigravity-awesome-skills` getting-started.md table: "Workspace: `.agent/skills/`"
- `vudovn/antigravity-kit` repo tree: confirmed `.agent/{agents,skills,workflows,rules}` with flat `.md` agents and `SKILL.md`-in-folder skills
- Installer `tools/bin/install.js`: `--antigravity` target is `~/.gemini/antigravity/skills` (global), not project-local
- `.agent/rules/` contains a single `GEMINI.md` — this is the Antigravity "rules" file, not per-skill

## Agent frontmatter format (from antigravity-kit product-owner.md)
```yaml
---
name: product-owner
description: …
tools: Read, Grep, Glob, Bash
model: inherit
skills: plan-writing, brainstorming, clean-code
---
```

## Skill frontmatter (from architecture/SKILL.md)
```yaml
---
name: architecture
description: …
allowed-tools: Read, Glob, Grep
---
```

## Workflow/command frontmatter (from plan.md)
```yaml
---
description: Create project plan using project-planner agent.
---
```

## How to apply
When implementing `antigravity_harness.ts`:
- commands → `.agent/workflows/specflow.<name>.md`
- backlog-cmd → `.agent/workflows/<name>.md`
- agents → `.agent/agents/specflow-<name>.md` (frontmatter: name, description, tools stripped to known Antigravity tools)
- skills → `.agent/skills/specflow-<name>/SKILL.md` (with name + description frontmatter)
- spec-root → `.specflow/<suffix>` (unchanged)
- project-root → `<suffix>` (unchanged)
