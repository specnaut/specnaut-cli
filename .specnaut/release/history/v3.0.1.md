**Nothing you install has changed.** The binary and the scaffolded templates
are byte-identical to v3.0.0 — `specnaut upgrade` on a project already at
3.0.0 will find nothing to do, and that is the correct outcome.

This release exists to harden the release pipeline itself, after a retroactive
audit of how v3.0.0 shipped. Three defects would have hit the *next* release:
the hand-written highlights block republished itself because nothing reset it;
postflight aborted before printing the verdicts it had just computed whenever
the operator's local binary failed to self-update; and the docs-site refresh
reported success on dispatch acceptance rather than on the site actually being
rebuilt.

A tag can now only be cut on a commit that is genuinely a release commit, with
a clean tree and six version files that agree, and the adoption gate no longer
demands a user-facing guide for code that reaches no user project.
