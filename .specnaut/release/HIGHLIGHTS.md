**If you are on v4.3.0, `self-update` will not bring you here. Reinstall once from
[specnaut.com](https://specnaut.com).**

v4.3.0 shipped signature verification and a defect in it. A Sigstore signing certificate lives ten
minutes; the verifier compared that window against the current time, so a release stopped verifying
shortly after it was built. The effect was not intermittent — every `self-update` more than ten
minutes after a release failed, for every user, with a message blaming a certificate-authority
rotation that had not happened.

The fix is in this release, which is exactly the problem: the binary doing the checking is the one
with the defect. A v4.3.0 binary cannot install v4.4.0, and no release we publish can change that.
Reinstalling from the website is a one-time step, and `install.sh` and Homebrew were never affected
— both verify the checksum sidecar and contain no signature path at all.

**What was actually wrong, since the guarantee is the point.** A certificate's validity window says
when it could sign, so it has to be judged against when the signature was _made_, not when someone
happens to look. That instant was in the bundle all along, in the transparency log's entry, and the
verifier was throwing it away. It now reads it — and trusts it only because Rekor counter-signs it.
Taken unverified, that timestamp is a number whoever writes the bundle chooses freely: a check that
constrains nothing while looking like it constrains something. The log's key is pinned, and the pin
is checkable rather than asserted — its SHA-256 is the log id printed in every attestation we
publish.

No test could have caught it. Every signing test minted a certificate valid for six years and froze
the clock, so the one leg that fails in reality was the one no fixture could reach. A real published
bundle is now committed and verified at the real clock, and it must keep passing as that bundle
ages.

The release pipeline now checks this too. Postflight runs the shipped verifier over the published
binaries, so a defect in a signature leg is caught while the release can still be corrected — not
one version later, by users.

**`/ship` is a top-level skill.** A project now gets three skills, divided by what they own:
`/board` the backlog, `/specnaut` the specification, `/ship` production. Tagging and releasing were
phases of the router that writes plans; they are now `/ship tag` and `/ship release`. On upgrade the
old phase documents move to their new address and carry their lock identity with them, so a file you
customised stays customised and stays read — instead of sitting orphaned at the old path while the
agent loads the vanilla copy at the new one.

**Codex subagents no longer inherit the primary model.** A child spawned by task description picks
no role, and Specnaut emitted no `[agents]` defaults, so every such child ran on the parent
session's model — raising the primary raised all of them, silently. The Codex scaffold now sets the
defaults.

**The plugin migration never ran, and now does.** The plugin detector looked for plugins one
directory level above where Claude Code installs them, so it answered "not installed" for every real
installation and the migrate-to-plugin path was dead code. It now finds them, and it covers every
agent and skill the plugin serves rather than one. The first upgrade with the plugin installed moves
the files the plugin now serves aside as `*.specnaut.bak`. They are backups: uninstall the plugin
and the next upgrade restores the files from the bundle.

**Backlog on GitHub Projects.** Single-select fields projected from the organization are read and
written natively instead of falling back to a label beside a field that already holds the value.
`list.sh Done` returns closed work instead of an empty column. `add.sh` no longer dies when the
board's auto-add workflow attaches the issue first, which used to leave a real issue with no Status,
out of sight of every column filter.
