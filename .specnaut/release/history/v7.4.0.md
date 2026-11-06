**On Codex, a run now closes what it spawned.** A subagent started with `spawn_agent` used to
outlive its work and hold its worktree, so the host refused to archive it and every delegating run
left children behind. Codex projects now receive `.specnaut/codex/session-lifecycle.md`: each
spawned child is recorded, a finished one is closed with `close_agent`, and every run that spawned
children ends with a sweep that reports what stayed open.

**Worktrees are archived only when nothing can be lost.** The sweep archives a worktree through the
host, never with `git worktree remove`, and only when its commits are on a freshly fetched base
branch or kept under a local, never-pushed `specnaut-kept/` branch, its status is clean, and its
ignored files were copied out to `~/.specnaut-kept/`. A refusal is reported, never forced. The merge
phase runs this sweep on every exit, including `--pr`.

`specnaut upgrade` adds the file and the `AGENTS.md` pointer on its own; other harnesses are
unchanged.
