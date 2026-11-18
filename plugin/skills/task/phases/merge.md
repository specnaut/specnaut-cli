
Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

## User Input

```text
$ARGUMENTS
```

## Preconditions

- The feature branch is checked out, and `plan`, `implement` and `review` have completed.
- `$ARGUMENTS` may carry, in any order: **`--pr`** — deliver through a pull request instead of a
  local merge; **`--no-close`** — merge and push but leave the backlog item open (a feature
  delivered across several branches, on every branch but the last).
- **An untrusted head is never merged here; the forge merges it.** When this session reviewed the
  branch in untrusted mode (`phases/review-untrusted.md`), or `$ARGUMENTS` names a PR number or a
  `<remote>/<branch>`, stop before step 0 and say so: nothing lands, is pushed, closed or moved. On
  Claude Code the review lock refuses that session's landing script and every push besides.
- The base branch is the `BASE_BRANCH` that the verifier prints at step 0. No such line
  means it is unknown: stop and say so — never assume `main`.

## The default is a local merge. `--pr` is the opt-in.

This phase lands the branch on the base with a local fast-forward; it needs no forge. Pass `--pr`
when the project genuinely requires the round-trip — a protected base, a human sign-off, a CI job
that runs only on `pull_request`. **Do not infer `--pr` from a remote, a forge or an open issue.**

## Steps

**No git hook runs in this phase.** Every git command it runs that writes — written here, described
in words, or named by a script's message — is `git -c core.hooksPath=/dev/null <subcommand> …`, as the landing
runs its own: the branch can commit a hook a hook manager runs, and nothing judges hooks. git-lfs
uploads from a pre-push hook, so the LFS objects are pushed explicitly first: inside the landing,
and in step 2 before the `--pr` push (the closeout's commit only deletes).

**The intake gate** (`phases/auto-chain.md`) runs before step 2, before every run of step 3, and,
under `--no-close`, once more after the push: there the item's line must read `OWN partial`.

0. **Check the helper scripts — before any script under `.specnaut/scripts/` runs**, again right
   after every `git rebase` this phase runs (before the gates and before `epic-status.sh`), before
   step 3, and after every commit this phase makes or rewrites (squash, fold). Run
   `phases/script-gate.md` § Resolving the verifier's block, then, in the same shell, with a flag
   only after a yes and with the digest that yes covers:

   ```bash
   "$sn" verify-scripts [--approved-scripts <SCRIPTS_DIGEST>] [--approved-instructions <INSTRUCTIONS_DIGEST>]
   ```

   The first case of `phases/script-gate.md` § Merge's step 0 outcomes that matches decides, on
   every run. After the scripts' yes, run this step again at once with `--approved-scripts
   <SCRIPTS_DIGEST>`, before any script of the tree runs, on the local path and on `--pr` alike:
   `epic-status.sh`, `run-gate.sh` and `lfs-push.sh` run on what that run decides, never on the
   run the question was asked from.

   A config line whose reason is `behind base: rebase` is handled as that reason is for a script:
   `git -c core.hooksPath=/dev/null rebase refs/remotes/origin/<BASE_BRANCH>`, then this step again at once — the branch only
   lags the base, and a later run judges it. A `NAMES_FILE` listing `.specnaut/workflow.yml` or
   `.specnaut/backlog-config.yml`, on any run, makes the merge mode `manual`; the `workflow` and
   `backlog-config` lines count on the last run only, and unless that run printed both `VERDICT
   workflow trusted` and `VERDICT backlog-config trusted` the mode is `manual` too: ask
   `phases/auto-chain.md`'s one question before step 3 unless the user already answered one. A
   rebase this phase runs that changes `.specnaut/workflow.yml` (`git diff --quiet ORIG_HEAD HEAD
   -- .specnaut/workflow.yml` exits non-zero) re-reads the mode after this step, as
   `phases/auto-chain.md` reads it (its one reader), and a `manual` answer is that question.
   Unless the last run printed `VERDICT instructions trusted`, or only `instructions` lines reading
   `behind base: rebase` (rebased as above), this run's merge mode is `manual`, and
   `phases/script-gate.md` § The instructions verdict says what to show and the one question to ask.
   Every other config line acts where its input is read, per `phases/script-gate.md` § The config
   verdicts.
   Each run's `NAMES_FILE` is removed (`rm -f`) once the next run prints its own, and the last
   when this phase ends, landed or stopped.

1. **Shape the history.** Ask the branch, not the board — `bash .specnaut/scripts/bash/epic-status.sh`
   reads its `Epic: #` trailers, and only before the landing: after it, the range is empty. Keep its
   last `CHILD` and `EPIC` lines (after any fold) for the close.
   **Under `--no-close`, first mark the delivery partial, on the branch:** set `"delivery":
   "partial"` in `.specnaut/feature.json` and commit it — on exit 14 as a commit the squash groups,
   on exit 0 as `git -c core.hooksPath=/dev/null commit --fixup <the last CHILD's sha>`, which the fold folds — so it lands
   with the work, in the same fast-forward or the same push.
   This list maps every exit `epic-status.sh`'s header lists; an exit it does not list is a
   finding: quote it and stop on the branch.
   - **Exit 14 — standalone**: run the full tier (**The full tier**, below), then load
     `phases/merge-squash.md` — **Squash by scope**.
   - **Exit 12** — the history does not read back to the board: fix it on the branch. **3** — the
     base is unknown: stop and say so. **15** — the history could not be read: stop and say so.
     **2** — usage: fix the call.
   - **Exit 16** — the range is empty but `.specnaut/feature.json` links an epic whose commits have
     landed (a re-run after the base moved): **stop** and say so — never squash, never close from
     here; the `CHILD` lines cannot be read back. A range holding any commit never reads 16.
   - **Exit 0 — an epic**: do **not** squash: run the full tier (**The full tier**, below), then
     load `phases/epic-fixups.md` and fold. Do not merge past a failed fold.

   **The full tier** — exits 0 and 14 only, before the landing. Run the full gate tier once, but
   first: if `git diff --quiet "$(git merge-base HEAD <base>)" HEAD -- .specnaut/gates.yml` exits
   non-zero, or step 0's last run printed a `gates` line other than `VERDICT gates trusted`, the
   branch edited the list that judges it, handled as step 0 handles a changed helper script: this run's merge mode is `manual`; show that diff (the same call without `--quiet`) and
   ask once: *"This branch changes `.specnaut/gates.yml`. Yes runs the branch's list as the full
   tier."* A `size-limits` or `boundaries` line other than `VERDICT size-limits trusted` or
   `VERDICT boundaries trusted` is asked the same way, in the same question, naming its file: *"Yes
   runs the size ratchet / the boundary check with the branch's copy."* A no stops on the branch, nothing landed. The yes covers that diff, and a later one asks
   again; under it the report names that run as the branch's list, never the base's. Then run
   `.specnaut/scripts/bash/run-gate.sh full --base "$(git merge-base HEAD <base>)"`. A failure is
   fixed on the branch (on an epic, as a `--fixup` of the child at fault; on a standalone item, as
   a commit on the branch, which the squash groups by scope),
   then the tier re-run — never escalated, and nothing lands past a failure. A fix never edits
   `.specnaut/gates.yml`. Its other exits: **3**, the candidate is refused: stop and say why, on
   the branch. **4**, nothing was checked. With a `removed:` line other than `none`, the branch
   emptied the tier: stop and say which commands left it, because a bare run of an empty tier
   passes. With `removed: none`, everything was omitted: run it bare,
   `.specnaut/scripts/bash/run-gate.sh full`, and read that result instead. A project that
   declares `.specnaut/impact.json` may run less than the whole tier, so a pass whose `scope:`
   line is not `full` is reported as that scope, and a pass with a `removed:` line names those
   commands: neither is ever reported as the full gate.
2. **`--pr` only** — once step 0 ran again after any yes, push the branch
   (`bash .specnaut/scripts/bash/lfs-push.sh && git -c core.hooksPath=/dev/null push -u origin <branch>`).
   A non-zero exit of `lfs-push.sh` stops before the push: 17 is step 4's row, any other is quoted
   and the phase stops on the branch. Then open the pull request against the base, name any issue its
   body references that `gh pr view <n> --json closingIssuesReferences` omits, report the PR URL,
   run step 5 and step 6, and **stop**: nothing has merged, so the item stays open. After the PR
   lands, `/task resume <n>` settles it. Never use the forge's "Squash and merge": it collapses
   the scopes the squash produced.
3. **Land it** — after step 0 ran again on the history as it now stands:

   ```
   bash .specnaut/scripts/bash/land-feature.sh [--scripts-digest <SCRIPTS_DIGEST>] [--instructions-digest <INSTRUCTIONS_DIGEST>]
   ```

   Pass each digest the user said yes to at step 0, and no other. It judges HEAD again itself,
   with the verifier, and lands only when the scripts and the instructions are each trusted or
   still that digest; a local base ahead of origin is left to its exit 6.
   It checks the tree is clean, that origin names `<base>` as its default, and that the branch
   contains `origin/<base>` and adds to it; after a yes to the instructions that held, it commits
   the approvals of the customised shipped skills that yes covered (`.specnaut/approved-skills.txt`,
   `phases/script-gate.md` § The instructions verdict) on top of the judged commit, which then lands
   too, or prints `APPROVALS NOT RECORDED` when the binary cannot record them (the next merge asks
   again); it pushes HEAD's git-lfs objects (`lfs-push.sh`), fast-forwards the base, pushes it,
   deletes the branch with `-d`, and verifies `HEAD` is the base; it prints `LANDED <base>
   <first>..<last> <n> commit(s)`. **It pushes without asking, in either merge mode**: reaching this
   step is the instruction — `phases/auto-chain.md` reads the mode, and this phase stops only where
   step 0 says.
4. **Read its exit** — this table maps every exit `land-feature.sh`'s header lists; an exit it does
   not list is a finding: quote it and stop on the branch. A row that rebases runs step 0 right
   after its `git rebase`, before anything else.

   | Exit | Meaning | What you do |
   | :--- | :--- | :--- |
   | 0 | landed and pushed | step 5 |
   | 2 | not on a feature branch | `git -c core.hooksPath=/dev/null checkout <branch>`, land again |
   | 3 | the base is unknown, or origin does not confirm it as its default | stop and say so, quoting its line — never land on a guessed branch |
   | 4 | the tree is dirty | commit, or stop whoever holds it |
   | 5 | behind `origin/<base>` | `git -c core.hooksPath=/dev/null rebase refs/remotes/origin/<base>`. Applies cleanly → step 0 at once, then re-run the gates — on the epic path, re-run `epic-status.sh` too and replace the kept `CHILD`/`EPIC` lines, whose shas the rebase changed — and land again. A conflict → `git -c core.hooksPath=/dev/null rebase --abort`, and the branch goes back to `review` — a resolution is a change nobody reviewed |
   | 6 | the local base holds commits origin lacks (printed: `origin/<base>..<base>`) | **stop on that fact**, quoting the range: they are someone's work. Nothing was rebased or pushed, and the phase does not rebase |
   | 7 | the push was rejected | quote the remote's message — never `--force`. A rule refused it (protected base, hook): run step 5, then stop and say so. Origin moved: `git -c core.hooksPath=/dev/null checkout <branch>`, `git -c core.hooksPath=/dev/null branch -f <base> refs/remotes/origin/<base>` (the local base holds only this branch's fast-forward), land again — exit 5 follows and its row applies. The close does not run until a landing pushes |
   | 9 | `HEAD` is not the base | the landing stands — it was pushed. Say so, `git -c core.hooksPath=/dev/null checkout <base>`, then step 5 runs: the person who asked must be back where they work |
   | 10 | nothing to land | the branch has no commit origin lacks: say so — nothing merged, nothing to close |
   | 11 | landed and pushed; the branch would not delete with `-d` | the landing stands: step 5 runs. Report the branch that stayed |
   | 12 | an unexpected git failure before the push | quote it and stop: nothing was pushed |
   | 13 | HEAD's scripts or instructions are neither trusted nor the digest passed, or hold a reason no yes covers, or the yes no longer held when its approvals were recorded, or the check could not run or refused the verifier | step 0 at once: its questions decide, then land again with those digests. "Could not judge": stop and say so |
   | 17 | the git-lfs objects could not be pushed first; its `LFS` line names why | quote that line and stop on the branch: nothing moved, nothing was pushed. `LFS CONFIG CHANGED`: show the `.lfsconfig` diff it names — a legitimate change is pushed or landed by hand, never by this phase. `LFS UNAVAILABLE`, `LFS TOO OLD`: install or upgrade git-lfs, then run the step again. `LFS PUSH FAILED`: say what its output names |

5. **Settle the card** — the one place this phase decides where the linked item's card goes. First
   the board fence: when step 0's `NAMES_FILE` lists `.specnaut/backlog-config.yml`, or its
   `backlog-config` line is not `VERDICT backlog-config trusted`, no backlog script runs — not
   `move.sh`, not `phases/merge-close.md`. Say so, naming the file: the branch chose which board
   they write to. The merge itself stands. Otherwise, the item is `.specnaut/feature.json`'s
   `linked_issue`, a positive whole number; none, or anything else, means nothing to settle. It
   is read under the `VERDICT linked-issue trusted` of step 0's last run before step 3, or its
   `untrusted … not on base` when the link names the item this run was started for: the id the
   chain started with, or the one `/task merge <id>` names (the branch wrote the first link). With
   no such id, or any other `linked-issue` line, it settles nothing: say so, quoting the line. The
   first row that matches decides:

   | How the phase ends | The card |
   | :--- | :--- |
   | `--pr`, whatever `--no-close` says, or not pushed (step 4 exit 7, refused by a rule) | `bash .specnaut/scripts/backlog/move.sh "<linked_issue>" "<review column>"`, the backend's own name for it from its `move.sh` usage. A failed move is reported; it never fails the merge |
   | pushed under `--no-close` | leave it in `In progress`: the delivery continues on another branch. The field must be in what landed (the gate's run after the push, above) |
   | pushed, not under `--no-close` | load `phases/merge-close.md`: it closes what shipped and reconciles |
6. **Close what this run spawned** — on every exit from this phase, a stop in step 1, 2 or 4
   included, whatever step 5 did: if `AGENTS.md` names a delegated-session lifecycle for your
   harness, run its session sweep now, telling it whether the branch landed (step 4 exit 0, 9 or 11
   — only that decides it). Quote its lines verbatim.

## 🔒 Merge is not a filing desk

Nothing gets opened here that could have been fixed in `implement` or `review`. A leftover
repairable inside what the branch touches is fixed and the branch amended — the cheapest this repair
will ever be. Open an item only for a **product decision**, a **boundary this branch does not
touch**, a **migration**, or a fix **larger than the work being merged**, at **P0 or P1**. A good
merge leaves the backlog **shorter**: one item closed, none opened — or the report says why, by
name.

## Output

Files and commits merged (from `LANDED`), whether the push ran or the remote's message, the branch
`HEAD` is on, and — when the close ran — each item closed, each card moved and why any was not,
`close-shipped.sh`'s summary line verbatim, and the spec removal or its reason — then step 6's lines, when it
ran. Every backlog item is named
per the `backlog-reference-contract` skill. On `--pr` the report is shorter and says plainly: the
branch pushed, the PR URL, step 5's move, and **nothing has merged and the item is still open**.
