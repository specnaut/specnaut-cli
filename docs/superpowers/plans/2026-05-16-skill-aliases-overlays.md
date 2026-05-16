# Skill aliases & overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a first-class, harness-agnostic convention for project-specific skill aliases
(`alias_of`) and pre/post hooks (`overlays`) in SKILL.md frontmatter, plus a `/specflow list-skills`
phase that renders an inspectable table of what's installed.

**Architecture:** Pure convention — zero TypeScript / runtime changes. The Specflow binary already
passes SKILL.md content byte-identically from `templates/core/` through the bundler to disk
(verified in `scripts/bundle-templates.ts:64-72`). The new fields live in the YAML frontmatter; the
bundler doesn't inspect them. Dispatch semantics (resolving an alias, running an overlay) stay in
the harness (Claude Code, Cursor, …) — Specflow only scaffolds the contract. The `list-skills` phase
is a markdown procedure the harness LLM executes by walking `.claude/skills/` (or equivalent) and
reading frontmatter — same pattern as every other phase.

**Tech Stack:** Deno 2 + TypeScript bundler · YAML frontmatter in SKILL.md · markdown phase docs
read by the harness · `tests/plugin/plugin_sync_test.ts` byte-identity gate.

> Issue: https://github.com/mkrlabs/specflow/issues/265

---

## Spec deviations (deliberate)

The grooming-time AC text on #265 names the example path as
`templates/core/skills/alias-example/SKILL.md` AND describes it as "NOT installed by default —
documentation/starter only". Those two halves are mutually inconsistent: anything inside
`templates/core/skills/` is, by convention, in the install path _only when listed in
`templates/manifest.json`_. The plan takes the second half literally — the example file lives at
`templates/core/skills/alias-example/SKILL.md` but is **not** added to `templates/manifest.json`, so
`bundle-templates.ts` never bundles it, `init` / `upgrade` never scaffold it, and there is no plugin
twin to keep in sync. Users browse / link to the file on GitHub for reference. This honours "NOT
installed by default" cleanly.

The AC says the `list-skills` table has the columns `NAME · KIND · ALIAS OF · OVERLAYS`. The plan
keeps those four columns and adds a fifth — `DESCRIPTION` — because every existing SKILL.md already
carries `description:` and surfacing it in the same table eliminates a second lookup for the user.
This is additive; it doesn't change the AC contract.

---

## File Structure

| File                                                   | Responsibility                                                                                                                                   | Action                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `templates/core/skills/specflow/phases/list-skills.md` | Procedure doc telling the harness LLM how to walk skills dirs, parse frontmatter, and render the alias/overlay table.                            | **Create**                   |
| `plugin/skills/specflow/phases/list-skills.md`         | Byte-identical twin of the above, required for the plugin distribution path.                                                                     | **Create**                   |
| `templates/core/skills/specflow/SKILL.md`              | Router skill — its Phase index, `argument-hint`, `when_to_use`, and non-chainable list are the source of truth that drives `/specflow` dispatch. | **Modify**                   |
| `plugin/skills/specflow/SKILL.md`                      | Byte-identical twin of the router skill.                                                                                                         | **Modify**                   |
| `templates/manifest.json`                              | Adds one entry registering the new phase in the install bundle.                                                                                  | **Modify**                   |
| `src/templates_bundle.ts`                              | Generated file — refreshed by `deno task bundle` after the manifest changes.                                                                     | **Regen (do not hand-edit)** |
| `tests/plugin/plugin_sync_test.ts`                     | Adds `"list-skills"` to the phases array so byte-identity drift is detected by CI.                                                               | **Modify**                   |
| `templates/core/skills/alias-example/SKILL.md`         | Canonical example showing `alias_of` + `overlays` frontmatter syntax. Documentation only — **no** manifest entry, **no** plugin twin.            | **Create**                   |
| `docs/llms.md`                                         | New `## Project-specific skill overlays` section documenting the convention.                                                                     | **Modify**                   |
| `README.md`                                            | New `## Project-specific skill overlays` section linking back to `docs/llms.md`.                                                                 | **Modify**                   |

---

## Tasks

### Task 1: Add the `list-skills` phase doc + manifest entry + plugin twin

**Files:**

- Create: `templates/core/skills/specflow/phases/list-skills.md`
- Create: `plugin/skills/specflow/phases/list-skills.md`
- Modify: `templates/manifest.json` (one new entry)
- Modify: `tests/plugin/plugin_sync_test.ts` (one new array element)
- Regen: `src/templates_bundle.ts` (via `deno task bundle`)

- [ ] **Step 1: Write the failing plugin-sync test entry** — add `"list-skills"` to the phases array
      in `tests/plugin/plugin_sync_test.ts` before either source or plugin file exists. This is the
      TDD anchor; the test will fail with a missing-file error, confirming the contract works.

Edit `tests/plugin/plugin_sync_test.ts:21-34`:

```typescript
...[
  "specify",
  "clarify",
  "plan",
  "tasks",
  "analyze",
  "implement",
  "review",
  "merge",
  "constitution",
  "checklist",
  "groom",
  "tag-version",
  "release-version",
  "list-skills",
].map((name) => ({
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
deno test tests/plugin/plugin_sync_test.ts
```

Expected: a failure on the new pair, with `Deno.readTextFile` throwing `NotFound` (or similar) for
`plugin/skills/specflow/phases/list-skills.md` and/or
`templates/core/skills/specflow/phases/list-skills.md`.

- [ ] **Step 3: Create the source phase doc**

Create `templates/core/skills/specflow/phases/list-skills.md` with the following content:

````markdown
# /specflow list-skills

A one-shot inspection phase. List every skill installed for this project, flag which ones are
aliases of upstream skills, and surface their pre/post hook overlays. The point is to make the
_shadowing_ relationships visible — without this, you have to read each script to know that a local
`tag-version/` actually delegates to `specflow.tag-version`.

This phase is **read-only** — it never mutates files, never invokes other phases, and never
auto-chains.

## What this phase does

1. **Locate the harness skills directory.** Try, in order:
   - `.claude/skills/` (Claude Code)
   - `.cursor/skills/` (Cursor)
   - `.windsurf/skills/`, `.gemini/skills/`, `.opencode/skills/`, `.agent/skills/` (other supported
     harnesses)
   - Use whichever directory exists in the current working tree. If none exist, report
     `no skills installed` and stop.

2. **Enumerate skill folders.** Each immediate sub-directory containing a `SKILL.md` file is one
   skill. Sub-directories without a `SKILL.md` are ignored (they may be phase-doc folders, scripts,
   etc.).

3. **Read each `SKILL.md` frontmatter.** The frontmatter is the block between the first two `---`
   lines. Extract:
   - `name:` — the skill's invocation name (required).
   - `description:` — short blurb (required).
   - `alias_of:` — when present, the skill is an alias that delegates to the named upstream skill.
     Convention is dotted notation, e.g. `alias_of: specflow.tag-version`.
   - `overlays:` — when present, a list of pre/post hooks. Each item carries `when: before | after`
     and `path: <relative-script>`.

4. **Render a markdown table** with five columns in this order:

   | Column        | Source                                            | Empty value          |
   | ------------- | ------------------------------------------------- | -------------------- |
   | `NAME`        | `name:` field, fallback to folder name            | n/a (always present) |
   | `KIND`        | `alias` if `alias_of` is present, else `skill`    | n/a                  |
   | `ALIAS OF`    | `alias_of:` value                                 | `—`                  |
   | `OVERLAYS`    | comma-joined `<path> (<when>)` per overlay entry  | `—`                  |
   | `DESCRIPTION` | `description:` field, truncated to 60 chars + `…` | n/a                  |

5. **Sort the rows** by NAME ascending. Render aliases and skills in the same alphabetical list —
   the `KIND` column already disambiguates.

6. **Stop after the table.** Do not chain into another phase. Do not propose follow-up actions
   unless the user asks. This is an inspect command.

## Example output

```
SKILLS — 4 installed (.claude/skills/)

| NAME           | KIND   | ALIAS OF              | OVERLAYS                 | DESCRIPTION                                     |
|----------------|--------|-----------------------|--------------------------|-------------------------------------------------|
| backlog        | skill  | —                     | —                        | GitHub Project #4 backed backlog with classific…|
| release-version| alias  | specflow.release-vers…| poll-cloud-build.sh (befo| Monorepo wrapper: poll Cloud Build then delegat…|
| specflow       | skill  | —                     | —                        | Specflow workflow router — entry point for the …|
| tag-version    | alias  | specflow.tag-version  | quality-gate.sh (before) | Monorepo wrapper: cd into inner repo then deleg…|
```

## Failure modes

- `SKILL.md` missing → skip the folder silently (it's not a skill).
- Frontmatter unparseable → render the row with `KIND = error` and leave the other columns blank;
  surface the file path in a `## Parse errors` footnote so the user can fix it.
- `alias_of` points at a skill not present in the table → keep the row as-is; cycle detection and
  unresolved-target warnings are the harness's job at _invocation_ time, not at _listing_ time (per
  #265 out-of-scope).

## When NOT to use this phase

- To **invoke** a skill — that's the skill's own slash command.
- To **modify** the alias/overlay relationship — edit the SKILL.md frontmatter directly.
- To **detect cycles** in alias chains — that requires the harness to resolve at dispatch time,
  which is out of scope for this phase.
````

- [ ] **Step 4: Register the new phase in the manifest**

Edit `templates/manifest.json`. Find line 17 (the `release-version` phase entry) and add a new entry
directly after `auto-chain` (line 18):

```json
{ "category": "phase", "name": "list-skills", "suffix": "list-skills.md", "source": "core/skills/specflow/phases/list-skills.md" },
```

The full ordered block for the phase category in `templates/manifest.json` will then read:

```json
{ "category": "phase", "name": "release-version", "suffix": "release-version.md", "source": "core/skills/specflow/phases/release-version.md" },
{ "category": "phase", "name": "auto-chain", "suffix": "auto-chain.md", "source": "core/skills/specflow/phases/auto-chain.md" },
{ "category": "phase", "name": "list-skills", "suffix": "list-skills.md", "source": "core/skills/specflow/phases/list-skills.md" },
```

- [ ] **Step 5: Regenerate the bundle**

```bash
deno task bundle
```

Expected stdout: `Bundled <N+1> core entries + <M> harness-specific → src/templates_bundle.ts` where
N+1 reflects the new phase entry. The `assertAllSourcesPresent` check inside
`scripts/bundle-templates.ts:46-62` confirms the file at
`templates/core/skills/specflow/phases/list-skills.md` exists; if you skipped Step 3, this command
will fail with `Missing template sources`.

- [ ] **Step 6: Create the byte-identical plugin twin**

```bash
cp templates/core/skills/specflow/phases/list-skills.md plugin/skills/specflow/phases/list-skills.md
```

The plugin path is not pre-formatted by `deno fmt` (excluded in `deno.json`), so a verbatim copy is
safe.

- [ ] **Step 7: Run the plugin-sync test to confirm it now passes**

```bash
deno test tests/plugin/plugin_sync_test.ts
```

Expected: every pair passes, including the new `list-skills` pair.

- [ ] **Step 8: Run the full test suite**

```bash
deno task test
```

Expected: all green. No other test references the phase list directly, so adding a new phase doesn't
ripple.

- [ ] **Step 9: Commit**

```bash
git add templates/core/skills/specflow/phases/list-skills.md \
        plugin/skills/specflow/phases/list-skills.md \
        templates/manifest.json \
        src/templates_bundle.ts \
        tests/plugin/plugin_sync_test.ts
git commit -m "feat(specflow): add list-skills phase for alias/overlay inspection"
```

---

### Task 2: Wire `list-skills` into the router SKILL.md

**Files:**

- Modify: `templates/core/skills/specflow/SKILL.md` (frontmatter + Phase index + non-chainable
  list + Workflow overview)
- Modify: `plugin/skills/specflow/SKILL.md` (byte-identical twin)

- [ ] **Step 1: Extend the router's `argument-hint`** in `templates/core/skills/specflow/SKILL.md:4`

Change from:

```yaml
argument-hint: <specify|clarify|plan|tasks|analyze|implement|review|merge|constitution|checklist|groom|tag-version|release-version> [args]
```

To:

```yaml
argument-hint: <specify|clarify|plan|tasks|analyze|implement|review|merge|constitution|checklist|groom|tag-version|release-version|list-skills> [args]
```

- [ ] **Step 2: Add a trigger phrase to `when_to_use`** in
      `templates/core/skills/specflow/SKILL.md:5-19`

After the `release-version:` line (line 19), add a new line:

```yaml
- list-skills: "list installed skills", "show skill aliases", "what overlays are active"
```

So the block reads:

```yaml
- release-version: "release", "publish a release", "create release notes"
- list-skills: "list installed skills", "show skill aliases", "what overlays are active"
```

- [ ] **Step 3: Update the top-of-file router description** in
      `templates/core/skills/specflow/SKILL.md:3`

Change the parenthesised phase list in the `description:` line from:

```
(specify, clarify, plan, tasks, analyze, implement, review, merge, constitution, checklist, groom, tag-version, release-version)
```

To:

```
(specify, clarify, plan, tasks, analyze, implement, review, merge, constitution, checklist, groom, tag-version, release-version, list-skills)
```

- [ ] **Step 4: Add the Phase index row** in `templates/core/skills/specflow/SKILL.md:46-60`

After the `release-version` row (line 60), add:

```markdown
| `list-skills` | `phases/list-skills.md` | List installed skills, flagging aliases and overlay
hooks. |
```

- [ ] **Step 5: Update the non-chainable phase list** in
      `templates/core/skills/specflow/SKILL.md:62-65`

Change from:

```markdown
Chainable phases are: `specify`, `clarify`, `plan`, `tasks`, `analyze`, `implement`, `review`. The
others (`merge`, `constitution`, `checklist`, `groom`, `tag-version`, `release-version`) are
one-shot regardless of chain mode.
```

To:

```markdown
Chainable phases are: `specify`, `clarify`, `plan`, `tasks`, `analyze`, `implement`, `review`. The
others (`merge`, `constitution`, `checklist`, `groom`, `tag-version`, `release-version`,
`list-skills`) are one-shot regardless of chain mode.
```

- [ ] **Step 6: Update the Workflow overview blurb** in
      `templates/core/skills/specflow/SKILL.md:105`

Change from:

```markdown
`constitution`, `checklist`, `groom`, `tag-version`, and `release-version` are out-of-band
utilities, not part of the linear flow.
```

To:

```markdown
`constitution`, `checklist`, `groom`, `tag-version`, `release-version`, and `list-skills` are
out-of-band utilities, not part of the linear flow.
```

- [ ] **Step 7: Verify the file is still under the Windsurf 12000-char cap**

```bash
wc -c templates/core/skills/specflow/SKILL.md
```

Expected: well under 12000 (current is 6343; the diff adds roughly 500 chars). The Windsurf harness
adapter at `src/infrastructure/harness/windsurf_harness.ts` will strip a few hundred chars at render
time, so the rendered size will be slightly smaller than the source. The hard ceiling is enforced by
`tests/infrastructure/harness/windsurf_harness_test.ts:123-133`.

- [ ] **Step 8: Mirror to the plugin twin** byte-identically

```bash
cp templates/core/skills/specflow/SKILL.md plugin/skills/specflow/SKILL.md
```

- [ ] **Step 9: Run the full test suite**

```bash
deno task test
```

Expected: all green. The Windsurf cap test and the plugin-sync test both pass.

- [ ] **Step 10: Commit**

```bash
git add templates/core/skills/specflow/SKILL.md plugin/skills/specflow/SKILL.md
git commit -m "feat(specflow): wire list-skills into the router phase index"
```

---

### Task 3: Add the `alias-example` documentation file

**Files:**

- Create: `templates/core/skills/alias-example/SKILL.md` (documentation only — NOT in manifest, NOT
  bundled, NOT scaffolded)

- [ ] **Step 1: Create the example SKILL.md**

```bash
mkdir -p templates/core/skills/alias-example
```

Create `templates/core/skills/alias-example/SKILL.md`:

````markdown
---
name: alias-example
description: Reference SKILL.md showing the `alias_of` + `overlays` frontmatter convention. Copy this folder to your project's harness skills dir (e.g. `.claude/skills/`) and edit. Specflow itself never installs this file — it lives in the Specflow repo as documentation.
alias_of: specflow.tag-version
overlays:
  - when: before
    path: ./scripts/quality-gate.sh
  - when: after
    path: ./scripts/notify-slack.sh
---

# alias-example

This file demonstrates the two optional frontmatter fields that Specflow's `/specflow list-skills`
phase recognises:

- **`alias_of: <skill-name>`** — declares that this skill is a wrapper around an upstream skill.
  Convention is dotted notation, with the plugin or distribution name as the prefix (e.g.
  `alias_of: specflow.tag-version`). The harness is responsible for resolving the alias at
  invocation time; Specflow only records the relationship.

- **`overlays:`** — a list of pre/post hooks the harness should run around the wrapped skill's body.
  Each entry carries:
  - `when: before` or `when: after` — where the hook fires relative to the wrapped skill.
  - `path: ./scripts/<name>.sh` — script path relative to this SKILL.md's folder.

## Why a project would override an upstream skill

A common pattern: a monorepo that uses Specflow at the root but needs a slightly different
`tag-version` because tags live inside a sub-repo. Rather than fork the canonical
`specflow.tag-version` script, the project ships a thin wrapper as `alias_of: specflow.tag-version`
plus an overlay that runs `cd inner-repo` before delegating.

The result is grep-able and self-documenting: anyone running `/specflow list-skills` sees the alias
relationship and the overlay hooks in one table. No code archaeology needed.

## What Specflow does with this file

**Nothing at runtime.** This file lives in the Specflow source tree purely as documentation. It is
intentionally absent from `templates/manifest.json`, so `specflow init` and `specflow upgrade` will
never scaffold it into your project. To use the pattern:

1. Copy this folder into your harness skills directory:
   ```
   cp -r templates/core/skills/alias-example .claude/skills/my-skill
   ```
2. Edit the frontmatter — at minimum change `name:`, `alias_of:`, and the overlay paths.
3. Write the actual delegate-and-hook logic in the body of the file (or in the overlay scripts).
4. Run `/specflow list-skills` to confirm the harness sees the new alias and overlay.

## Prior art

- komence/komence-monorepo commits `5fbae6ea` and `39691ae3` — manually-implemented Option 2
  wrappers that this convention codifies.
````

- [ ] **Step 2: Confirm the file is NOT in the manifest**

```bash
jq '.core[] | select(.source | contains("alias-example"))' templates/manifest.json
```

Expected: no output (empty). If anything is printed, the file was accidentally registered — remove
that entry before committing.

- [ ] **Step 3: Run the full test suite**

```bash
deno task test
```

Expected: all green. Untracked files under `templates/core/` are not scanned by any test
(`assertAllSourcesPresent` only checks files referenced by the manifest, see
`scripts/bundle-templates.ts:46-62`).

- [ ] **Step 4: Commit**

```bash
git add templates/core/skills/alias-example/SKILL.md
git commit -m "docs(skills): add alias-example reference SKILL.md"
```

---

### Task 4: Document the convention in `docs/llms.md` and `README.md`

**Files:**

- Modify: `docs/llms.md` (insert new `## Project-specific skill overlays` section between
  `## Available harnesses` and `## What makes Specflow different from upstream Spec Kit`)
- Modify: `README.md` (insert new `## Project-specific skill overlays` section between
  `## Claude Code plugin` and `## Upgrading an existing project`)

- [ ] **Step 1: Add the section to `docs/llms.md`**

Insert the following block before the `## What makes Specflow different from upstream Spec Kit`
heading (currently at line 360). The new section becomes the last subsection under the
harness-introduction region.

````markdown
## Project-specific skill overlays

Specflow's skill folders are plain markdown — anything you put under your harness's `skills/`
directory (e.g. `.claude/skills/<name>/`, `.cursor/skills/<name>/`) is a skill, full stop. To make
the common "override an upstream skill" pattern discoverable, Specflow recognises two optional
fields in `SKILL.md` frontmatter:

| Field                    | Meaning                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alias_of: <skill-name>` | This skill is a thin wrapper that delegates to the named upstream skill. Dotted notation (e.g. `specflow.tag-version`) makes the distribution explicit. |
| `overlays:`              | A list of pre/post hooks. Each entry carries `when: before \| after` and `path: ./scripts/<file>.sh` relative to the SKILL.md.                          |

The Specflow binary itself **never resolves or dispatches** aliases / overlays — the harness (Claude
Code, Cursor, Codex, …) is responsible for honouring the frontmatter at invocation time. Specflow's
role is to standardise the contract.

To see what's installed and which aliases / overlays are active:

```bash
/specflow list-skills
```
````

The phase walks your harness's skills directory, parses every SKILL.md frontmatter, and renders a
`NAME · KIND · ALIAS OF · OVERLAYS ·
DESCRIPTION` table. Skills without `alias_of` show
`KIND = skill`; aliases show `KIND = alias` and the target.

A reference example lives at
[`templates/core/skills/alias-example/SKILL.md`](https://github.com/mkrlabs/specflow/blob/main/templates/core/skills/alias-example/SKILL.md)
in the Specflow source tree. It is **not** installed by `specflow
init` — copy it manually when you
want to introduce your first alias.

````
- [ ] **Step 2: Add the section to `README.md`**

Insert the following block before the `## Upgrading an existing project` heading (currently at line 87 of README.md):

```markdown
## Project-specific skill overlays

Need to override an upstream Specflow skill in one project — e.g. a
monorepo `tag-version` that has to `cd` into an inner repo first?
SKILL.md frontmatter accepts two optional fields:

```yaml
---
name: tag-version
alias_of: specflow.tag-version
overlays:
  - when: before
    path: ./scripts/cd-inner-repo.sh
---
````

Run `/specflow list-skills` to see which aliases and overlays are active in your project. The
Specflow binary scaffolds and ships the convention; the harness (Claude Code, Cursor, …) honours it
at dispatch time. See `docs/llms.md` for the full contract and
[`templates/core/skills/alias-example/SKILL.md`](templates/core/skills/alias-example/SKILL.md) for a
copy-pasteable starting point.

````
- [ ] **Step 3: Run `deno fmt --check` on the markdown files**

```bash
deno fmt --check docs/llms.md README.md
````

If `deno fmt` complains about whitespace or list-indent, run `deno fmt
docs/llms.md README.md` to
fix in place, then re-stage.

- [ ] **Step 4: Run the full test suite**

```bash
deno task test
```

Expected: all green. Documentation changes don't impact any test.

- [ ] **Step 5: Commit**

```bash
git add docs/llms.md README.md
git commit -m "docs: document alias_of + overlays SKILL.md convention"
```

---

### Task 5: Branch, push, open PR, drive to merge

**Files:** none — this is the integration task.

- [ ] **Step 1: Check what's already committed**

```bash
git log --oneline main..HEAD
```

Expected: four `feat:` / `docs:` commits from Tasks 1-4. If the work landed directly on a fresh
branch off `main`, this is the full history.

- [ ] **Step 2: Branch (if working directly on main)**

If `git rev-parse --abbrev-ref HEAD` returns `main`, switch to a feature branch:

```bash
git switch -c 265-skill-aliases-overlays
```

The four commits move with the branch (`git switch -c` carries uncommitted work, and committed work
is already on this HEAD).

- [ ] **Step 3: Push the branch**

```bash
git push --set-upstream origin 265-skill-aliases-overlays
```

- [ ] **Step 4: Open the PR via REST (avoids GraphQL rate-limit)**

````bash
gh api -X POST repos/mkrlabs/specflow/pulls --input - <<'JSON'
{
  "title": "feat(specflow): first-class skill alias / overlay convention + list-skills phase",
  "head": "265-skill-aliases-overlays",
  "base": "main",
  "body": "Closes #265.\n\n## Agent adoption\n\nSpecflow's SKILL.md frontmatter now recognises two optional fields — `alias_of: <skill-name>` and `overlays: [{when, path}]` — that let a project ship a thin wrapper around an upstream skill without forking it. The relationship is recorded in the frontmatter and rendered by a new `/specflow list-skills` phase as a pipe table (NAME · KIND · ALIAS OF · OVERLAYS · DESCRIPTION).\n\nThe Specflow binary itself does NOT dispatch aliases or run overlays — the harness (Claude Code, Cursor, …) honours the frontmatter at invocation time. Specflow's contribution is the convention + the inspector phase.\n\n## Files\n\n- `templates/core/skills/specflow/phases/list-skills.md` + plugin twin — new phase doc.\n- `templates/core/skills/specflow/SKILL.md` + plugin twin — router updated (Phase index, argument-hint, when_to_use, non-chainable classification).\n- `templates/manifest.json` — registers the phase entry.\n- `tests/plugin/plugin_sync_test.ts` — adds `list-skills` to the byte-identity contract.\n- `templates/core/skills/alias-example/SKILL.md` — reference example (NOT in manifest, NOT scaffolded — documentation only).\n- `docs/llms.md` + `README.md` — new \"Project-specific skill overlays\" sections.\n\n## Out of scope (intentionally)\n\n- Alias-cycle detection in the binary (harness concern).\n- Fallback behaviour when an `alias_of` target is missing (harness concern).\n- A `specflow check --skills` subcommand (the `list-skills` phase covers the UX without binary changes).\n\n## Prior art\n\nkomence/komence-monorepo commits `5fbae6ea` and `39691ae3` — Option-2 manual wrappers this convention codifies.\n\n```prompt\nAfter `specflow upgrade`, you can introduce a project-specific alias by copying templates/core/skills/alias-example/SKILL.md from the Specflow repo into your .claude/skills/<name>/ directory, editing the alias_of: and overlays: frontmatter to match your needs, and re-running /specflow list-skills to confirm the harness sees it.\n```\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"
}
JSON
````

Capture the returned PR URL.

- [ ] **Step 5: Wait for CI, then merge via REST**

```bash
PR=$(gh api repos/mkrlabs/specflow/pulls --jq '.[] | select(.head.ref=="265-skill-aliases-overlays") | .number' | head -1)
gh pr checks "$PR" --watch --interval 10 --repo mkrlabs/specflow
```

If `docs-check` fails because the CI heuristic doesn't recognise the doc updates as sufficient,
apply the workaround label:

```bash
gh api -X POST "repos/mkrlabs/specflow/issues/$PR/labels" -f "labels[]=docs:not-needed"
```

Then merge once green:

```bash
gh api -X PUT "repos/mkrlabs/specflow/pulls/$PR/merge" -f merge_method=squash
```

- [ ] **Step 6: Close the issue via the PO subagent**

Per CLAUDE.md, "Every backlog mutation goes through the `product-owner` subagent." Dispatch the PO
with a brief instruction to close #265 with `reason: completed`, referencing the merged PR in the
close comment. Do NOT call `gh issue close` from the main session.

- [ ] **Step 7: Local cleanup**

```bash
git switch main
git pull
git branch -D 265-skill-aliases-overlays
```

---

## Verification

End-to-end after all tasks:

1. **Test suite** — `deno task test` is green at every commit boundary (TDD anchor in Task 1 Step
   1-2, full suite at every task's "Run tests" step).
2. **Bundle integrity** — `deno task bundle` succeeds and `src/templates_bundle.ts` reflects the new
   manifest entry. The `assertAllSourcesPresent` check confirms `list-skills.md` exists at the
   manifested path.
3. **Plugin sync** — `tests/plugin/plugin_sync_test.ts` passes with the new `list-skills` pair.
   Adding a phase without its plugin twin breaks the test loudly.
4. **Windsurf cap** — `tests/infrastructure/harness/windsurf_harness_test.ts` confirms the router
   SKILL.md stays under 12000 rendered chars (current 6343 + ~500 added = ~6800, well clear of the
   cap).
5. **Pre-commit gates** — every commit hits `deno fmt --check`, `deno lint`, `deno task bundle`,
   `deno check src/main.ts` (the pre-commit hook described in CLAUDE.md). Markdown lint surprises
   get fixed inline with `deno fmt <file>`.
6. **Mental smoke** — `/specflow list-skills` on a project with one alias produces a markdown table
   with NAME, KIND=alias, ALIAS OF=<target>, OVERLAYS listed, DESCRIPTION truncated. No phase-doc
   bug surfaces (the doc is markdown, executed by the harness LLM).

## Out of scope (do NOT do)

- **Adding YAML schema validation** for `alias_of` / `overlays` in TypeScript. There is no existing
  SKILL.md schema in the codebase (architect confirmed: zero parsers, zero Zod, zero strip-unknowns
  logic in `scripts/bundle-templates.ts:64-72`). Introducing one for two optional fields is a 10x
  over-build.
- **Wiring the `alias-example` into `templates/manifest.json`.** The example is deliberately
  documentation-only — see "Spec deviations" at the top of this plan.
- **Implementing alias cycle detection** anywhere in Specflow. Per #265 AC, that is the harness's
  responsibility at dispatch time.
- **Building a `specflow check --skills` CLI subcommand.** The `list-skills` phase achieves
  equivalent UX without any binary changes; reserve a binary subcommand for a future ticket if the
  phase proves insufficient.
- **Auto-generating overlay scripts** during `specflow init`. Per #265 AC, out of scope.
- **Renaming any existing phase or skill** to align with the new convention. The new fields are
  purely additive.

## PR adoption block

The PR body in Task 5 Step 4 already includes the `## Agent adoption` section per
`.github/pull_request_template.md`. No further work needed at PR time.
