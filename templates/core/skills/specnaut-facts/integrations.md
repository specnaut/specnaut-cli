# Optional integrations

Harness features Specnaut does not configure, but that pair well with its workflow. This is
reference, read on request — the always-on `AGENTS.md` carries one line pointing here. The
harness's own documentation wins wherever it says something newer.

## Claude Code

- **Periodic maintenance** — `/loop 1h` runs the prompt in `.claude/loop.md` every hour. The
  bundled default delegates to the `/task groom` skill (groom backlog, surface stale PRs, list
  orphan specs); edit `loop.md` freely to add project-specific checks. See
  https://code.claude.com/docs/en/scheduled-tasks.

- **Goal-directed sessions** — `/goal <condition>` keeps Claude taking turns until a fast model
  judges the condition met. Best conditions state one measurable end state and a turn cap, e.g.
  `/goal every open pull request has a passing CI run, or stop after 20 turns`. Run headless with
  `claude -p "/goal …"`. Check status with `/goal`; cancel with `/goal clear` (aliases:
  `stop`/`off`/`reset`/`cancel`). For recurring periodic checks use `/loop` (see `.claude/loop.md`)
  instead. See https://code.claude.com/docs/en/goal.

- **Multi-session dispatch (`claude agents`)** — opens a terminal UI that lists every background
  Claude session, dispatches new ones, and lets you peek / reply / attach without losing context.
  Specnaut's scaffolded subagents in `.claude/agents/` appear in the dispatch picker automatically —
  start one with the agent name as the first word, e.g. `developer fix the lint errors in src/cli/`,
  `@code-reviewer review the last commit`, or `@product-owner groom the backlog`. Skills are
  dispatchable too: `/task plan "<feature>"` launches a session running the full
  plan-implement-review chain. File edits are isolated under `.claude/worktrees/` (git worktrees),
  so several Specnaut agents can work in parallel without stepping on each other. See
  https://code.claude.com/docs/en/agent-view.

- **Async notifications** — install one of the channel plugins (Telegram, Discord, iMessage) so
  Claude can ping you when a long-running task or agent dispatch finishes. See
  https://code.claude.com/docs/en/channels.

- **Headless / CI invocation** — `claude -p "<prompt>"` runs Claude Code non-interactively, useful
  for CI gates, pre-commit hooks, and cron jobs that dispatch a specific agent. Specnaut ships a
  wrapper at `.claude/scripts/dispatch-agent.sh <agent-name> "<prompt>"` that derives the right
  `--allowedTools` from the agent's frontmatter. See https://code.claude.com/docs/en/headless.

- **Deep links** — a `claude-cli://open?repo=<owner>/<repo>&q=<prompt>` URL opens a fresh Claude
  Code session in the right project with the prompt pre-filled. Useful in runbooks, dashboards, and
  chat messages. See https://code.claude.com/docs/en/deep-links.

- **MCP servers** — connect external tools (GitHub, cloud consoles, databases) via `.mcp.json`. See
  https://code.claude.com/docs/en/mcp.

## Codex

- **Goal-directed sessions** — `/goal <objective>` keeps Codex working toward one objective across
  turns until its stopping condition holds; bare `/goal` shows the current goal, and
  `/goal pause`, `/goal resume`, `/goal clear` control the run. The feature may need
  `goals = true` under `[features]` in your Codex `config.toml`. See
  https://learn.chatgpt.com/use-cases/follow-goals.

- **CLI reference** — the full Codex CLI surface (slash commands, config schema, headless mode):
  https://learn.chatgpt.com/docs/developer-commands?surface=cli.

- **More Codex use cases** — https://learn.chatgpt.com/use-cases.
