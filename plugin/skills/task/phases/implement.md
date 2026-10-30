Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

## User Input

```text
$ARGUMENTS
```

## Before the first line

<!-- BEGIN: spec-backend=cloud -->
**Cloud spec setup** — the spec lives on SpecNaut Cloud and `/task plan` created no branch. First,
run `specnaut spec pull <task>` once: it writes the spec to the gitignored
`.specnaut/specs/.cache/<task>/`, and you read it from there. If the pull fails, stop with its
message. Then create the branch:
`.specnaut/scripts/bash/create-new-feature.sh --branch-only "<feature description>"`.

<!-- END: spec-backend=cloud -->
Run `.specnaut/scripts/bash/check-prerequisites.sh --json` for the feature directory, and read its
`plan.md` — the brief, or the full plan. Then:

- **The decision table is binding.** A decision is implemented only in its named home. If the code
  wants a second spelling, amend the brief first; it is not resolved at the keyboard.
- **Extract before you grow** — apply `.specnaut/memory/size-limits.md` § **implement**: re-measure
  every file you will touch, split a file over its target first, in its own commit, and put new
  behaviour in a new module wherever it can.
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
