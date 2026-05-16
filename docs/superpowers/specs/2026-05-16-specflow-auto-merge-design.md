# Auto-chain as the default `/specflow` behavior — Design

> **Status:** approved **Date:** 2026-05-16 **Author:** Kevin + Claude (Opus 4.7) **Architect
> pass:** completed 2026-05-16 — validated; structural amendment applied (chain-control prose in
> dedicated phase file)

## Why this change

Specflow ships two slash skills today:

- `/specflow <phase> [args]` — phase-by-phase router (manual flow).
- `/specflow-auto <phase> [args]` — same phases, but chains them automatically with two checkpoints
  (`STOP #1` for unresolved clarifications, `STOP #2` for pre-merge validation).

End users (and the AI agents that recommend commands to them) default to `/specflow specify`,
because it is the shorter name and the one that appears first in every doc / agent recommendation.
The consequence: users copy-paste each subsequent phase by hand. The auto-chain feature is hidden
behind a noisier alias and rarely picked up.

The fix is structural, not editorial. We promote the auto-chain behavior to the default, retire the
second skill name, and add a single power-user opt-out for the rare cases when a one-shot phase is
genuinely desired.

## End state

After this change:

- `/specflow specify "<feature>"` runs the **full chain**:
  `specify → clarify → plan → tasks → analyze → implement → review`, stopping only at the two
  existing checkpoints, then asking for explicit confirmation before `/specflow merge`.
- `/specflow specify --manual "<feature>"` runs `specify` only and stops. Each subsequent phase must
  be invoked manually.
- `/specflow <phase> <args>` mid-flow (e.g. `/specflow plan 042`) applies the artefact-detection
  default that lives in `specflow-auto` today: if downstream artefacts are absent → chain from here;
  if present → one-shot.
- `/specflow <phase> --once` and `--continue` flags remain available for explicit override of the
  artefact heuristic.
- `/specflow-auto <anything>` continues to work for one release as a thin deprecation alias (prose
  redirect, no behavior of its own), with a printed deprecation warning. Removed in the next major
  release.

## Behavior matrix

| Invocation                       | What happens                                                                   | When to use                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `/specflow specify "X"`          | Full chain → STOP #2 (merge approval)                                          | Default. New feature, end-to-end run.                                                        |
| `/specflow specify --manual "X"` | Draft spec only, no chain                                                      | Power user wants to review the spec before letting the chain proceed.                        |
| `/specflow clarify` mid-flow     | Chain forward from clarify (artefact-detection default)                        | Resuming an interrupted flow after a fresh shell / context loss.                             |
| `/specflow plan --once 042`      | Regenerate `plan.md` only, no cascade                                          | User tweaked `spec.md`, wants new `plan.md` but not new `tasks.md`.                          |
| `/specflow plan --continue 042`  | Force the chain from `plan` even if downstream artefacts exist                 | User tweaked `plan.md`, wants `tasks → analyze → implement → review` to re-run from scratch. |
| `/specflow-auto <phase> ...`     | Prints deprecation notice, then behaves identically to `/specflow <phase> ...` | Muscle-memory for existing users. Removed in next major.                                     |

The flags `--manual`, `--once`, and `--continue` are **mutually exclusive** and parsed at the
**router level** — phase files (`phases/specify.md`, `phases/plan.md`, etc.) stay unchanged.

## Architecture

### Router skill takes ownership of chain control

`templates/core/skills/specflow/SKILL.md` becomes the single authority for routing, flag parsing,
and chain control. Its responsibilities:

1. Parse `$ARGUMENTS`:
   - First-or-any token matching `--manual` / `--once` / `--continue` sets the chain mode flag
     (mutually exclusive; reject conflicting flags with a clear error).
   - Strip the flag from the args before dispatch.
   - First remaining token is the phase name; the rest is the phase argument string.
2. Dispatch to the phase file (`phases/<phase>.md`) with the cleaned args, exactly like today.
3. After the phase returns, decide whether to continue the chain:
   - `--manual` set → stop after this phase.
   - Phase is not chainable (`constitution`, `checklist`, `groom`, `tag-version`, `release-version`)
     → stop.
   - `--once` set → stop.
   - Else → read `phases/auto-chain.md` and follow it.

### `phases/auto-chain.md` carries the chain-control prose

The chain mechanics — STOP #1, silent gates, STOP #2, mid-chain re-entry artefact detection, failure
handling, context budget — live in a new file `templates/core/skills/specflow/phases/auto-chain.md`.
The router reads this file when the chain is engaged. This preserves the "router body stays lean"
invariant (the consolidated router guideline at ~200 lines).

The content is, essentially, the body of today's `specflow-auto/SKILL.md` minus its frontmatter and
minus the manual opt-out paragraph (which moves into the router's flag-parsing section).

### `/specflow-auto` becomes a prose deprecation alias

`templates/core/skills/specflow-auto/SKILL.md` is rewritten to:

```markdown
---
name: specflow-auto
description: DEPRECATED — /specflow now auto-chains by default since v1.5.0.
---

# /specflow-auto is deprecated

Auto-chain is now the default behavior of `/specflow`. Use:

- `/specflow specify "<feature>"` — runs the full chain automatically
- `/specflow specify --manual "<feature>"` — runs specify only, no chain
- `/specflow <phase> <args>` — mid-chain re-entry with artefact-detection

This skill will be removed in the next major release.
```

Plain prose, no Skill-tool call, works on every harness. The existing manifest entry stays for one
release so projects upgrading from ≤ 1.4.x see the new body via `specflow upgrade`. The next major
release drops the entry; `upgrade_plan.ts` already emits a `remove` kind for files no longer in the
manifest, so the cleanup is automatic.

## Files in scope

Bundled into a single PR.

| File                                                     | Change                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `templates/core/skills/specflow/SKILL.md`                | Add flag parsing + post-phase chain decision. Remove the "use /specflow-auto" footer.                                                                                                                                   |
| `templates/core/skills/specflow/phases/auto-chain.md`    | **NEW.** Chain mechanics moved from `specflow-auto`.                                                                                                                                                                    |
| `templates/core/skills/specflow/phases/analyze.md`       | Tweak the re-run hint to mention `--once` (avoid surprise chain when regenerating just `plan.md`).                                                                                                                      |
| `templates/core/skills/specflow/phases/review.md`        | Drop the stale "hand back to `/specflow-auto`" reference.                                                                                                                                                               |
| `templates/core/skills/specflow-auto/SKILL.md`           | Rewrite as prose deprecation alias.                                                                                                                                                                                     |
| `templates/core/agents/specflow-expert.md`               | Line 217: drop the `/specflow-auto` reference.                                                                                                                                                                          |
| `templates/harness-specific/cursor/specify-rules.mdc`    | Line 32: same update.                                                                                                                                                                                                   |
| `templates/harness-specific/claude/commands/specflow.md` | Line 18 drift fix: remove the stale `disable-model-invocation: true` claim (the flag was lifted in a prior change).                                                                                                     |
| `plugin/skills/specflow/{SKILL,phases/*}.md`             | Byte-identical mirror of `templates/core` equivalents.                                                                                                                                                                  |
| `plugin/skills/specflow-auto/SKILL.md`                   | Mirror of new prose alias.                                                                                                                                                                                              |
| `plugin/agents/specflow-expert.md`                       | Mirror.                                                                                                                                                                                                                 |
| `plugin/README.md`                                       | Lines 4, 12, 60: flip the marketed primary entry.                                                                                                                                                                       |
| `docs/llms.md`                                           | Rewrite the auto-chain section (lines 358-413): make `/specflow specify` the primary command, demote `/specflow-auto` to a deprecation note.                                                                            |
| `.claude/skills/test-sandbox/scripts/smoke-features.sh`  | Move the three existing `specflow-auto` assertions to target the merged router (or `phases/auto-chain.md`). Add a deprecation-notice assertion on `specflow-auto`. Add a chain-mode regression assertion on the router. |

`src/domain/plugin_coverage.ts` stays unchanged during the deprecation release; the `specflow-auto`
entry is removed in the next major release alongside the manifest cleanup.

## Migration story

### For end users

- **On `specflow upgrade`** from 1.4.x → 1.5.x: the bundled router becomes auto-chain by default;
  their existing `/specflow-auto` invocations keep working (deprecation prose appears in chat). No
  code changes required on the user side.
- **Custom-edited skill files** (any user who hand-modified `.claude/skills/specflow/SKILL.md`) are
  preserved via the existing `preserve` SHA-comparison path; they keep their old behavior and see a
  `preserve` warning in upgrade output. They can opt in by deleting the custom file before upgrade.

### For agent recommendations

- Agents trained to suggest `/specflow specify` now suggest the right thing structurally — no
  instruction tweak required to fix the user's screenshot complaint.
- The PO brief / developer completion report templates do not need changes; they reference
  `/specflow <phase>` generically.

### For the muscle-memory of existing users

`/specflow-auto specify` keeps working through 1.5.x with a one-line deprecation notice. The next
major release (2.0) drops the alias.

## Risks and mitigations

| Risk                                                                                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User runs `/specflow plan` mid-flow expecting one-shot (today's behavior), gets a chain instead.            | The artefact-detection default catches the common case (downstream artefacts present → one-shot). Documented in `phases/auto-chain.md`. Edge case: tweak the spec, then run `/specflow plan` with no `plan.md` yet — chain fires. Mitigation: `--once` flag is the explicit one-shot opt-out, and the chain naturally stops at STOP #1 if clarifications are missing. |
| Power user prefers to review spec between phases by default.                                                | `--manual` flag, documented in the workflow overview.                                                                                                                                                                                                                                                                                                                 |
| The deprecation alias prose is loaded by harnesses that don't render Markdown bodies (cursor/codex/gemini). | Architect confirmed prose works on every harness — there is no Skill-tool dependency.                                                                                                                                                                                                                                                                                 |
| Smoke test references `specflow-auto/SKILL.md` content that no longer exists.                               | The plan moves the three existing `specflow-auto` assertions to the router and adds a deprecation-notice assertion.                                                                                                                                                                                                                                                   |
| `analyze.md` suggests `/specflow plan` for the "regenerate just the plan" use case; that now chains.        | `analyze.md` text changes to suggest `--once` explicitly.                                                                                                                                                                                                                                                                                                             |

## Release classification

**Minor** version bump. Behavior change with backward compatibility preserved via the one-release
deprecation alias. The CHANGELOG entry will read along the lines of:

> ### Features
>
> - `/specflow specify` now auto-chains the full workflow by default. Power users can run
>   `/specflow specify --manual "..."` to keep the one-shot phase-by-phase flow.
>
> ### Deprecations
>
> - `/specflow-auto` is now an alias of `/specflow` and will be removed in the next major release.
>   Update muscle memory.

## Out of scope

- Renaming any phase (`specify`, `clarify`, `plan`, etc.).
- Changing the two-checkpoint protocol itself (STOP #1 / STOP #2).
- Adding new chain-control flags beyond `--manual` / `--once` / `--continue`.
- Removing `specflow-auto` from the manifest in this release — the one-release deprecation window is
  the whole point.
- Touching any non-chainable phase (`constitution`, `checklist`, `groom`, `tag-version`,
  `release-version`) — they stay one-shot irrespective of flags.
