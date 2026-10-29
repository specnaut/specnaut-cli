# Squash by scope — one commit per scope, never "exactly one commit"

Loaded by `phases/merge.md` at its step 4. This is the **standalone** path's rule: one backlog item,
one branch, one merge. An **epic** branch does not squash — its history is already one commit per
task and `merge.md` routes it elsewhere. If you arrived here from an epic, you are in the wrong
file.

A branch usually carries more than one kind of change, and collapsing them into a single commit
destroys the thing squashing exists to produce: **a history a human can read.**

| What is on the branch | Where it goes |
| :--- | :--- |
| The feature itself — rules, domain, service, UI, its tests | **One** commit, `<type>(<id>): <what it does>` |
| Generated artefacts the feature invalidated — bundles, codegen output, lockfiles | Its own `chore(codegen):` commit |
| Configuration, tooling, CI unrelated to the feature | Its own `chore(...)` / `ci(...)` commit |
| Documentation or agent memory written alongside | Its own `docs(...)` commit |
| A fix to a **pre-existing** defect the branch happened to expose | Its own commit, with **its own** backlog id — never the feature's |

**Every commit subject carries the backlog id of the thing it is about**, in the scope position:
`feat(412): …`, `fix(389): …`, and `chore(codegen):` where the commit belongs to no item. That id is
what makes `git log --oneline` readable against the board, and it is why a pre-existing fix must not
inherit the feature's id — that would attribute work to an item which never asked for it. The id
comes from whichever backlog backend the project uses; no backend-specific syntax is required.

### Procedure

1. `git log <base>..HEAD --oneline` — read what is actually there.
2. Group the commits by scope using the table above, and **show the grouping**.
3. `git reset --soft <base>`, then re-commit **one group at a time**, staging paths **by name**.
   Never `git add -A` — a sweep is the fastest way to pull in something the branch never had.
4. `git log <base>..HEAD --oneline` again. The result is one commit per scope, in an order that
   reads forwards: the feature first, its codegen after it, unrelated changes last.

**Do not stop between steps 2 and 3.** The grouping is shown so the user can see what happened, not
so they can approve it mid-run. Asking for the merge *is* asking for the squash. The one thing that
legitimately halts here is a file you cannot classify — name those files, say why, and ask about
**those files only**.

### Verification, which is not optional

- **`git diff <base>..HEAD` must be byte-identical to what it was before the squash.** A squash that
  changes the tree is not a squash, it is a rewrite. Capture the diff before step 3 and compare
  after step 4.
- **`git status --short` must then be empty.** If anything appears:
  - **Untracked (`??`)** — usually generated output. Decide per file: it belongs either to the
    codegen commit or to `.gitignore`. Never leave it dangling and never report success over it.
  - **Modified** — something wrote to the tree during the squash. Find out what before going
    further; an agent still holding the worktree is the usual answer, and it must be stopped first.

### The squash happens either way — on this path

"Either way" means **either `--pr` or local**, not "either kind of branch". Since #557 there are two
history rules, and this file governs only the standalone one; an epic branch does not squash at all
and `merge.md` routes it elsewhere before this file is ever loaded. The sentence below is the one
most likely to be read in isolation, so it says which "either" it means.

Squash by scope runs on the `--pr` path too, before the branch is pushed — so the pull request
carries the same readable history the local path would have produced. Then **do not use the forge's
"Squash and merge" button**: it collapses the scopes back into the single commit this whole
procedure exists to avoid. Merge the PR with a merge or rebase strategy, or land it locally.

A repository whose base branch is **protected** cannot take the local path at all — the push is
rejected. That is precisely what `--pr` is for; it is not a reason for this phase to guess.

