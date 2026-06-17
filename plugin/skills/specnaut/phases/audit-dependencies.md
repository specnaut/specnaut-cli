
# /specnaut audit dependencies

**Read-only** project-wide dependency-hygiene sweep. Walks every detected
manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `composer.json`,
`Gemfile`, `go.mod`, `deno.json` / `deno.jsonc`), dispatches the
`dependency-auditor` agent in audit mode, and emits a structured findings
report. **Never mutates project code** — running the phase twice in a
row leaves `git status --porcelain` identical (modulo the new report
file).

This phase is **manual-only** — invoke explicitly with
`/specnaut audit dependencies` or schedule with
`/loop 1d /specnaut audit dependencies`. Unlike `/specnaut review`
(which gates a single feature branch with fmt/lint/typecheck/tests),
`/specnaut audit dependencies` is a periodic systemic sweep that
produces backlog material, not a pass/fail verdict.

## Argument parsing

`$ARGUMENTS` may contain `--severity <level>` where `<level>` is `critical`,
`high`, `medium`, or `low`. Default is `high` (Critical + High are
surfaced; Medium and Low go to "Out of scope" in the report).
`--severity medium` extends the surfacing down to Medium; `--severity low`
surfaces everything.

Reject any other argument with: `error: unknown argument <token> — accepted: --severity <critical|high|medium|low>` and stop.

## Procedure

1. **Detect the codebase root.** Use `git rev-parse --show-toplevel`. If not
   a git repo, abort with `error: /specnaut audit dependencies requires a git repository (uses git ls-files for scope)` — there is no value in auditing
   an un-versioned directory because the report won't be reproducible.

2. **Build the inventory.** Run `git ls-files` once and group the output:
   - Dependency manifests (`package.json`, `pyproject.toml`, `Cargo.toml`,
     `composer.json`, `Gemfile`, `go.mod`, `deno.json` / `deno.jsonc`)
   - Lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
     `poetry.lock`, `uv.lock`, `Cargo.lock`, `composer.lock`,
     `Gemfile.lock`, `go.sum`, `deno.lock`)
   - License allowlist override (`.specflow/license-allowlist.txt`) if
     present
   - Source files by language extension — used to verify declared deps
     are actually imported (axis 3, unused-dep detection)

3. **If zero recognised manifests are detected**, abort the audit with
   a single-line "skipped — no dependency manifest detected" report
   (full section shape still rendered, all findings sections empty).

4. **Dispatch the `dependency-auditor` agent** with the dispatch prompt
   below. The agent operates in audit mode (full codebase scan, NOT
   per-PR review mode). It has `Read`, `Grep`, `Glob`, and constrained
   `Bash` access; it MUST NOT call `Edit`, `Write`, `NotebookEdit`, or
   any mutating tool. The Bash allow-list explicitly EXCLUDES `npm
   audit`, `cargo audit`, `pip-audit`, `osv-scanner`, etc. — live
   advisory queries are out of scope for this phase (see the agent doc's
   "Read-only contract" section).

5. **Persist the report** at
   `docs/specnaut/audits/YYYY-MM-DD-dependencies.md` (UTC date). If the
   file already exists for today, append a `## Run 2 (HH:MM UTC)` heading
   rather than overwriting.

6. **Offer PO handoff** (do NOT auto-execute). Print to stdout:

   > Audit report written to `docs/specnaut/audits/YYYY-MM-DD-dependencies.md`.
   > Want me to dispatch the `product-owner` agent to convert Critical and
   > High findings into an Epic + sub-tasks?

   Wait for the user's reply. On confirmation, dispatch the
   `product-owner` agent with the report path + the instruction: "Create
   one Epic titled `dependency audit findings YYYY-MM-DD` with one
   sub-task per Critical / High finding (batch Medium / Low into a
   single grouped task if `--severity medium` or `--severity low` was
   passed)."

## Dispatch prompt for the `dependency-auditor` agent

Pass the agent the following prompt verbatim (substituting `$INVENTORY`
with the grouped file inventory from step 2 and `$SEVERITY_FLOOR` with
the resolved severity threshold):

```
You are running in **audit mode** (Mode 2 per your agent spec) — full
codebase sweep, not per-PR review.

Read-only contract: see your agent doc. Bash limited to read-only
inspection commands. You MUST NOT invoke `npm audit`, `cargo audit`,
`pip-audit`, `osv-scanner`, or any live advisory / CVE database fetch —
those are out of scope. Any mutating tool call is a contract violation.

Severity floor: $SEVERITY_FLOOR. Findings below this floor go into the
"Out of scope" section (named, not detailed).

Inventory:

$INVENTORY

Walk the axis checklist from your agent doc in order (version pin
discipline, lockfile presence/freshness, unused declared deps, license
violations, outdated by major, typosquat heuristics, peer-dep conflicts,
duplicate deps). Detect every present manifest and report per-manifest
sub-sections in each severity section. When a manifest's ecosystem
doesn't have the relevant axis surface, record it under "Out of scope"
rather than emitting empty findings.

Output: the Markdown report shape from your agent doc.
```

## Read-only contract test

After the agent returns, run:

```bash
git status --porcelain
```

The only acceptable diff is the new
`docs/specnaut/audits/YYYY-MM-DD-dependencies.md` file (and the parent
`docs/specnaut/audits/` directory if it had to be created). Anything else
is a contract breach — record it as an error in the final report and
surface to the user.

## Output format (what the user sees)

```
specnaut-audit-dependencies report
──────────────────────────────────
Codebase: <root>
Severity floor: <high|medium|low|critical>
Findings: N (Critical: X · High: Y · Medium: Z · Low: W)
Manifests: <one line — "package.json, deno.json">
License allowlist: <"default (8 SPDX ids)" | "default + .specflow/license-allowlist.txt (N more)">
Report:   docs/specnaut/audits/YYYY-MM-DD-dependencies.md
Read-only: ✓ (git status clean except for the report file)

Next step: dispatch product-owner to convert findings into a backlog Epic? (y/N)
```

## When NOT to use this phase

- For per-PR review on a feature branch → use `/specnaut review` (gates merge with the dependency-auditor in PR mode, not audit mode).
- For live CVE / advisory cross-reference → out of scope; run your ecosystem's native audit tool separately (`npm audit`, `cargo audit`, `pip-audit`, `bundle audit`, `osv-scanner`). The audit-dependencies phase intentionally avoids these because they require network access + cached package databases that drift between runs, breaking reproducibility.
- For a single-file dependency check → invoke `dependency-auditor` directly with the manifest paths.

---

Inspired by the discipline of `obra/superpowers` v5.1.0 (MIT, Jesse Vincent),
adapted to Specnaut's bundled agent + backlog conventions. The
`dependency-auditor` agent itself is Specnaut-native (no upstream sibling).
