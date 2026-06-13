# Feature Specification: Per-axis scope-targeted audit-dispatch skills

**Feature Branch**: `014-per-axis-audit-skills`
**Created**: 2026-06-13
**Status**: Draft
**Input**: User description: "Per-axis scope-targeted audit-dispatch skills (mechanism B, second shape, of the miximodel audit-team port, epic mkrlabs/specflow-monorepo#12). Five thin skills — /arch-audit, /sec-audit, /perf-audit, /dep-audit, /a11y-audit — each resolves an optional scope (--path / --range / --diff / whole repo) and dispatches the matching auditor agent, which emits a REVIEW SUMMARY. No dated report file (that stays /specflow audit <axis>'s job). Complementary fast, targeted entry point."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Quick targeted audit of one area, one axis (Priority: P1)

A maintainer wants a fast read on one concern over one area — "is the security of this subtree sound?" — without generating a dated report file or running the full multi-seat team. They run `/sec-audit --path <subtree>`. The skill resolves that scope and dispatches the security auditor over it; the auditor returns its findings ending with a `REVIEW SUMMARY` block. Nothing is written to disk.

**Why this priority**: This is the entire value of the second shape — a fast, scoped, interactive single-axis audit. Without it there is no per-axis entry point.

**Independent Test**: Run `/perf-audit --path <subtree>`; confirm the performance auditor is dispatched over that subtree, returns findings + a `REVIEW SUMMARY`, and no report file appears under `docs/`.

**Acceptance Scenarios**:

1. **Given** `/arch-audit --path app/x`, **When** it runs, **Then** the architecture-auditor is dispatched scoped to `app/x` and returns a `REVIEW SUMMARY`; `git status` shows no new report file.
2. **Given** `/sec-audit` with no argument, **When** it runs, **Then** the security-auditor is dispatched over the whole repository.
3. **Given** `/dep-audit --diff`, **When** it runs, **Then** the dependency-auditor is dispatched over the current branch's diff vs `main`.

---

### User Story 2 - Choose the scope shape that fits (Priority: P1)

The maintainer selects scope by argument: `--path <subtree>` (a directory), `--range <sha1>..<sha2>` (a commit range), `--diff` (current branch vs `main`), or no argument (whole repo). The same four scope shapes work identically across all five axis skills.

**Why this priority**: Consistent scope semantics across the five skills is what makes them learnable as a family; equal priority to US1.

**Acceptance Scenarios**:

1. **Given** `--range <a>..<b>` on any of the five skills, **When** it runs, **Then** the audit covers exactly that commit range.
2. **Given** an unrecognized argument, **When** the skill parses it, **Then** it reports the accepted forms and stops rather than silently auditing the whole repo.

---

### User Story 3 - Know which tool to reach for (Priority: P2)

Each skill's documentation states plainly: it dispatches one auditor over a scope and returns findings inline; it does NOT write a dated report (use `/specflow audit <axis>` for that) and it is NOT the multi-seat team (use `/code-audit` for that). The maintainer can tell the three audit entry points apart.

**Why this priority**: Discoverability/disambiguation prevents misuse; trails the functional stories.

**Acceptance Scenarios**:

1. **Given** any of the five SKILL.md files, **When** read, **Then** it names its dispatched agent, its scope arguments, and the distinction from both `/specflow audit <axis>` and `/code-audit`.

---

### Edge Cases

- **Not a git repo** with `--range`/`--diff` → the skill reports it cannot resolve a commit scope and stops (whole-repo/`--path` still work without history).
- **`--path` to a nonexistent subtree** → reports the empty scope rather than dispatching the agent over nothing.
- **Empty diff/range** (no changes) → reports "nothing in scope" rather than dispatching an empty audit.
- **Unrecognized argument** → lists accepted forms and stops (no silent whole-repo fallback).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Five thin dispatch skills MUST exist, one per existing auditor axis: `arch-audit` →
  architecture-auditor, `sec-audit` → security-auditor, `perf-audit` → performance-auditor,
  `dep-audit` → dependency-auditor, `a11y-audit` → a11y-auditor.
- **FR-002**: Each skill MUST accept an optional scope argument — `--path <subtree>`,
  `--range <sha1>..<sha2>`, `--diff` (current branch vs `main`), or none (whole repo) — with identical
  semantics across all five.
- **FR-003**: Each skill MUST dispatch ONLY its corresponding auditor agent, with the resolved scope
  injected into the agent's prompt and an audit framing. It MUST NOT dispatch other axes.
- **FR-004**: Each skill MUST NOT write a dated report file — findings are returned inline. (The
  report-writing flow remains `/specflow audit <axis>`.)
- **FR-005**: The dispatched auditor MUST emit a `REVIEW SUMMARY` block per `review-findings-contract`
  (already in place from mechanism A / #378).
- **FR-006**: Each skill MUST be read-only — it never edits files, commits, or creates issues.
- **FR-007**: Each skill MUST reject an unrecognized argument by listing the accepted forms and
  stopping — no silent whole-repo fallback — and MUST report an empty resolved scope rather than
  dispatching the agent over nothing.
- **FR-008**: Each SKILL.md MUST document its dispatched agent, its scope arguments, and the
  distinction from both `/specflow audit <axis>` (report-writing) and `/code-audit` (multi-seat team).
- **FR-009**: The five skills MUST ship through the bundle (`init`/`upgrade`) — registered in the
  manifest, embedded in the regenerated bundle.

### Key Entities *(see Domain Model section below for full structure)*

- **Axis skill**: a thin dispatcher binding one axis name to one auditor agent.
- **Scope argument**: the optional `--path`/`--range`/`--diff`/none selector, uniform across skills.

## Domain Model *(mandatory)*

**Bounded context:** Per-axis Audit Dispatch — fast, scoped, single-axis entry points that dispatch one
existing auditor agent and return findings inline. A sibling of the report-writing `/specflow audit
<axis>` and the multi-seat `/code-audit`, sharing the mechanism-A contract for output.

**Vocabulary (Ubiquitous language):**

- **Axis** — one of architecture / security / performance / dependency / accessibility.
- **Axis skill** — the thin `/{axis}-audit` dispatcher for that axis.
- **Scope** — the resolved files/commits under audit, from `--path` / `--range` / `--diff` / whole-repo.
- **Dispatch** — invoking the single matching auditor agent with the scope + audit framing.

**Entities (have identity):**

- **Axis skill** [aggregate root] — identified by its name (`arch-audit` … `a11y-audit`). Binds an
  axis to exactly one auditor agent. Read-only; output is the agent's inline findings.

**Value objects (no identity, immutable):**

- **Scope(shape, selector)** — `shape` ∈ {`path`, `range`, `diff`, `whole`}; uniform across all skills.

**Invariants (rules the domain must never break):**

- One axis skill dispatches exactly one auditor agent (its own axis), never a team, never another axis.
- No dated report file is written (distinguishes it from `/specflow audit <axis>`).
- Read-only: dispatch mutates no tracked files.
- Unrecognized argument ⇒ stop with accepted-forms message; empty scope ⇒ no dispatch.
- The four scope shapes behave identically across all five skills.

**Out of scope (other bounded contexts touched but not owned here):**

- **`/code-audit`** (multi-seat, #379, merged) — the team; these are single-axis.
- **`/specflow audit <axis>`** — the report-writing flow; unchanged.
- **`review-findings-contract`** (#378, merged) — provides the REVIEW SUMMARY the agents emit.
- **New auditor agent types** — none created; only the five existing axes.
- **FinOps cost-projection seat** — Cloud-specific.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each of the five skills dispatches exactly its own auditor axis over the resolved scope —
  verifiable per skill — and never writes a report file (`git status` unchanged after a run, SC-shared
  with read-only).
- **SC-002**: The four scope shapes (`--path` / `--range` / `--diff` / whole) resolve consistently
  across all five skills.
- **SC-003**: An unrecognized argument is rejected with the accepted-forms message on 100% of the
  skills (no silent whole-repo fallback).
- **SC-004**: Each dispatched auditor's output ends with a `REVIEW SUMMARY` block (inherited from #378).
- **SC-005**: A fresh `specflow init` / `upgrade` delivers all five skills.

## Assumptions

- The five auditor agents exist and emit the canonical `REVIEW SUMMARY` (mechanism A / #378, merged).
- These are Claude-Code orchestrator skills: scope resolution + single-agent dispatch are instructions
  to the lead, mirroring the miximodel `/perf-audit` shape; no shell script is required (scope is
  resolved with simple git commands described in the skill, or — for `--path`/`--range`/whole — may
  reuse the `collect-audit-scope.sh` from #379 if convenient, but the file/commit list is all that is
  needed, not the category signals).
- Distribution reuses the bundle/manifest path; these are markdown-only skills (no `scripts/`), so they
  ARE mirrored to `plugin/` (unlike the script-backed `code-audit`/`backlog`).
- The five skills share a consistent body structure (axis name + agent + scope handling + the
  three-way disambiguation note); near-identical except the bound agent.
