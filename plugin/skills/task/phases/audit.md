Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

# /task audit

## User Input

```text
$ARGUMENTS
```

```text
/task audit [--security] [--archi] [--perf] [--a11y] [--deps] [--path <subtree> | --range <a>..<b> | --diff | --last <n>]
```

A **high-altitude, read-only** audit: it judges the *shape* of the code on one or more axes —
layering, security exposure, performance cliffs, accessibility gaps, dependency risk — not a
per-line PR review. It mutates **no tracked file**: `git status` is unchanged after a run. It is
one-shot and never chains.

- **One or more axis flags** → only those seats run.
- **No axis flag** → every applicable seat runs, in parallel, and their findings are synthesized
  into one report.

## Step 1 — Parse the arguments

Accept the axis flags above and at most one scope argument. Anything else → print the usage block
above and **STOP**. Never silently fall back to a wider audit than the one asked for.

## Step 2 — Resolve the scope

Run the bundled scope resolver and read its block:

```bash
.specnaut/scripts/audit/collect-audit-scope.sh [--path <subtree> | --range <a>..<b>] [--last <n>]
```

- `--diff` is passed as `--range "$(git merge-base main HEAD)"..HEAD`.
- **An axis flag and no scope argument** → `--path .` (the whole repository).
- **No axis flag and no scope argument** → pass nothing: the script auto-resolves, in priority
  order, unpushed (`origin/main..HEAD`) → since the latest tag → the last N commits (default 20).

The script prints a `CODE-AUDIT SCOPE` block: `SCOPE`, `SCOPE_LABEL`, `COMMITS`, `FILES`,
`TOTAL_FILES`, and `CATEGORY SIGNALS` (`FRONTEND_COUNT`, `TEST_COUNT`, `DEP_COUNT`,
`INFRA_COUNT`). If it exits non-zero (not a git repository), surface its error and stop.

If `TOTAL_FILES: 0`, dispatch nothing. Emit exactly one line and stop — no report, no REVIEW
SUMMARY:

```text
Nothing to audit in this scope. Widen it with --path <subtree>, --range <a>..<b>, --diff, or --last <n>.
```

## Step 3 — Select the seats

| Flag | Seat | Agent | Applicable when (no flag given) |
| :--- | :--- | :--- | :--- |
| `--archi` | Architecture | `architect-expert` | scope non-empty (always) |
| `--security` | Security | `security-expert` | scope non-empty (always) |
| `--perf` | Performance | `performance-expert` | scope non-empty (always) |
| `--a11y` | Accessibility | `accessibility-expert` | `FRONTEND_COUNT > 0` |
| `--deps` | Dependency | `dependency-expert` | `DEP_COUNT > 0` |

A flag the user named runs its seat whatever the signals say. With no flag, a seat whose gating
signal is zero is skipped and the skip, with its reason, is recorded in the report's `### Scope`
line. Only `FRONTEND_COUNT` and `DEP_COUNT` gate; `TEST_COUNT` and `INFRA_COUNT` describe the scope
and select nothing — there is no test or infra seat. These are the **existing** expert agents; this
verb defines none.

## Step 4 — Dispatch every selected seat IN PARALLEL (one message)

**One `Agent` call per seat, all in the same message** — never one after another. On Codex, one
`spawn_agent(agent_type="<agent>")` per seat. Do not pass a `model:` override: each seat runs on the
tier its agent file declares.

Give each seat the same scope context (`SCOPE_LABEL`, the commit list, the file list) and an
**audit framing** for its axis, plus the seat's knowledge-base instruction **verbatim**:

- **Security** — "Before judging anything, read `.specnaut/memory/security/00-triage.md`, then
  `README.md`, then the domain files its routing table selects for this scope. Report using the
  finding format defined in `00-triage.md`." If the scope is obviously one-sided (a migration, an
  auth module, a CI workflow), name the domain file yourself.
- **Accessibility** — read `.specnaut/memory/a11y/00-triage.md` first — it sets Level A/AA scope,
  the severity rubric, and what source cannot establish — then route by surface through
  `.specnaut/memory/a11y/README.md`, and read the matching leaf's `## When it is NOT a finding`
  before shipping each finding. Cite the criterion by number **and** name; downgrade to
  `Suspicion —` at LOW anything it cannot attribute.
- **Dependency** — read `.specnaut/memory/security/06-supply-chain-and-integrity.md` before writing
  a finding; it owns the shape of the supply chain, the agent owns license policy, version currency
  and per-manifest mechanics. Downgrade to `Suspicion —` at LOW anything it cannot cite.
- **Architecture** and **Performance** — the framing alone; their agents carry their own
  catalogues.

Each seat states which sources it read and ends with the canonical `REVIEW SUMMARY` block. If a
named knowledge base is absent, the seat says so in one line.

## Step 5 — Report

**One seat** → return its findings inline, with its `REVIEW SUMMARY` verbatim. Write no file.

**Several seats** → wait for every one, then **merge → dedupe by `file:line` (keep the most
detailed instance) → severity-rank** (critical > high > medium > low). A seat that errored or
returned nothing is shown as `errored` / `empty` — **never silently dropped**.

```text
## Audit — <SCOPE_LABEL>

### Scope
- <N commits>, <M files> | seats deployed: <list> | skipped: <seat (reason)>, …

### Seats
| Seat | Agent | Status | Findings |
|------|-------|--------|----------|

### 🏛 Architecture   ### 🔒 Security   ### ⚡ Performance   ### ♿ Accessibility   ### 📦 Dependency
- (deployed seats only) findings, each `file:line` + suggested fix, deduplicated, severity-ranked.

### Top issues to fix first
1. …

### Verdict: HEALTHY | NEEDS WORK | DEBT ACCRUING
```

Then the aggregated block:

```text
REVIEW SUMMARY
REVIEW_SCOPE: audit <SCOPE_LABEL> (seats: <list>)
REVIEW_VERDICT: pass | fail | needs_followup
CRITICAL_COUNT: <sum>
HIGH_COUNT: <sum>
MEDIUM_COUNT: <sum>
LOW_COUNT: <sum>
TOP_ISSUES: <one sentence | none>
RECOMMENDATION: <one sentence>
```

**Dominance rule:** `REVIEW_VERDICT` is `fail` if **any** seat reported `fail`; else
`needs_followup` if any seat reported `needs_followup`; else `pass`. The counts are per-seat sums.

You may persist a multi-seat report at `docs/specnaut/audits/YYYY-MM-DD-audit.md` — the only write
this verb ever makes; the audited code is never touched.
