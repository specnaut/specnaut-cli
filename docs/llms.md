# Specflow

> Specflow is an enhanced fork of the
> [`specify` CLI from GitHub Spec Kit](https://github.com/github/spec-kit), distributed as a single
> native binary (no Python prerequisites). It scaffolds the files your AI coding harness consumes —
> SpecKit slash-commands, spec / plan / tasks templates, a constitution, agents, and a backlog
> system — directly into an existing project, in one command.

Specflow does **not** call any LLM and does **not** orchestrate any agent at runtime. Your AI
harness (Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot CLI, Windsurf, OpenCode,
Antigravity) is what reads the generated files and acts on them.

This page is the canonical documentation. The same content is available as raw Markdown at
[`/llms.txt`](./llms.txt) for LLM consumption — see [llmstxt.org](https://llmstxt.org/) for the
convention.

## Install

The fastest path on macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/mkrlabs/specflow/main/install.sh | bash
```

The installer downloads the platform binary, verifies the SHA256 checksum, and places it in
`/usr/local/bin` (auto-elevating via `sudo` if needed). On non-writable prefixes with no terminal it
falls back to `~/.local/bin`.

Pin a specific version:

```bash
curl -fsSL https://.../install.sh | VERSION=v0.7.1 bash
```

Custom install dir:

```bash
curl -fsSL https://.../install.sh | PREFIX=$HOME/.local/bin bash
```

Or via Homebrew (macOS / Linux):

```bash
brew tap mkrlabs/tap
brew install specflow
```

Manual download: pick the binary for your OS/arch from
[GitHub Releases](https://github.com/mkrlabs/specflow/releases), `chmod +x`, place it on your
`$PATH`. On macOS clear the quarantine attribute with
`xattr -d com.apple.quarantine /path/to/specflow`.

## Quickstart

### Create a new project

```bash
specflow init my-project
cd my-project
```

This scaffolds a tree configured for the **Claude Code** harness by default (`.claude/`,
`.specflow/`, `AGENTS.md`, `tasks/backlog.md`, …). Open the project in your harness and run the
`/specflow.specify` slash-command to start your first feature.

### Add Specflow to an existing project

```bash
cd my-existing-project
specflow init --here
```

Specflow merges its `.gitignore` block into your existing file (non-destructively, fenced with
`# --- Specflow: gitignore ---` markers). Other specflow-managed files use upgrade-aware semantics:
if you customize a generated file, `specflow upgrade` will preserve it unless you pass `--force`.

### Pick a different harness

```bash
specflow init my-project --ai cursor
specflow init my-project --ai antigravity
specflow init my-project --ai gemini
# … etc.
```

Eight harness targets are supported: `claude` (default), `cursor`, `codex`, `gemini`, `windsurf`,
`copilot`, `opencode`, `antigravity`. Each emits files in the convention that harness expects.

### Other commands

```bash
specflow check                    # diagnose your environment
specflow check --project          # also diagnose the current specflow project
specflow upgrade                  # update templates to the binary's version
specflow upgrade --dry-run        # preview the upgrade plan
specflow upgrade --force          # apply destructive changes (backs up customizations)
specflow self-update              # upgrade the binary itself
specflow self-update --check      # only report whether an update is available
specflow backlog configure        # wire the backlog to a remote (GitHub Issues + Project V2)
specflow backlog sync             # push backlog mutations to the remote
specflow --version                # print version
specflow --help                   # full usage
```

## Available harnesses

| Key           | Display name       | Output root             |
| ------------- | ------------------ | ----------------------- |
| `claude`      | Claude Code        | `.claude/`              |
| `cursor`      | Cursor             | `.cursor/`              |
| `codex`       | Codex CLI          | `.codex/`, `.agents/`   |
| `gemini`      | Gemini CLI         | `.gemini/`              |
| `windsurf`    | Windsurf           | `.windsurf/`            |
| `copilot`     | GitHub Copilot CLI | `.github/instructions/` |
| `opencode`    | OpenCode           | `.opencode/`            |
| `antigravity` | Antigravity        | `.agent/`               |

All harnesses share the same source-of-truth content in `templates/core/`. The per-harness adapters
in `src/infrastructure/harness/` map that core bundle to each harness's directory layout and
frontmatter conventions.

## What makes Specflow different from upstream Spec Kit

Specflow is a fork of the official `specify` CLI with three additions:

### 1. Auto-chained pipeline

The generated `specify` skill chains `clarify → plan → tasks → analyze → implement → review → merge`
in a single session. Upstream stops at every step and asks the human to invoke the next one.
Specflow only stops twice: when clarification is genuinely required, and once before merging.

### 2. `review` phase post-implement

After `implement`, the generated workflow runs a dedicated `review` phase that checks structure
(architecture boundaries, silent error swallowing, leaked internal IDs, cache layering, test
coverage) and the quality gates (format, lint, typecheck, tests). If `review` flags something, the
loop is `implement → review → fix → re-review` — also automatic.

### 3. Backlog as product source of truth

The generated project ships with a `tasks/backlog.md` index plus per-task files under
`tasks/backlog/NNN-slug.md` (typed frontmatter: id, title, category, priority, complexity, status,
depends_on, spec, tags, created). A Product Owner agent gates every mutation.
`specflow backlog sync` pushes the backlog to a remote (GitHub Issues + Project V2 in v1; GitLab and
Bitbucket planned for later).

## Design principles

- **Agnostic of the user project's language** — Python, TypeScript, Go, PHP, Rust… your project,
  your stack.
- **Agnostic of the LLM** — Claude, OpenAI, Gemini, local models, anything your harness supports.
- **Agnostic of the AI harness** — eight first-class targets today, with the same core content for
  all.
- **Agnostic of the backlog source** — local Markdown is the source of truth, with one-way sync to
  the remote of your choice.
- **Single binary** — distributed via `deno compile` for macOS arm64/x64, Linux arm64/x64, and
  Windows x64. No Python, no `pip`, no extra runtimes on the user's machine.

## Repository

Source, releases, and issue tracker:
**[github.com/mkrlabs/specflow](https://github.com/mkrlabs/specflow)**.

The `AGENTS.md` file at the repo root is the canonical context document for any future Claude Code,
Codex, or other agent session contributing to the project itself.
