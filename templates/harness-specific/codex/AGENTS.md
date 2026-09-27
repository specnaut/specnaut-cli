# Codex Reference

- **Project documentation and rules**: the primary reference is `AGENTS.md`
  at the project root. Read it first.
- **Skills**: installed skills live in `.agents/skills/`.
- **Subagents**: Codex subagent definitions live in `.codex/agents/`
  (TOML format).
<!-- BEGIN: backend=local -->
- **Backlog**: managed via the `/board groom` workflow — local Markdown
  backend, indexed in `.specnaut/backlog.md`.
<!-- END: backend=local -->
<!-- BEGIN: backend=github -->
- **Backlog**: managed via the `/board groom` workflow — GitHub Issues and a
  GitHub Project, configured in `.specnaut/backlog-config.yml`.
<!-- END: backend=github -->
<!-- BEGIN: backend=gitlab -->
- **Backlog**: managed via the `/board groom` workflow — GitLab Issues,
  configured in `.specnaut/backlog-config.yml`.
<!-- END: backend=gitlab -->
<!-- BEGIN: backend=cloud -->
- **Backlog**: managed via the `/board groom` workflow — Specnaut Cloud,
  configured in `.specnaut/backlog-config.yml`.
<!-- END: backend=cloud -->

**Backlog references** follow the `backlog-reference-contract` skill — read it; never restate it here.

**Response style** — brevity, visual order, questions as selections, badge colours — follows the `response-style-contract` skill; read it, never restate it here.

**UI work** follows the `mobile-first-contract` skill — read it; never restate it here.

## Optional integrations

These are Codex CLI features Specnaut does NOT configure by default, but
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
