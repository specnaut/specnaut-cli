# AGENTS.md — Specflow

> Context document for every future session (Claude Code, Codex, etc.). Read this first.

## Vision

Specflow is an **enhanced fork of the `specify` CLI** from
[GitHub Spec Kit](https://github.com/github/spec-kit), distributed as a **native binary** (no Python
prerequisites on the user side).

Specflow's role is **exactly** that of upstream `specify init`: scaffold, inside an existing
project, the files consumed by the user's AI harness (Claude Code, Cursor, Copilot, Codex, Windsurf,
…) — SpecKit commands, spec/plan/tasks templates, constitution, utility scripts. **Specflow does not
talk to any LLM. Specflow does not orchestrate any agent. It is the user's harness that consumes the
generated files.**

### The 3 differences from upstream

1. **Auto mode by default** — the generated `specify` skill/command chains
   `clarify → plan → tasks → analyze → implement → review → merge` in a single session, stopping
   only for (a) required clarifications, (b) pre-merge validation. Upstream is 100 % manual step by
   step.

2. **`review` phase post-implement** — a dedicated step that runs structural checks (architecture,
   silent catches, internal-ID exposure, cache, test coverage) then the quality gates (format / lint
   / typecheck / tests). The `implement → review → fix → re-review` loop is scripted in the
   generated skill. Upstream has no such phase.

3. **`backlog` command + Product Owner agent** — a task backlog system (index `tasks/backlog.md` +
   `tasks/backlog/NNN-slug.md` files with typed frontmatter) managed by a PO agent shipped in the
   templates, with a sync script to a remote backend (GitHub Issues + Project V2 in v1; GitLab /
   Bitbucket planned). Upstream has no notion of a product backlog.

## What Specflow is not

- Not an AI harness
- Not a multi-LLM orchestrator
- Not an agent runtime
- Not an executable specification engine
- Not a Claude Code rewrite

If the question is "can Specflow run without the user having an AI harness?" → **no**. Specflow
writes files that Claude Code (or Cursor, etc.) reads to operate. The binary's language is an
installation/distribution concern, not a runtime one.

## Frustrations with upstream Spec Kit

- Manual steps at every transition (no auto-chain)
- No structured `review` phase after implementation
- No notion of a **product backlog**: one feature at a time, no broader view
- Sync with a remote tracker (GitHub Issues…) must be done by hand

## Locked decisions

- **Language**: **Deno** (TypeScript, native compile via `deno compile`, zero-deps standard library,
  official `denoland/skills` for dev velocity).
- **v0.2 scope — multi-harness ready**:
  - Two target harnesses: **Claude Code** (default, `.claude/` + `.specflow/`) and **Cursor**
    (`.cursor/skills/` + `.cursor/rules/` + `.specflow/`) — single harness per invocation, selected
    via `--ai claude|cursor`
  - CLI surface and behaviour equivalent to upstream `specify init`
  - The **3 differentiating features embedded by default**: auto-chain, `review` phase, backlog +
    Product Owner agent
- **Backlog storage**: local Markdown files (index + one file per task) + one-way sync script to
  GitHub Issues/Project V2 via `gh`. GitLab/Bitbucket in v2+.
- **Additional harnesses** (Codex, Copilot, Windsurf, OpenCode, Antigravity, …): v0.3+.

## Methodology observed in `examples/` (reference, not to copy verbatim)

The `examples/` folder contains a real project where Kevin wired Spec Kit + agents + backlog by hand
on top of Claude Code. The **agnostic** elements worth keeping:

### 1. Auto-chained Spec Kit pipeline

```
specify → clarify → plan → tasks → analyze → implement → review → merge
           ▲                                                        ▲
           STOP #1                                                  STOP #2
       (if questions)                                       (validation before merge)
```

- **Auto by default**; `--manual` restores legacy one-shot behaviour.
- `--copilot`: "cloud handoff" variant (push + draft PR + hand off to a remote agent).
- Only 2 user interruptions: required clarifications, and pre-merge validation.

### 2. Backlog as product source of truth

- `tasks/backlog.md` index (checklist grouped by priority).
- One file per task `tasks/backlog/NNN-slug.md` with structured frontmatter: `id`, `title`,
  `category`, `priority`, `complexity` (Fibonacci 1/2/3/5/8/13/21), `status`, `depends_on`, `spec`,
  `tags`, `created`.
- Statuses: `todo | in_progress | done | deferred | blocked`.
- **Every mutation = mandatory sync** to the remote backend (GitHub Issues + Project V2 in the
  example; to be generalized to GitLab / Bitbucket / local).
- A **Product Owner agent** has exclusive ownership of mutations — the `/backlog` command always
  delegates to it, even for trivial additions.
- The PO decides **SpecKit spec vs direct implementation** based on complexity (≥ 8 pts / new entity
  / multi-layer → spec; otherwise direct).

### 3. Specialist agent team with interaction contract

Observed agent types: `product-owner`, `developer` (alias `implementer`), `workflow-manager`,
`review-coordinator`, `qa-tester`, `security-auditor`, `devops-sre`, `accessibility-auditor`,
`performance-analyst`, `api-contract-reviewer`, `design-system-enforcer`, `code-reviewer`,
`test-reviewer`, domain experts (typography, payments…).

Every agent declares: `model`, `tools`, `skills`, `memory`, `maxTurns`, `permissionMode`, `color`,
`description`. Agents hand work back and forth using structured **"workflow status blocks"** +
**"handoff blocks"** (no free-form prose).

#### Manual-only vs auto-triggerable

Specflow's bundled agents distinguish two invocation modes via the `disable-model-invocation`
frontmatter flag (Claude Code feature):

- **Auto-triggerable** (flag absent or `false`) — Claude may spawn the agent when the user's request
  matches the agent's `description`. Used for cheap, scoped, additive agents: `code-reviewer`,
  `security-auditor`, `test-reviewer` (sub-agents of `review-coordinator`), plus the orchestrators
  `review-coordinator`, `workflow-manager`, and the backlog gatekeeper `product-owner` (which the
  working contract requires for every backlog mutation anyway).
- **Manual-only** (`disable-model-invocation: true`) — Claude will NOT auto-spawn the agent; it must
  be invoked explicitly. Used for heavy, destructive, or expensive agents: `developer` (writes code,
  can refactor large surfaces), `devops-sre` (touches infra / pipelines), `qa-tester` (runs full
  test suites — costly).

Other harnesses ignore the flag (they don't model auto-invocation the same way), so the agents still
work universally — the flag only restricts auto-spawn under Claude Code.

### 4. Constitution + spec templates

A `.specflow/memory/constitution.md` file codifies project invariants (non-negotiable architecture,
conventions, policies). Spec Kit loads
`.specflow/templates/{spec,plan,tasks,checklist,constitution,agent-file}-template.md` to generate
the artefacts. The agent-file template is repopulated on every feature to give context to AI agents.

### 5. Cross-cutting skills

- Inter-agent contracts: `workflow-contract`, `handoff-protocol`, `review-findings-contract`,
  `qa-report-contract`, `status-audit`.
- Integrations: `github-pr`, `github-issue`, `github-release`, `git-tag`.
- A `speckit` skill acts as a single dispatcher (resolves a spec by number/name, loads the right
  command).

### 6. What is **project-specific** (to extract and make configurable)

- Tech stack hardcoded in `developer` / `implementer` agents.
- Domain skills (`adonisjs-v7`, `react`, `tailwind-v4-expert`, `configcat`, `ccbill`, `segpay`,
  etc.).
- Shell hooks (`protect-files.sh`, `auto-format.sh`…).
- Python/Bash scripts for GitHub sync.
- The single integration target (Claude Code `.claude/`).

## Design principles for Specflow

- **Agnostic of the user project's language** (Python / TS / Go / PHP / Rust…).
- **Agnostic of the LLM** (Claude / OpenAI / Gemini / local).
- **Agnostic of the AI harness** on the user side: Claude Code, Cursor, Codex, Aider, or standalone
  without any harness.
- **Agnostic of the backlog source**: local Markdown, GitHub, GitLab, Bitbucket, etc.
- No "mega-spec": ship via an **incremental roadmap**, each brick has its own spec → plan →
  implementation cycle.

## Repository state

Shipping public releases via the Homebrew tap, the `install.sh` one-liner, and GitHub Releases. For
the current CLI surface, run `specflow --help` or read `src/cli/help.ts`; for the current version
and what changed, see `gh release list -R mkrlabs/specflow` or `CHANGELOG.md`. The cross-platform
build matrix lives in `.github/workflows/release.yml`; each binary ships with a `.sha256` checksum.

## Conventions for AI agents working on this repo

- Use the DDD/hexagonal layering under `src/`: `domain/` (pure), `application/` (use cases + ports),
  `infrastructure/` (adapters), `cli/` (presentation). Tests mirror `src/`.
- Every brick follows the same cycle: brainstorming spec → plan → subagent-driven-development
  execution (managed via the Specflow workflow).
- Templates live in `templates/` and are bundled into the binary at build time via
  `scripts/bundle-templates.ts`. Never hand-edit `src/templates_bundle.ts`.
- Pre-commit hook runs `deno fmt --check + lint + bundle + check` — must be green before every
  commit.
