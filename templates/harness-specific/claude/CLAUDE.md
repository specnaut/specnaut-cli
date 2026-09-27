# Claude Reference

- **Project documentation and rules**: the primary reference is `AGENTS.md` at
  the project root. Read it first.
- **Skills**: installed skills live in `.claude/skills/` — including the
  `/specnaut` and `/board` entry points.
- **Agents**: specialized agents live in `.claude/agents/`.
<!-- BEGIN: backend=local -->
- **Backlog**: managed via `/board` — local Markdown backend, indexed in
  `.specnaut/backlog.md`.
<!-- END: backend=local -->
<!-- BEGIN: backend=github -->
- **Backlog**: managed via `/board` — GitHub Issues and a GitHub Project,
  configured in `.specnaut/backlog-config.yml`.
<!-- END: backend=github -->
<!-- BEGIN: backend=gitlab -->
- **Backlog**: managed via `/board` — GitLab Issues, configured in
  `.specnaut/backlog-config.yml`.
<!-- END: backend=gitlab -->
<!-- BEGIN: backend=cloud -->
- **Backlog**: managed via `/board` — Specnaut Cloud, configured in
  `.specnaut/backlog-config.yml`.
<!-- END: backend=cloud -->

**Backlog references** follow the `backlog-reference-contract` skill — read it; never restate it here.

**Response style** — brevity, visual order, questions as selections, badge colours — follows the `response-style-contract` skill; read it, never restate it here.

**UI work** follows the `mobile-first-contract` skill — read it; never restate it here.

## Optional integrations

These are Claude Code features Specnaut does NOT configure by default, but
that pair well with the scaffolded workflow. Set them up if they fit your
team's needs.

- **Periodic maintenance** — `/loop 1h` runs the prompt in
  `.claude/loop.md` every hour. The bundled default delegates to the
  `/board groom` skill (groom backlog, surface stale PRs, list orphan
  specs); edit `loop.md` freely to add project-specific checks. See
  https://code.claude.com/docs/fr/scheduled-tasks.

- **Goal-directed sessions** — `/goal <condition>` keeps Claude taking
  turns until a fast model judges the condition met. Best conditions
  state one measurable end state and a turn cap, e.g. `/goal the Ready
  column on the Specnaut Project is empty and deno task test exits 0,
  or stop after 20 turns`. Run headless with `claude -p "/goal …"`.
  Check status with `/goal`; cancel with `/goal clear` (aliases:
  `stop`/`off`/`reset`/`cancel`). For recurring periodic checks use
  `/loop` (see `.claude/loop.md`) instead. See
  https://code.claude.com/docs/fr/goal.

- **Multi-session dispatch (`claude agents`)** — opens a terminal UI
  that lists every background Claude session, dispatches new ones,
  and lets you peek / reply / attach without losing context. Specnaut's
  scaffolded subagents in `.claude/agents/` appear in the dispatch
  picker automatically — start one with the agent name as the first
  word, e.g. `developer fix the lint errors in src/cli/`, `@qa-tester
  run a sandbox smoke pass`, or `@product-owner groom the backlog`.
  Skills are dispatchable too: `/specnaut plan "<feature>"` launches
  a session running the full spec-plan-tasks chain. File edits are
  isolated under `.claude/worktrees/` (git worktrees), so several
  Specnaut agents can work in parallel without stepping on each
  other. Requires Claude Code v2.1.139+. See
  https://code.claude.com/docs/fr/agent-view.

- **Async notifications** — install one of the channel plugins (Telegram,
  Discord, iMessage) so Claude can ping you when a long-running task or
  agent dispatch finishes. See
  https://code.claude.com/docs/fr/channels.

- **Headless / CI invocation** — `claude -p "<prompt>"` runs Claude Code
  non-interactively, useful for CI gates, pre-commit hooks, and cron jobs
  that dispatch a specific agent. Specnaut ships a wrapper at
  `.claude/scripts/dispatch-agent.sh <agent-name> "<prompt>"` that auto-
  derives the right `--allowedTools` from the agent's frontmatter. See
  https://code.claude.com/docs/fr/headless.

- **Deep links** — a `claude-cli://open?repo=<owner>/<repo>&q=<prompt>` URL
  opens a fresh Claude Code session in the right project with the prompt
  pre-filled. Useful in runbooks, dashboards, and Slack messages. See
  https://code.claude.com/docs/fr/deep-links.

- **MCP servers** — connect external tools (GitHub, GCP, AWS, databases)
  via `.mcp.json`. See https://code.claude.com/docs/fr/mcp.
