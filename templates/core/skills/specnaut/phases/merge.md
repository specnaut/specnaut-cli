
## User Input

```text
$ARGUMENTS
```

## Preconditions

- The feature branch must be checked out.
- All Specnaut phases must have completed successfully (clarify, plan, tasks, analyze, implement,
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
8. **Close the linked backlog issue** (only if push happened and `feature.json.linked_issue` is set):
   1. Read `.specnaut/feature.json`. Extract `linked_issue` (`jq -r '.linked_issue // empty'`).
      If absent / null / empty, skip the rest of step 8 silently — no backlog backend wiring
      to act on.
   2. Detect the backend by checking `.specnaut/installed.lock` (`backlog_backend: <local|github|gitlab>`)
      or, equivalently, the presence of `.specnaut/backlog-config.yml` (github/gitlab) vs
      `.specnaut/backlog.md` (local).
   3. **github + gitlab only** — run `bash .specnaut/scripts/backlog/cascade-check.sh <linked_issue>`.
      Exit 11 means the parent has open sub-issues; do NOT close. Report the open children to the
      user and stop (the issue stays in `In progress` / `Ready` until the children are closed).
   4. Ask the user: "Close issue #<linked_issue> on the board now? (yes/no)". On `no`, skip the
      rest of step 8 — leave the column flip to a future run or to a manual `move.sh`.
   5. On `yes`, run `bash .specnaut/scripts/backlog/move.sh <linked_issue> Done`. This is the
      mechanical column flip — `move.sh` is idempotent and the working contract permits the merge
      phase to call it directly (the PO retains exclusive ownership of the close + comment, not
      the column move).
   6. **github + gitlab only** — dispatch the `product-owner` subagent with the prompt:
      "PR for issue #<linked_issue> just merged on `main`. The mechanical move to Done has
      already been done via `move.sh`. Please run the second half of the two-step close: post
      a close comment on the issue referencing the merged commit range `<first-sha>..<last-sha>`
      (from step 6's summary), then `gh issue close <linked_issue> --reason completed`. Confirm
      with a one-line report." This keeps the audit comment under PO ownership and surfaces the
      `docs audit` line from the PO's close-step contract.
   7. **local backend only** — `move.sh <id> Done` already flipped the frontmatter; no second
      step needed. The local backlog has no separate "issue" object beyond the file itself.

   Backward-compat: feature trees without `linked_issue` (created before this field existed)
   skip step 8 silently. Multi-PR features (final PR not yet merged) — the user answers `no`
   in step 8.4 and re-runs `/specnaut merge` on the last PR.

## Output

A structured report with: files merged, commits merged, whether the user chose to push, and — when
step 8 ran — whether the linked issue was closed (and via which backend), or skipped (and why:
no `linked_issue`, user declined, or `cascade-check` blocked the close).
