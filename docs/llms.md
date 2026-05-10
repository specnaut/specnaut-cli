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

### Install the Claude Code plugin

If you use Claude Code and want Specflow's slash-commands and sub-agents available across **all your
projects** without running `specflow init`, install the Claude Code plugin:

```
/plugin install mkrlabs/specflow-plugin
```

The plugin ships the same 23 assets the binary scaffolds — the consolidated `specflow` router skill
(with 11 phase docs), the `specflow-review` auto-invoke alias, the `specflow-auto` skill, and 9
sub-agents — but at user scope, versioned, and auto-updated via `/plugin update`. Because the
plugin's slash-commands are namespaced and the consolidated router itself is named `specflow`,
you'll see a double-prefix at the call site:

```
/specflow-plugin:specflow specify "<feature description>"
/specflow-plugin:specflow plan
/specflow-plugin:specflow-auto specify "<feature description>"
```

Slightly verbose, but unambiguous. If you scaffold project-local with `specflow init`, you get the
shorter `/specflow specify "..."` form.

To test a local checkout of the plugin without publishing:

```bash
claude --plugin-dir /path/to/specflow/plugin
```

**Plugin vs `specflow init`** — they complement each other:

| Aspect                             | Binary (`specflow init`)    | Plugin (`/plugin install`)          |
| ---------------------------------- | --------------------------- | ----------------------------------- |
| Scope                              | Project-local (`.claude/`)  | User-scope (all projects)           |
| Slash-command style                | `/specflow specify` (short) | `/specflow-plugin:specflow specify` |
| Customizable per-project           | Yes                         | No (user-scope, shared)             |
| Backlog skill, hooks, `.specflow/` | Yes                         | No (project-stateful — binary-only) |
| Kept in sync                       | `specflow upgrade`          | `/plugin update`                    |

Most teams use both: the plugin provides discoverability and keeps the agents up-to-date across all
projects; `specflow init` provides the short slash-commands and project-local customization.

## Quickstart

### Create a new project

```bash
specflow init my-project
cd my-project
```

This scaffolds a tree configured for the **Claude Code** harness by default (`.claude/`,
`.specflow/`, `AGENTS.md`, `.specflow/backlog.md`, …). Open the project in your harness — that's
where you'll run the rest.

### Step 1 after `init`: run `/specflow constitution`

`/specflow constitution` is the expected first action after `specflow init`. It scaffolds your
project's guiding principles (architecture, quality gates, ways of working) into
`.specflow/memory/constitution.md` so the rest of the pipeline (`/specflow specify`,
`/specflow plan`, `/specflow tasks`, `/specflow implement`) has something to anchor on. Refine the
generated constitution and the root `AGENTS.md` for your stack, then move on to
`/specflow specify "<feature description>"` for your first feature.

### Add Specflow to an existing project

```bash
cd my-existing-project
specflow init --here
```

Specflow merges its `.gitignore` block into your existing file (non-destructively, fenced with
`# --- Specflow: gitignore ---` markers). Other specflow-managed files use upgrade-aware semantics:
if you customize a generated file, `specflow upgrade` will preserve it unless you pass `--force`.

### What's in `.specflow/installed.lock` and should I commit it?

`specflow init` writes a small YAML file at `.specflow/installed.lock`. It records the harness you
chose, the templates version installed, and a SHA-256 + install timestamp for every file Specflow
emitted. It contains no secrets — only file paths, content hashes, and version strings.

**Commit it.** `specflow upgrade` reads this lock to know which harness to map templates to, to
detect files you have customized (so it doesn't clobber them), and to drop orphaned files that are
no longer part of the bundle. `specflow check --project` also surfaces the harness, templates
version, and backlog backend from this file (and warns when `backlog-config.yml` has empty required
fields for the github / gitlab backends). Without the lock, both commands degrade gracefully but
cannot do their real job — `specflow upgrade` will refuse and ask you to re-run
`specflow init --here --force` to rebuild the lock from scratch.

### Pick a different harness

```bash
specflow init my-project --ai cursor
specflow init my-project --ai antigravity
specflow init my-project --ai gemini
# … etc.
```

Eight harness targets are supported: `claude` (default), `cursor`, `codex`, `gemini`, `windsurf`,
`copilot`, `opencode`, `antigravity`. Each emits files in the convention that harness expects.

### Pick a backlog backend

```bash
specflow init my-project --backlog github
specflow init my-project --backlog gitlab
specflow init my-project --backlog local      # default
```

Three backends are supported: `local` (default), `github`, `gitlab`. See
[Backlog as product source of truth](#3-backlog-as-product-source-of-truth) for what each one stores
and how the PO agent talks to it.

#### Pre-fill the backlog config with `--backlog-url`

When the chosen backend is `github` or `gitlab`, `specflow init` can take the project's Kanban URL
up front and write a fully-populated `.specflow/backlog-config.yml` — no manual edit needed before
running `/backlog`. Pass the project URL via `--backlog-url`:

```bash
# GitHub org-owned project
specflow init --here --ai claude --backlog github \
  --backlog-url https://github.com/orgs/myorg/projects/1

# GitHub user-owned project
specflow init --here --ai claude --backlog github \
  --backlog-url https://github.com/users/alice/projects/12

# GitLab (gitlab.com or self-hosted)
specflow init --here --ai claude --backlog gitlab \
  --backlog-url https://gitlab.com/mygroup/myproject
```

Three URL formats are supported:

- GitHub org-owned: `https://github.com/orgs/<org>/projects/<N>`
- GitHub user-owned: `https://github.com/users/<user>/projects/<N>`
- GitLab project: `https://<host>/<group>/<project>`

For GitHub, the `repo:` field of the populated config is derived from `git remote get-url origin`
(both HTTPS and SSH remote shapes are recognised). Pass `--backlog-repo <owner>/<name>` to override
that derivation when the project lives across multiple repos or the local remote isn't `origin`.

Without `--backlog-url` on a TTY, `specflow init` interactively prompts for the URL after the
backend picker. **In non-TTY mode (CI / scripted setup) `--backlog-url` is required when `--backlog`
is `github` or `gitlab`** — omitting it exits with code `2` and a clear error message. The
non-clobber invariant still holds: re-running `init` against a project with an existing
`backlog-config.yml` does NOT overwrite it.

### Run `init` non-interactively (CI / scripts)

When you pass both `--ai` and `--backlog` (and `--backlog-url` when the backend is remote), no
interactive prompt is shown — `specflow init` runs fully unattended, which is what you want in CI or
scripted setup:

```bash
# Local backend — zero-config, just the two flags
specflow init my-project --ai claude --backlog local

# GitHub backend — --backlog-url is required in non-TTY mode
specflow init my-project --ai claude --backlog github \
  --backlog-url https://github.com/orgs/myorg/projects/1

# GitLab backend — same shape
specflow init --here --no-git --ai cursor --backlog gitlab \
  --backlog-url https://gitlab.com/mygroup/myproject
```

Without those flags, `specflow init` shows an arrow-key picker (↑/↓ to move, space/enter to select)
when stdin is a TTY, and falls back to a numeric prompt — or the defaults — when stdin is piped.

### Other commands

```bash
specflow check                    # diagnose your environment
specflow check --project          # also diagnose the current specflow project
                                  #   (warns if the plugin was uninstalled after migration)
specflow upgrade                  # update templates to the binary's version
                                  #   (when specflow-plugin is installed + harness=claude:
                                  #    vanilla agent/command files are auto-migrated to the plugin)
specflow upgrade --dry-run        # preview the upgrade plan
specflow upgrade --force          # apply destructive changes (backs up customizations)
specflow self-update              # upgrade the binary itself
specflow self-update --check      # only report whether an update is available
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

Specflow is a fork of the official `specify` CLI with four additions:

### 1. Auto-chained pipeline

The generated `specify` skill chains `clarify → plan → tasks → analyze → implement → review → merge`
in a single session. Upstream stops at every step and asks the human to invoke the next one.
Specflow only stops twice: when clarification is genuinely required, and once before merging.

The chain is invoked through the bundled `/specflow-auto` skill:

```
/specflow-auto specify "<feature description>"
```

Two checkpoints inside the chain:

- **STOP #1 — clarify** runs after `clarify`. If `spec.md` still has `[NEEDS CLARIFICATION]`
  markers, the model surfaces the top 3 questions and waits. Once you answer, the chain resumes
  automatically. If there are no markers, the chain continues silently.
- **STOP #2 — pre-merge** runs after `review`. The model summarises the work (files changed, tests,
  open risks, business outcome) and asks `Ready to merge?` before invoking `merge`. Reply `yes` to
  finish.

To opt out of the chain entirely (run only `specify` and stop):

```
/specflow-auto specify --manual "<feature description>"
```

#### Mid-chain re-entry

Any phase other than `specify` can also enter the chain when invoked through `/specflow-auto` —
useful for two real workflows:

- **Manual review between early phases** — read `spec.md` after `specify` lands, then
  `/specflow-auto clarify N` resumes the chain through `plan → tasks → … → STOP #2`.
- **Context-budget recovery** — open a fresh session after compaction and run
  `/specflow-auto implement N` to pick up the tail (`→ review → STOP #2`).

The default is **context-aware**: if downstream artefacts under `.specflow/specs/<feature>/` are
missing, the chain fires; if they exist, the invocation is treated as a single-phase re-run (so
regenerating `plan.md` doesn't accidentally cascade through the rest). Two explicit overrides when
the default guesses wrong:

- `/specflow-auto <phase> N --continue` — force the chain regardless of artefact state.
- `/specflow-auto <phase> N --once` — force one-shot regardless.

### 2. `review` phase post-implement

After `implement`, the generated workflow runs a dedicated `review` phase that checks structure
(architecture boundaries, silent error swallowing, leaked internal IDs, cache layering, test
coverage) and the quality gates (format, lint, typecheck, tests). If `review` flags something, the
loop is `implement → review → fix → re-review` — also automatic.

### 3. Backlog as product source of truth

A Product Owner agent gates every mutation, and supports three backends:

- **Local Markdown** (`--backlog local`, default) — index at `.specflow/backlog.md`, task files at
  `.specflow/backlog/NNN-slug.md` (typed frontmatter: id, title, category, priority, complexity,
  status, parent, depends_on, spec, tags, created). Sub-tasks reference their parent via
  `parent: "#NNN"`.
- **GitHub Issues + Projects** (`--backlog github`) — the agent talks directly to the backend via
  `gh` CLI; epics use the native sub-issues API. No local mirror, no sync command — the remote is
  the source of truth.
- **GitLab Issues** (`--backlog gitlab`) — the agent talks to GitLab via `glab` CLI. Status is
  tracked via scoped `Status::*` labels rather than a native column field; otherwise the model
  mirrors the GitHub backend (no local mirror, no sync command).

The user picks one backend per project. The chosen backend is recorded in `.specflow/installed.lock`
so the PO knows which one to use without auto-detection.

**Semantic label bootstrap.** For GitHub and GitLab backends, `specflow init` scaffolds
`.specflow/scripts/backlog/ensure-labels.sh`. Run it once to seed seven canonical labels —
`security`, `refactor`, `docs`, `tech-debt`, `dx`, `performance`, `dependency` — into the remote
repo. Idempotent; never edits or deletes existing labels. The GitHub default `bug` label is verified
but never re-created. The full reference lives in `.specflow/LABELS.md` next to the install —
including a guidance note for local backend users on tagging via task-file frontmatter.

### 4. Claude Code plugin distribution

Specflow ships a first-class Claude Code plugin (`specflow-plugin`) available via the Claude Code
marketplace:

```
/plugin install mkrlabs/specflow-plugin
```

The plugin gives any Claude Code user instant access to the full Specflow slash-command suite and
sub-agents — no binary, no `specflow init` required. The 24 plugin assets (the consolidated
`specflow` router skill with 11 phase docs, the `specflow-review` auto-invoke alias, the
`specflow-auto` skill, and 10 sub-agents) are namespaced under `/specflow-plugin:*` so they coexist
with project-local copies without collision.

When both the plugin and the binary are in use, `specflow upgrade` detects the plugin and
auto-migrates vanilla on-disk agents and command files (backed up, then deleted — the plugin serves
them going forward). `specflow check --project` warns when covered files are missing and the plugin
is not installed, with a recovery hint.

### 5. Bundled `specflow-expert` agent

Every scaffold ships a `specflow-expert` agent that knows Specflow itself — its commands, harnesses,
backlog backends, and what changed between releases. It auto-triggers on Specflow-related questions
("how does specflow X", "what is /specflow Y", "quoi de neuf") so users on a Specflow-scaffolded
project can ask the harness about the tool without copy-pasting docs. It uses a vendored knowledge
snapshot for offline / deterministic answers and `WebFetch` against
<https://specflow.makerlabs.dev/llms.txt> + the GitHub Releases API for live "what's new" queries.
Manual dispatch via `/specflow-expert <question>` is also supported.

The agent also handles **bug reports**: ask "report this as a bug" (or hit a Specflow failure) and
it pre-fills a structured GitHub issue against `mkrlabs/specflow` with a 6-section template (Summary
/ Repro / Observed / Expected / Environment / Logs), auto-populating the environment block from
`.specflow/installed.lock` + `specflow --version` + `uname -srm`, scrubbing common token shapes
(GitHub PATs, GitLab PATs, Anthropic / OpenAI keys, AWS access keys), and handing you a pre-filled
`https://github.com/mkrlabs/specflow/issues/new?…` URL to review and submit. The agent never
auto-submits — you always see the body before clicking.

## Design principles

- **Agnostic of the user project's language** — Python, TypeScript, Go, PHP, Rust… your project,
  your stack.
- **Agnostic of the LLM** — Claude, OpenAI, Gemini, local models, anything your harness supports.
- **Agnostic of the AI harness** — eight first-class targets today, with the same core content for
  all.
- **Agnostic of the backlog source** — pick local Markdown or your remote tracker (GitHub Issues +
  Projects, GitLab Issues; Bitbucket planned). The PO agent talks to whichever you chose.
- **Single binary** — distributed via `deno compile` for macOS arm64/x64, Linux arm64/x64, and
  Windows x64. No Python, no `pip`, no extra runtimes on the user's machine.

## Repository

Source, releases, and issue tracker:
**[github.com/mkrlabs/specflow](https://github.com/mkrlabs/specflow)**.

The `AGENTS.md` file at the repo root is the canonical context document for any future Claude Code,
Codex, or other agent session contributing to the project itself.
