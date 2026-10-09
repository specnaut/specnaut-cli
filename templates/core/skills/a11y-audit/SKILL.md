---
name: a11y-audit
description: Single-axis accessibility audit of a scope. Use when the user says "a11y audit", "accessibility audit", "audit for accessibility", "check WCAG compliance", or "review the accessibility of <path>". Dispatches ONLY the accessibility-expert over a resolved scope (WCAG 2.1 AA over front-end source) and returns its findings inline. Read-only — writes no report file.
argument-hint: "[--path <subtree> | --range <a>..<b> | --diff]"
---

# Accessibility Audit — single-axis dispatch

A **thin, read-only** audit of one axis: accessibility. This skill resolves a
scope, dispatches the **single** `accessibility-expert` agent over it, and returns
that agent's findings **inline**. It writes **no file** and mutates **no
tracked files** — `git status` is unchanged after a run.

It judges the *shape* of the code on its axis — WCAG 2.1 AA over front-end
source — not line-by-line PR nitpicks.

## Step 1 — Parse the scope argument

Accept exactly one optional scope argument. The accepted forms are:

```text
/a11y-audit                      # whole repo
/a11y-audit --path <subtree>     # files under a subtree
/a11y-audit --range <a>..<b>     # files changed in a commit range
/a11y-audit --diff               # files changed on current branch vs main
```

If the argument is **unrecognized**, print the four accepted forms above and
**STOP**. Never silently fall back to a whole-repo audit.

## Step 2 — Resolve the scope file list

Run the matching git command for the parsed shape:

| Shape | Command |
|---|---|
| `--path <subtree>` | `git ls-files <subtree>` |
| `--range <a>..<b>` | `git diff --name-only <a>..<b>` |
| `--diff` | `git diff --name-only main...HEAD` |
| whole (no arg) | `git ls-files` |

If `--range`/`--diff` is used outside a git repository, surface the git error
and **STOP**. If the resolved list is **empty**, emit exactly one line and
**STOP** — no dispatch, no REVIEW SUMMARY:

```text
Nothing in scope. Widen it with --path <subtree>, --range <a>..<b>, or --diff.
```

## Step 3 — Dispatch ONLY the accessibility-expert

Dispatch the **single** `accessibility-expert` agent — never a team, never another
axis. Give it the resolved file list and an **audit framing**: judge the
accessibility shape of the scoped front-end source (semantic HTML, heading
hierarchy, alt text, form labels, keyboard nav, focus indicators, ARIA
correctness, color contrast where computable) — not a per-line review. Do not pass a `model:` override — a lens runs on the tier its agent file declares.

Include its Step 0 in the dispatch prompt, verbatim: read
`.specnaut/memory/a11y/00-triage.md` first — it sets Level A/AA scope, the
severity rubric, and the list of things source cannot establish — then route
by surface through `.specnaut/memory/a11y/README.md`, and read the matching
leaf's `## When it is NOT a finding` before shipping each finding. The agent
must state which sources it read, cite the criterion by number **and** name,
and downgrade to `Suspicion —` at LOW anything it cannot attribute. If
`.specnaut/memory/a11y/` is absent, it says so in one line instead.

## Step 4 — Return findings inline

Return the agent's findings inline. The `accessibility-expert` ends with the
canonical `REVIEW SUMMARY` block (verdict + severity counts, per the
review-findings-contract, #378) — surface it verbatim. **Write no report
file.**

## How this differs — disambiguation

- **`/a11y-audit`** (this skill) — dispatches the **one** `accessibility-expert`
  over a scope and returns findings **inline**. No report file.
- **`/specnaut audit accessibility`** — the report-writing single-axis audit:
  runs the same expert but **persists a dated report** under
  `docs/specnaut/audits/`. Use it when you want a durable artifact.
- **`/code-audit`** — the **multi-seat** team audit: dispatches every
  applicable expert (architecture / security / performance / a11y /
  dependency) in parallel and synthesizes one combined report. Use it for a
  broad health-check, not a single axis.
