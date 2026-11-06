**Specnaut now refuses to write, move, delete or read through a symlink that leaves your project.**

Every filesystem operation resolves its destination the way the kernel does — following the whole
symlink chain, applying `..` from where each component actually lands — and refuses anything that
resolves outside the project root. The message names the path you asked for, where it really
resolved to, and the root it escaped, so a refusal tells you what to fix rather than that something
went wrong.

**This can refuse a layout that used to work.** If a directory inside your project is a symlink to
somewhere outside it — a `.claude/` shared between checkouts, a skills folder linked to a dotfiles
repo — `init`, `upgrade` and `diff` will now stop rather than write through it. That is the point:
`diff` previously rendered the contents of a linked-to file on stdout, and this tool's stdout is
routinely read into an agent's context and into CI logs. If you rely on such a layout, replace the
link with a real directory, or point Specnaut at the directory the link resolves to.

The reason this shipped as one change rather than as a run of near-misses: two review rounds each
found a real defect in the same thirty-line resolver, one hop further out than the last. The space
of layouts is not enumerable by imagination. So the resolver is now checked against the kernel
itself — ninety-six enumerated layouts, ground truth obtained by performing the write and asking
where the bytes landed. Both previously-found defects fail that check in a single run.

**Epics are one branch, chained over their children, merged once.** Previously an epic produced a
branch per child and a merge per child. Now the chain loops over the children on a single branch,
fixups fold into the commit of the child they belong to, the merge is flat, and every card the merge
touches is closed and reconciled — including the parent, which cannot close while a child is open.

**If you install the plugin rather than scaffolding, you were missing the board skill entirely.**
Three bundled agents dispatch to `/board`, one of them blocking outright without its output, and the
plugin shipped none of it — not removed, never added. It ships now. The backend scripts still come
from `specnaut init`; a plugin-only install has the documents and needs an init before the mechanics
apply, which the skill now says on its own page.

Smaller, and worth knowing if you use the GitHub backlog backend: a wrong `project_number` in
`backlog-config.yml` used to be invisible. The read commands address the board through `repo:` alone,
so they kept working while every project write was dead. The four writing scripts now resolve the
number when the config is read and tell you which project numbers do exist for that owner. The two
`project_node_id` / `status_field_id` keys are gone — nothing ever read them, and nothing ever
populated them, despite the documentation promising both.
