---
name: arch-audit
description: Single-axis architecture audit of a scope. Use when the user says "arch audit", "audit the architecture", "check for architectural drift", "audit layering", or "review the architecture of <path>". Dispatches ONLY the architecture-auditor over a resolved scope (layering / DDD / SOLID / DRY) and returns its findings inline. Read-only — writes no report file.
argument-hint: "[--path <subtree> | --range <a>..<b> | --diff]"
---

# Architecture Audit — single-axis dispatch

A **thin, read-only** audit of one axis: architecture. This skill resolves a
scope, dispatches the **single** `architecture-auditor` agent over it, and
returns that agent's findings **inline**. It writes **no file** and mutates
**no tracked files** — `git status` is unchanged after a run.

It judges the *shape* of the code on its axis — layering / DDD boundaries /
SOLID / DRY — not line-by-line PR nitpicks.

## Step 1 — Parse the scope argument

Accept exactly one optional scope argument. The accepted forms are:

```text
/arch-audit                      # whole repo
/arch-audit --path <subtree>     # files under a subtree
/arch-audit --range <a>..<b>     # files changed in a commit range
/arch-audit --diff               # files changed on current branch vs main
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

## Step 3 — Dispatch ONLY the architecture-auditor

Dispatch the **single** `architecture-auditor` agent — never a team, never
another axis. Give it the resolved file list and an **audit framing**: judge
the architectural shape of the scoped code (hex-layer violations, circular
deps, god files, bounded-context leaks, ports/adapters discipline, SOLID/DRY)
— not a per-line review.

## Step 4 — Return findings inline

Return the agent's findings inline. The `architecture-auditor` ends with the
canonical `REVIEW SUMMARY` block (verdict + severity counts, per the
review-findings-contract, #378) — surface it verbatim. **Write no report
file.**

## How this differs — disambiguation

- **`/arch-audit`** (this skill) — dispatches the **one** `architecture-auditor`
  over a scope and returns findings **inline**. No report file.
- **`/specnaut audit architecture`** — the report-writing single-axis audit:
  runs the same auditor but **persists a dated report** under
  `docs/specnaut/audits/`. Use it when you want a durable artifact.
- **`/code-audit`** — the **multi-seat** team audit: dispatches every
  applicable auditor (architecture / security / performance / a11y /
  dependency) in parallel and synthesizes one combined report. Use it for a
  broad health-check, not a single axis.
