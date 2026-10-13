**Windsurf support is removed.** Specnaut now scaffolds for six harnesses: Claude Code, Cursor,
Codex, Copilot, OpenCode and Antigravity. On a project installed for Windsurf, `upgrade`, `diff`,
`reconcile` and `check` stop with one message, change nothing, and name the command that switches
the project to another harness. `UPGRADING.md` has the steps.

**The unit suite runs once per item, not on every commit.** The workflow commits once per task and
once per epic child, and three places ran the whole suite at that rate. Now each moment has its own
content. Every commit gets static checks only: the `fast` gate tier is documented as format, lint
and type check. When the work is done, the review runs the unit suite once on the frozen tree; on an
epic it skips it for every child but the last and says so. The merge runs unit plus functional /
end-to-end once, through the `full` tier. Per-task verification runs the tests relevant to the
change. `gates.yml` and the quality-gates doc also advise keeping your own commit hook static.
