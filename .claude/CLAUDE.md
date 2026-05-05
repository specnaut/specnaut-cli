# CLAUDE.md — Specflow

Project-specific directives for the main Claude Code session in this repo. Read AGENTS.md for the
project vision; this file only encodes how Kevin wants to be collaborated with.

## Working contract

**Kevin gives orders. Claude does the work.** No exceptions.

- **Never ask Kevin to perform an action.** Don't end a turn with "merge the PR", "run the
  migration", "verify locally", "review the diff and approve", "push when you're ready", "you'll
  need to do X". If a step needs to happen, do it yourself.
- **The only permitted form of question is permission-seeking, not delegation.** Acceptable: "Should
  I merge PR #N now?" / "Do you want me to release v0.6.2?" — these ask for authorisation.
  Forbidden: "Can you merge PR #N?" / "Please review and merge." — these push work onto Kevin.
- **Default to acting when authority is implied.** If Kevin said "ship it", "do the whole thing",
  "tu te démerdes", or already approved a multi-step plan, don't pause at every checkpoint. Drive
  the work to completion (commit, push, open PR, merge, close issue, release if applicable). Status
  updates are fine; permission re-asks are not.
- **When unsure whether you have authority for a destructive action** (force-push, history rewrite,
  mass-delete, public-facing message), ask once with a concrete proposal — never with a "do you want
  to do X?" framing. Frame as "I'm about to do X, OK?".
- **Every backlog mutation goes through the `product-owner` subagent** — don't run `add.sh` /
  `move.sh` / `gh issue {create,close,edit}` inline. Dispatch the PO and let it execute. (See
  `.claude/skills/backlog/SKILL.md`.)
- **Every release / pipeline / distribution change goes through the `devops-sre` subagent
  first** — before editing `.github/workflows/*.yml`, `install.sh`, `scripts/build.ts`,
  `scripts/bump-tap-formula.ts`, anything in `mkrlabs/homebrew-tap`, or running `/release`,
  dispatch `devops-sre` for an advisory pass. The agent is read-only (same pattern as the
  architect): it returns findings + recommendations; the main session executes the change.
  Skip the dispatch only for trivial doc tweaks inside the same area (e.g. typo in a comment).
  (See `.claude/agents/devops-sre.md`.)

## Implementation defaults

- Branch + PR for every non-trivial change. Direct-to-main only for release commits
  (`chore: release vX.Y.Z`) and one-line fixes Kevin explicitly says are OK direct.
- Tests must be green locally (`deno task test`) before push. The pre-commit hook also runs fmt +
  lint + bundle + check.
- After a PR merges, dispatch the PO to close the linked issue with `reason: completed` and
  reference the merged PR in the close comment.
- Don't manufacture follow-up tickets unprompted. If shipping the work surfaced a real new issue,
  dispatch the PO to open it; otherwise stay out.
