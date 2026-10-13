---
name: verification-before-completion
description: Use before reporting any work as DONE — implementing agents (developer subagent, inline executor, the controller) MUST run this verification checklist before claiming completion. Trigger phrases include "verify this is done", "ready to ship", "is this complete", "before I merge", or any moment an agent is about to report DONE on a task or PR. Catches the common failure mode where "done" really means "I think it's done but I haven't actually checked".
---

# Verification Before Completion

A forcing function for the discipline an agent should already have but
often skips under time pressure. Run this checklist before reporting
**any** work as complete — a task, a feature, a PR, a release. Anything
not verified is not done.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/verification-before-completion/SKILL.md`.
> Re-implemented for Specnaut with explicit pre-commit + smoke + bundle
> gates that match this repo's actual quality contract.

## When to invoke

Mandatory invocation points:

- Before an implementer subagent reports `DONE` on a task
- Before a controller reports a feature complete to the user
- Before opening a PR (CI catches some of these, but not all)
- Before merging a PR
- Before tagging a release (the `/release` skill already includes this
  inline)

If you find yourself about to type "✅ done" or report a task complete,
**stop and run this checklist first**.

## The checklist

Run each item literally. Don't trust memory — the whole point of this
skill is to override the agent's tendency to say "I'm pretty sure I
did that already".

### 1. Tests are actually green — at the right scope

Which tests depends on what you are about to call done:

- **A task inside a larger piece of work** (an implementer reporting
  `DONE` to its controller, one child of an epic): the tests **relevant
  to your change** — the files you touched and the ones that exercise
  them. Not the whole suite. The bundled workflow commits once per task,
  and the whole suite at that rate costs its runtime times the commit
  count while catching nothing a single run at the end would miss.
- **The work as a whole** (a feature reported complete, before a PR or a
  merge, before a release): the project's **whole** unit suite, once.

Use this project's own test command — read it from the task runner or
the CI workflow, the same way item 2 finds the other gates. Do not
assume one.

Expected: a pass count and zero failures. **Read the actual output.**
If the number of passed tests is lower than the previous baseline AND
no tests were intentionally removed, that's a silent skip — find it.

A test that didn't run is not a test that passed.

### 2. This project's own gates are clean

Run the gates **this** project defines — format, lint, type-check, and
any generated artifact. Do not assume a toolchain: read the task
runner (`deno.json`, `package.json`, `Makefile`, `pyproject.toml`, …)
or the CI workflow, and run what it runs.

Each gate must exit 0, and two failure shapes are not the same thing:

- **A formatter or generator rewrote files.** Not an error — stage the
  result and re-check. A generated artifact that comes back dirty was
  stale in the commit you were about to call done.
- **Lint or type-check failed.** A genuine error. Fix it; never pass
  it off as noise.

If you cannot find the gates, say so in the report rather than
reporting a clean run you did not perform.

### 3. Working tree is clean (or all dirty files are intentional)

```bash
git status --porcelain
```

Expected: empty, OR every line is intentional + documented. If you
see uncommitted changes you can't explain, you committed a partial
state — either commit the rest or `git stash`.

### 4. Plan checkboxes are all ticked

If you're executing a plan from `docs/specnaut/plans/`, every `- [ ]`
under the tasks you claimed to complete must now read `- [x]`. Read
the plan file with the Read tool, search for `- [ ]` lines under your
task's section. Any unchecked box = silent skip.

### 5. Self-review against the requirements

Re-read the task / spec / issue you set out to satisfy. For each
acceptance criterion or numbered requirement, name the file:line or
the commit that addresses it. If you can't, that requirement isn't
done.

## If this project *is* the Specnaut bundle source

Three extra gates, and they apply to exactly one kind of project: one
that contains `templates/core/`. Everywhere else the conditions below
are false by construction, so skip this section — it is here because
Specnaut's own maintainers receive this skill the same way you did.

### Smoke coverage audit (when touching scaffolded scripts or skills)

If your change touched `templates/core/skills/` or
`templates/core/skills/board/scripts/`:

```bash
bash scripts/smoke/audit.sh
```

Expected: `0 coverage gap(s), 0 stale assertion(s)`. A new file under
those paths without a smoke assertion is a contract violation — add
the assertion before claiming done.

### Plugin byte-identity (when touching scaffolded skills or agents)

If your change touched `templates/core/skills/` or
`templates/core/agents/`, the mirror under `plugin/skills/` or
`plugin/agents/` must be byte-identical:

```bash
deno test --allow-read tests/plugin/plugin_sync_test.ts
```

Expected: every pair in SYNC_PAIRS green. If a new file landed, add
the SYNC_PAIR entry.

## When a verification fails

**Stop. Do not report DONE.** Fix the failure first.

If the failure is in your own work → fix inline, re-verify.

If the failure exposes a real issue in the spec or plan → surface it
to the user with the exact failure output. Do not paper over it. Do
not claim "mostly done" or "done with minor issues".

The skill's whole reason for existing is to catch the moment you'd
otherwise say "yeah I'm pretty sure that works" without checking.

## Report shape

When every check passes, report DONE with the evidence inline — the
**number** each check produced, never the word "clean" on its own:

```
Status: DONE

Verification:
- tests: 645 passed | 0 failed ✓
- gates: fmt/lint/type-check exit 0, no artifact drift ✓
- git status: clean ✓
- plan checkboxes: 12/12 ticked ✓
- requirements: <ACa> @ <file:line> · <ACb> @ <file:line> · ... ✓
```

A count is checkable and an adjective is not. "Tests pass" survives a
run that collected nothing; "645 passed | 0 failed" does not.

The user trusts a report shaped like this far more than a bare "done".

## When NOT to invoke this skill

- For pure conversational replies (you're not reporting work done)
- For mid-task progress updates ("working on task 3 now") — verification
  is for the **completion claim**, not the running commentary
- For exploratory work where the agent is still gathering context

## Integration with other skills

- `developer` agent — should invoke this skill before reporting DONE
  to the controller
- `subagent-driven-development` — the controller invokes this skill on
  the implementer's report before dispatching the spec-compliance
  reviewer (one more layer of defence)
- `executing-plans` — the inline executor invokes this skill at the
  final whole-plan checkpoint before opening the PR
- `/release` — the release skill already includes inline verification
  (preflight checks, smoke audit, the whole suite). This skill formalises
  the same discipline for non-release work.

## Out of scope

This skill does not:

- Run the checks for you — you run them yourself, then report the
  result
- Replace the `code-reviewer` agent's review — verification is
  self-checks; review is a fresh-eyes peer check
- Mutate any state (no commits, no PR operations, no backlog moves)
- Override user-stated overrides (if the user said "ship it,
  skip the smoke audit", that authorisation holds — but log the
  exception in the verification report so the trace is honest)
