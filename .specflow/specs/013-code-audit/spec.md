# Feature Specification: High-altitude multi-seat parallel audit (`/code-audit`)

**Feature Branch**: `013-code-audit` **Created**: 2026-06-13 **Status**: Draft **Input**: User
description: "Headline multi-seat parallel audit skill `/code-audit` (mechanism B of the miximodel
audit-team port, epic mkrlabs/specflow-monorepo#12). A scope-collection script resolves an audit
scope on `main` and emits category signals; the skill dispatches the relevant auditor agents IN
PARALLEL, then synthesizes one deduplicated, priority-ranked report with an aggregated REVIEW
SUMMARY. Read-only; complements /specflow audit <axis>."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Take a step back and audit a burst of merged work (Priority: P1)

A maintainer has just shipped several features straight to `main` with no feature branch or spec,
and wants an architecture-level read before things calcify. They run `/code-audit`. It auto-resolves
the scope (the unpushed/recent commits), deploys the relevant auditor seats in parallel, and returns
one prioritized report — not five separate ones — with an overall verdict.

**Why this priority**: This is the headline capability the issue exists for and the whole "audit
team" value proposition. Without it there is no multi-seat audit at all.

**Independent Test**: From a repo with a few recent commits, run `/code-audit` with no arguments;
confirm a single unified report is produced covering the relevant seats, ending with one aggregated
`REVIEW SUMMARY` block.

**Acceptance Scenarios**:

1. **Given** recent commits touching backend + frontend, **When** `/code-audit` runs, **Then** the
   architecture, security, performance, and accessibility seats are deployed and their findings
   appear in one report under per-seat headings, deduplicated by file+line.
2. **Given** all seats return clean, **When** synthesis runs, **Then** the aggregated
   `REVIEW SUMMARY` carries `REVIEW_VERDICT: pass` with summed (zero) counts.
3. **Given** the security seat returns a `fail` and others `pass`, **When** synthesis runs, **Then**
   the aggregated verdict is `fail`.

---

### User Story 2 - Audit a specific subtree, only the relevant seats (Priority: P1)

A maintainer wants to audit one area deliberately. They run `/code-audit --path <subtree>`. The
scope is that subtree; the category signals from the scope script decide which signal-gated seats
deploy — a backend-only subtree skips the accessibility seat (zero frontend signal), while
architecture, security, and performance still run on any non-empty scope.

**Why this priority**: Targeted deep audits are the second primary use; seat-selection-from-signals
is what makes the audit proportional (no wasted accessibility pass on a pure-backend scope).

**Independent Test**: Run `/code-audit --path <backend-only-dir>`; confirm the accessibility seat is
skipped (zero frontend signal) and the report says which seats were deployed and which were skipped
and why.

**Acceptance Scenarios**:

1. **Given** `--path` on a subtree with zero frontend files, **When** seats are selected, **Then**
   the accessibility seat is skipped and the report records the skip.
2. **Given** `--range <a>..<b>`, **When** scope resolves, **Then** the audit covers exactly that
   commit range.

---

### User Story 3 - Trust the scope resolution without thinking about it (Priority: P2)

When no `--path`/`--range` is given, the maintainer trusts auto-scope: unpushed commits vs `main`,
else commits since the last tag, else the last N commits (default 20). The report states the
resolved scope in plain terms so the maintainer can confirm it audited what they meant.

**Why this priority**: Auto-scope is what makes the no-argument invocation ergonomic; it trails the
two functional P1s because it is a convenience layer over them.

**Acceptance Scenarios**:

1. **Given** unpushed commits exist, **When** `/code-audit` runs with no args, **Then** scope =
   `main..HEAD` and the report labels it as such.
2. **Given** a clean branch with nothing unpushed and no path, **When** scope resolves, **Then** it
   falls back to since-last-tag, else last-20-commits, and labels which rule fired.
3. **Given** the resolved scope is empty (zero files), **When** the skill runs, **Then** it stops
   and tells the maintainer the scope was empty and how to widen it — it does not dispatch empty
   seats.

---

### Edge Cases

- **Not a git repo** → the scope script aborts with a clear message (the audit is not reproducible
  without git history).
- **A seat agent fails or returns nothing** → synthesis notes the seat as errored/empty rather than
  silently dropping it; the other seats' findings still produce a report.
- **A category signal is zero** → that seat is skipped and the skip is recorded (not a silent
  absence).
- **Empty scope** (`TOTAL_FILES: 0`) → no seats are dispatched at all; the skill emits a one-line
  "nothing to audit" message instead of an empty audit. (Architecture, security, and performance run
  on any non-empty scope, so a non-empty scope always deploys at least those three.)
- **The same finding surfaces from two seats** at the same file+line → deduplicated, keeping the
  most detailed instance.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: A scope-collection script MUST resolve the audit scope from arguments in priority
  order: (1) explicit `--path <subtree>` or `--range <sha1>..<sha2>`; (2) unpushed commits vs
  `main`; (3) commits since the last tag; (4) last-N commits (default 20, configurable).
- **FR-002**: The script MUST emit structured CATEGORY SIGNALS for the resolved scope — at minimum
  `FRONTEND_COUNT`, `TEST_COUNT`, `DEP_COUNT`, `INFRA_COUNT` (file counts per category) — in a form
  the skill can read to select seats.
- **FR-003**: The script MUST abort with a clear message when run outside a git repository, and MUST
  report a zero-file scope distinctly (so the skill can stop rather than dispatch empty seats).
- **FR-004**: A `/code-audit` skill MUST call the scope script, then dispatch the applicable auditor
  seats — drawn from `architecture-auditor`, `security-auditor`, `performance-auditor`,
  `dependency-auditor`, `a11y-auditor` — IN PARALLEL (one dispatch per seat, all in a single batch,
  never sequential).
- **FR-005**: A seat MUST be skipped when its governing category signal is zero (e.g. zero frontend
  files → skip accessibility; zero dependency-manifest changes → skip dependency), and each skip
  MUST be recorded in the report. Architecture, security, and performance are deployed whenever the
  scope is non-empty; accessibility iff `FRONTEND_COUNT > 0`; dependency iff `DEP_COUNT > 0`. Every
  rule is decidable from the existing category signals (there is no docs-only carve-out — no
  `DOCS_COUNT` signal exists).
- **FR-006**: After all seats complete, the skill MUST synthesize ONE unified report: findings
  merged, deduplicated by file+line (keeping the most detailed), and priority-ranked by severity,
  grouped under per-seat headings, preceded by which seats were deployed/skipped and the resolved
  scope label.
- **FR-007**: The report MUST close with an aggregated normalized `REVIEW SUMMARY` block (per
  `review-findings-contract`): overall `REVIEW_VERDICT` = `fail` if any seat failed, else
  `needs_followup` if any seat needs follow-up, else `pass`; severity counts summed across seats.
- **FR-008**: The skill MUST be read-only — it never edits files, commits, or creates issues.
  Running it twice leaves `git status` unchanged (modulo any report file it writes).
- **FR-009**: The skill MUST operate on `main` (not branch-bound) and MUST be documented as
  complementary to — not a replacement for — `/specflow audit <axis>` (single-axis,
  branch-oriented).
- **FR-010**: Invocation MUST support `/code-audit` (no args → auto-scope) and
  `/code-audit --path
  <subtree>` / `--range <a>..<b>`.
- **FR-011**: The skill and its script MUST ship through the bundle (`init`/`upgrade`), co-located
  as a bundled skill with its `scripts/` directory.

### Key Entities _(see Domain Model section below for full structure)_

- **Audit scope**: the resolved set of commits/files under review, plus the label of which
  resolution rule produced it.
- **Category signal**: a per-category file count over the scope that governs whether a seat deploys.
- **Audit seat**: one auditor agent dispatched over the scope with an audit (not per-PR) framing.
- **Unified report**: the merged, deduplicated, ranked synthesis with the aggregated verdict.

## Domain Model _(mandatory)_

**Bounded context:** Multi-seat Code Audit — orchestration that turns a scope on `main` into a
parallel auditor-team run and one synthesized verdict. Sits above the individual auditor agents and
the mechanism-A contracts; produces a report, mutates nothing.

**Vocabulary (Ubiquitous language):**

- **Scope** — the commits/files under audit, with a **scope label** naming the rule that produced it
  (`path` / `range` / `unpushed` / `since-tag` / `last-N`).
- **Category signal** — a file count per category (`FRONTEND`, `TEST`, `DEP`, `INFRA`) over the
  scope.
- **Seat** — one auditor agent run for the audit (architecture / security / performance / dependency
  / accessibility), in audit framing (judge the shape of merged work, not line-by-line PR review).
- **Synthesis** — the lead step that merges seat outputs into one deduplicated, ranked report.
- **Aggregated verdict** — the single `REVIEW_VERDICT` derived from all seat verdicts.

**Entities (have identity):**

- **Audit run** [aggregate root] — identified by scope label + timestamp. Owns the seat set, the
  findings, and the aggregated verdict. Read-only; its only output is the report.
- **Seat result** — identified by (audit run, auditor name). Carries that seat's `REVIEW SUMMARY` +
  findings, or an errored/empty marker.

**Value objects (no identity, immutable):**

- **Scope(label, commits, files)** — resolved once per run.
- **CategorySignals(frontend, test, dep, infra)** — non-negative integers; the seat-selection
  function reads them.
- **Finding(file, line, severity, description)** — deduplicated by `(file, line)`.
- **AggregatedVerdict(value, summedCounts)** — `fail` dominates `needs_followup` dominates `pass`.

**Invariants (rules the domain must never break):**

- Read-only: an audit run never mutates tracked files (only an optional report artifact).
- A seat with a zero governing signal is not dispatched, and its skip is recorded.
- Aggregated verdict = `fail` if any seat `fail`; else `needs_followup` if any seat
  `needs_followup`; else `pass`. Counts are the per-seat sums.
- Seats are dispatched in parallel (one batch), never sequentially.
- An empty scope produces a "nothing to audit" report, never empty seat dispatches.

**Out of scope (other bounded contexts touched but not owned here):**

- **Per-axis scope-targeted dispatch skills** (mechanism B second shape, #380) — separate.
- **Status ledger integration** (mechanism C, #381) — the report's aggregated `REVIEW SUMMARY` is
  produced here but consumed there.
- **`/specflow audit <axis>`** — unchanged; `/code-audit` complements it.
- **FinOps cost-projection seat** — Cloud-specific; not deployed here.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: From a scope spanning ≥2 categories, `/code-audit` returns exactly ONE report covering
  all applicable seats — never N separate reports — with a single aggregated `REVIEW SUMMARY`.
- **SC-002**: Seat selection matches the signals on 100% of runs: every seat with a zero governing
  signal is skipped (and recorded), every seat with a non-zero signal is deployed.
- **SC-003**: Seats are dispatched in parallel — verifiable by the skill issuing all seat dispatches
  in a single batch, not one-after-another.
- **SC-004**: The aggregated verdict obeys the dominance rule (`fail` > `needs_followup` > `pass`)
  and the counts equal the per-seat sums, on every run.
- **SC-005**: Running `/code-audit` twice over the same clean scope leaves `git status` identical
  (modulo a report file) — the skill is provably read-only.
- **SC-006**: A fresh `specflow init` / `upgrade` delivers the `/code-audit` skill + its scope
  script.

## Assumptions

- The auditor agents already emit the canonical `REVIEW SUMMARY` block (mechanism A / #378, merged),
  so synthesis can parse and aggregate seat verdicts without prose interpretation.
- Category detection is heuristic (path/extension globs), consistent with the existing
  `/specflow audit` inventory approach; precision is "good enough to choose seats", not exhaustive
  classification.
- The skill is a Claude-Code-style orchestrator skill (the lead assembles scope, dispatches, and
  synthesizes); the parallel-dispatch and synthesis steps are instructions to the lead, mirroring
  the proven miximodel `/code-audit`.
- Report persistence reuses the existing audit convention
  (`docs/specflow/audits/YYYY-MM-DD-code-audit.md`) but the report is primarily returned inline;
  persistence is a convenience, not a gate.
- Distribution reuses the bundle/manifest path (a skill with a `scripts/` subdir, like `backlog`).
