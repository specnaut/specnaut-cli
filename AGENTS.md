# AGENTS.md — Specnaut

> Context document for every future session (Claude Code, Codex, etc.). Read this first.

## Vision

Specnaut is an **enhanced fork of the `specify` CLI** from
[GitHub Spec Kit](https://github.com/github/spec-kit), distributed as a **native binary** (no Python
prerequisites on the user side).

Specnaut's role is **exactly** that of upstream `specify init`: scaffold, inside an existing
project, the files consumed by the user's AI harness (Claude Code, Cursor, Copilot, Codex, OpenCode,
Antigravity) — SpecKit commands, spec/plan/tasks templates, constitution, utility scripts.
**Specnaut does not talk to any LLM. Specnaut does not orchestrate any agent. It is the user's
harness that consumes the generated files.**

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
   templates, with sync to a remote backend selected per project (see **Locked decisions** below for
   the authoritative source). Upstream has no notion of a product backlog.

## What Specnaut is not

- Not an AI harness
- Not a multi-LLM orchestrator
- Not an agent runtime
- Not an executable specification engine
- Not a Claude Code rewrite

If the question is "can Specnaut run without the user having an AI harness?" → **no**. Specnaut
writes files that Claude Code (or Cursor, etc.) reads to operate. The binary's language is an
installation/distribution concern, not a runtime one.

## Consumer agnosticism — non-negotiable

> **Specnaut is a tool other projects consume. Those projects are none of Specnaut's business.**

The CLI scaffolds files that a user's harness reads. It never learns what the user builds, who they
bill, or how they host it — and it never talks to an LLM, so it never sees their code. That
ignorance is a **property of the product**. This repository has to embody it.

So: **no project that uses Specnaut, was used to design Specnaut, or belongs to whoever is writing
the commit may leave a trace here.** Not its name. Not the vendors it integrates with — payment
processors, feature-flag services, auth providers. Not its infrastructure — hostnames, stack names,
cloud resource identifiers. Not its business material — backlogs, roadmaps, incidents. In code,
tests, fixtures, docs, specs, commit messages, agent or skill definitions, or an `examples/` folder.

Three rules follow:

1. **Never vendor a real project's configuration as reference material.** If a mechanism is worth
   documenting, describe the _mechanism_ and write a synthetic, obviously-fictional example. A copy
   taken "temporarily, to extract the pattern" outlives the extraction.
2. **Attribute to nothing.** Write "modeled on a reference setup", never "modeled on `<project>`".
   The attribution carries no engineering value and names something that does not belong here.
   Public prior art whose mention is the point — upstream Spec Kit, Claude Code — is the exception.
3. **Invent your examples.** Neutral placeholders only (`acme`, `example.com`, `my-app`). A real
   vendor may appear only if Specnaut itself integrates with it — never because a user's project
   does.

**The test, before any commit:** _would this line tell a stranger what an unrelated project is
called, who it pays, or how it is built?_ If yes, it does not belong here.

**A violation is an incident, not a typo.** Removing it at `HEAD` leaves it live in git history,
tags, and PR refs. It requires a history rewrite — and where releases are immutable, every affected
version number is burned permanently. This is not hypothetical: it is what happened here, and what
it cost.

## Frustrations with upstream Spec Kit

- Manual steps at every transition (no auto-chain)
- No structured `review` phase after implementation
- No notion of a **product backlog**: one feature at a time, no broader view
- Sync with a remote tracker (GitHub Issues…) must be done by hand

## Locked decisions

- **Language**: **Deno** (TypeScript, native compile via `deno compile`, zero-deps standard library,
  official `denoland/skills` for dev velocity).
- **Multi-harness by design**:
  - **Claude Code** is the default target (`.claude/` + `.specnaut/`); one harness per invocation,
    selected via `--ai`. The registered set is authoritative in `src/cli/harnesses.ts` — read it
    there rather than trusting a list in prose. `specnaut init --help` prints the current values.
  - CLI surface and behaviour equivalent to upstream `specify init`
  - The **3 differentiating features embedded by default**: auto-chain, `review` phase, backlog +
    Product Owner agent
- **Backlog storage**: selectable per project via `--backlog`, defaulting to local Markdown files
  (index + one file per task). Registered backends live in `src/domain/backlog_strategies/`;
  `specnaut init --help` prints the current values. Bitbucket is not implemented.
- **Adding a harness is additive**: a new adapter under `src/infrastructure/harness/`, registered in
  `src/cli/harnesses.ts`. Nothing in the CLI surface or the template bundle is harness-specific by
  default — divergence is opt-in, per adapter.

## Methodology Specnaut implements

Specnaut's design was distilled from a hand-wired Spec Kit + agents + backlog setup that predated
the tool. Only the **agnostic** mechanisms were kept; everything tied to that setup's stack,
vendors, or domain was deliberately left out. The mechanisms:

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
- A **Product Owner agent** has exclusive ownership of mutations — the `/board` command always
  delegates to it, even for trivial additions.
- The PO decides **SpecKit spec vs direct implementation** based on complexity (≥ 8 pts / new entity
  / multi-layer → spec; otherwise direct).

### 3. Specialist agent team with interaction contract

Observed agent types: `product-owner`, `developer` (alias `implementer`), `workflow-manager`,
`review-coordinator`, `qa-tester`, `security-expert`, `devops-sre`, `a11y-expert`,
`performance-analyst`, `api-contract-reviewer`, `design-system-enforcer`, `code-reviewer`,
`test-reviewer`, domain experts (typography, payments…).

Every agent declares: `model`, `tools`, `skills`, `memory`, `maxTurns`, `permissionMode`, `color`,
`description`. Agents hand work back and forth using structured **"workflow status blocks"** +
**"handoff blocks"** (no free-form prose).

#### Manual-only vs auto-triggerable

Specnaut's bundled agents distinguish two invocation modes via the `disable-model-invocation`
frontmatter flag (Claude Code feature):

- **Auto-triggerable** (flag absent or `false`) — Claude may spawn the agent when the user's request
  matches the agent's `description`. Used for cheap, scoped, additive agents: `code-reviewer`,
  `security-expert`, `test-reviewer` (sub-agents of `review-coordinator`), plus the orchestrators
  `review-coordinator`, `workflow-manager`, and the backlog gatekeeper `product-owner` (which the
  working contract requires for every backlog mutation anyway).
- **Manual-only** (`disable-model-invocation: true`) — Claude will NOT auto-spawn the agent; it must
  be invoked explicitly. Used for heavy, destructive, or expensive agents: `developer` (writes code,
  can refactor large surfaces), `devops-sre` (touches infra / pipelines), `qa-tester` (runs full
  test suites — costly).

Other harnesses ignore the flag (they don't model auto-invocation the same way), so the agents still
work universally — the flag only restricts auto-spawn under Claude Code.

### 4. Constitution + spec templates

A `.specnaut/memory/constitution.md` file codifies project invariants (non-negotiable architecture,
conventions, policies). Spec Kit loads
`.specnaut/templates/{spec,plan,tasks,checklist,constitution,agent-file}-template.md` to generate
the artefacts. The agent-file template is repopulated on every feature to give context to AI agents.

### 5. Cross-cutting skills

- Inter-agent contracts: `workflow-contract`, `handoff-protocol`, `review-findings-contract`,
  `qa-report-contract`, `status-audit`.
- Integrations: `github-pr`, `github-issue`, `github-release`, `git-tag`.
- A `speckit` skill acts as a single dispatcher (resolves a spec by number/name, loads the right
  command).

### 6. What is **project-specific** (to extract and make configurable)

- Tech stack hardcoded in `developer` / `implementer` agents.
- Domain skills bound to one project's framework, vendors, or business domain — these are exactly
  what must NOT ship here (see "Project agnosticism" below).
- Shell hooks (`protect-files.sh`, `auto-format.sh`…).
- Python/Bash scripts for GitHub sync.
- The single integration target (Claude Code `.claude/`).

## Design principles for Specnaut

- **Agnostic of the user project's language** (Python / TS / Go / PHP / Rust…).
- **Agnostic of the LLM** (Claude / OpenAI / Gemini / local).
- **Agnostic of the AI harness** on the user side: Claude Code, Cursor, Codex, Aider, or standalone
  without any harness.
- **Agnostic of the backlog source**: local Markdown, GitHub, GitLab, Bitbucket, etc.
- No "mega-spec": ship via an **incremental roadmap**, each brick has its own spec → plan →
  implementation cycle.

## Repository state

Shipping public releases via the Homebrew tap, the `install.sh` one-liner, and GitHub Releases. For
the current CLI surface, run `specnaut --help` or read `src/cli/help.ts`; for the current version
and what changed, see `gh release list -R specnaut/specnaut-cli` or `CHANGELOG.md`. The
cross-platform build matrix lives in `.github/workflows/release.yml`; each binary ships with a
`.sha256` checksum.

## Conventions for AI agents working on this repo

- Use the DDD/hexagonal layering under `src/`: `domain/` (pure), `application/` (use cases + ports),
  `infrastructure/` (adapters), `cli/` (presentation). Tests mirror `src/`.
- Every brick follows the same cycle: brainstorming spec → plan → subagent-driven-development
  execution (managed via the Specnaut workflow).
- Templates live in `templates/` and are bundled into the binary at build time via
  `scripts/bundle-templates.ts`. Never hand-edit `src/templates_bundle.ts`.
- Pre-commit hook runs `deno fmt --check + lint + bundle + check` — must be green before every
  commit.
