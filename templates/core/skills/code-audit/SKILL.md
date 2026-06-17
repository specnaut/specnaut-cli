---
name: code-audit
description: High-altitude, multi-seat parallel code audit of a scope on main. Use when the user says "audit the codebase", "code audit", "audit recent changes", "do a full audit", "health-check this code", or "audit the last N commits". Resolves a scope, dispatches the applicable auditor seats (architecture / security / performance / accessibility / dependency) IN PARALLEL, and synthesizes one deduplicated, severity-ranked report. Read-only. Complementary to `/specnaut audit <axis>` (single-axis).
argument-hint: "[--path <subtree> | --range <a>..<b>] [--last <n>]"
---

# Code Audit — multi-seat parallel audit

A **high-altitude** audit: judge the *shape* of merged work across several
expert lenses at once, not a per-line PR review. This skill resolves a scope,
deploys the applicable auditor seats **in parallel**, and merges their output
into one report.

It is **read-only**: running it mutates **no tracked files**. It dispatches the
same auditor agents `/specnaut audit <axis>` uses; the difference is breadth —
`/specnaut audit <axis>` runs one axis, `/code-audit` runs all applicable seats
in a single parallel batch and synthesizes one verdict. The two are
**complementary**.

## Step 1 — Resolve the scope

Run the bundled scope resolver and read its block:

```bash
.specnaut/scripts/code-audit/collect-audit-scope.sh [--path <subtree> | --range <a>..<b>] [--last <n>]
```

Pass through whatever `$ARGUMENTS` the user gave. With no arguments the script
auto-resolves in priority order: explicit `--path`/`--range` → unpushed
(`origin/main..HEAD`) → since-latest-tag → last-N commits (default 20).

The script prints a `CODE-AUDIT SCOPE` block: `SCOPE`, `SCOPE_LABEL`, `COMMITS`,
`FILES`, `TOTAL_FILES`, and a `CATEGORY SIGNALS` section with `FRONTEND_COUNT`,
`TEST_COUNT`, `DEP_COUNT`, `INFRA_COUNT`. If the script exits non-zero (not a git
repo), surface its error and stop.

## Step 2 — Stop on an empty scope

If `TOTAL_FILES: 0`, do **not** dispatch any seats. Emit exactly one line and
stop — no report, no REVIEW SUMMARY:

```text
Nothing to audit in this scope. Widen it with --path <subtree>, --range <a>..<b>, or --last <n>.
```

## Step 3 — Select the seats from CATEGORY SIGNALS

Seats are proportional to the signals — skip a seat when its governing signal is
zero, and record the skip with its reason in the report's `### Scope` line.

| Seat          | Agent                 | Deployed when                          |
| ------------- | --------------------- | -------------------------------------- |
| Architecture  | architecture-auditor  | scope non-empty (always)               |
| Security      | security-auditor      | scope non-empty (always)               |
| Performance   | performance-auditor   | scope non-empty (always)               |
| Accessibility | a11y-auditor          | `FRONTEND_COUNT > 0` (gating signal)   |
| Dependency    | dependency-auditor    | `DEP_COUNT > 0` (gating signal)        |

These are the **existing** auditor agents — this skill defines no new agents.

**Gating vs informational signals.** Only `FRONTEND_COUNT` and `DEP_COUNT`
**gate** a seat (accessibility and dependency, respectively). `TEST_COUNT` and
`INFRA_COUNT` are **informational context only** — no seat consumes them, and
there is intentionally no test/coverage or infra seat (no such auditor agent
exists). All four counts are always emitted (the scope-signals contract requires
it); the two informational ones simply describe the scope, they do not select
seats.

## Step 4 — Dispatch all selected seats IN PARALLEL (one message)

**Dispatch every selected seat in a SINGLE message — one `Agent` call per seat,
never one after another.** Issuing them sequentially defeats the entire point of
the skill: the seats are independent and must run concurrently. Put all the
`Agent` tool calls in the same assistant turn so they execute in parallel.

Give each seat the **same scope context** (the `SCOPE_LABEL`, the commit list,
and the file list from Step 1) and an **audit framing**: judge the shape of the
merged work — architecture drift, security exposure, performance cliffs,
accessibility gaps, dependency risk — not line-by-line PR nitpicks. Each auditor
already emits the canonical `REVIEW SUMMARY` block (verdict + severity counts)
after its prose; rely on it for synthesis.

## Step 5 — Synthesize ONE report

Wait for every seat to return, then **merge → dedupe by `file:line` (keep the
most detailed instance) → severity-rank** (critical > high > medium > low). A
seat that errored or returned nothing is shown in the table as `errored` /
`empty` — **never silently dropped**.

Emit one report:

```text
## Code Audit — <SCOPE_LABEL>

### Scope
- <N commits>, <M files> | seats deployed: <list> | skipped: <seat (reason)>, …

### Seats
| Seat | Agent | Status | Findings |
|------|-------|--------|----------|
| Architecture | architecture-auditor | ✅ / errored / empty | <n> |
| …            | …                    | …                    | … |

### 🏛 Architecture   ### 🔒 Security   ### ⚡ Performance   ### ♿ Accessibility   ### 📦 Dependency
- (only the deployed seats) CRITICAL/HIGH/MEDIUM/LOW findings, each `file:line` +
  suggested fix, deduplicated by file+line across seats, severity-ranked.

### Top issues to fix first
1. …

### Verdict: HEALTHY | NEEDS WORK | DEBT ACCRUING
```

Then close with the aggregated normalized block:

```text
REVIEW SUMMARY
REVIEW_SCOPE: code-audit <SCOPE_LABEL> (seats: <list>)
REVIEW_VERDICT: pass | fail | needs_followup
CRITICAL_COUNT: <sum>
HIGH_COUNT: <sum>
MEDIUM_COUNT: <sum>
LOW_COUNT: <sum>
TOP_ISSUES: <one sentence | none>
RECOMMENDATION: <one sentence>
```

**Aggregated verdict — dominance rule:** `REVIEW_VERDICT` is `fail` if **any**
seat reported `fail`; else `needs_followup` if **any** seat reported
`needs_followup`; else `pass`. The four `*_COUNT` values are the **per-seat
sums**.

You may optionally persist the report at
`docs/specnaut/audits/YYYY-MM-DD-code-audit.md` — that doc dir is the only write
this skill ever makes; the audited code is never touched.
