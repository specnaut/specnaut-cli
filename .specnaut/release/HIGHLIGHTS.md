**`/task review` can review a pull request it cannot trust.** Give it a PR number or a
`<remote>/<branch>`, and the review exports that branch as inert files rather than checking it out.
Its gates then run in a sandbox: a container (podman, then docker) first, then bubblewrap on Linux
or `sandbox-exec` on macOS. Anything that cannot run there is reviewed statically and is never run.
`specnaut review trust <pr> <sha>` decides from the forge's own facts whether a PR needs this. On
Claude Code, a session that starts such a review stays locked to it until it ends. On every other
harness, this mode is refused. The verdict never merges.

**`specnaut sandbox probe` and `specnaut sandbox exec`** show which sandbox your machine offers and
run a command under it. Both say which resource caps a run goes without.

**`specnaut upgrade` ends with what is new:** the highlights of every release it crossed, from the
binary itself, with no network needed.

**`/task` starts no new work while an earlier landing is unsettled**, and text sent to Specnaut
Cloud is checked for credentials before it leaves your machine. The macOS binaries are now signed
and notarized, so the Keychain keeps "Always Allow" across `self-update`.

**The cockpit loads on Claude Code again.** Claude Code could not refresh the marketplace that
`specnaut upgrade` declared, so the `specnaut-cockpit` mod never loaded. The marketplace is now
declared in a form Claude Code refreshes, still pinned to your Specnaut release, and the next
`specnaut upgrade` repairs a project's existing declaration.
