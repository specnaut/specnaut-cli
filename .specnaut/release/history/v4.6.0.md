**`specnaut check --project` now tells you when a phase addendum is never read.** An addendum under
`.specnaut/addenda/<skill>/<phase>.md` is only picked up when its path names a real phase. A typo
(`planning.md`), a phase an upgrade renamed (`specnaut/tag-version.md`, now `ship/tag.md`) or a
contract document instead of a phase used to be skipped without a word. The guardrail you wrote was
simply off. `check` now lists each such file with the path it most likely meant, as a warning, so
the exit code stays 0.

**The board scripts no longer blame your configuration for GitHub's rate limit.** When the project
could not be read, the GitHub backlog scripts said the configured project number did not exist and
exited 2, even when the real cause was a rate limit or a network error. They now exit 2 only when
the owner's project list was read and the number is not in it. Any other failure exits 13, "could
not verify", and quotes what `gh` said, so you retry instead of editing a config that was right.

Also in this release: every action in the release workflow is pinned to a commit SHA, and the
release notes list a change once even when two commits carry the same subject.
