**`/specnaut upgrade` brings a project up to date from inside the session.** It updates the
`specnaut` binary when a newer release is out, runs `specnaut upgrade`, lists the files it kept
because you customised them and the ones waiting for `specnaut reconcile`, checks the project, and
commits the result as `chore(specnaut): upgrade to v<version>` without pushing. `--dry-run` shows
the plan and changes nothing.
