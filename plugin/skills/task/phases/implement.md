Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

## User Input

```text
$ARGUMENTS
```

## Before the first line

<!-- BEGIN: spec-backend=cloud -->
**Cloud spec setup** — the spec lives on SpecNaut Cloud and `/task plan` created no branch.
`<task>` is the item `plan` handed on, else the whole-number `linked_issue` of HEAD's committed
`.specnaut/feature.json` when `wip-audit.sh` (below) prints `ACTIVE` for it at HEAD's tip — a link
HEAD's own commits set, never one inherited from the base; otherwise stop and ask for it. For an
epic's child it is the epic, and `<epoch>` is `<task>`'s creation time.
If `view.sh` printed `—` for it, the header of `wip-audit.sh` says what to pass. First, run
`specnaut spec pull <task>` once: it writes the spec to the gitignored `.specnaut/specs/.cache/<task>/`,
and you read it from there. Read its outcome as `phases/plan-reentry.md` does: anything but a
materialised `1-plan.md` stops. Then the branch, from
`bash .specnaut/scripts/bash/wip-audit.sh <task>@<epoch>`; a non-zero exit stops:

- `ACTIVE <task> <sha>`, HEAD's tip is `<sha>`, and HEAD's branch passes `resume.md` § 3: continue
  on it. A re-entry creates no second branch. When `git hash-object` of the pulled `1-plan.md` is
  not its committed `feature.json` `plan_blob`, the plan changed since it was approved: stop and say
  so — `/task plan <task>` re-approves it.
- `ACTIVE` anywhere else: stop and name the sha, never a branch name — `/task resume <task>`
  adopts it. `UNPUSHED`: stop where the intake gate points (`phases/auto-chain.md`).
- `IDLE` or `LANDED`: HEAD is the base, or its branch passes `resume.md` § 3 check 5; otherwise stop
  and name HEAD's sha. Then that gate, then `.specnaut/scripts/bash/create-new-feature.sh
  --branch-only --issue <task> "<feature description>"`, write `{ "linked_issue": <task>,
  "plan_blob": "<git hash-object of the pulled 1-plan.md>" }` to `.specnaut/feature.json` and
  commit it alone — anything already
  staged (`git diff --cached --quiet` fails) is a stop:
  `git add .specnaut/feature.json && git commit --allow-empty -m "plan(<task>): link the branch to
  its task"`. `wip-audit.sh` and `resume.md` § 3 check 8 read the branch by it.

<!-- END: spec-backend=cloud -->
Run `.specnaut/scripts/bash/check-prerequisites.sh --json` for the feature directory, and read its
`plan.md` — the brief, or the full plan. Then:

- **The decision table is binding.** A decision is implemented only in its named home. If the code
  wants a second spelling, amend the brief first; it is not resolved at the keyboard.
- **Extract before you grow** — apply `.specnaut/memory/size-limits.md` § **implement**: re-measure
  every file you will touch, split a file over its target first, in its own commit, and put new
  behaviour in a new module wherever it can.
- **Start from what the branch already holds.** Read `<base>..HEAD` against the brief before the
  first change: a re-entered branch may be half built, or done. Build only what is missing. A commit
  subject is a claim: judge what is built from each diff against the brief's checks, and report a
  subject its diff does not bear out instead of counting it done.
- **Done is the brief's checks.** Work until every one of them passes; they are what `review` runs.
- **Keep secrets out of git.** The project's ignore files must exclude `.env*`, `*.env`,
  `*.tfstate*`, `*.tfvars`, `*.secret.yaml`, `kubeconfig*`, `*.key`, `*.crt` and `secrets/` where
  the stack produces them, and generated output (`node_modules/`, `dist/`, `build/`, `target/`,
  `.venv/`). Append a missing pattern; never rewrite the user's file.

## Building it

Order the work yourself, from the brief: there is no separate breakdown. Write the test before the
code it proves where you can, and commit by scope as you go.

**Size your own team, under a cap.** Split independent parts across subagents when that is faster —
at most four at once, each given its files, the rows of the decision table it touches and the check
it must pass. Two agents never hold the same file. You stay the one who integrates, gates and
commits.

**An epic runs as a loop.** When the item is an epic with open sub-issues, read
`phases/epic-loop.md` and follow it: one commit per child on the epic's branch, the fast gate after
each, no return to the user between children.

## 🔒 What you find while building, you fix while building

A stale comment, a guard with no test, a message promising what the code does not do, a helper that
swallows an error: **fix it, in this branch, in its own commit**. Log it instead only when it needs a
product decision, crosses a boundary this task does not touch, needs a migration, or is larger than
the task — and say why in one sentence; such an item is opened at P0 or P1.

## Ending this phase — freeze, then INVOKE `review`, same turn

An implementation that has not been through review is not finished.

1. **Freeze the tree.** Name the commit and stop every agent still holding the tree before anything
   is gated: reviewers and suites read it live.
2. **Invoke `review` yourself, in the same turn.** Whether anything stops here is
   `phases/auto-chain.md`'s to say.
