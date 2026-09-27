---
name: specnaut-facts
description: The vendored offline snapshot of what Specnaut is, its commands, harnesses and backlog backends — what specnaut-guide answers from when the live docs cannot be fetched. Preloaded, not user-invocable.
user-invocable: false
---

# specnaut-facts

Preloaded by `specnaut-guide`. Split out of that agent under #562, when its
emitted Windsurf workflow had 47 characters of room left and no duplication to
reclaim. The seat's *protocol* (fetch live, check versions, file bugs) and the
*facts* it falls back on change for different reasons, which is the split.

**This is a snapshot and it goes stale.** The live docs win; see the seat's
fetch protocol. Nothing was cut in the move.

Frozen at scaffold time. Run the live fetch protocol for anything newer.

### What Specnaut is

Enhanced fork of [`specify` CLI](https://github.com/github/spec-kit), distributed as a single native binary. Scaffolds AI harness files — SpecKit slash-commands, spec/plan/tasks templates, a constitution, sub-agents, and a backlog system — into an existing project in one command. Does **not** call any LLM; the user's AI harness reads the generated files. Docs: <https://specnaut.com/llms.txt>. Source: <https://github.com/specnaut/specnaut-cli>.

**Install:** `curl -fsSL https://raw.githubusercontent.com/specnaut/specnaut-cli/main/install.sh | bash` or `brew tap specnaut/tap && brew install specnaut`.

**Harnesses:** claude, cursor, codex, windsurf, copilot, opencode, antigravity — all share `templates/core/` content, mapped per-harness by an adapter.

**Different from upstream Spec Kit:** auto-chained pipeline (`/specnaut plan` chains all phases); dedicated `review` phase after implement; backlog as product source of truth via `product-owner` agent (backends: local, github, gitlab); Claude Code plugin distribution (`specnaut-plugin` marketplace).

**Bundled agents:** product-owner, developer, review-coordinator, code-reviewer, security-expert, test-reviewer, qa-tester, workflow-manager, devops-sre, specnaut-guide.

### Commands

- `specnaut init [--here] [--ai <harness>] [--backlog <backend>] [--backlog-url <url>]` — scaffold the project.
- `specnaut upgrade` — refresh templates. On apply writes `.specnaut/upgrade-pending.json` (`{from,to,at}`) + staging dir (`.specnaut/upgrade-staging/<path>`, consumed by `specnaut reconcile`; each apply leaves only the files that run preserved); both removed after successful `review-upgrade` walk. Prints `@specnaut-guide review-upgrade` handoff.
- `specnaut reconcile --status` — list files pending post-upgrade reconciliation as JSON; only paths `reconcile <path>` can resolve.
- `specnaut reconcile <path> --accept-upstream` — take the new template version (backs up local, updates lock).
- `specnaut reconcile <path> --accept-current` — keep local version (re-stamps lock SHA only).
- `specnaut check [--project]` — verify scaffold integrity.
- `specnaut self-update` — replace binary with latest release, verifying SHA256.
- `specnaut --version` — print binary + bundled templates version.

### Backlog conventions (GitHub backend)

`Priority` (P0–P2) and `Size` (XS–XL) via Project V2 native fields (`set-field.sh`); fall back to `priority:*`/`size:*` labels when the native field is absent. Two-step close: `move.sh <num> Done` then `gh issue close --reason completed`. `/board groom` catches items closed via paths that bypassed the move step.

### Design principles

Agnostic of language / LLM / harness / backlog backend. Single binary via `deno compile` for macOS, Linux, Windows. No Python or extra runtimes.
