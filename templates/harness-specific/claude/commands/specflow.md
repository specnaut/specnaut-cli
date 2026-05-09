---
description: Specflow workflow router — dispatches to the specflow skill (router phases live at .claude/skills/specflow/phases/<phase>.md). `/specflow <phase> [args]` runs a single phase.
argument-hint: <specify|clarify|plan|tasks|analyze|implement|review|merge|constitution|checklist|groom> [args]
---

## User Input

```text
$ARGUMENTS
```

## Dispatch

Invoke the **specflow** skill (at `.claude/skills/specflow/SKILL.md`) using the `Skill` tool, passing `$ARGUMENTS` through verbatim. The skill's body parses the first token as the phase name (`specify`, `clarify`, `plan`, `tasks`, `analyze`, `implement`, `review`, `merge`, `constitution`, `checklist`, `groom`) and reads the corresponding `phases/<phase>.md` to execute the procedure.

Empty `$ARGUMENTS` → the skill prints the workflow overview and stops.

This command is a thin slash-command shim so users can type `/specflow specify "..."` directly. The skill itself has `disable-model-invocation: true`; this command makes the explicit `/` form available alongside the `specflow-review` auto-invoke alias.
