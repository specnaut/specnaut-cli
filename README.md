# Specnaut

An enhanced fork of the [GitHub Spec Kit](https://github.com/github/spec-kit) `specify` CLI,
distributed as a **native binary** (no Python prerequisites).

Specnaut scaffolds the files your AI harness (Claude Code, Cursor, Copilot, Codex, Windsurf…) uses
to drive a spec-driven workflow inside your project. It adds three things upstream doesn't:

- **Auto mode** — chains `specify → clarify → plan → tasks → analyze → implement → review → merge`
  uninterrupted, except for required clarifications and pre-merge validation
- **Structured `review` phase** — architecture checks + quality gates (format/lint/typecheck/tests)
  with an `implement → review → fix → re-review` loop
- **Product backlog** — Markdown index + one file per task with structured frontmatter, a Product
  Owner agent for management, one-way sync to GitHub Issues/Project V2

## What Specnaut is not

Specnaut does not talk to any LLM. Specnaut does not orchestrate any agent. You need a compatible AI
harness (same as upstream).

## Supported AI harnesses

Specnaut scaffolds for one AI harness per invocation:

| Flag                    | Harness            |
| ----------------------- | ------------------ |
| `--ai claude` (default) | Claude Code        |
| `--ai cursor`           | Cursor             |
| `--ai codex`            | Codex CLI          |
| `--ai windsurf`         | Windsurf           |
| `--ai copilot`          | GitHub Copilot CLI |
| `--ai opencode`         | OpenCode           |
| `--ai antigravity`      | Antigravity        |

## Installation

### curl | bash

```bash
curl -fsSL https://raw.githubusercontent.com/specnaut/specnaut-cli/main/install.sh | bash
```

Pin a version: `VERSION=v0.1.0-alpha.1`. Change install directory: `PREFIX=$HOME/.local/bin`.

### Homebrew

```bash
brew tap mkrlabs/tap
brew install specnaut
```

(The tap is updated manually at release time for v0.1.)

### Manual

Download the binary for your OS/arch from
[GitHub Releases](https://github.com/specnaut/specnaut-cli/releases), run `chmod +x` and place it in
your `$PATH`.

On macOS, you may need to clear the quarantine attribute after download:

```bash
xattr -d com.apple.quarantine /path/to/specnaut
```

## Install as a plugin / extension (five harnesses)

If you'd rather skip `specnaut init` and have Specnaut available across **all your projects**,
install it as a plugin / extension in your harness — same skill content across all five targets:

| Harness                | Install command                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code**        | `/plugin install specnaut/specnaut-cli-plugin`                                                                             |
| **Codex CLI / App**    | `/plugins` → search "specnaut" → install¹                                                                                  |
| **Cursor**             | `/add-plugin specnaut/specnaut-cli`                                                                                        |
| **OpenCode**           | Add to `opencode.json`: `"plugin": ["specnaut@git+https://github.com/specnaut/specnaut-cli.git"]`                          |
| **GitHub Copilot CLI** | `copilot plugin marketplace add specnaut/specnaut-marketplace`<br/>`copilot plugin install specnaut@specnaut-marketplace`¹ |

¹ Codex CLI and the shared marketplace listing land once their one-time prereqs are provisioned —
see [the docs](https://specnaut.com/llms.txt) for current status. The sync workflows ship inert
(skip with a warning) until then.

**When to use the plugin vs the binary:**

- Plugin: cross-project, always up-to-date, no `specnaut init` needed, auto-activates skills on
  session start via the `using-specnaut` bootstrap.
- Binary: project-local customization, short slash-commands (`/specify`), backlog + hooks support.

Most teams use both. See [the docs](https://specnaut.com) for the full boundary table and
per-harness tool-mapping references. The website and documentation source live in their own repo,
[`specnaut/specnaut-web`](https://github.com/specnaut/specnaut-web) — this repo is the CLI only.

## Project-specific skill overlays

Need to override an upstream Specnaut skill in one project — e.g. a monorepo `tag-version` that has
to `cd` into an inner repo first? SKILL.md frontmatter accepts two optional fields:

```yaml
---
name: tag-version
alias_of: specnaut.tag-version
overlays:
  - when: before
    path: ./scripts/cd-inner-repo.sh
---
```

Run `/specnaut list-skills` to see which aliases and overlays are active in your project. The
Specnaut binary scaffolds and ships the convention; the harness (Claude Code, Cursor, …) honours it
at dispatch time. See [the docs](https://specnaut.com/llms.txt) for the full contract and
[`templates/core/skills/alias-example/SKILL.md`](templates/core/skills/alias-example/SKILL.md) for a
copy-pasteable starting point.

## Upgrading an existing project

When you update the `specnaut` binary (via `specnaut self-update` or Homebrew), the bundled
templates may have changed. To pull those changes into a project you previously `init`'d:

```bash
specnaut upgrade --dry-run    # preview what would change
specnaut upgrade              # apply safely — files you customized are preserved
specnaut upgrade --force      # overwrite customized files (backed up to .specnaut.bak)
specnaut diff                 # show how your customized files diverge from the bundled originals
```

Specnaut tracks the SHA256 of each template in `.specnaut/installed.lock` so it can detect your
local edits and avoid overwriting them. Commit this lock file alongside your project.

`specnaut upgrade` detects edits automatically, but a `specnaut init --here --force` refresh
overwrites every bundled file unconditionally. To protect a customized file even from a forced
refresh, declare it in a `.specnaut/preserve.yml` manifest — a top-level `preserved:` list of
project-relative paths:

```yaml
preserved:
  - .claude/agents/product-owner.md
  - .claude/agents/developer.md
```

Declared files are then kept by both `specnaut upgrade` and `specnaut init --force`, each with a
per-file `preserved …` notice. Use `specnaut diff` to see how a preserved file has drifted from the
evolving bundle so you can fold in upstream changes by hand, and pass `--reset-preserved` to a
refresh to deliberately discard your customizations and take the bundled version back. Commit
`preserve.yml` alongside the lock file.

When the `specnaut-plugin` Claude Code plugin is installed and the project harness is `claude`,
`specnaut upgrade` auto-migrates vanilla agent and command files to the plugin (backs them up, then
removes them from disk — the plugin serves them going forward). Customized files are preserved with
a warning. If you later uninstall the plugin, `specnaut check --project` will warn about any covered
files that are now missing and tell you how to recover them.

## Development setup

```bash
git clone https://github.com/specnaut/specnaut-cli.git
cd specnaut-cli
deno task setup          # installs the pre-commit hook
deno task test           # sanity check — all green
```

The pre-commit hook runs `deno fmt --check`, `deno lint`, and `deno check` on every commit. To skip
it in an emergency, use `git commit --no-verify` (avoid in normal workflow — CI will fail anyway).
