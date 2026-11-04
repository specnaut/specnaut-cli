**One approval word no longer covers two gates.** `merge` used to land a branch and also release
edits to what guards the landing, including the settings switch that turns every hook off. Editing
`.claude/settings*.json`, `.specnaut/hooks/`, `.specnaut/workflow.yml` or the landing scripts now
needs your own `approve the guard change` in that turn.

**Why this is a major: `merge` is refused for those files, where it used to work.** The refusal says
what to type. Run `specnaut upgrade`; on Codex, then trust the hooks again with `/hooks`.

**The guards fire far less on ordinary work.** An unreadable line, or a command word that is only a
variable, is held only when the line names git or a listed command. `ls`, `echo`, `printf`, `stat`,
`git grep` and a literal `for` header no longer read as writes to the constitution. An unquoted
heredoc is read as bash reads it, so its prose names nothing and its substitutions still count.

**`view.sh` returns the whole issue when an agent runs it.** Without a terminal it printed only the
comments, so an issue with none looked empty. It now prints the creation time, fields, body and
comments.
