# Upgrade Adoption Design

**Status:** Draft (brainstorming output — awaiting Kevin's review before plan) **Date:** 2026-05-16
**Author:** brainstorming session with Kevin

## Problem

`specflow upgrade` does its job mechanically: it diffs the bundled templates against the recorded
lock, applies safe changes, preserves customizations, and exits. But the **AI agent that lives in
the project afterward has no idea anything happened.** It can't tell the user "you just got feature
X — to adopt it in this codebase, do Y". The user is on their own to:

1. Read the GitHub Release notes (which are a flat changelog with no adoption guidance).
2. Figure out what each new feature means for _their_ project.
3. Manually rewrite agent files, skills, and rules that reference replaced commands.
4. Reconcile any files they customized against new upstream versions, armed only with a unified diff
   dumped in their terminal.

The result: people upgrade and don't actually pick up the new features. PR #252 (auto-chain by
default) is a perfect example — the release notes say what shipped, but not what you need to change
in _your_ `.claude/agents/` to take advantage of it.

## Goal

Turn `specflow upgrade` into the start of an agent-assisted adoption flow: each release ships
pre-written **adoption prompts** for its features, the upgrade prints a handoff line, and the
`specflow-expert` agent walks the user through what changed, optionally creating a review branch and
reconciling customized files one by one.

Three outcomes:

1. **Adoption prompts authored at PR time** — each `feat:` PR carries a `## Agent adoption` section
   with a ready-to-paste prompt explaining what to do in an existing project. Reviewable, versioned,
   shippable.
2. **Enriched release notes** — `gen-changelog.ts` aggregates those sections into a structured
   `### Adoption guide` block in the GitHub Release body.
3. **Agent-guided upgrade review** — `@specflow-expert review-upgrade` reads a small marker file
   dropped by `specflow upgrade`, fetches the release notes for the version delta, optionally
   creates a review branch, plays each adoption prompt one at a time (via the `developer` subagent),
   and walks the user through every customized file with a `keep / take / merge` choice.

## Non-goals

- Automatic execution of adoption prompts without user opt-in. The user always sees the prompt and
  chooses `a/s/c/q` per item.
- Replacing the existing customization-preservation logic (`computeUpgradePlan`). The new flow sits
  _on top of_ it; the plan still drives what's preserved and what's auto-updated.
- A GUI / web companion for reconciliation. Terminal-only, agent-driven.
- Migrating between backlog backends (already handled by `switchBacklogBackend`).
- Cross-release adoption skipping (e.g., "I'm on 1.0, jumping to 2.0"). The agent handles ranges via
  the GitHub Releases list endpoint but doesn't attempt smart consolidation — it presents N adoption
  prompts in chronological order.

## Architecture overview

```
┌────────────────────────────────────────────────────────────────┐
│ Author time (per PR)                                           │
│   PR template gains `## Agent adoption` section                │
│   CI lint enforces presence on feat: PRs                       │
└────────────────────────────────────────────────────────────────┘
                          ▼
┌────────────────────────────────────────────────────────────────┐
│ Release time (gen-changelog.ts)                                │
│   For each feat: commit, fetch PR body, extract Agent adoption │
│   Emit `### Adoption guide` block in release notes             │
│   Attached to GitHub Release body via softprops/action-gh-release │
└────────────────────────────────────────────────────────────────┘
                          ▼
┌────────────────────────────────────────────────────────────────┐
│ Upgrade time (specflow upgrade)                                │
│   Apply bundle changes (existing behavior)                     │
│   Write `.specflow/upgrade-pending.json` marker                │
│   Write upstream version of preserved files to                 │
│     `.specflow/upgrade-staging/<path>`                         │
│   Print handoff:                                               │
│     → @specflow-expert review-upgrade                          │
└────────────────────────────────────────────────────────────────┘
                          ▼
┌────────────────────────────────────────────────────────────────┐
│ Review time (specflow-expert review-upgrade mode)              │
│   1. Read marker → from/to/at                                  │
│   2. Fetch release bodies for tag range via GitHub API         │
│   3. Parse `### Adoption guide` sections                       │
│   4. Optionally create review branch                           │
│   5. Walk adoption prompts one by one (dispatch developer)     │
│   6. Walk preserved files (specflow reconcile per file)        │
│   7. Cleanup marker + staging                                  │
└────────────────────────────────────────────────────────────────┘
```

## Component 1: PR `## Agent adoption` convention

**Rule:** Every `feat:` PR body MUST contain a `## Agent adoption` section. `fix:` / `chore:` /
`refactor:` / `docs:` PRs may have one (silent skip if absent).

**Format:** Markdown. Prose intro followed by a fenced code block holding the adoption prompt.

**Example (hypothetical body of PR #252):**

````markdown
## Summary

…

## Agent adoption

`/specflow specify "<feature>"` now chains every phase through to `review` in a single session. If
your project has agent rules or documentation pointing users at `/specflow-auto`, update them to
`/specflow specify`. `--manual` is the per-phase opt-out and replaces the old `/specflow-auto`
workflow when one-shot per phase is wanted.

```prompt
Audit my project for any reference to `/specflow-auto` in:
  - `.claude/agents/*.md`
  - `.cursor/rules/*.mdc`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`

Replace each with `/specflow specify "<…>"`. Add a brief note
explaining `--manual` is the per-phase opt-out. Open a PR with the
changes.
```
````

**Validation:**

A new CI workflow `.github/workflows/pr_adoption_lint.yml` runs on `pull_request` events and:

1. Checks the PR title prefix. If `feat:` (or `feat(scope):`), proceeds.
2. Fetches the PR body via `gh pr view` or the workflow's `${{ github.event.pull_request.body }}`.
3. Greps for `^## Agent adoption\b` and at least one `` ```prompt `` fenced block underneath.
4. If missing on a `feat:` PR: fails with a clear message:
   `feat: PRs must include a "## Agent adoption" section in the body.
   See docs/contributing.md#agent-adoption.`
5. On non-`feat:` PRs: passes unconditionally (section optional).

**PR template:** `.github/pull_request_template.md` (does not yet exist in this repo — we add it)
ships with the skeleton pre-populated:

````markdown
## Summary

<!-- one paragraph: what does this PR change? -->

## Agent adoption

<!-- Required for feat: PRs. Delete this section for fix:/chore:. -->

<!-- Prose: what existing projects need to know -->

```prompt
<!-- Ready-to-paste prompt for an AI agent to adopt the change -->
```
````

**Contributor docs:** A new `docs/contributing.md` section explains the convention, gives 2–3
example sections, and links to the `/specflow specify` PR (#252) as the canonical reference.

## Component 2: Release notes format

**Today (`gen-changelog.ts`):**

```markdown
## What's changed in v1.5.0

### Features

- /specflow auto-chains by default; /specflow-auto deprecated (#252)

### Bug fixes

- Use absolute path for llms.txt link on /docs/ page (#251)

### Internal / chores

<details>
<summary>2 internal changes</summary>
…
</details>
```

**After:**

````markdown
## What's changed in v1.5.0

### Features

- /specflow auto-chains by default; /specflow-auto deprecated (#252)

### Bug fixes

- Use absolute path for llms.txt link on /docs/ page (#251)

### Adoption guide

These prompts help your AI agent adopt the new features in an existing project. Copy them into your
harness, or run `@specflow-expert review-upgrade` to be walked through automatically.

**#252 — Auto-chain by default**

`/specflow specify "<feature>"` now chains every phase through to `review` in a single session. If
your project has agent rules or documentation pointing users at `/specflow-auto`, update them to
`/specflow specify`. `--manual` is the per-phase opt-out…

```prompt
Audit my project for any reference to `/specflow-auto` in…
```
````

### Internal / chores

<details>
<summary>2 internal changes</summary>
…
</details>
```

**Mechanics (in `scripts/gen-changelog.ts`):**

For each commit classified as `feat`:

1. Match the subject for `(#NNN)$`. If present, extract the PR number.
2. Call `gh pr view <NNN> --json body --jq .body`. Cache results in a `Map<number, string>` to avoid
   double-fetches.
3. Extract the substring between `## Agent adoption` and the next `^##` header (or EOF). Strip
   leading/trailing whitespace.
4. If the section is missing on a `feat:` commit: emit a warning to stderr but do not fail the build
   (the CI lint in Component 1 is the gate; `gen-changelog.ts` stays best-effort).
5. Aggregate the extracted sections in a `### Adoption guide` block placed after `### Bug fixes` and
   before `### Internal / chores`.

`formatChangelog` gains a new param `adoptionEntries: Array<{prNum,
title, body}>` and renders the
block when non-empty. Existing tests in `tests/scripts/gen_changelog_test.ts` (or equivalent —
verify) are extended with a fixture covering the adoption flow.

The release workflow (`.github/workflows/release.yml`) needs the `gh` CLI available (already used
elsewhere) and access to public PR bodies (no extra token — public repo).

## Component 3: CLI handoff + upgrade marker

**Marker file `.specflow/upgrade-pending.json`:**

```json
{
  "from": "1.4.0",
  "to": "1.6.0",
  "at": "2026-05-16T14:33:00.000Z"
}
```

Three fields only. The list of preserved files is **not** duplicated here —
`specflow reconcile --status` is the live source of truth (it inspects `.specflow/upgrade-staging/`,
which shrinks as files are reconciled). Keeping the marker minimal avoids stale state.

**Lifecycle:**

| Event                                                                        | Effect                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specflow upgrade` → `applied` with no marker present                        | Write a fresh marker.                                                                                                                                                                                                     |
| `specflow upgrade` → `applied` with marker already present (chained upgrade) | **Preserve the existing `from`**, update `to` to the new version, update `at`. Staging directory gets the latest upstream content per preserved path (overwrites). User's pending review still covers the original range. |
| `specflow upgrade` → `up-to-date` or `--dry-run`                             | Touch nothing.                                                                                                                                                                                                            |
| `specflow-expert review-upgrade` → completed                                 | `rm` the marker.                                                                                                                                                                                                          |

**Staging directory `.specflow/upgrade-staging/`:**

For each `preserve` action in the upgrade plan, the CLI writes the _upstream_ (bundled-template)
version into `.specflow/upgrade-staging/<path>` — same path tree, just re-rooted. The on-disk
project file remains the user's customized version.

On chained upgrades, the staging file is overwritten with the latest upstream content (intermediate
versions are lost — acceptable because reconciliation compares the user's customization to the
latest-upstream, not to historical intermediates).

**Gitignore:** `templates/core/root/.gitignore` gains:

```
.specflow/upgrade-pending.json
.specflow/upgrade-staging/
```

Existing projects pick this up via the merge-block logic in `merge_block.ts` — the `# specflow`
block is updated in place.

**Handoff stdout (end of `runUpgrade`):**

Replaces the current single-line `✓ upgraded to templates 1.6.0`:

```
✓ upgraded to templates 1.4.0 → 1.6.0

→ Walk through what's new with your AI:
  `@specflow-expert review-upgrade`

  (proposes a review branch, plays adoption prompts for each new
   feature, and helps you reconcile any customized files)
```

Conditions:

- Only printed when `status === "applied"`.
- Printed even if the range contains only `fix:` / `chore:` releases — reconciliation of customized
  files is still useful.

**Code touched:**

- `src/application/upgrade_project.ts`:
  - After computing the plan, write staging files for each `preserve` action via
    `writer.writeBundle` with destinations prefixed by `.specflow/upgrade-staging/`.
- `src/cli/handlers/upgrade_handler.ts`:
  - `runUpgrade` writes the marker via a new `UpgradeMarkerStore` port and prints the handoff.
    Merges with existing marker when present (preserves original `from`, updates `to` and `at`).
- `src/application/ports.ts`:
  - New port `UpgradeMarkerStore` with `read(projectDir)`, `write(projectDir, marker)`,
    `delete(projectDir)`.
- `src/infrastructure/fs_upgrade_marker_store.ts`:
  - Filesystem implementation (`Deno.readTextFile` / `Deno.writeTextFile` / `Deno.remove`).
- `src/domain/upgrade_marker.ts`:
  - Pure type + JSON schema validation + merge helper.

**Tests:**

- `tests/domain/upgrade_marker_test.ts` — schema validation, merge helper (chained upgrade preserves
  `from`).
- `tests/application/upgrade_project_test.ts` — adds assertions that staging files are written for
  every `preserve` action.
- `tests/integration/upgrade_test.ts` — asserts marker file exists after apply, handoff line is in
  stdout, no marker after `--dry-run` / `up-to-date`.
- `tests/infrastructure/fs_upgrade_marker_store_test.ts` — round-trips a marker.

## Component 4: `specflow-expert` `review-upgrade` mode

**Trigger:** the agent's dispatch message contains the literal keyword `review-upgrade` (matched
case-insensitive, word-boundary-aware to avoid catching false positives like "review upgrade-related
code").

**Frontmatter changes (`templates/core/agents/specflow-expert.md` + plugin mirror):**

`tools` extended from `Read, WebFetch, Grep, Glob` to `Read, WebFetch, Grep, Glob, Bash, Agent`.

Rationale:

- `Bash` — git ops (`git status`, `git checkout -b`, `git add`, `git commit`) + invoking
  `specflow reconcile` (Component 5).
- `Agent` — dispatching `developer` to apply adoption prompts and merge files.

The agent stays read-only on files (no `Edit` / `Write`) — file changes go through `developer`
dispatches or the `specflow reconcile` CLI.

**Protocol added to the agent body** (new section between `## Bug report protocol` and
`## Vendored knowledge snapshot`):

````markdown
## Review-upgrade protocol

Trigger: the user's dispatch contains `review-upgrade`.

### 1. Read the marker

Read `.specflow/upgrade-pending.json`. If absent or unreadable:

> No recent upgrade marker. Run `specflow upgrade` first, then dispatch me again with
> `review-upgrade`.

Exit.

### 2. Fetch release bodies

For each version tag in the range `(marker.from, marker.to]` (exclusive of `from`, inclusive of
`to`):

- WebFetch `https://api.github.com/repos/mkrlabs/specflow/releases/tags/v<TAG>`.
- Extract `body`.
- Parse the `### Adoption guide` section: scan for `^\*\*#(\d+) — (.+?)\*\*$` headers; each header
  is followed by a prose paragraph and a `` ```prompt … ``` `` block.

Aggregate into `adoption: Array<{version, prNum, title, prose, prompt}>`.

If GitHub API fails: explain to the user, fall back to the vendored knowledge snapshot for
high-level guidance, and skip the structured walk (no prompts to play).

### 3. Present the plan

Output a summary:

> 📦 Upgrade review — v{from} → v{to} (upgraded {at})
>
> Releases in range: • v1.5.0 — N feature(s) • v1.6.0 — N feature(s) + N fix(es)
>
> Adoption prompts ({count}):
>
> 1. v1.5.0 #252 — Auto-chain by default
> 2. ...
>
> Customized files preserved by the upgrade ({count}): • .claude/agents/developer.md • ... → I'll
> walk you through these after the adoption prompts.
>
> Want me to put all this on a fresh branch `specflow-upgrade-v{to}` so you can review the result as
> a PR? [Y/n]

### 4. Branch (optional)

If user answers `Y`:

1. Run `git status --porcelain`.
2. If working tree has upgrade-related changes (un-committed): create branch and commit them.
````

git checkout -b specflow-upgrade-v{to} git add -A git commit -m "chore: specflow upgrade v{from} →
v{to}"

```
3. If working tree is clean (user already committed): say so, skip
branch.
4. If working tree has unrelated changes: refuse politely:
> Your working tree has changes I didn't expect. Please stash or
> commit them, then dispatch me again.

If `n`: continue on the current branch.

### 5. Walk adoption prompts

For each entry in `adoption`, in order:
```

─── {i}/{N} ─── v{version} #{prNum} — {title}

{prose}

Prompt:

> {prompt}

Action: [a] Run it (I'll dispatch the developer agent) [s] Skip (not applicable to this project) [c]
Show me the prompt verbatim so I can customize it [q] Quit — I'll resume next time

```
- `a`: dispatch `developer` subagent with the prompt as the task and
  context `{version, prNum, on review branch: <yes/no>}`. After the
  developer reports back, if `git diff --quiet` shows the working
  tree is dirty, commit on the review branch (if one):
  `feat(adoption): #{prNum} {title}`. If the developer made no
  changes (`git diff --quiet` clean), skip the commit and tell the
  user "No changes needed in this project for this feature."
- `s`: note "skipped" in memory; no persistence.
- `c`: print the raw prompt in a code block, then re-prompt with
  `a/s/q` (no `c` second time).
- `q`: end the walk early, retain marker + staging for resume.

### 6. Reconcile customized files

After the adoption walk completes (or is skipped), proceed to
Component 5 (file-by-file walk). See that section for the per-file
loop.

### 7. Cleanup

When both walks finish without user `s` (skip-later) or `q`:

- Remove `.specflow/upgrade-pending.json` and
  `.specflow/upgrade-staging/`.
- If on a review branch: final commit `chore: complete specflow
  upgrade review v{from} → v{to}` (summarizing what was applied vs
  skipped).
- Tell the user they can open a PR from the review branch.

If user used `s` / `q` anywhere: leave marker + staging intact; tell
the user to resume with `review-upgrade` later.
```

**Coexistence with Q&A mode:** All existing protocols (live fetch, version check, bug report,
vendored knowledge) stay intact. The `review-upgrade` mode is gated by the keyword. Outside that
keyword, the agent answers questions exactly as today.

**Disable-model-invocation:** stays `false` (no change). The agent is manually dispatched in this
mode.

**Code touched:**

- `templates/core/agents/specflow-expert.md` — adds the protocol section, extends `tools`
  frontmatter.
- `plugin/agents/specflow-expert.md` — byte-identical mirror.
- `.claude/skills/test-sandbox/scripts/smoke-features.sh` — new block asserting:
  - `templates/core/agents/specflow-expert.md` contains `## Review-upgrade protocol`
  - Plugin mirror is byte-identical
  - `tools:` line includes `Bash` and `Agent`

## Component 5: `specflow reconcile` subcommand + file walk

**Subcommand surface:**

```
specflow reconcile <path> --accept-upstream
specflow reconcile <path> --accept-current
specflow reconcile --status
```

**`specflow reconcile <path> --accept-upstream`:**

1. Verify `<path>` exists in `.specflow/upgrade-staging/`. If not: exit non-zero with
   `no pending reconciliation for <path>`.
2. Verify `<path>` has a lock entry. If not: exit non-zero with `<path> is not tracked by Specflow`.
3. Back up the on-disk version to `<path>.specflow.bak`.
4. Copy `.specflow/upgrade-staging/<path>` → `<path>`.
5. Compute SHA-256 of new content. Update the lock entry's `sha256`, `installedAt: now`,
   `templatesVersion: marker.to`.
6. Remove `.specflow/upgrade-staging/<path>`.
7. If staging dir now empty: `rmdir`.
8. Print `✓ reconciled <path> — took upstream`.

**`specflow reconcile <path> --accept-current`:**

1. Verify `<path>` exists in `.specflow/upgrade-staging/`. If not: error.
2. Verify project `<path>` exists. If not: error (file deleted post-upgrade).
3. Compute SHA-256 of current on-disk content. Update lock entry to that SHA, `installedAt: now`,
   `templatesVersion: marker.to`.
4. Remove `.specflow/upgrade-staging/<path>`.
5. If staging dir empty: `rmdir`.
6. Print `✓ reconciled <path> — kept local`.

**`specflow reconcile --status`:**

Print JSON:

```json
{
  "pending": [
    ".claude/agents/developer.md",
    ".claude/skills/specflow/SKILL.md"
  ],
  "stagingDir": ".specflow/upgrade-staging"
}
```

If staging dir absent: `{"pending": [], "stagingDir": null}`.

Used by specflow-expert to iterate. JSON only (no text mode in V1).

**Mutual exclusivity:** `--accept-upstream` and `--accept-current` are mutually exclusive.
`--status` takes no positional. The parser enforces.

**File walk (continuation of specflow-expert review-upgrade Section 6):**

```
specflow reconcile --status   ← JSON parsed by agent
```

For each path returned:

```
─── File {i}/{N} ─── {path}

You customized this file. The new template (v{to}) has changes too.

Diff summary: +{N} / -{N} lines

Action:
  [k] Keep my version (lock it in — next upgrade won't re-flag this)
  [t] Take the upstream version (overwrites my customizations, backed up)
  [m] Merge intelligently — I'll dispatch `developer` to combine both
  [v] View full diff
  [s] Skip — decide later (file stays customized, will re-flag next upgrade)
```

- `k`: `specflow reconcile <path> --accept-current`. Commit (if on review branch):
  `chore(reconcile): keep local <path>`.
- `t`: `specflow reconcile <path> --accept-upstream`. Commit:
  `chore(reconcile): take upstream <path>`.
- `m`: dispatch `developer` with:
  > Merge two versions of `<path>`.
  >
  > - Local (the user's customization): `<path>`
  > - Upstream (new template): `.specflow/upgrade-staging/<path>`
  >
  > Goal: keep the user's intentional customizations while pulling in upstream's improvements. Write
  > the merged result directly to `<path>`. Report the high-level reasoning for your merge.

  Then `specflow reconcile <path> --accept-current`. Commit:
  `chore(reconcile): merge upstream into <path>`.
- `v`: shell out to `diff -u <path> .specflow/upgrade-staging/<path>`, print, re-prompt with
  `k/t/m/s`.
- `s`: leave file + staging entry untouched. Reduce pending count.

**Diff summary:** Computed by the agent via Bash:
`diff <path> .specflow/upgrade-staging/<path> | grep -c '^>'` (added) and `grep -c '^<'` (removed).
Approximate counts are fine; the user sees the full unified diff with `v`.

**Code touched:**

- `src/domain/reconcile.ts` (new) — pure helpers:
  - `loadStaging(projectDir)` → returns list of staging paths.
  - `acceptUpstream(...)` → returns the new lock entry + write/delete operations to perform (data
    shape only).
  - `acceptCurrent(...)` → same shape.
- `src/application/reconcile_path.ts` (new) — use case wiring `reader`, `writer`, `lockStore`,
  `stagingStore`.
- `src/infrastructure/fs_staging_store.ts` (new) — fs operations on the staging dir.
- `src/cli/handlers/reconcile_handler.ts` (new) — CLI routing, handles `--accept-upstream` /
  `--accept-current` / `--status`.
- `src/cli/parser.ts` — new `reconcile` subcommand.
- `src/cli/help.ts` — usage text.
- `src/cli/handlers/upgrade_handler.ts` — already writes the marker (Component 3); no further
  changes needed for reconcile.
- `src/application/upgrade_project.ts` — after computing the plan, write staging files. (Already
  noted in Component 3.)
- `templates/core/root/.gitignore` — adds `.specflow/upgrade-pending.json` and
  `.specflow/upgrade-staging/`.

**Tests:**

- `tests/domain/reconcile_test.ts` — pure helpers, all branches.
- `tests/application/reconcile_path_test.ts` — use case with mocks.
- `tests/integration/reconcile_test.ts` — end-to-end fixture: upgrade a brownfield project with a
  customized file, run `specflow reconcile
  --status`,
  `specflow reconcile <path> --accept-upstream`, assert file content + lock SHA + staging removed.
- `tests/integration/reconcile_test.ts` (continued) — same fixture with `--accept-current`.

## Component 6: Documentation surface (cross-cutting)

**Principle:** every command, flag, file path, convention, and workflow introduced by this design
must be discoverable by an AI agent reading the canonical docs _without prior session context_. If
an agent can't learn it from `https://specflow.makerlabs.dev/llms.txt` (the published docs) plus the
bundled `specflow-expert` vendored snapshot, the doc is incomplete.

This rules out implicit-only behavior. The CLI handoff line, the marker schema, the staging
directory, the `specflow reconcile` subcommand, the `review-upgrade` agent mode, and the
`## Agent adoption` PR convention all get explicit prose + examples in the docs.

### `docs/llms.md` — additions

`docs/llms.md` is the source of truth that gets deployed to
`https://specflow.makerlabs.dev/llms.txt` (and mirrored to the GitHub wiki by `wiki.yml`). It's read
raw by any AI harness on demand. The following sections are added or extended:

1. **Top-level "Upgrades & adoption" section** (new, sibling to the existing command reference) — a
   single canonical place that explains:
   - What `specflow upgrade` does (already exists; cross-link).
   - The handoff line and what it means.
   - How an AI agent should react when it sees `.specflow/upgrade-pending.json` in a project
     (proactively suggest dispatching `specflow-expert review-upgrade`).
   - The full `review-upgrade` workflow narratively, end-to-end, so an agent reading just this doc
     can replicate the walk-through without dispatching specflow-expert if needed.

2. **`specflow reconcile` command reference** — added to the command table near `specflow upgrade`:

   ```
   specflow reconcile --status
     Print a JSON object listing files pending reconciliation
     (post-upgrade customized files in `.specflow/upgrade-staging/`).

   specflow reconcile <path> --accept-upstream
     Take the new template version. Backs up the local file to
     `<path>.specflow.bak`, copies upstream content into place,
     and updates `.specflow/installed.lock`.

   specflow reconcile <path> --accept-current
     Keep the local customized version. Re-stamps the lock SHA to
     match on-disk content (so the next upgrade does NOT re-flag
     this file as preserved).
   ```

3. **`.specflow/upgrade-pending.json` schema** documented inline so an agent inspecting the file can
   parse it correctly (fields, types, lifecycle).

4. **`.specflow/upgrade-staging/` directory** documented as the source of upstream content during
   reconciliation, with the path-mirroring convention.

5. **`## Agent adoption` PR convention** — a contributor-facing subsection under a new
   "Contributing" block (or as an extension of the existing one), including the format, the CI lint,
   and a reference example.

6. **`specflow-expert review-upgrade` mode** — under the existing sub-agents section. Documents the
   trigger keyword, the workflow steps at a high level, and the user options (`a/s/c/q`,
   `k/t/m/v/s`).

7. **`specflow upgrade` handoff line** documented in the section on `specflow upgrade` itself. An
   agent that runs `specflow upgrade` in a project (e.g., during a tooling refresh) will see the
   handoff and know to either dispatch `specflow-expert` or run the walk-through itself per the
   documented protocol.

### `specflow-expert` vendored snapshot

The `## Vendored knowledge snapshot` section inside `templates/core/agents/specflow-expert.md` (and
its plugin mirror) is frozen at scaffold time. It gains:

- A "Commands" subsection entry for `specflow reconcile` with the same three-mode reference as
  above.
- A "Files written by `specflow upgrade`" subsection enumerating the marker and staging directory,
  with paths and lifecycle.
- A pointer to `## Review-upgrade protocol` (the protocol section itself, also in this file) so an
  agent reading the vendored snapshot during offline operation has the full picture.

### `README.md` — minimal

The repo README gets one short paragraph under "Upgrading" pointing at the AI-assisted review flow:

> After `specflow upgrade`, run `@specflow-expert review-upgrade` in your AI harness to walk through
> what changed and adopt new features in your project. See `docs/llms.md` for the full protocol.

No protocol detail in the README — keeps it tight.

### `docs/contributing.md`

A new file (the repo currently has no `docs/contributing.md`) covers:

- The `## Agent adoption` convention (full format spec).
- 2–3 worked examples (one for a refactor-style `feat:`, one for a new command, one for a
  deprecation).
- How the CI lint works and what message it emits on failure.
- The PR template skeleton (which itself references this doc).

### `specflow --help` and `specflow reconcile --help`

CLI usage text is the third documentation surface (after `llms.md` and the agent vendored snapshot).
The new `reconcile` subcommand needs a detailed `--help` block covering all three modes with
examples. The top-level `specflow --help` lists `reconcile` alongside `upgrade` / `check` / `init` /
`self-update`.

### Wiki sync

`wiki.yml` mirrors `docs/llms.md` to `https://github.com/mkrlabs/specflow/wiki` on every `main`
push. No changes needed — the new sections flow through automatically.

### Documentation-as-acceptance-criterion

For each implementation PR, "docs updated" is on the checklist:

- Component 1 PR — `docs/contributing.md` + PR template.
- Component 2 PR — release-notes excerpt in `docs/llms.md` shows the new `### Adoption guide` shape.
- Component 3 PR — `docs/llms.md` "Upgrades & adoption" section, handoff line, marker schema.
  `specflow upgrade --help` mentions the handoff.
- Component 4 PR — vendored snapshot updated, `review-upgrade` protocol cross-linked from
  `docs/llms.md`.
- Component 5 PR — `specflow reconcile` documented in `docs/llms.md`, vendored snapshot, and
  `--help`.

A smoke assertion in `.claude/skills/test-sandbox/scripts/smoke-features.sh` verifies, for each new
doc anchor, that the corresponding heading exists in both `docs/llms.md` and the vendored snapshot.
This is the same drift-prevention pattern used elsewhere in the repo.

## Edge cases

| Case                                                                                                      | Behavior                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project file deleted between upgrade and reconcile                                                        | `reconcile <path>` errors. Agent presents the file as "missing — skip".                                                                                                                                                  |
| Staging file corrupted / absent                                                                           | `reconcile <path>` errors with `staging missing for <path>`. Agent advises re-running `specflow upgrade`.                                                                                                                |
| User customizes a file _after_ the upgrade and _before_ reconcile                                         | The diff and `--accept-current` reflect the latest on-disk content (with the new customizations).                                                                                                                        |
| User runs `specflow upgrade` twice quickly without reconcile                                              | Marker merges (`from` preserved, `to` and `at` updated). Staging files are overwritten with the latest upstream — `reconcile --status` reflects the union of preserved paths across both upgrades.                       |
| `specflow reconcile <path>` called with no marker present                                                 | Errors with `no upgrade pending`. The user runs `specflow upgrade` first.                                                                                                                                                |
| `specflow reconcile <path>` on a path not in staging                                                      | Errors with `no pending reconciliation for <path>`.                                                                                                                                                                      |
| User aborts mid-review (`q` in adoption walk)                                                             | Marker + staging stay on disk. Resume with `@specflow-expert review-upgrade`. Skipped prompts are NOT re-asked — but since no persistence, they re-appear on resume; the user simply skips again. **Acceptable for V1.** |
| `feat:` PR was merged without an `## Agent adoption` section (CI lint bypassed or pre-existed convention) | `gen-changelog.ts` emits a stderr warning. The adoption guide for that PR is absent. The release ships with one fewer entry; manual amendment to the release body is possible after the fact.                            |
| GitHub API rate limit during `review-upgrade`                                                             | Live fetch protocol falls back to vendored snapshot (already handled). Walk skipped with a note: "Couldn't fetch release notes; high-level adoption guidance only."                                                      |
| User on the default branch when invoking `review-upgrade`                                                 | The branch step proposes a fresh branch (preferred) but doesn't refuse.                                                                                                                                                  |
| User declines the branch and then accepts an adoption prompt that modifies many files                     | All edits land on the current branch. Existing per-prompt commits still happen if `developer` decides to commit. The user gets a less clean history but no broken state.                                                 |

## Implementation order

Each component is one or two PRs. Suggested order, smallest-first:

1. **Component 1 (PR convention)** — PR template, contributing docs, CI lint. Land first so the
   convention is in place before we consume it. Self-contained; no runtime change.
2. **Component 2 (changelog enrichment)** — `gen-changelog.ts` extension. Depends on Component 1
   (PRs needing the section). Can land before the rest because it's harmless if no PR has the
   section yet (warnings only).
3. **Component 3 (CLI marker + handoff)** — new ports, marker file, stdout handoff. Standalone;
   doesn't need the agent or reconcile to work.
4. **Component 5 (reconcile subcommand)** — new CLI subcommand. Tested independently.
   specflow-expert calls into it.
5. **Component 4 (specflow-expert review-upgrade)** — last, because it composes all the previous
   components.

Tests gate each PR. Smoke assertions added in PR 5 cover the full chain. **Documentation lands with
each PR**, not as a follow-up sweep — see Component 6.

## Open questions resolved during brainstorming

- **Source of adoption prompts** → hand-written per PR (not LLM-generated).
- **Discovery mechanism** → CLI prints a handoff line (no autotrigger).
- **Branch ownership** → `specflow-expert` creates it on demand.
- **MVP scope** → ship both adoption guide and reconciliation together.
- **Release notes format** → `### Adoption guide` section in the same release body (not a separate
  file).
- **specflow-expert tool surface** → gains `Bash` + `Agent`; stays read-only on files; dispatches
  `developer` for edits.
- **Reconcile granularity** → one file at a time, with `k/t/m/v/s`.
- **Backup on take-upstream** → automatic to `<path>.specflow.bak` (mirrors the existing `--force`
  upgrade backup convention).
- **Documentation surface** → every new command, file path, schema, and convention is documented in
  `docs/llms.md`, the `specflow-expert` vendored snapshot, and the CLI `--help` output. Each
  implementation PR ships its own doc updates (no follow-up sweep). Verified by smoke assertions on
  the heading anchors.

## Out of scope (future work)

- **Persistent skip state.** If the user skips a prompt with `s`, the next `review-upgrade` re-asks.
  A future enhancement could record skipped prompts in the marker and suppress them.
- **Adoption prompt versioning.** If a `feat:` PR's adoption prompt is incorrect after merge, today
  there's no way to amend without editing the release body manually. Future: a `release-notes/`
  directory under version control with the structured adoption guide, treated as the source of
  truth.
- **Cross-PR adoption consolidation.** Five small features might share one adoption strategy. V1
  plays them one by one; V2 could group.
- **`specflow upgrade --review-only`** that runs the review walk against an existing marker without
  re-applying templates.
- **Adoption prompts for `fix:` PRs that change behavior.** V1 restricts the convention to `feat:`.
  If a bug fix shifts public behavior, the PR can adopt the section voluntarily; CI just doesn't
  enforce it.
