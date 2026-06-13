---
name: sec-audit
description: Single-axis security audit of a scope. Use when the user says "sec audit", "security audit", "audit for security issues", "check for vulnerabilities", or "review the security of <path>". Dispatches ONLY the security-auditor over a resolved scope (authz / inputs / secrets / injection) and returns its findings inline. Read-only — writes no report file.
argument-hint: "[--path <subtree> | --range <a>..<b> | --diff]"
---

# Security Audit — single-axis dispatch

A **thin, read-only** audit of one axis: security. This skill resolves a
scope, dispatches the **single** `security-auditor` agent over it, and
returns that agent's findings **inline**. It writes **no file** and mutates
**no tracked files** — `git status` is unchanged after a run.

It judges the *shape* of the code on its axis — authz / input validation /
secrets / injection — not line-by-line PR nitpicks.

## Step 1 — Parse the scope argument

Accept exactly one optional scope argument. The accepted forms are:

```text
/sec-audit                      # whole repo
/sec-audit --path <subtree>     # files under a subtree
/sec-audit --range <a>..<b>     # files changed in a commit range
/sec-audit --diff               # files changed on current branch vs main
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

## Step 3 — Dispatch ONLY the security-auditor

Dispatch the **single** `security-auditor` agent — never a team, never
another axis. Give it the resolved file list and an **audit framing**: judge
the security shape of the scoped code (input validation, authz, secrets,
injection, SSRF, path traversal, silent error swallowing) — not a per-line
review.

## Step 4 — Return findings inline

Return the agent's findings inline. The `security-auditor` ends with the
canonical `REVIEW SUMMARY` block (verdict + severity counts, per the
review-findings-contract, #378) — surface it verbatim. **Write no report
file.**

## How this differs — disambiguation

- **`/sec-audit`** (this skill) — dispatches the **one** `security-auditor`
  over a scope and returns findings **inline**. No report file.
- **`/specflow audit security`** — the report-writing single-axis audit:
  runs the same auditor but **persists a dated report** under
  `docs/specflow/audits/`. Use it when you want a durable artifact.
- **`/code-audit`** — the **multi-seat** team audit: dispatches every
  applicable auditor (architecture / security / performance / a11y /
  dependency) in parallel and synthesizes one combined report. Use it for a
  broad health-check, not a single axis.
