
# /specflow audit accessibility

**Read-only** project-wide WCAG 2.1 AA accessibility sweep. Walks the
front-end surface of the codebase, dispatches the `a11y-auditor` agent
in audit mode, and emits a structured findings report. **Never mutates
project code** — running the phase twice in a row leaves
`git status --porcelain` identical (modulo the new report file).

This phase is **manual-only** — invoke explicitly with
`/specflow audit accessibility` or schedule with
`/loop 1d /specflow audit accessibility`. Unlike `/specflow review`
(which gates a single feature branch with fmt/lint/typecheck/tests),
`/specflow audit accessibility` is a periodic systemic sweep that
produces backlog material, not a pass/fail verdict.

## FE-surface gate

Before any work, the `a11y-auditor` agent checks for a front-end
surface (see its agent doc for the full signal list — `.html`, `.jsx`,
`.tsx`, `.vue`, `.svelte`, `.astro` files, or a `package.json` listing
a FE framework dep). If none present, the agent emits:

> no FE surface detected — accessibility audit skipped (this project ships no front-end source the auditor can read).

…and stops. This is by design — `/specflow audit accessibility` on a
CLI-only project is a no-op. The audit reports nothing; do not invent
findings.

## Argument parsing

`$ARGUMENTS` may contain `--severity <level>` where `<level>` is
`critical`, `high`, `medium`, or `low`. Default is `high` (Critical +
High are surfaced; Medium and Low go to "Out of scope" in the report).
`--severity medium` extends the surfacing down to Medium;
`--severity low` surfaces everything.

Reject any other argument with: `error: unknown argument <token> — accepted: --severity <critical|high|medium|low>` and stop.

## Procedure

1. **Detect the codebase root.** Use `git rev-parse --show-toplevel`.
   If not a git repo, abort with `error: /specflow audit accessibility requires a git repository (uses git ls-files for scope)` — there is no value in auditing an un-versioned directory because the report won't
   be reproducible.

2. **Build the inventory.** Run `git ls-files` once and group the
   output:
   - Front-end source: `.html`, `.htm`, `.jsx`, `.tsx`, `.vue`,
     `.svelte`, `.astro`
   - Stylesheets: `.css`, `.scss`, `.sass`, `.less`, `.styl`
   - Layout / app shell files: anything under `src/app/`, `src/pages/`,
     `src/routes/`, `pages/`, `app/`
   - Component directories: `src/components/`, `components/`
   - Dependency manifests: `package.json`

3. **Dispatch the `a11y-auditor` agent** with the dispatch prompt
   below. The agent first runs the FE-surface gate; if no FE surface
   exists, it returns the skip-line and the phase exits without
   writing a report.

4. **Persist the report** at
   `docs/specflow/audits/YYYY-MM-DD-accessibility.md` (UTC date), but
   ONLY if the agent returned actual findings. If the agent skipped
   due to no FE surface, print the skip-line to stdout and exit
   without creating a report file.

   If the file already exists for today, append a `## Run 2 (HH:MM UTC)`
   heading rather than overwriting.

5. **Offer PO handoff** (do NOT auto-execute) — only if a report was
   written. Print to stdout:

   > Audit report written to `docs/specflow/audits/YYYY-MM-DD-accessibility.md`.
   > Want me to dispatch the `product-owner` agent to convert Critical
   > and High findings into an Epic + sub-tasks?

   Wait for the user's reply. On confirmation, dispatch the
   `product-owner` agent with the report path + the instruction:
   "Create one Epic titled `accessibility audit findings YYYY-MM-DD`
   with one sub-task per Critical / High finding (batch Medium / Low
   into a single grouped task if `--severity medium` or
   `--severity low` was passed)."

## Dispatch prompt for the `a11y-auditor` agent

Pass the agent the following prompt verbatim (substituting `$INVENTORY`
with the grouped file inventory from step 2 and `$SEVERITY_FLOOR` with
the resolved severity threshold):

```
You are running in **audit mode** (Mode 2 per your agent spec) — full
codebase sweep, not per-PR review.

FIRST: run the FE-surface gate from your agent doc. If no FE surface
is detected, emit the skip-line and stop. Do NOT continue to the
axis walk.

If FE surface is detected, proceed:

Read-only contract: see your agent doc. Bash limited to read-only
inspection commands. Any mutating tool call is a contract violation.

Severity floor: $SEVERITY_FLOOR. Findings below this floor go into
the "Out of scope" section (named, not detailed).

Inventory:

$INVENTORY

Walk the axis checklist from your agent doc in order (semantic HTML,
heading hierarchy, alt text, form labels, keyboard navigation, ARIA
correctness, color contrast, lang attribute, skip links, live
regions). For each axis, record findings at or above the severity
floor; document axes that produced no findings under "Out of scope"
when the underlying surface exists.

Output: the Markdown report shape from your agent doc.
```

## Read-only contract test

After the agent returns (with findings — i.e. not the skip case),
run:

```bash
git status --porcelain
```

The only acceptable diff is the new
`docs/specflow/audits/YYYY-MM-DD-accessibility.md` file (and the
parent `docs/specflow/audits/` directory if it had to be created).
Anything else is a contract breach — record it as an error and surface
to the user.

In the skip case (no FE surface), `git status --porcelain` should be
empty.

## Output format (what the user sees)

### With a FE surface

```
specflow-audit-accessibility report
───────────────────────────────────
Codebase: <root>
FE surface: <one-line summary>
Severity floor: <high|medium|low|critical>
Findings: N (Critical: X · High: Y · Medium: Z · Low: W)
Report:   docs/specflow/audits/YYYY-MM-DD-accessibility.md
Read-only: ✓ (git status clean except for the report file)

Next step: dispatch product-owner to convert findings into a backlog Epic? (y/N)
```

### Without a FE surface

```
specflow-audit-accessibility — skipped
──────────────────────────────────────
no FE surface detected — accessibility audit skipped (this project ships no front-end source the auditor can read).
```

## When NOT to use this phase

- For per-PR review on a feature branch → use `/specflow review` (gates merge with the a11y-auditor in PR mode, not audit mode).
- For runtime browser-based accessibility testing (axe-core, Lighthouse, screen reader walkthroughs) → out of scope; this phase reads source, not runtime traces.
- For mobile-native accessibility (iOS VoiceOver, Android TalkBack) → out of scope; web FE only.
- For a single-component a11y check → invoke `a11y-auditor` directly with the file paths.

---

Inspired by the discipline of `obra/superpowers` v5.1.0 (MIT, Jesse Vincent),
adapted to Specflow's bundled agent + backlog conventions. The
`a11y-auditor` agent itself is Specflow-native (no upstream sibling).
