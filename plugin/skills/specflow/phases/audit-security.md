
# /specflow audit security

**Read-only** project-wide security sweep. Walks the entire codebase, dispatches
the `security-auditor` agent in audit mode, and emits a structured findings
report. **Never mutates project code** — running the phase twice in a row leaves
`git status --porcelain` identical.

This phase is **manual-only** — invoke explicitly with `/specflow audit security`
or schedule with `/loop 1d /specflow audit security`. Unlike `/specflow review`
(which gates a single feature branch with fmt/lint/typecheck/tests),
`/specflow audit security` is a periodic systemic sweep that produces backlog
material, not a pass/fail verdict.

## Argument parsing

`$ARGUMENTS` may contain `--severity <level>` where `<level>` is `critical`,
`high`, `medium`, or `low`. Default is `high` (Critical + High are surfaced;
Medium and Low go to "Out of scope" in the report). `--severity medium`
extends the surfacing down to Medium; `--severity low` surfaces everything.

Reject any other argument with: `error: unknown argument <token> — accepted: --severity <critical|high|medium|low>` and stop.

## Procedure

1. **Detect the codebase root.** Use `git rev-parse --show-toplevel`. If not a
   git repo, abort with `error: /specflow audit security requires a git repository (uses git ls-files for scope)` — there is no value in auditing an
   un-versioned directory because the report won't be reproducible.

2. **Build the inventory.** Run `git ls-files` once and group the output:
   - Source files by language extension
   - Config / secrets-shaped files (`.env*`, `*.key`, `*.pem`, `id_rsa*`, `secrets.*`)
   - Dependency manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `composer.json`, `Gemfile`, `requirements*.txt`)
   - CI / GitHub Actions (`.github/workflows/*.yml`)

3. **Dispatch the `security-auditor` agent** with the dispatch prompt below.
   The agent operates in audit mode (full codebase scan, NOT per-PR review
   mode). It has `Read`, `Grep`, `Glob`, and constrained `Bash` access; it
   MUST NOT call `Edit`, `Write`, `NotebookEdit`, or any mutating tool.

4. **Persist the report** at
   `docs/specflow/audits/YYYY-MM-DD-security.md` (UTC date). If the file
   already exists for today, append a `## Run 2 (HH:MM UTC)` heading rather
   than overwriting.

5. **Offer PO handoff** (do NOT auto-execute). Print to stdout:

   > Audit report written to `docs/specflow/audits/YYYY-MM-DD-security.md`.
   > Want me to dispatch the `product-owner` agent to convert Critical and High
   > findings into an Epic + sub-tasks?

   Wait for the user's reply. On confirmation, dispatch the `product-owner`
   agent with the report path + the instruction: "Create one Epic titled
   `security audit findings YYYY-MM-DD` with one sub-task per Critical /
   High finding (batch Medium / Low into a single grouped task if
   `--severity medium` or `--severity low` was passed)."

## Dispatch prompt for the `security-auditor` agent

Pass the agent the following prompt verbatim (substituting `$INVENTORY` with
the grouped file inventory from step 2 and `$SEVERITY_FLOOR` with the resolved
severity threshold):

```
You are running in **audit mode** — full-codebase sweep, not per-PR review.

Read-only contract: you MUST NOT call Edit, Write, NotebookEdit, or any tool
that mutates files. Bash is permitted only for `git ls-files`, `git log`,
`git show`, `grep`, `rg`, and dependency-listing commands (`npm ls`, `pip list`,
`cargo tree`, etc.). Any other Bash invocation is a contract violation.

Scope: walk the inventory below and surface findings for each of these axes:

1. **Authentication / authorization** — missing authz on write endpoints,
   broken session handling, insecure cookies, JWT verification gaps,
   role-check bypasses.
2. **Input validation** — route handlers accepting user input without
   validation, deserialization of untrusted data, type confusion paths.
3. **Secret leaks** — credentials / API keys / tokens / private keys in
   source files OR git history (`git log -S '...'` for known patterns).
   `.env` or `*.key` files committed to history are CRITICAL.
4. **Injection** — raw SQL concatenation, shell command interpolation with
   user input, raw HTML / template rendering with unescaped user data,
   eval-of-string.
5. **SSRF** — outbound HTTP / network calls to URLs built from user input
   without allowlist.
6. **Path traversal / arbitrary file ops** — file-system paths built from
   user input without normalization + allowlist.
7. **Supply chain** — outdated dependencies with known CVEs in the
   dependency manifests, unpinned transitive deps, package installs from
   non-canonical registries.
8. **Upload validation** — file upload handlers without MIME / size /
   extension checks.
9. **CSRF** — state-changing HTTP routes without CSRF protection (where
   applicable to the framework).
10. **Silent error swallowing** — `catch` / `except` blocks that hide errors
    without logging, especially in security-relevant code paths.

Severity floor for surfacing: $SEVERITY_FLOOR. Findings below this floor go
into the "Out of scope" section of the report (named, not detailed).

Inventory:

$INVENTORY

Output format: a Markdown document with these EXACT sections in this order
(all required, even when empty):

# Security audit — YYYY-MM-DD

## Summary

- Total findings: N (Critical: X · High: Y · Medium: Z · Low: W)
- Codebase scope: <one line — "342 source files across TypeScript, Python, shell">
- Time window: <one line — "git history scanned back to first commit on main">
- Severity floor: $SEVERITY_FLOOR

## Critical

For each finding:
- `path/to/file.ts:42` — <one-line rationale>
  - Suggested fix sketch: <2-3 sentences, no code>

## High

(same shape)

## Medium

(same shape — only populated if $SEVERITY_FLOOR is `medium` or `low`)

## Low

(same shape — only populated if $SEVERITY_FLOOR is `low`)

## Out of scope

- <named axis> — <one line on why not surfaced this run>

End with no VERDICT line. Audit-mode reports are not pass/fail.
```

## Read-only contract test

After the agent returns, run:

```bash
git status --porcelain
```

The only acceptable diff is the new `docs/specflow/audits/YYYY-MM-DD-security.md`
file (and the parent `docs/specflow/audits/` directory if it had to be created).
Anything else in the porcelain output is a contract breach — record it as an
error in the final report and surface to the user.

## Output format (what the user sees)

```
specflow-audit-security report
──────────────────────────────
Codebase: <root>
Severity floor: <high|medium|low|critical>
Findings: N (Critical: X · High: Y · Medium: Z · Low: W)
Report:   docs/specflow/audits/YYYY-MM-DD-security.md
Read-only: ✓ (git status clean except for the report file)

Next step: dispatch product-owner to convert findings into a backlog Epic? (y/N)
```

## When NOT to use this phase

- For per-PR review on a feature branch → use `/specflow review` (gates merge with the security-auditor in PR mode, not audit mode).
- For triaging GitHub security alerts after a release preflight → the `/release` flow already dispatches `security-auditor` in alert-triage mode (Mode 2 in the agent's prompt).
- For a single-file security check → invoke `security-auditor` directly with the file paths.

---

Inspired by the discipline of `obra/superpowers` v5.1.0 (MIT, Jesse Vincent),
adapted to Specflow's bundled agent + backlog conventions.
