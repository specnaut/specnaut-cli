# Claude Reference

- **Project documentation and rules**: the primary reference is `AGENTS.md` at
  the project root. Read it first.
- **Skills**: installed skills live in `.claude/skills/`.
- **Specflow commands**: custom Specflow commands live in `.claude/commands/`.
- **Agents**: specialized agents live in `.claude/agents/`.
- **Backlog**: managed via `/backlog` — when the project uses the local
  Markdown backend, see `.specflow/backlog.md`.

## Optional integrations

These are Claude Code features Specflow does NOT configure by default, but
that pair well with the scaffolded workflow. Set them up if they fit your
team's needs.

- **Periodic maintenance** — `/loop 1h` runs the prompt in
  `.claude/loop.md` every hour. The bundled default delegates to the
  `/specflow groom` skill (groom backlog, surface stale PRs, list orphan
  specs); edit `loop.md` freely to add project-specific checks. See
  https://code.claude.com/docs/fr/scheduled-tasks.

- **Goal-directed sessions** — `/goal <condition>` keeps Claude taking
  turns until a fast model judges the condition met. Best conditions
  state one measurable end state and a turn cap, e.g. `/goal the Ready
  column on the Specflow Project is empty and deno task test exits 0,
  or stop after 20 turns`. Run headless with `claude -p "/goal …"`.
  Check status with `/goal`; cancel with `/goal clear` (aliases:
  `stop`/`off`/`reset`/`cancel`). For recurring periodic checks use
  `/loop` (see `.claude/loop.md`) instead. See
  https://code.claude.com/docs/fr/goal.

- **Async notifications** — install one of the channel plugins (Telegram,
  Discord, iMessage) so Claude can ping you when a long-running task or
  agent dispatch finishes. See
  https://code.claude.com/docs/fr/channels.

- **Headless / CI invocation** — `claude -p "<prompt>"` runs Claude Code
  non-interactively, useful for CI gates, pre-commit hooks, and cron jobs
  that dispatch a specific agent. Specflow ships a wrapper at
  `.claude/scripts/dispatch-agent.sh <agent-name> "<prompt>"` that auto-
  derives the right `--allowedTools` from the agent's frontmatter. See
  https://code.claude.com/docs/fr/headless.

- **Deep links** — a `claude-cli://open?repo=<owner>/<repo>&q=<prompt>` URL
  opens a fresh Claude Code session in the right project with the prompt
  pre-filled. Useful in runbooks, dashboards, and Slack messages. See
  https://code.claude.com/docs/fr/deep-links.

- **MCP servers** — connect external tools (GitHub, GCP, AWS, databases)
  via `.mcp.json`. See https://code.claude.com/docs/fr/mcp.
