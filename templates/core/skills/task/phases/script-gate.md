# The helper-script gate

`resume`, `groom`, the backlog verbs and `audit` load this doc before the first script under
`.specnaut/scripts/` runs. `review` and `merge` run their own gate step (`phases/review.md` step 1,
`phases/merge.md` step 0); every verb that runs a gate reads § The config verdicts.

## The gate

Run this block as written, from the project's root, before the first script of the tree, and
again after any `git switch`, `git rebase` or commit the verb makes:

<!-- script-gate: verify-scripts -->
```bash
out=$(specnaut verify-scripts); rc=$?; printf '%s\n' "$out"
base=$(printf '%s\n' "$out" | sed -n 's/^BASE \([0-9a-f]\{40,64\}\)$/\1/p')
last=$(printf '%s\n' "$out" | tail -n 1)
names=$(printf '%s\n' "$out" | sed -n 's/^NAMES_FILE //p'); [ -z "$names" ] || rm -f "$names"
if [ "$rc" -eq 0 ] && [ -n "$base" ] && [ "$last" = "VERDICT scripts trusted" ]; then
  echo "SCRIPTS TRUSTED"
else
  echo "SCRIPTS NOT RUN: verify-scripts exit $rc"
fi
```

`SCRIPTS TRUSTED` is the one outcome under which the verb runs a script of the tree. Any other
runs none in this run: report the `SCRIPTS NOT RUN` line and each `UNTRUSTED` line, and stop. No
`BASE` line (exit 2 or 3, or no `specnaut` on the PATH) means the base or the verifier is
missing: say which. Never fall back to a script of the tree, nor to a hand-run of what it does.
The `BASE` sha is the base for any range the verb passes a script.

## The config verdicts

Before the gate's `VERDICT scripts` line, the verifier prints one line per config input a branch
controls: `VERDICT <class> trusted`, or `VERDICT <class> untrusted <path> <reason>`. Trusted means
the work tree holds the value the base branch's tip holds, so reading the tree reads the base.
A verb that ran a gate reads an input only under that gate's trusted line. An untrusted line, or
none, means the tree's value is never read, and the row below applies:

| Class | Read by | Not trusted |
| :--- | :--- | :--- |
| `workflow` | `merge-mode.sh`: `phases/auto-chain.md`, `phases/merge.md` step 0 | the mode is `manual`, the reading that asks |
| `size-limits` | `size-ratchet.sh`: `phases/review-seats.md`, `phases/quality-gates.md`; `specnaut scan`: `phases/audit.md` | not run: report `NOT RUN: <the line>`, never a pass; `merge` asks (its **The full tier**) |
| `boundaries` | `boundary-check.sh`: `phases/review-seats.md`, `phases/quality-gates.md`, `phases/audit.md` | as `size-limits` |
| `backlog-config` | every backlog script, and remote mode: `backlog.md`, `groom.md`, `resume.md`, `phases/auto-chain.md`, `phases/merge.md` step 5 | no backlog script runs: stop and say so (at merge the landing stands); the mode is `manual`; remote mode is on if either copy turns it on, and then nothing lands (`phases/auto-chain.md`) |
| `linked-issue` | `.specnaut/feature.json`'s link: `resume.md`, `phases/plan-reentry.md`, `phases/merge.md` step 5 (whose item `phases/merge-close.md` takes) | the link is not read; `phases/merge.md` step 5 names its one exception |
| `gates` | `run-gate.sh`: `phases/merge.md` **The full tier**, `phases/review-seats.md`, `phases/quality-gates.md` | `merge` asks; the review's fast tier is skipped |
| `instructions` | the session itself: `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md` every turn, `docs/constitution.md` and a phase's project additions as it runs; and the harness: `.claude/skills/`, `.claude/agents/`, `.claude/hooks/`, `.claude/commands/`, `.claude/settings.json`, `.mcp.json`, `.codex/`, `.agents/`, `.specnaut/hooks/`, with `.gitattributes`, judged in the work tree and at HEAD; `AGENTS.override.md`, `CLAUDE.local.md` and `.claude/settings.local.json` judged as committed at HEAD, as are, for a project in a subfolder, `AGENTS.md` and `CLAUDE.md` in each folder above it, named `../AGENTS.md` | the read already happened: `phases/merge.md` step 0 makes the mode `manual` and asks, as **The instructions verdict** below says; one line per path |

`backlog-config` judges every line of `.specnaut/backlog-config.yml` but the columns grooming
writes (`intake_column`, `ready_column`), each held to the one quoted value grooming writes: the
tracker's address on any backend, and the `remote:` block. `linked-issue` judges the link as its
`sed` readers take it, raw: one `"linked_issue"` key, whose value is `null` or a whole number from
1, compared as written; a file its readers could read two ways is refused.

### The instructions verdict

`phases/merge.md` step 0 acts on it. Unless the last run printed `VERDICT instructions trusted`,
or only `instructions` lines reading `behind base: rebase` (rebased as step 0 rebases a config
line), the merge mode is `manual`: a missing `instructions` line is an untrusted one. Show each
named path as it lands: `git diff --text --no-textconv --no-ext-diff --no-color <BASE_TIP> HEAD
-- <path>` (a file the base lacks, in full). A `work tree differs from HEAD` reason means the
session read other bytes than those that land, whatever `git status` shows; for such a path HEAD
lacks, show the work tree's file and say it does not land. A `line endings differ` reason, whose
diff can be empty, is shown as its reason says: the same text, a CR before LF on one side only. A
`holds invisible characters` reason names each code point and its line: say so with the diff,
which does not show them. A `differs from the copy Specnaut ships` reason names a skill Specnaut
ships whose bytes are not the shipped copy, even where the base holds the same edit: show `specnaut
diff <path>`, which compares it with that copy. Then ask once, as the one question before step 3: *"This branch changes
the instructions, skills, hooks or settings this session's harness loads. Yes lands them."* A no stops on the branch. The yes covers
that run's `INSTRUCTIONS_DIGEST` (the files as HEAD commits them and the reasons shown) and
nothing else: a later run with another digest asks again, even naming the same paths, or with a
new reason, and a run with no such line asks. The
session read `AGENTS.md` before step 0 ran: this stop is the control, not undoing that read.
