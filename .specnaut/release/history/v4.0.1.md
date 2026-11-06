**If you scaffolded with 4.0.0 on anything but Claude Code, the first thing Specnaut told you to
type did not exist.**

`init`'s "Next steps" hardcoded the Claude command surface and printed it under every harness. On
the five that namespace their skills the board is `/specnaut-board`, so `/board add` — the headline
command of 4.0.0 — was a no-op. Windsurf was wrong twice over: its phases are flat sibling
workflows, so `/specnaut plan` is `/specnaut-plan` there. And GitHub Copilot has no slash commands
at all — it applies `.github/instructions/` by context — so every line it was handed was fiction.

Nothing about the scaffolded projects was wrong; only the instructions were. Re-running `init` is
not necessary, and `upgrade` is not either — the fix is entirely in what the binary prints.

The command shapes are not a preference. They fall out of where each harness puts a phase and a
board skill: phases nested under the router's own folder mean the router takes the phase as an
argument, phases emitted as siblings mean each is its own command. So the fix is a table checked
against the destinations each harness actually emits, rather than a table someone maintains by hand
— a harness that changes its layout now takes a test red instead of quietly making `init` lie.

Three smaller contradictions between the binary and its own documentation, from the same pass:
`--help` said the backlog default was `local` when it is `cloud`, and a non-interactive `init` takes
that default and produces a project with no credentials — the one reference that should have warned
you stated the opposite. `specnaut cloud token` ships and works but was missing from `--help`,
leaving the only scriptable auth primitive invisible to anyone starting there. And `UPGRADING.md`
quoted "2 added, 2 removed" for the 4.0.0 migration; a real upgrade from 3.2.0 removes five, and one
of them is `.claude/commands/`, which a user who does not expect it will not commit.

None of these came from a check firing. They came from running the released binary against a clean
project and reading what it said.
