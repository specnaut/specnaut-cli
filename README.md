# Specnaut

An enhanced fork of the [GitHub Spec Kit](https://github.com/github/spec-kit) `specify` CLI,
distributed as a **native binary** (no Python prerequisites).

Specnaut scaffolds the files your AI harness (Claude Code, Cursor, Copilot, Codex, Windsurf…) uses
to drive a spec-driven workflow inside your project. It adds three things upstream doesn't:

- **Autopilot** — chains `plan → tasks → implement → review → merge → push` uninterrupted. It stops
  at most once, at the end of `plan`, and only to ask what only you can answer — architecture,
  security and performance choices are settled by the expert agents and reported; then it
  implements, reviews, merges into your base branch, pushes and closes the backlog item without
  asking again. Set `merge: manual` in `.specnaut/workflow.yml` (or pass `--manual-merge` for one
  run) to be asked once, at the review verdict
- **Structured `review` phase** — architecture checks + quality gates (format/lint/typecheck/tests)
  with an `implement → review → fix → re-review` loop
- **Product backlog** — Markdown index + one file per task with structured frontmatter, a Product
  Owner agent for management, one-way sync to GitHub Issues/Project V2

## Three skills, one project

Specnaut gives your harness three skills, and they divide by what they own:

| Skill       | Owns                                                               | Typical invocation                    |
| :---------- | :----------------------------------------------------------------- | :------------------------------------ |
| `/board`    | the backlog — what you might do, and what you are doing            | `/board add "…"`, `/board groom`      |
| `/specnaut` | the specification — what a thing is, and whether it is built right | `/specnaut plan "…"`                  |
| `/ship`     | production — getting a built thing out the door                    | `/ship`, `/ship tag`, `/ship release` |

Shipping is deliberately not a specification concern. It has a different cadence, a different risk
profile — irreversible, outward-facing, it triggers live pipelines — and a different audience from
writing a plan.

On harnesses that namespace their skills the names carry a prefix (`/specnaut-board`,
`/specnaut-ship`); `specnaut init` prints the exact commands for the harness you chose.

> **Upgrading an existing project?** Some releases rename or remove things `specnaut upgrade` cannot
> fix inside files you wrote — your `AGENTS.md`, your own skills, your saved prompts. Check
> [UPGRADING.md](UPGRADING.md) for the version you are moving to.

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
brew tap specnaut/tap
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

| Harness                | Install command                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code**        | `/plugin marketplace add specnaut/specnaut-marketplace`<br/>`/plugin install specnaut-plugin@specnaut-marketplace`               |
| **Codex CLI / App**    | `/plugins` → search "specnaut" → install¹                                                                                        |
| **Cursor**             | `/add-plugin specnaut/specnaut-cli`                                                                                              |
| **OpenCode**           | Add to `opencode.json`: `"plugin": ["specnaut@git+https://github.com/specnaut/specnaut-cli.git"]`                                |
| **GitHub Copilot CLI** | `copilot plugin marketplace add specnaut/specnaut-marketplace`<br/>`copilot plugin install specnaut-plugin@specnaut-marketplace` |

¹ Codex CLI lands once its one-time prereqs are provisioned — see
[the docs](https://specnaut.com/llms.txt) for current status.

**When to use the plugin vs the binary:**

- Plugin: cross-project, always up-to-date, no `specnaut init` needed, auto-activates skills on
  session start via the `using-specnaut` bootstrap.
- Binary: project-local customization, short slash-commands (`/specnaut plan`, `/ship`), backlog +
  hooks support.

Most teams use both. See [the docs](https://specnaut.com) for the full boundary table and
per-harness tool-mapping references. The website and documentation source live in their own repo,
[`specnaut/specnaut-web`](https://github.com/specnaut/specnaut-web) — this repo is the CLI only.

## Claude Code cockpit

If you work in Claude Code, the **Specnaut Cockpit** mod puts your usage limits in front of you: the
5-hour and weekly windows with their reset times, the context fill, the session's cost, and the
chain's progress while the autopilot runs. It sits in a band above the prompt. `/cockpit` opens a
pane with seven days of history, per day and per branch, kept on your machine.

It also stops the autopilot **cleanly**: when a window reaches 90%, the chain halts before
`implement`, `review` or `merge` instead of being cut off halfway, and resumes with
`/specnaut <phase>` after the reset. Projects scaffolded for Claude Code offer to install it; to
install it by hand:

```text
/plugin marketplace add specnaut/specnaut-marketplace
/plugin install specnaut-cockpit@specnaut-marketplace
```

Details, settings and privacy: [`mods/specnaut-cockpit/README.md`](mods/specnaut-cockpit/README.md).

## Project-specific skill overlays

Need to override an upstream Specnaut skill in one project — e.g. a monorepo `/ship tag` that has to
`cd` into an inner repo first? SKILL.md frontmatter accepts two optional fields:

```yaml
---
name: ship-tag
alias_of: ship.tag
overlays:
  - when: before
    path: ./scripts/cd-inner-repo.sh
---
```

The alias and overlay fields are declared in a skill's own frontmatter, where anyone reading it sees
them. The Specnaut binary scaffolds and ships the convention; the harness (Claude Code, Cursor, …)
honours it at dispatch time. See [the docs](https://specnaut.com/llms.txt) for the full contract and
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
specnaut diff <path>          # scope that to one managed file
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

The same manifest is how you **decline** a bundled file. Delete the file and declare its path:
`upgrade` treats a declared path as preserved before it considers the file missing, so it is not
re-added. Without the declaration, a deleted bundled file simply comes back on the next upgrade —
deleting is not a decision the project can record any other way. `--reset-preserved` is what lifts
it.

The key is `preserved:`. A manifest with any other top-level shape — `preserve:`, a bare list,
invalid YAML — declares nothing; `upgrade` warns and continues, so check the warning rather than
assuming your files are held.

Declared files are then kept by both `specnaut upgrade` and `specnaut init --force`, each with a
per-file `preserved …` notice. Use `specnaut diff <path>` to see how one preserved file has drifted
from the evolving bundle so you can fold in upstream changes by hand — that per-file check is the
maintenance duty a preserve declaration creates, and `specnaut diff` with no path answers it for
every managed file at once, and pass `--reset-preserved` to a refresh to deliberately discard your
customizations and take the bundled version back. Commit `preserve.yml` alongside the lock file.

When the `specnaut-plugin` Claude Code plugin is installed and the project harness is `claude`,
`specnaut upgrade` auto-migrates vanilla agent and command files to the plugin (backs them up, then
removes them from disk — the plugin serves them going forward). Customized files are preserved with
a warning. If you later uninstall the plugin, `specnaut check --project` will warn about any covered
files that are now missing and tell you how to recover them.

### Adding to a bundled phase without preserving it

Most customisations of a `/specnaut` or `/ship` phase are one project-specific rule — "run the
migration check before tagging". Preserving the whole phase doc for that freezes it: it stops
receiving upstream changes, and every one has to be merged in by hand from then on. Write the rule
in a phase addendum instead — a file your project owns at `.specnaut/addenda/<skill>/<phase>.md`:

```markdown
<!-- .specnaut/addenda/ship/release.md -->

Before computing the tag, run `./scripts/check-pending-migrations.sh`. If it reports a pending
migration, stop and name it.
```

`<skill>` is `specnaut` or `ship`; `<phase>` is the phase's name as its router lists it (`plan`,
`review`, `audit-security`, `tag`, `release`). The path is the same under every harness. The routers
read the addendum right after the phase doc, and a managed block in `AGENTS.md` carries the same
instruction to the surfaces that reach a phase without a router. An addendum adds to the phase at
the step it names; it cannot replace or skip a bundled step — where it contradicts one, the bundled
step stands and the assistant says so. No file is no addendum: nothing is printed, nothing is
scaffolded. Contract docs a phase loads (`plan-audits`, `merge-close`, …) take no addendum of their
own; write it in the parent phase's addendum and name the step. Specnaut never writes, tracks or
upgrades anything under `.specnaut/addenda/`, so `upgrade` keeps refreshing the phase doc beside it.
Commit the directory. `specnaut check --project` warns about any file there that no router reads — a
mistyped or renamed phase, a contract doc, a wrong directory — and names the path it belongs at.

Use an addendum when you are adding a step, a check, or a project fact to a phase. A full preserve
is still warranted when you need a bundled step itself to be different — removed, reordered or
rewritten — because that is exactly what an addendum cannot do. Declare the file in
`.specnaut/preserve.yml` and take on the `specnaut diff` duty described above.

## Development setup

```bash
git clone https://github.com/specnaut/specnaut-cli.git
cd specnaut-cli
deno task setup          # installs the pre-commit hook
deno task test           # sanity check — all green
```

The pre-commit hook runs `deno fmt --check`, `deno lint`, and `deno check` on every commit. To skip
it in an emergency, use `git commit --no-verify` (avoid in normal workflow — CI will fail anyway).
