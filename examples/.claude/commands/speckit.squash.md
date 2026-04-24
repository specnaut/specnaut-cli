---
description: Squash all commits on a feature branch into a single commit with a clean message.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

Squash all feature-related commits on the current branch into a single,
well-crafted commit. The feature number is provided as `$ARGUMENTS`
(e.g., `152`).

### Step 1: Validate Branch

1. Parse the feature number from `$ARGUMENTS`. If empty or not a number:
   **ERROR** — "No feature number provided. Usage: `/speckit squash NNN`"

2. Get the current git branch name:

   ```bash
   git branch --show-current
   ```

3. Verify that the current branch name **starts with the feature number**
   followed by a dash (e.g., `152-notice-draft-publish` for feature `152`).
   - **If the branch does NOT match**: **STOP** and report:
     "You are on branch `{current_branch}`, which does not match feature
     {number}. Please checkout the correct branch first."
   - **If the branch matches**: proceed to Step 2.

### Step 2: Identify Changes to Squash

1. List all commits on the current branch that are **not on `main`**:

   ```bash
   git log --oneline HEAD --not main
   ```

2. Also check for uncommitted changes:

   ```bash
   git status --short
   ```

3. **Determine the scenario**:
   - **Multiple commits (≥2), with or without uncommitted changes**:
     Classic squash — proceed to show commit list and ask confirmation.
   - **1 commit + uncommitted changes**: Amend the uncommitted changes
     into the existing commit (show both the commit and the uncommitted
     files, ask confirmation).
   - **0 commits + uncommitted changes**: All work is uncommitted — this
     is valid! Stage everything and create a single feature commit.
     Show the list of changed files and ask confirmation.
   - **0 commits + no uncommitted changes**: **STOP** and report:
     "No commits and no uncommitted changes found — nothing to squash."
   - **1 commit + no uncommitted changes**: **STOP** and report:
     "Only 1 commit found and working tree is clean — nothing to squash."

4. **Display the preview to the user** and ask for confirmation:

   ```text
   🔀 Squash Preview for feature {number}

   {count} commits to squash into 1:
   {commit list — newest first, if any}

   {number of uncommitted files} uncommitted files to include:
   {file list, if any}

   Proceed with squash? (yes/no)
   ```

   (Omit the "commits" or "uncommitted files" section if that category
   is empty.)

5. **Wait for the user's response**:
   - If the user says "no", "cancel", "stop", or "wait": **STOP** — do
     not squash.
   - If the user says "yes", "y", "go", "oui", "ok", or "proceed":
     continue to Step 3.

### Step 3: Execute Squash

**Scenario A — Multiple commits exist (≥2):**

1. Find the merge base with `main`:

   ```bash
   git merge-base main HEAD
   ```

2. Soft-reset to that parent commit to stage all changes:

   ```bash
   git reset --soft {merge_base}
   ```

3. Stage any remaining uncommitted changes:

   ```bash
   git add -A
   ```

4. Read the spec title from `specs/{number}-*/spec.md` if it exists,
   and review all squashed commit messages for context.

5. Create a single commit (see commit format below).

**Scenario B — 0 commits, only uncommitted changes:**

1. Stage all changes:

   ```bash
   git add -A
   ```

2. Read the spec title from `specs/{number}-*/spec.md` if it exists,
   and review the changed files to understand the scope.

3. Create a single commit (see commit format below).

**Scenario C — 1 commit + uncommitted changes:**

1. Stage all uncommitted changes:

   ```bash
   git add -A
   ```

2. Amend the existing commit to include the new changes, updating
   the message if needed:

   ```bash
   git commit --amend
   ```

**Commit format (for Scenarios A and B):**

Create a single commit with a comprehensive message that:

- Uses the conventional commit format: `feat({number}): {description}`
- Summarizes ALL the work done (from commits and/or file changes)
- Ends with the `Co-Authored-By` line
- Uses a HEREDOC for proper formatting

**Verify** the squash succeeded:

```bash
git log --oneline HEAD --not main
```

Confirm only **1 commit** remains.

### Step 4: Post-Squash Verification (CRITICAL)

After the squash commit succeeds, perform these **mandatory checks**
before reporting success:

1. **Check for uncommitted changes**:

   ```bash
   git status --short
   ```

   - If ANY files appear (modified, untracked, staged), **DO NOT report
     success**. Instead:
     - **Untracked files** (marked `??`): These are often auto-generated
       files from the framework (e.g., `.adonisjs/` routes, `database/schema.ts`,
       registry files). Stage and amend them into the squash commit:
       ```bash
       git add -A && git commit --amend --no-edit
       ```
     - **Modified files** (marked ` M` or `M `): These may be spec files
       reformatted by Prettier during review, or test files accidentally
       left out. Stage and amend them:
       ```bash
       git add -A && git commit --amend --no-edit
       ```
   - **Re-check** `git status --short` after amending. If still not
     clean, investigate and fix before reporting.

2. **Verify no test files were accidentally excluded**:

   ```bash
   git diff --name-only main -- 'tests/**' | head -20
   ```

   - List all test files in the diff vs main.
   - If test files were modified/created as part of the feature, verify
     they are included in the squash commit (not left as uncommitted
     changes).

3. **Verify no framework-generated files are missing**:

   Common auto-generated files that MUST be committed if they changed:
   - `.adonisjs/client/registry/index.ts`
   - `.adonisjs/client/registry/schema.d.ts`
   - `.adonisjs/client/registry/tree.d.ts`
   - `.adonisjs/server/routes.d.ts`
   - `database/schema.ts`

   ```bash
   git status --short -- '.adonisjs/' 'database/schema.ts'
   ```

   If any of these appear as untracked or modified, amend them in.

4. **Scan for accidental temp/debug files in the commit** (CRITICAL):

   AI agents sometimes create temporary test files to debug data, test
   endpoints, or inspect database state. These files must NEVER be
   committed. Scan the staged diff for suspicious files:

   ```bash
   git diff --name-only main | grep -iE '(^tmp/|^temp/|\.tmp\.|test_scratch|debug_|scratch\.|playground\.|^test\.[tj]s$|^try\.|^check\.|^verify\.|spike\.|^experiment)'
   ```

   Also check for files at the project root that don't belong:

   ```bash
   git diff --name-only main | grep -E '^[^/]+\.(ts|js|mjs)$' | grep -viE '(vite\.config|tsconfig|eslint|prettier|adonisrc|ace)'
   ```

   If ANY suspicious files are found:
   - **STOP** and list them to the user
   - Ask: "These files look like temporary/debug files. Should I remove
     them from the commit?"
   - If yes: `git reset HEAD {file}` for each, then `git checkout -- {file}`
     or `rm {file}`, then re-amend the commit
   - Common patterns of AI-generated temp files:
     - `test_*.ts`, `try_*.ts`, `check_*.ts`, `debug_*.ts`
     - `scratch.ts`, `playground.ts`, `experiment.ts`
     - Files in `tmp/`, `temp/`, or `.tmp/` directories
     - One-off scripts that query the DB or call endpoints directly

5. **Final clean check**:

   ```bash
   git status
   ```

   Must show: `rien à valider, la copie de travail est propre`
   (or English equivalent: `nothing to commit, working tree clean`).
   **Only proceed to the report if the working tree is clean.**

### Step 5: Report

Display the result:

```text
✅ Squash complete

{old_count} commits (+ uncommitted changes) → 1:

{new_commit_hash} {new_commit_message_first_line}

{files_changed} files changed, +{insertions} / -{deletions}
Branch: {branch_name} (not pushed)
Working tree: clean ✓
```

## Key Rules

- **NEVER squash without user confirmation** — always show the commit
  list and wait for approval.
- **NEVER force-push** — only squash locally, the user decides when to
  push.
- The squash commit message should incorporate key details from ALL
  squashed commits (bug fixes, prompt changes, etc.), not just the first
  one.
- Use `git reset --soft` + `git commit` — do NOT use `git rebase -i`
  (interactive rebase is not supported in this environment).
- Always verify the branch matches the feature number before proceeding.
- **ALWAYS run post-squash verification** (Step 4) — never skip it.
  Leaving uncommitted files after a squash is a common AI mistake that
  causes confusion in subsequent operations. The garde-fou in Step 4
  exists specifically to catch auto-generated files (routes, schema) and
  reformatted spec files that get left behind.
