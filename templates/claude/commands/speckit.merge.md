---
description: Merge the current feature branch into the base branch after pre-merge validation.
---

## User Input

```text
$ARGUMENTS
```

## Preconditions

- The feature branch must be checked out.
- All Speckit phases must have completed successfully (clarify, plan, tasks, analyze, implement,
  review).
- `$ARGUMENTS` is optional. If empty, the base branch is `main`. Otherwise it is the first token of
  `$ARGUMENTS`.

## Steps

1. Determine the base branch from `$ARGUMENTS` (default `main`).
2. Run `git status --porcelain` — abort if the working tree is dirty.
3. Run `git fetch origin <base>` and verify the current branch is up-to-date with `origin/<base>`
   (fast-forward or rebase first if behind).
4. Run `git checkout <base>`.
5. Run `git merge --ff-only <feature-branch>`. If fast-forward is not possible, stop and ask the
   user whether to rebase.
6. Print the merge summary (files changed, commits merged).
7. Ask the user: "Push to origin <base>? (yes/no)". Do NOT auto-push.

## Output

A structured report with: files merged, commits merged, whether the user chose to push, and the next
suggested action (e.g. `/backlog update <id> --status done`).
