---
name: requesting-code-review
description: Use when work is complete enough to need an independent eye — after each task in a subagent-driven plan, after a major feature, before merging to main. Trigger phrases include "review this", "request code review", "review the changes", "review my work", "check this before merge". Dispatches a fresh code-reviewer subagent with precise context and a canonical prompt template.
---

# Requesting Code Review

Dispatch a code reviewer subagent to catch issues before they cascade.
The reviewer gets precisely crafted context for evaluation — never your
session's history. This keeps the reviewer focused on the work product,
not your thought process, and preserves your own context for continued
work.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/requesting-code-review/SKILL.md` + the
> `code-reviewer.md` prompt template. Re-implemented for Specflow with
> the prompt template inlined here (single file) and integrated with
> Specflow's bundled `code-reviewer` agent.

**Core principle:** Review early, review often.

## When to request review

**Mandatory:**

- After each task in a `subagent-driven-development` plan
- After completing a major feature
- Before merging to main

**Optional but valuable:**

- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing a complex bug

## Specflow integration

Specflow ships a bundled **`code-reviewer` agent**
(`templates/core/agents/code-reviewer.md`) that this skill dispatches.
The agent's system prompt covers Specflow conventions (hexagonal
layers, byte-identity plugin-sync contract, smoke audit, Windsurf cap,
backlog-script conventions, …). Use it instead of `general-purpose`
when reviewing changes inside this repo.

For changes that touch security surfaces, also dispatch
`security-auditor` in parallel. For test-only diffs, `test-reviewer`
is the right specialist.

## How to request

**Step 1: Get the git range to review.**

```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main, or last task commit
HEAD_SHA=$(git rev-parse HEAD)
```

For a subagent-driven task, BASE is the commit at the start of the task,
HEAD is the current task's commit. For a whole feature, BASE is
`origin/main` and HEAD is the branch tip.

**Step 2: Dispatch the code-reviewer subagent** with the canonical
prompt template (see below). Use the `Task` tool with
`subagent_type: code-reviewer` and pass the four placeholders:
`{DESCRIPTION}`, `{PLAN_OR_REQUIREMENTS}`, `{BASE_SHA}`, `{HEAD_SHA}`.

**Step 3: Act on the feedback.**

- Fix Critical issues immediately. Do not proceed.
- Fix Important issues before moving to the next task.
- Note Minor issues for a follow-up commit or a tidy-up later.
- Push back if the reviewer is wrong — with code/tests/reasoning, not
  just assertion.

## The canonical reviewer prompt template

Paste this verbatim into a `Task({subagent_type: "code-reviewer", ...})`
dispatch, substituting the four placeholders. The format is mandatory —
Specflow's two-stage review pattern (spec compliance, then code
quality; see `subagent-driven-development` skill) depends on the reviewer returning the
exact sections below.

````
You are a Senior Code Reviewer with expertise in software architecture,
design patterns, and best practices. Your job is to review completed
work against its plan or requirements and identify issues before they
cascade.

## What Was Implemented

{DESCRIPTION}

## Requirements / Plan

{PLAN_OR_REQUIREMENTS}

## Git Range to Review

**Base:** {BASE_SHA}
**Head:** {HEAD_SHA}

```bash
git diff --stat {BASE_SHA}..{HEAD_SHA}
git diff {BASE_SHA}..{HEAD_SHA}
```

## What to Check

**Plan alignment:**
- Does the implementation match the plan / requirements?
- Are deviations justified improvements, or problematic departures?
- Is all planned functionality present?

**Code quality:**
- Clean separation of concerns?
- Proper error handling?
- Type safety where applicable?
- DRY without premature abstraction?
- Edge cases handled?

**Architecture:**
- Sound design decisions?
- Reasonable scalability and performance?
- Security concerns?
- Integrates cleanly with surrounding code?

**Testing:**
- Tests verify real behavior, not mocks?
- Edge cases covered?
- Integration tests where they matter?
- All tests passing?

**Production readiness:**
- Migration strategy if schema changed?
- Backward compatibility considered?
- Documentation complete?
- No obvious bugs?

## Calibration

Categorize issues by actual severity. Not everything is Critical.
Acknowledge what was done well before listing issues — accurate praise
helps the implementer trust the rest of the feedback.

If you find significant deviations from the plan, flag them specifically
so the implementer can confirm whether the deviation was intentional.
If you find issues with the plan itself rather than the implementation,
say so.

## Output Format

### Strengths
[What's well done? Be specific.]

### Issues

#### Critical (Must Fix)
[Bugs, security issues, data loss risks, broken functionality]

#### Important (Should Fix)
[Architecture problems, missing features, poor error handling, test gaps]

#### Minor (Nice to Have)
[Code style, optimization opportunities, documentation polish]

For each issue:
- File:line reference
- What's wrong
- Why it matters
- How to fix (if not obvious)

### Recommendations
[Improvements for code quality, architecture, or process]

### Assessment

**Ready to merge?** [Yes | No | With fixes]

**Reasoning:** [1-2 sentence technical assessment]

## Critical Rules

**DO:**
- Categorize by actual severity
- Be specific (file:line, not vague)
- Explain WHY each issue matters
- Acknowledge strengths
- Give a clear verdict

**DON'T:**
- Say "looks good" without checking
- Mark nitpicks as Critical
- Give feedback on code you didn't actually read
- Be vague ("improve error handling")
- Avoid giving a clear verdict
````

## Two-stage review pattern (subagent-driven only)

Specflow's `subagent-driven-development` skill runs **two reviews per
task**, in this order:

1. **Spec-compliance review** — verifies the implementation matches the
   plan task verbatim. Nothing more, nothing less. Catches scope creep
   and missed requirements. Uses a different prompt template focused on
   plan↔code alignment only.

2. **Code-quality review** — runs only if spec compliance passes. Uses
   the canonical template above. Catches architecture, testing, and
   production-readiness gaps.

The order matters: spec compliance is cheap and disqualifies "looks
clean but builds the wrong thing" implementations. Don't run code
quality first — you'll waste reviewer cycles on code that has to be
rewritten anyway.

For one-shot reviews (not subagent-driven), just use the code-quality
template above. Skip the spec-compliance stage.

## Example dispatch (Claude Code)

```typescript
Task({
  subagent_type: "code-reviewer",
  description: "Review writing-plans skill (#271)",
  prompt: `<paste the template above with placeholders filled in>`
});
```

## Example output

```
### Strengths
- Clean separation between SKILL.md content and inline prompt template
- Honest attribution to obra/superpowers MIT with re-implementation note
- Trigger phrases in description are concrete and match likely user phrasing

### Issues

#### Important
1. **Missing fallback when code-reviewer agent unavailable**
   - File: SKILL.md:L42
   - Issue: skill assumes `subagent_type: code-reviewer` exists; on harnesses where the agent isn't bundled, the dispatch will fail silently
   - Fix: document the `general-purpose` fallback explicitly

#### Minor
1. **Trigger phrase "review this" is broad**
   - File: SKILL.md:L4
   - Issue: could over-trigger on conversational uses ("review this list with me")
   - Impact: low — the user can disambiguate; not worth tightening

### Recommendations
- Consider linking from the developer agent doctrine to this skill once shipped

### Assessment

**Ready to merge: Yes**

**Reasoning:** Solid first draft of the skill. The single Important item is a small note, not a defect. Minor items are taste calls.
```

## Red flags

**Never:**

- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If the reviewer is wrong:**

- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification

## When NOT to use this skill

- For the final pre-merge check on a feature branch — that's
  `/specflow review`, which has broader scope (architecture, quality
  gates, fmt/lint/typecheck/tests).
- For security-specific concerns — dispatch `security-auditor` instead.
- For test-quality concerns specifically — dispatch `test-reviewer`.
