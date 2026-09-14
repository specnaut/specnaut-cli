---
name: using-specnaut
description: Bootstrap skill loaded at session start. Teaches the agent how to discover and invoke Specnaut's bundled skills, agents, and slash commands. Auto-injected by the SessionStart hook on harnesses that support hooks (Claude Code, Cursor); on other harnesses, read this file once per session before answering Specnaut-related questions.
---

# Using Specnaut

This is the bootstrap skill that makes the agent **Specnaut-aware** on
every turn. It does not do any work itself — it points the agent at the
right Specnaut skill / agent / slash command for the user's intent.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/using-superpowers/SKILL.md`. Re-implemented for
> Specnaut's skill ecosystem.

## The rule

**If you think there is even a 1% chance a Specnaut skill applies to
what the user is asking, invoke it.** Skills override default behaviour
where they apply.

User instructions in `CLAUDE.md`, `AGENTS.md`, or direct requests
always take precedence over a skill's defaults. If the user says
"skip TDD" and a skill says "always TDD", follow the user.

## How to invoke a Specnaut skill

Use the harness's `Skill` tool (Claude Code) or the equivalent
(`skill` on Codex/OpenCode/Copilot — see "Tool-name differences across
harnesses" below for where your harness's mapping lives).

The skill content is loaded into your context. Follow it directly — do
not re-read the file with `Read`.

## Specnaut skill registry

| Skill | When to invoke |
|---|---|
| `specnaut` (router) | User typed `/specnaut <phase>` or asked for the spec-kit pipeline (`/specnaut plan → tasks → implement → review → merge`). Greenfield features with formal specs. |
| `writing-plans` | User wants to plan an issue or a feature without the spec-kit ceremony. Trigger phrases: "plan this", "write a plan for X", "give me an implementation plan". |
| `requesting-code-review` | Work is complete enough to need an independent eye. Dispatch the bundled `code-reviewer` agent with the canonical prompt template. |
| `subagent-driven-development` | Execute a plan task-by-task with mandatory two-stage review (spec compliance + code quality) per task. Consumes plans produced by `writing-plans`. |
| `executing-plans` | Inline alternative to subagent-driven — execute a plan task-by-task in-session with checkpoint pauses. Faster for trivial plans. |
| `response-style-contract` | Preloaded, never invoked. How every answer is shaped — brevity, visual order, questions as selections, badge colours. In force on every turn. |
| `verification-before-completion` | Discipline checklist that any agent MUST run before reporting DONE. Tests green / pre-commit clean / plan boxes ticked / smoke audit / plugin sync / Windsurf cap / requirements addressed. |
| `brainstorming` | Spec-discovery entry point when the idea is vague — discovery dialogue, then present the design and hand off to `writing-plans`. Questions follow the `response-style-contract` skill. |
| `code-audit` | User wants a broad, multi-seat health-check ("audit the codebase", "code audit", "audit the last N commits"). Resolves a scope, dispatches the applicable expert seats (architecture / security / performance / a11y / dependency) in parallel, synthesizes one report. Read-only. Complementary to `/specnaut audit <axis>`, which runs a single axis. |
| `arch-audit` / `sec-audit` / `perf-audit` / `dep-audit` / `a11y-audit` | Per-axis audit family — user wants **one** lens over a scope ("arch audit", "security audit `--path src/`", "perf audit `--diff`"). Each resolves a uniform scope (`--path` / `--range` / `--diff` / whole) and dispatches its **single** bound expert (architecture / security / performance / dependency / a11y), returning findings **inline**. Read-only, writes no report. Complements `/specnaut audit <axis>` (which persists a dated report) and `/code-audit` (the multi-seat team). |
| `status-audit` | User wants a health check of a running multi-agent session ("status audit", "audit the session", "what's blocked", "session health"). Reads the `.specnaut/logs/agents.jsonl` status ledger and reports seven views (state counts / per-agent latest / blocked / stale ≥15m / done-vs-criteria contradictions / missing handoffs / verdict summary). Read-only. Pair with `/loop 5m /status-audit` to supervise long headless work. |
| `backlog` | User asked about a backlog item, the board, an issue. Read-only access; mutations go through the `product-owner` agent. |

**Preloaded output-contract skills** (`user-invocable: false` — never invoke
directly): `workflow-contract`, `handoff-protocol`, `review-findings-contract`,
`qa-report-contract`. These define the machine-readable `WORKFLOW STATUS` /
`HANDOFF` / `REVIEW SUMMARY` / `QA SUMMARY` blocks. They are loaded into an
agent's context via the agent's `skills:` frontmatter (see the agent registry
below) and never appear as user commands.

## Specnaut agent registry

Dispatch via `Task({ subagent_type: "<name>" })`; on Codex
`spawn_agent(agent_type="<name>")` — never by description alone.

| Agent | When to dispatch |
|---|---|
| `developer` | Implementing tasks from a plan (TDD, frequent commits, in-code documentation). |
| `code-reviewer` | Reviewing diffs against a plan or requirements. Use the prompt template from `requesting-code-review` skill. |
| `security-expert` | Security review or alert triage on Specnaut-shipped code. |
| `test-reviewer` | Test-quality-only review (no architecture). |
| `product-owner` | **Every** backlog mutation goes through this agent — no exceptions. Read-only inspection (`list.sh`, `view.sh`) can be done directly. |
| `qa-tester` | Run the QA scenario catalogue against the released binary. |
| `devops-sre` | Advisory pass before editing CI workflows, build or install scripts, distribution channels, or infrastructure. |
| `specnaut-guide` | Specnaut-specific consulting on the binary, plugin, or scaffolded project state. |
| `review-coordinator` | Orchestrates the implement → review → fix loop for `/specnaut implement`. |
| `workflow-manager` | High-level workflow orchestration across phases. |
| `architect-expert` | Architectural drift — layering, cycles, god files, ports/adapters discipline. Reviews a diff, or audits the whole codebase via `/specnaut audit architecture`. |
| `performance-expert` | N+1 queries, blocking I/O, missing indexes, cache misuse, bundle weight. Review or `/specnaut audit performance`. |
| `dependency-expert` | Manifest hygiene — pins, ranges, licences, advisory shape, typosquatting. Review or `/specnaut audit dependencies`. |
| `accessibility-expert` | WCAG 2.1 AA over front-end source. Review or `/specnaut audit accessibility`. Stops early on a repo with no front-end surface. |
| `ui-ux-designer` | Owns `DESIGN.md`. Creates a design system from a brief, edits an existing one, or audits UI source for drift against it. |

## Routing principles

1. **`/specnaut plan` vs `writing-plans`** — both produce plans, but for
   different inputs:
   - `/specnaut plan` follows the spec-kit flow: one `plan.md` carrying
     the decision table and both plan-time audits, then `tasks.md`. Use
     for greenfield features with formal contracts.
   - `writing-plans` (skill) takes a free-form issue or requirement and
     produces a single executable plan file with bite-sized TDD tasks.
     Use for issue-driven and ad-hoc work.

2. **Backlog mutations → `product-owner`** — never call `add.sh`,
   `move.sh`, `set-field.sh`, or `gh issue {create,close,edit}`
   directly. Dispatch the PO. The PO knows about classification gates,
   sub-issue links, soft date axes, and reporting conventions.

3. **Releases & pipelines → `devops-sre` first** — before editing CI
   workflows, `install.sh`, build scripts, or running `/release`,
   dispatch `devops-sre` for an advisory pass. The agent is read-only;
   the main session executes after the advisory.

4. **`-expert` vs `-reviewer`** — a `-reviewer` only ever sees a diff.
   An `-expert` does that too, but also runs standalone over the whole
   codebase via `/specnaut audit <domain>`. So reach for an expert when
   the question is about the shape of the code rather than about this
   change: a new subsystem boundary, a dependency surface you inherited,
   a performance characteristic nobody has measured. Both are read-only
   — they return findings, the main session acts.

## Skill discovery on different harnesses

This file may run on any of Specnaut's plugin-distribution targets:
Claude Code, Codex CLI, Codex App, Cursor, OpenCode, GitHub Copilot
CLI. Each harness uses different tool names — `Read` vs `read_file`,
`Task` vs `spawn_agent`, etc.

Before invoking any tool, consult the right reference. Where it lives
depends on how this skill reached you:

- **Scaffolded into a project** (`specnaut init --ai <harness>`) — the
  harness was fixed at scaffold time, so exactly one reference ships and
  it is already yours: read `.specnaut/harness-tools.md` and stop.
- **Loaded from the plugin distribution** — the harness is not known in
  advance, so every reference ships side by side. Pick yours from
  `references/{claude,codex,cursor,opencode,copilot}-tools.md`, detecting
  the harness from env hints (`CLAUDE_PLUGIN_ROOT`, `CURSOR_*`,
  `CODEX_*`, …) or from the tool list in your current context.

If neither path yields a file, no mapping is recorded for your harness:
fall back to the baseline names above and check them against the tools
you can actually see. Never guess a tool name that is not in your
context.

## Red flags — these thoughts mean "stop and check for a skill"

| Thought | Reality |
|---|---|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read the current version. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "Kevin asked me to do X, just go" | Kevin's order is honored; the skill tells you HOW to honor it. |

## When NOT to invoke any Specnaut skill

- Pure conversation (greetings, clarifying chat, "thanks").
- Questions about another repo / project unrelated to Specnaut.
- Single-keystroke / single-word user inputs that need clarification
  before action (ask the user, then re-evaluate).

## Skill priority

When multiple Specnaut skills could apply, use this order:

1. **Process skills first** — `writing-plans` before any implementation;
   `requesting-code-review` after every task in a subagent-driven flow.
2. **Domain skills second** — `backlog` for backlog inquiries,
   `specnaut` (router) for spec-kit phases.

"Let's build X" → `writing-plans` first, then implementation skills.
"Fix this bug" → diagnose first (read the code), then `writing-plans`
if the fix needs more than 2 changes, otherwise just fix.

## Out of scope

This bootstrap skill is loaded by the SessionStart hook to make the
agent skill-aware. It does not:

- Execute any backlog / git / build commands itself
- Replace the per-skill SKILL.md files (read those when invoking a
  specific skill)
- Override `CLAUDE.md` / `AGENTS.md` project directives

For per-harness adapter details, see the manifest at
`plugin/.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`,
`.codex-plugin/plugin.json`, or the `.opencode/plugins/specnaut.js`
adapter (issues #277–#280).
