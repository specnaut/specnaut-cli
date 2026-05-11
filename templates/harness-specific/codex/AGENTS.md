# Codex Reference

- **Project documentation and rules**: the primary reference is `AGENTS.md`
  at the project root. Read it first.
- **Skills**: installed skills live in `.agents/skills/`.
- **Subagents**: Codex subagent definitions live in `.codex/agents/`
  (TOML format).
- **Backlog**: managed via the `/specflow groom` workflow — when the
  project uses the local Markdown backend, see `.specflow/backlog.md`.

## Optional integrations

These are Codex CLI features Specflow does NOT configure by default, but
that pair well with the scaffolded workflow.

- **Periodic maintenance** — `/goal` runs the prompt in `.codex/goal.md`
  as a one-shot long-horizon objective (groom backlog, surface stale PRs,
  list orphan specs); edit `goal.md` freely. The feature is experimental
  — opt in by adding `goals = true` under `[features]` in your Codex
  `config.toml`, or toggle it with `/experimental`. Lifecycle controls:
  `/goal pause`, `/goal resume`, `/goal clear`. See
  https://developers.openai.com/codex/use-cases/follow-goals.

- **CLI reference** — full Codex CLI surface (slash commands, config
  schema, headless mode): https://developers.openai.com/codex/cli/reference.

- **More Codex use cases** — https://developers.openai.com/codex/use-cases.
