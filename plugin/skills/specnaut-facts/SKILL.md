---
name: specnaut-facts
description: The vendored offline snapshot of what Specnaut is, its commands, harnesses and backlog backends — what specnaut-guide answers from when the live docs cannot be fetched. Preloaded, not user-invocable.
user-invocable: false
constitution-exempt: reference facts about Specnaut preloaded by specnaut-guide, which already reads the constitution first
---

# specnaut-facts

Preloaded by `specnaut-guide`. Split out of that agent. The seat's *protocol* (fetch live, check versions, route reports) and the
*facts* it falls back on change for different reasons, which is the split.

**This is a snapshot and it goes stale.** The live docs win; see the seat's
fetch protocol. Nothing was cut in the move.

Frozen at scaffold time. Run the live fetch protocol for anything newer.

### What Specnaut is

Enhanced fork of [`specify` CLI](https://github.com/github/spec-kit), distributed as a single native binary. Scaffolds AI harness files — SpecKit slash-commands, spec/plan/tasks templates, a constitution, sub-agents, and a backlog system — into an existing project in one command. Does **not** call any LLM; the user's AI harness reads the generated files. Docs: <https://specnaut.com/llms.txt>. Source: <https://github.com/specnaut/specnaut-cli>.

**Install:** `curl -fsSL https://raw.githubusercontent.com/specnaut/specnaut-cli/main/install.sh | bash` or `brew tap specnaut/tap && brew install specnaut`.

**Harnesses:** claude, cursor, codex, copilot, opencode, antigravity — all share `templates/core/` content, mapped per-harness by an adapter.

**Different from upstream Spec Kit:** auto-chained pipeline (`/task plan` chains all phases); dedicated `review` phase after implement; backlog as product source of truth via `product-owner` agent (backends: local, github, gitlab, cloud); Claude Code plugin distribution (the `specnaut-cockpit` plugin from the `specnaut-marketplace` marketplace).

**Bundled agents:** product-owner, developer, code-reviewer, security-expert, specnaut-guide, architect-expert, performance-expert, accessibility-expert, dependency-expert.

### Commands

- `specnaut init [--here] [--ai <harness>] [--backlog <backend>] [--backlog-url <url>]` — scaffold the project.
- `specnaut upgrade` — refresh templates. On apply writes `.specnaut/upgrade-pending.json` (`{from,to,at}`) + staging dir (`.specnaut/upgrade-staging/<path>`, consumed by `specnaut reconcile`; each apply leaves only the files that run preserved); both removed after successful `review-upgrade` walk. Prints `@specnaut-guide review-upgrade` handoff.
- `specnaut reconcile --status` — list files pending post-upgrade reconciliation as JSON; only paths `reconcile <path>` can resolve. Its `refused` list (`{path, reason}`) names staged links no command may act on: show each to the user, verbatim; they remove the link itself.
- `specnaut reconcile <path> --accept-upstream` — take the new template version (backs up local, updates lock).
- `specnaut reconcile <path> --accept-current` — keep local version (re-stamps lock SHA only).
- `specnaut check [--project]` — verify scaffold integrity.
- `specnaut scan [--path <dir>] [--format text|json|mermaid] [--top <n|all>]` — map file, function and class sizes against the size limits, read-only, offline, no agent: where to look, never a verdict. Function and class sizes are estimated. Exit 0 no file over its ceiling, 1 one is, 2 usage or a `--path` matching nothing, 3 could not run.
- `specnaut gate <status|raise|cancel>` — the non-interactive bridge a skill phase uses to raise a remote-control gate (Specnaut Cloud).
- `specnaut self-update` — replace binary with latest release, verifying SHA256.
- `specnaut --version` — print binary + bundled templates version.

### Skills

- `/task` — one unit of work: backlog (`list`, `next`, `add`, `edit`, `close`, `groom`), pipeline (`plan`, `implement`, `review`, `merge`), `audit` (`--security`, `--archi`, `--perf`, `--a11y`, `--deps`; every applicable axis with no flag; opened by the `specnaut scan` map, `--scan` for the map alone), `constitution`.
- `/specnaut` — the framework: `doc`, `list`, `upgrade`, `issue` (reports a Specnaut problem or proposal upstream, after the user approves the exact text).
- `/ship` — production: `tag`, `release`.
- `/design` — the project's `DESIGN.md` design system: discovery when absent, edit when present, `audit` for drift. Started by the user only.

Earlier releases kept the pipeline, the backlog and the audits at other addresses; the `specnaut` skill's **Retired addresses** table maps each to its new one, and `specnaut upgrade` moves them.

### Quality gates

`.specnaut/gates.yml` declares the `fast` and `full` tiers, and `run-gate.sh <tier>` runs them. A project may opt in to running only what a change can affect: `.specnaut/impact.json` and an adapter of its own, used behind `--base <rev>` or `--refs-stdin`. Specnaut ships no graph and names no build tool; what cannot be shown safe runs the whole tier and names why. Behind those flags exit 3 refuses a candidate and exit 4 means nothing was checked. `phases/quality-gates.md` is the contract.

### Backlog conventions (GitHub backend)

`Priority` (P0–P3) and `Size` (XS–XL) via Project V2 native fields (`set-field.sh`); fall back to `priority:*`/`size:*` labels when the native field is absent. Two-step close: `gh issue close --reason completed` first, then `move.sh <num> Done` — moving first makes a sweep report the open card in Done as drift. `/task groom` catches items closed via paths that bypassed the move step.

### Optional integrations

Harness features Specnaut does not configure but that pair well with it — Claude Code's `/loop`,
`/goal`, `claude agents`, headless runs, deep links, MCP; Codex's `/goal` and CLI reference — are in
`integrations.md`, the document installed beside this skill's own file. The always-on `AGENTS.md`
points there in one line.

### Design principles

Agnostic of language / LLM / harness / backlog backend. Single binary via `deno compile` for macOS, Linux, Windows. No Python or extra runtimes.
