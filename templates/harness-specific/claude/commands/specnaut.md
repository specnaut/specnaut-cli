---
description: Specnaut workflow router — dispatches to the specnaut skill (router phases live at .claude/skills/specnaut/phases/<phase>.md). `/specnaut <phase> [args]` runs a single phase.
argument-hint: <specify|clarify|plan|tasks|analyze|implement|review|merge|constitution|checklist|groom> [args]
---

## User Input

```text
$ARGUMENTS
```

## Dispatch

Invoke the **specnaut** skill (at `.claude/skills/specnaut/SKILL.md`) using the `Skill` tool, passing `$ARGUMENTS` through verbatim. The skill's body parses the first token as the phase name (`specify`, `clarify`, `plan`, `tasks`, `analyze`, `implement`, `review`, `merge`, `constitution`, `checklist`, `groom`) and reads the corresponding `phases/<phase>.md` to execute the procedure.

Empty `$ARGUMENTS` → the skill prints the workflow overview and stops.

This command is a thin slash-command shim so users can type `/specnaut specify "..."` directly. The router auto-chains the rest of the workflow by default; pass `--manual` to opt out, or `--once` / `--continue` to override the mid-chain artefact-detection heuristic.
