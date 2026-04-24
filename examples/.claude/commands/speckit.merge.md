---
description: SpecKit Merge Workflow for squashing and merging a feature branch into main with a flat history.
argument-hint: [feature-number]
---

# SpecKit Squash & Merge Workflow

You are initiating the SpecKit Merge process for feature #$ARGUMENTS.
Your exact goal is to ensure a perfectly flat git history on `main` by squashing, rebasing the feature branch, avoiding merge commits, and eventually pushing to origin.

## Workflow Instructions

Please follow these steps methodically. Do not attempt to run steps all at once; verify the output of each command before continuing.

### 1. Verification of the Feature Branch

- **Action:** Check the current active branch using the terminal (`git branch --show-current`).
- **Requirement:** Ensure that you are currently on a feature branch containing the feature number provided: `$ARGUMENTS`.
- **If failed:** Tell the user they are not on the correct feature branch and stop the process.

### 2. Verification of the Squash Command (Single Commit Rule)

- **Action:** Check if the active branch has been squashed into exactly one distinct commit relative to `main` using `git log main..HEAD --oneline`.
- **Requirement:** There must be **exactly ONE single commit** unique to this feature branch.
- **If failed (multiple commits):** Inform the user that the branch contains multiple commits and hasn't been squashed yet. Ask the user if they would like you to perform a squash (e.g., using `git rebase -i main` or `git reset --soft main`) before proceeding. Wait for their instructions.

### 3. Rebase and Merge (Flat History)

To guarantee a flat history without merge commits, execute the following actions in this exact order:

1. `git fetch origin main` (Update local references to the remote `main` branch)
2. `git rebase origin/main` (Rebase the current isolated feature branch onto the latest `main`. If conflicts occur, pause and ask the user to resolve them)
3. `git checkout main` (Switch to the local `main` branch)
4. `git pull --rebase origin main` (Ensure local `main` is perfectly synced with the remote)
5. `git merge --ff-only <feature-branch-name>` (Fast-forward merge the squashed branch. The `--ff-only` flag ensures no merge commit is ever created!)

### 4. Mark the Linked Backlog Task as Done

After the fast-forward merge succeeds, automatically close the corresponding
backlog task — merging the spec means the work is done.

1. **Locate the linked backlog task**:
   - Read `specs/<feature-dir>/spec.md` (the feature dir matches the feature
     number `$ARGUMENTS`)
   - Search for a line matching one of:
     - `**Backlog Task**: [NNN]` — explicit link
     - `tasks/backlog/NNN-` — markdown reference to the task file
   - Extract the 3-digit task ID `NNN`
   - **If no link is found**, skip this step silently and continue to step 5.
     Not every spec is tied to a backlog task.

2. **Update the backlog task file** at `tasks/backlog/NNN-<slug>.md`:
   - Change the `status:` field in the frontmatter to `done`
   - Leave the rest of the file intact

3. **Update the backlog index** `tasks/backlog.md`:
   - Find the line containing `` `NNN` `` in its current priority section
     (Critical / High Priority / Medium Priority / Low Priority / Deferred)
   - Convert the leading `- [ ]` to `- [x]` and move the entry into the
     `## Done` section, preserving its description
   - Update the Summary table counts at the bottom: decrement the source
     priority's count, increment the Done count, and increment Done points
     by the task's complexity. Also update Total tasks if needed (it stays
     the same — tasks just move sections, not disappear).

4. **Commit the backlog updates** as a single dedicated commit on `main`:

   ```bash
   git add tasks/backlog.md tasks/backlog/NNN-*.md
   git commit -m "chore(backlog): mark task NNN as done — merged via spec $ARGUMENTS"
   ```

   This creates a follow-up commit immediately after the squashed feature
   commit. The history stays flat (no merge commit).

5. **Sync the status change to GitHub Issues — NON-NEGOTIABLE.** Without
   this step, the GitHub issue + Project #3 Kanban board stay OPEN even
   though the local MD says `done`, creating silent divergence:

   ```bash
   python3 .claude/skills/backlog/scripts/sync-to-github.py --id NNN
   ```

   Expected output: `✔ Updated issue #<N>`. If the script fails, surface
   the error to the user but do not abort the merge — they can re-run
   the sync manually.

6. **Confirm** to the user: `✅ Task NNN marked as done in backlog and synced to GitHub.`

If any step in this section fails (file not found, parse error, etc.),
**do not abort the merge workflow** — the merge itself has already succeeded.
Surface the failure as a warning so the user can fix the backlog state
manually, then continue to section 5 (Ask for Push Permission).

### 5. Ask for Push Permission

Once the fast-forward merge is complete and the backlog task is marked done,
the feature commitment is safely squashed into `main`.

- **Action:** Present a brief summary of the updated `main` branch log (`git log -n 3 --oneline`) so both the feature commit and the backlog-status commit are visible.
- **Confirmation:** Explicitly ask the user: _"The feature has been merged into main locally, maintaining a perfectly flat history, and the linked backlog task has been marked done. Should I push the changes to origin main? (`git push origin main`)"_
- **Final step:** Only execute `git push origin main` **after** the user explicitly says "yes" or validates the prompt.
