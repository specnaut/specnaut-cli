**`install.sh` verifies what it installs.** It installs from a published release, never from `main`,
and with `gh` on the machine it checks the release's attestation before it runs anything. Each
release now publishes the installer beside the binaries, in its own attestation bundle, and
`SECURITY.md` shows the commands to verify it by hand before running it.

**`/task kanban` opens your backlog board in the browser** and prints its link.

**A container run records the syscall filter it really got.** A probe inside the container reads
which names of the CLI's profile the OCI runtime put in force and which it dropped, and the run's
evidence lists both. A runtime whose libseccomp is too old to know a name is no longer silent about
it.

**The size ratchet exempts generated code by default**, so a regenerated file no longer counts
against the size limits.

**The merge's instruction check reads more of what a branch can run.** It reads commands nested in
substitutions and `-c` strings, the files those commands run, a skill's fenced shell blocks and
`allowed-tools` grants, PowerShell `$env:Path` and `PATH+=` forms, and nested `.gitattributes` and
`.lfsconfig` files. A customised shipped skill is asked about once per content, in any letter case,
and a non-ASCII name is asked about rather than matched.

**Programs Specnaut starts are never taken from your project's folders.** git, gh, the sandbox
engines, bubblewrap and the toolchain probes are looked up only on PATH entries outside the
repository. When that leaves nothing, the error names the entry that was left out and why.

**`/task merge` pushes Git LFS objects** when it pushes with hooks off, with trace variables cleared
and signed URLs cut to their host.
