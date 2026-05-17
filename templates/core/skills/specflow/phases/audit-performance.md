
# /specflow audit performance

**Read-only** project-wide performance sweep. Walks the entire codebase,
dispatches the `performance-auditor` agent in audit mode, and emits a
structured findings report. **Never mutates project code** — running the
phase twice in a row leaves `git status --porcelain` identical (modulo
the new report file).

This phase is **manual-only** — invoke explicitly with
`/specflow audit performance` or schedule with
`/loop 1d /specflow audit performance`. Unlike `/specflow review` (which
gates a single feature branch with fmt/lint/typecheck/tests),
`/specflow audit performance` is a periodic systemic sweep that produces
backlog material, not a pass/fail verdict.

## Argument parsing

`$ARGUMENTS` may contain `--severity <level>` where `<level>` is `critical`,
`high`, `medium`, or `low`. Default is `high` (Critical + High are
surfaced; Medium and Low go to "Out of scope" in the report).
`--severity medium` extends the surfacing down to Medium; `--severity low`
surfaces everything.

Reject any other argument with: `error: unknown argument <token> — accepted: --severity <critical|high|medium|low>` and stop.

## Procedure

1. **Detect the codebase root.** Use `git rev-parse --show-toplevel`. If not
   a git repo, abort with `error: /specflow audit performance requires a git repository (uses git ls-files for scope)` — there is no value in auditing
   an un-versioned directory because the report won't be reproducible.

2. **Build the inventory.** Run `git ls-files` once and group the output:
   - Source files by language extension
   - Schema / migration files (`schema.sql`, `migrations/`, `prisma/schema.prisma`, `*.sql`, ORM model files)
   - Dependency manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `composer.json`, `Gemfile`, `requirements*.txt`)
   - Front-end source (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro`)

3. **Dispatch the `performance-auditor` agent** with the dispatch prompt
   below. The agent operates in audit mode (full codebase scan, NOT
   per-PR review mode). It has `Read`, `Grep`, `Glob`, and constrained
   `Bash` access; it MUST NOT call `Edit`, `Write`, `NotebookEdit`, or
   any mutating tool.

4. **Persist the report** at
   `docs/specflow/audits/YYYY-MM-DD-performance.md` (UTC date). If the
   file already exists for today, append a `## Run 2 (HH:MM UTC)` heading
   rather than overwriting.

5. **Offer PO handoff** (do NOT auto-execute). Print to stdout:

   > Audit report written to `docs/specflow/audits/YYYY-MM-DD-performance.md`.
   > Want me to dispatch the `product-owner` agent to convert Critical and
   > High findings into an Epic + sub-tasks?

   Wait for the user's reply. On confirmation, dispatch the
   `product-owner` agent with the report path + the instruction: "Create
   one Epic titled `performance audit findings YYYY-MM-DD` with one
   sub-task per Critical / High finding (batch Medium / Low into a
   single grouped task if `--severity medium` or `--severity low` was
   passed)."

## Dispatch prompt for the `performance-auditor` agent

Pass the agent the following prompt verbatim (substituting `$INVENTORY`
with the grouped file inventory from step 2 and `$SEVERITY_FLOOR` with
the resolved severity threshold):

```
You are running in **audit mode** (Mode 2 per your agent spec) — full
codebase sweep, not per-PR review.

Read-only contract: see your agent doc. Bash limited to read-only
inspection commands. Any mutating tool call is a contract violation.

Severity floor: $SEVERITY_FLOOR. Findings below this floor go into the
"Out of scope" section (named, not detailed).

Inventory:

$INVENTORY

Walk the axis checklist from your agent doc in order (DB access, index
hygiene, blocking I/O, cache layers, bundle bloat, hot loops, concurrency
leaks, sequential awaits, memory-leak vectors). For each axis, when the
codebase doesn't have the relevant surface (no DB layer, no FE source,
etc.), record it under "Out of scope" rather than emitting empty
findings.

Output: the Markdown report shape from your agent doc.
```

## Read-only contract test

After the agent returns, run:

```bash
git status --porcelain
```

The only acceptable diff is the new
`docs/specflow/audits/YYYY-MM-DD-performance.md` file (and the parent
`docs/specflow/audits/` directory if it had to be created). Anything else
is a contract breach — record it as an error in the final report and
surface to the user.

## Output format (what the user sees)

```
specflow-audit-performance report
─────────────────────────────────
Codebase: <root>
Severity floor: <high|medium|low|critical>
Findings: N (Critical: X · High: Y · Medium: Z · Low: W)
Report:   docs/specflow/audits/YYYY-MM-DD-performance.md
Read-only: ✓ (git status clean except for the report file)

Next step: dispatch product-owner to convert findings into a backlog Epic? (y/N)
```

## When NOT to use this phase

- For per-PR review on a feature branch → use `/specflow review` (gates merge with the performance-auditor in PR mode, not audit mode).
- For benchmark / profiler-backed perf work → out of scope; this phase reads code, not runtime traces.
- For a single-file performance check → invoke `performance-auditor` directly with the file paths.

---

Inspired by the discipline of `obra/superpowers` v5.1.0 (MIT, Jesse Vincent),
adapted to Specflow's bundled agent + backlog conventions. The
`performance-auditor` agent itself is Specflow-native (no upstream sibling).
