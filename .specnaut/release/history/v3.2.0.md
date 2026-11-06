**Six things reported success without proving it. This release makes each of them say what
happened.**

Two of the six were user-facing. `specnaut upgrade --reset-baseline` applied a wider set of files
than the "customized, and behind" list its own hint offers to apply — the flag was bounded to
"upstream moved", the hint counts only files a completed upgrade actually skipped. On a same-minor
upgrade the two agree and nothing shows; across majors upstream has moved for nearly everything. A
project audited going two majors measured 53 files rewritten against the 2 it was told about. The
flag is now bounded to exactly the list the report printed. One consequence is deliberate: a lock
corrupted by a pre-1.0 binary is healed one upgrade later than before, because a corrupted entry
only counts as behind once it lags the lock's own version. That is the price of the number in the
hint being true.

The other is that a project on the `cloud`, `github` or `gitlab` backlog backend was given
`.specnaut/backlog.md`, a Markdown index of a directory tree those backends never create. Its
manifest entry was missing the backend gate that 38 of its siblings carry, so it shipped everywhere
— a second, empty source of truth for data that lives elsewhere. `cloud` is the default, so this
reached most installs. It is now gated to the local backend, where the file it indexes exists.

Upgrading a project on any other backend therefore **deletes** that file: it is no longer part of
the bundle, so it becomes an orphan and `upgrade` removes it, listed under "removed (no longer in
templates)". A copy you edited is held back until you pass `--force`, and backed up when you do — an
untouched one goes without a `.specnaut.bak`, because there is nothing in it you wrote.
Local-backend projects keep theirs.

The remaining four are in the release pipeline itself, and share one shape. `Create release`
uploaded whatever `dist/` files it found and reported success, so a build short one binary published
a release that 404s for everyone on that platform. The security gate's degraded-mode warning was
unreachable — the array recording inaccessible queries was mutated inside a command substitution, so
a revoked scope read as "0 open alerts" and the gate passed on an empty signal it believed was a
clean one. It had never printed, on any release. `create_pr_idempotent` reported every
`gh pr create` failure as benign idempotency, so a rate limit, a revoked scope and a real
already-exists were indistinguishable. And the Codex marketplace channel, which had been green for
eighteen months, was retired: its pull requests targeted a fork nobody merged upstream, and opening
one was the last step, so nothing ever noticed that it published nothing.

Also here: a `skipIfExists` destination that a project has turned into a symlink is no longer
written wholesale. `writeTextFile` follows links, so such a write does not replace the destination —
it replaces whatever the link points at, and leaves the link intact, so nothing in a directory
listing shows the damage. The managed-section merge still follows the link deliberately, which is
what puts Specnaut's fenced block in the file a consolidated project actually reads.

None of these was found by a check firing. All six came out of auditing an upgrade path by hand.
