# Folding an epic's fixups — one commit per child, still

Loaded by `phases/merge.md` on the epic path, before the merge.

On an epic branch the scope is the task: one commit per child, and children
never merge together. Real work does not arrive that way. A child gets fixed
after its commit is written — because its fast gate failed as the loop moved
on, or because the full gate failed at the end and the fault was attributed to
it. Those fixes have to fold back into **their own child's** commit, so what
reaches the default branch still reads as one commit per child.

## Write the fixup so it already knows where it goes

When you fix a child whose commit is already written, commit the fix as a
**fixup of that child's commit**:

```
git commit --fixup=<sha-of-that-child's-commit>
```

This is the whole of AC 1 and AC 2, done at the moment the fix is written
rather than reconstructed later. The commit git produces is titled
`fixup! <that child's subject>`, so:

- it is **attributed to the child at fault** by construction;
- it **never acquires an id of its own** — no `T<NN>` scope, no `(#N)`, no
  `Epic:` trailer, because it is not a child;
- it **cannot inherit a different child's id**, because the target is a sha
  you named, not a guess made afterwards from a subject line.

A fixup written any other way has to be matched to a child by reading it, and
a match made by reading is a match that can be wrong.

## The fold

Capture the diff **before** touching anything. This is not optional, and the
reason is at the bottom of this file.

```
git diff <base>..HEAD > /tmp/epic-before.diff
GIT_SEQUENCE_EDITOR=true git rebase --autosquash --keep-base <base>
```

`--autosquash` moves each `fixup!` commit next to the commit it names and
squashes it in. It touches nothing else: a fixup folds into **its own** target
and no other, so two children are never collapsed however related they look,
and the children keep their relative order. `GIT_SEQUENCE_EDITOR=true` accepts
the plan git generated rather than opening an editor — the plan is the point,
not something to hand-edit.

If the rebase stops on a conflict, resolve it, `git rebase --continue`, and
re-run **every** check below afterwards. Do not skip a commit.

## Verification, which is not optional — and is stated here on purpose

Squash-by-scope has a verification block of its own. It governs the
**standalone** path, it lives in `phases/merge-squash.md`, and it does not
reach here. This procedure rewrites history for a different reason, so it
carries its own checks rather than borrowing them by implication.

**1. The tree did not move.**

```
git diff <base>..HEAD > /tmp/epic-after.diff
diff /tmp/epic-before.diff /tmp/epic-after.diff
```

The two must be **byte-identical**. A fold that changes the tree is not a fold,
it is a rewrite. `diff` exiting non-zero here stops the merge — and note that
`diff` exits `2` when it cannot read a file, which is not "they differ": check
for exit `0`, do not check for "not 1".

**2. Nothing is left in the working tree.** `git status --short` must be empty.
If anything appears:

- **Untracked (`??`)** — usually generated output. Decide per file: it belongs
  either in the child's commit or in `.gitignore`. Never leave it dangling and
  never report success over it.
- **Modified** — something wrote to the tree during the rebase. Find out what
  before going further; an agent still holding the worktree is the usual
  answer, and it must be stopped first.

**3. One commit per child, in dependency order.**

```
git log <base>..HEAD --oneline
```

Every remaining commit must carry a `T<NN>` scope, the ordinals must run in
order with none missing and none twice, and no `fixup!` subject may survive. A
surviving `fixup!` means `--autosquash` did not match it — its target was
rewritten, or it was written by hand with the wrong subject — and folding it by
eye is how a fix lands on the wrong child.

If any of the three fails, **stop and say which one**. A merge that proceeds
past a failed fold puts a history on the default branch that nobody can read
back to the board, which is the whole thing #552 exists to produce.
