# Specflow

An enhanced fork of the [GitHub Spec Kit](https://github.com/github/spec-kit) `specify` CLI,
distributed as a **native binary** (no Python prerequisites).

Specflow scaffolds the files your AI harness (Claude Code, Cursor, Copilot, Codex, Gemini CLI…) uses
to drive a spec-driven workflow inside your project. It adds three things upstream doesn't:

- **Auto mode** — chains `specify → clarify → plan → tasks → analyze → implement → review → merge`
  uninterrupted, except for required clarifications and pre-merge validation
- **Structured `review` phase** — architecture checks + quality gates (format/lint/typecheck/tests)
  with an `implement → review → fix → re-review` loop
- **Product backlog** — Markdown index + one file per task with structured frontmatter, a Product
  Owner agent for management, one-way sync to GitHub Issues/Project V2

## What Specflow is not

Specflow does not talk to any LLM. Specflow does not orchestrate any agent. You need a compatible AI
harness (same as upstream).

## Supported AI harnesses

Specflow scaffolds for one AI harness per invocation:

- **Claude Code** (default) — `specflow init <name>` or `--ai claude`
- **Cursor** — `specflow init <name> --ai cursor`

Additional harnesses (Codex CLI, GitHub Copilot, Gemini CLI, Windsurf, …) are planned for later
releases. See `AGENTS.md` for the roadmap.

## Installation

### curl | bash

```bash
curl -fsSL https://raw.githubusercontent.com/mkrlabs/specflow/main/install.sh | bash
```

Pin a version: `VERSION=v0.1.0-alpha.1`. Change install directory: `PREFIX=$HOME/.local/bin`.

### Homebrew

```bash
brew tap mkrlabs/tap
brew install specflow
```

(The tap is updated manually at release time for v0.1.)

### Manual

Download the binary for your OS/arch from
[GitHub Releases](https://github.com/mkrlabs/specflow/releases), run `chmod +x` and place it in your
`$PATH`.

On macOS, you may need to clear the quarantine attribute after download:

```bash
xattr -d com.apple.quarantine /path/to/specflow
```

## Upgrading an existing project

When you update the `specflow` binary (via `specflow self-update` or Homebrew), the bundled
templates may have changed. To pull those changes into a project you previously `init`'d:

```bash
specflow upgrade --dry-run    # preview what would change
specflow upgrade              # apply safely — files you customized are preserved
specflow upgrade --force      # overwrite customized files (backed up to .specflow.bak)
```

Specflow tracks the SHA256 of each template in `.specflow/installed.lock` so it can detect your
local edits and avoid overwriting them. Commit this lock file alongside your project.

## Development setup

```bash
git clone https://github.com/mkrlabs/specflow.git
cd specflow
deno task setup          # installs the pre-commit hook
deno task test           # sanity check — all green
```

The pre-commit hook runs `deno fmt --check`, `deno lint`, and `deno check` on every commit. To skip
it in an emergency, use `git commit --no-verify` (avoid in normal workflow — CI will fail anyway).
