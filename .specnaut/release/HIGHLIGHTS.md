**Check your committed `.specnaut/feature.json`.** Until this release, `/specnaut plan` told the
agent to write the feature directory there as an absolute path — your home directory, username
included — and that file is committed on the feature branch by design. On a public repository that
path was published with the branch. From v4.5.0 the plan phase writes it repo-relative
(`.specnaut/specs/<prefix>-<name>`); both readers always accepted that form, so nothing else
changes. `upgrade` does not rewrite a `feature.json` already in your history, and no tool should do
that on your behalf: if a published one matters to you, that is a history rewrite you decide on.

**A release publish always stops for you.** The scaffolded Claude Code settings now carry `ask`
rules for `gh release create`, `gh release edit … --draft…` and `gh run rerun`. Claude Code checks
`ask` before `allow`, so a broad `gh release *` you added to run `/ship` unattended still prompts at
the one step you cannot take back — including inside a compound command. `upgrade` merges the rules
into an existing `settings.json` and leaves your own allow and deny lists alone. Two consequences,
stated rather than discovered: an unattended or headless `/ship release` now stops at that prompt,
and a rule you delete comes back on the next `upgrade` — a guard you can switch off by accident is
not one. Publishing through the raw REST API is not covered.

**Add to a bundled phase without freezing it.** A project that needed one extra sentence in a
Specnaut phase used to preserve the whole file, and from then on hand-merge every upstream change
into it. A project-owned `.specnaut/addenda/<skill>/<phase>.md` — for example
`.specnaut/addenda/ship/release.md` — is now read with that phase. It adds at the step it names and
never replaces a bundled one; the bundled doc keeps updating underneath it. Keep a full preserve for
changing or removing a bundled step.

**`release-github.sh` reports what GitHub holds, not what it was asked.** A stray draft no longer
counts as the deployed baseline and silently moves the changelog range. `--draft` no longer prints
"published". A re-run that finds an existing release now says whether it is a draft, on a
machine-readable last line (`created|exists draft=<bool> url=<url>`), and `--fail-if-exists` refuses
to adopt one.

**Also in this release.** Feature numbers are no longer reused after a shipped spec directory is
removed — the next number counts every spec directory in git history. `set-field.sh` writes
organization-level date fields, and a failed field discovery now exits `13` instead of looking like
an absent field and steering you into a label beside a native field. `upgrade` clears staged copies
left by older upgrades, and `reconcile --status` lists only what `reconcile <path>` can resolve. The
Claude, Codex and Cursor context files no longer point at paths your backlog backend does not have.

Still on v4.3.0? `self-update` cannot reach any later release from there — reinstall once from
[specnaut.com](https://specnaut.com). From v4.4.0 on, `self-update` works as normal.
