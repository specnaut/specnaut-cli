# Specflow

> Specflow is an enhanced fork of the
> [`specify` CLI from GitHub Spec Kit](https://github.com/github/spec-kit), distributed as a single
> native binary (no Python prerequisites). It scaffolds the files your AI coding harness consumes —
> SpecKit slash-commands, spec / plan / tasks templates, a constitution, agents, and a backlog
> system — directly into an existing project, in one command.

Specflow does **not** call any LLM and does **not** orchestrate any agent at runtime. Your AI
harness (Claude Code, Cursor, Codex, GitHub Copilot CLI, Windsurf, OpenCode, Antigravity) is what
reads the generated files and acts on them.

This page is the canonical documentation. The same content is available as raw Markdown at
[`/llms.txt`](/llms.txt) for LLM consumption — see [llmstxt.org](https://llmstxt.org/) for the
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

### Install as a plugin / extension (five harnesses)

If you want Specflow's skills and sub-agents available across **all your projects** without running
`specflow init`, install Specflow as a plugin / extension in your harness. Specflow ships adapters
for five harnesses with the same skill content across all of them — the bundled router skill, the
phase docs, the bootstrap skill, the sub-agents, and the SessionStart hook (where supported).

| Harness                | Install command                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Claude Code**        | `/plugin install mkrlabs/specflow-plugin`                                                                                |
| **Codex CLI / App**    | `/plugins` → search "specflow" → install (once the marketplace listing lands; see Notes)                                 |
| **Cursor**             | `/add-plugin mkrlabs/specflow`                                                                                           |
| **OpenCode**           | Add `"plugin": ["specflow@git+https://github.com/mkrlabs/specflow.git"]` to `opencode.json`                              |
| **GitHub Copilot CLI** | `copilot plugin marketplace add mkrlabs/specflow-marketplace`<br/>`copilot plugin install specflow@specflow-marketplace` |

The skill content is identical across harnesses; only the surface conventions differ (slash-command
prefix, auto-activation mechanism, tool naming). See the per-harness tool-mapping references at
`plugin/skills/using-specflow/references/<harness>-tools.md` for the equivalent of every Claude Code
tool on each harness.

#### Claude Code — slash-command prefix

```
/specflow-plugin:specflow specify "<feature description>"
/specflow-plugin:specflow plan
```

Slightly verbose, but unambiguous (the plugin's slash-commands are namespaced and the consolidated
router itself is named `specflow`). If you scaffold project-local with `specflow init` instead, you
get the shorter `/specflow specify "..."` form.

To test a local checkout of the plugin without publishing:

```bash
claude --plugin-dir /path/to/specflow/plugin
```

#### Auto-activation across harnesses

Specflow ships a `using-specflow` bootstrap skill loaded automatically at session start on every
harness that supports it (via plugin/hooks/hooks.json on Claude Code, plugin/hooks/hooks-cursor.json
on Cursor, the `experimental.chat.messages.transform` hook in `.opencode/plugins/specflow.js` on
OpenCode). The bootstrap skill teaches the agent Specflow's skill registry, agent registry, and
routing principles so you don't need to invoke `/specflow` explicitly — typing "plan this issue" or
"review my work" is enough for the right skill to fire.

#### Notes on Codex CLI and the shared marketplace

Codex CLI and Copilot CLI distribute plugins through marketplaces. Specflow has two adapter targets
that need a one-time human setup before the marketplace listings are live:

- **Codex CLI** — `.codex-plugin/plugin.json` ships in this repo; the
  `scripts/sync-to-codex-plugin.sh` script (fires on every release tag) mirrors the Specflow plugin
  content into `mkrlabs/plugins` (a fork of `openai/plugins`). Until that fork is rebased into
  upstream and the `CODEX_SYNC_TOKEN` PAT is provisioned (see issues #298–#300), the sync emits a
  workflow warning and skips — same fail-safe pattern as the Homebrew tap bump.
- **Copilot CLI + shared marketplace** — `.claude-plugin/marketplace.json` lives in
  `mkrlabs/specflow-marketplace` (a separate repo). `scripts/sync-to-marketplace.sh` bumps the
  version on every release. Until the marketplace repo + `MARKETPLACE_SYNC_TOKEN` are provisioned
  (see issues #309–#310), the sync skips with a warning.

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
`/specflow plan`, `/specflow tasks`, `/specflow implement`) has something to anchor on.

The generated constitution comes pre-populated with four opinionated baseline blocks (all
user-tunable): **Engineering methodology** (TDD / DDD / SOLID-DRY-KISS-YAGNI /
Boy-Scout-escalation), **Architecture layers** (hexagonal default: `domain/` / `application/` /
`infrastructure/` / `presentation/`), **Back-end patterns** (Repository, service objects, DI through
constructors, thin controllers, errors as domain types, pure domain), and **Front-end patterns**
(view/logic separation, no business rules in templates, smart vs dumb components, single source of
truth for state, typed API client, accessibility mandatory). New projects via `specflow init`
inherit all four blocks automatically. `specflow upgrade` delivers updated agents and skills but
does **not** rewrite an existing constitution — to adopt the new baselines in an existing project,
rebase your constitution manually.

Refine the generated constitution and the root `AGENTS.md` for your stack, then move on to
`/specflow specify "<feature description>"` for your first feature.

### Add Specflow to an existing project

```bash
cd my-existing-project
specflow init --here
```

Specflow merges its `.gitignore` block into your existing file (non-destructively, fenced with
`# --- Specflow: gitignore ---` markers). Other specflow-managed files use upgrade-aware semantics:
if you customize a generated file, `specflow upgrade` will preserve it unless you pass `--force`.

**Declaring a file preserved across a forced refresh.** `specflow upgrade` auto-preserves a file
whose hash diverged, but `specflow init --force` would otherwise overwrite every managed file. To
keep a customized file (e.g. a tailored `.claude/agents/product-owner.md`) even through a forced
refresh, list it in a version-controllable `.specflow/preserve.yml` manifest:

```yaml
preserved:
  - .claude/agents/product-owner.md
```

Both `init --force` and `upgrade` then leave that file untouched and print one notice per preserved
path — never a silent skip. The file stays lock-tracked, so `specflow diff` keeps showing how it has
drifted from the evolving bundle. A project with no `preserve.yml` behaves exactly as before. To
deliberately discard a customization and restore the bundled version for one run, add
`--reset-preserved` (it overrides every declaration for that run and reports each override; it is
never the default). A declared path that is not a managed bundle file is reported as an ineffective
declaration (a warning) rather than silently honored.

Pass `--dry-run` to preview the plan without touching disk — combined with `--force` it shows which
files would be overwritten and which would be merged, but writes nothing. `--dry-run` is the trump
card: it wins over `--force`.

**Inside a monorepo workspace?** When the target sits inside an enclosing Specflow workspace (an
ancestor with `.specflow/` whose `deno.json` `workspace` list declares the target as a member),
`specflow init` and `specflow upgrade` provision `.specflow/` as usual but skip the agentic files
(`.claude/skills`, `.claude/agents`, `.claude/commands`) — those are inherited from the parent, so
no copy is scattered into the sub-repo. To force full provisioning anyway, drop an empty
`.specflow/standalone.yml` marker in the target.

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
specflow init my-project --ai codex
# … etc.
```

Seven harness targets are supported: `claude` (default), `cursor`, `codex`, `windsurf`, `copilot`,
`opencode`, `antigravity`. Each emits files in the convention that harness expects.

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

### Pick a versioning scheme

`specflow init` asks which scheme to use for the bundled `/specflow tag-version` and
`/specflow release-version` commands. Two options:

- **SemVer** (`v1.2.3`) — recommended for libraries / SDKs whose consumers reason about breaking
  changes by version number.
- **Date-based** (`vYY.M.Da`) — recommended for apps / SaaS / deployed products where the version
  number is just a release identifier. No major/minor/patch guesswork; the letter suffix handles
  same-day re-tags.

Specflow pre-selects a sensible default by scanning the project for SemVer signals:

- **Library publishing markers** — `package.json` `exports`, `pyproject.toml` `[project]` /
  `[tool.poetry]`, `Cargo.toml` `[lib]`, `composer.json` `type=library`.
- **Semver-shaped git tags** — any local tag matching `v?MAJOR.MINOR.PATCH` (with optional
  pre-release / build suffix), e.g. `v1.2.3`, `1.0.0-rc.1`, `v2.0.0+build.5`. Date-shaped tags like
  `v25.5.16a` are explicitly excluded so brownfield repos already on date scheme don't get
  mis-suggested.
- **CHANGELOG.md** — Keep-a-Changelog style headers (`## [1.2.0]`, `## v1.2.0`, `## 1.2.0`).

Any one signal flips the suggestion to SemVer. When zero signals are found, Specflow suggests
date-based. The user can always override at the picker. The choice is persisted by **rewriting the
scaffolded skill** itself (the unchosen scheme's blocks are stripped at scaffold time), so the
on-disk `.specflow/scripts/release/tag.sh` only contains the chosen scheme's logic. To switch
schemes later, re-run `specflow init` and pick the other option.

Pass `--scheme semver|date` to bypass the picker in non-TTY mode.

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
specflow upgrade --reset-preserved  # ignore .specflow/preserve.yml for this run (reports each override)
specflow diff                     # show how managed files diverge from the bundle (read-only)
specflow diff --only-customised   # restrict the diff to files you actually changed
specflow init --here --force --reset-preserved  # forced refresh that overrides preserve declarations
specflow reconcile --status       # list files pending post-upgrade reconciliation (JSON)
specflow reconcile <path> --accept-upstream  # take new template version (backs up local)
specflow reconcile <path> --accept-current   # keep local version (re-stamps lock SHA)
specflow self-update              # upgrade the binary itself
specflow self-update --check      # only report whether an update is available
specflow --version                # print version
specflow --help                   # full usage
```

### Bundled tag + release commands

Every scaffolded project ships two router commands under `/specflow`:

- **`/specflow tag-version`** — creates an annotated git tag using the project's versioning scheme.
  Bumps automatically (latest tag → next). For SemVer, `--bump major|minor|patch` controls the
  direction (default `patch`); for date-based, the letter suffix increments. Pushes to `origin` if a
  remote is configured, else stays local. Pass `--no-push` to skip.
- **`/specflow release-version`** — generates **categorized release notes** for a tag (default:
  latest) covering every commit since the previous tag. The output is the release-body Markdown, one
  section per non-empty Conventional Commits bucket (Features / Bug Fixes / Performance / Refactors
  / Documentation / Tests / Build & CI / Chores / Style / Other). Pipe the output into
  `gh release create` / `glab release create` to publish.

The scripts live at `.specflow/scripts/release/{tag,release}.sh` — the same path across all 8
harnesses.

For **GitHub**-hosted projects, the bundled `release-github.sh` wrapper is the one-command path:

```bash
bash .specflow/scripts/release/release-github.sh           # latest tag, auto-baseline, publish
bash .specflow/scripts/release/release-github.sh --draft   # create as draft
```

For **GitLab**-hosted projects, `release-gitlab.sh` mirrors the same contract:

```bash
bash .specflow/scripts/release/release-gitlab.sh           # latest tag
bash .specflow/scripts/release/release-gitlab.sh v1.2.3    # specific tag
```

Both wrappers compute the baseline as **the previous tag with a published release attached** (not
the previous tag by date) — tags pushed without a release are "subsumed" and their commits land in
this release, with the subsumed tag names listed inline. They push the tag to `origin` if needed,
then call `gh release create` / `glab release create`. Idempotent: a second run against an
already-released tag exits 0 with an explanatory message.

For **local-only** projects (no remote, or you just want a Markdown artifact), the bundled
`release-local.sh` wrapper writes the categorized body to a file:

```bash
bash .specflow/scripts/release/release-local.sh             # latest tag → RELEASE_NOTES_<tag>.md
bash .specflow/scripts/release/release-local.sh --out NOTES.md v1.2.3
```

No remote API calls, no auth — paste the output into any release UI, attach to a deploy email, or
pipe to a custom publisher.

## Available harnesses

| Key           | Display name       | Output root             |
| ------------- | ------------------ | ----------------------- |
| `claude`      | Claude Code        | `.claude/`              |
| `cursor`      | Cursor             | `.cursor/`              |
| `codex`       | Codex CLI          | `.codex/`, `.agents/`   |
| `windsurf`    | Windsurf           | `.windsurf/`            |
| `copilot`     | GitHub Copilot CLI | `.github/instructions/` |
| `opencode`    | OpenCode           | `.opencode/`            |
| `antigravity` | Antigravity        | `.agent/`               |

All harnesses share the same source-of-truth content in `templates/core/`. The per-harness adapters
in `src/infrastructure/harness/` map that core bundle to each harness's directory layout and
frontmatter conventions.

Some harnesses also ship harness-specific helper files alongside the core scaffold:

- **Claude** — `.claude/CLAUDE.md` (harness reference, including `/goal`, `/loop`, and
  `claude agents` usage notes) + `.claude/loop.md` (default prompt for `/loop`, Claude's recurring
  periodic-maintenance feature).
- **Codex** — `.codex/AGENTS.md` (harness reference) + `.codex/goal.md` (default prompt for `/goal`,
  Codex's experimental one-shot long-horizon feature; enable via `goals = true` under `[features]`
  in `config.toml`).

## Project-specific skill overlays

Specflow's skill folders are plain markdown — anything you put under your harness's `skills/`
directory (e.g. `.claude/skills/<name>/`, `.cursor/skills/<name>/`) is a skill, full stop. To make
the common "override an upstream skill" pattern discoverable, Specflow recognises two optional
fields in `SKILL.md` frontmatter:

| Field                    | Meaning                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alias_of: <skill-name>` | This skill is a thin wrapper that delegates to the named upstream skill. Dotted notation (e.g. `specflow.tag-version`) makes the distribution explicit. |
| `overlays:`              | A list of pre/post hooks. Each entry carries `when: before \| after` and `path: ./scripts/<file>.sh` relative to the SKILL.md.                          |

The Specflow binary itself **never resolves or dispatches** aliases / overlays — the harness (Claude
Code, Cursor, Codex, …) is responsible for honouring the frontmatter at invocation time. Specflow's
role is to standardise the contract.

To see what's installed and which aliases / overlays are active:

```bash
/specflow list-skills
```

The phase walks your harness's skills directory, parses every SKILL.md frontmatter, and renders a
`NAME · KIND · ALIAS OF · OVERLAYS · DESCRIPTION` table. Skills without `alias_of` show
`KIND = skill`; aliases show `KIND = alias` and the target.

A reference example lives at
[`templates/core/skills/alias-example/SKILL.md`](https://github.com/mkrlabs/specflow/blob/main/templates/core/skills/alias-example/SKILL.md)
in the Specflow source tree. It is **not** installed by `specflow init` — copy it manually when you
want to introduce your first alias.

## What makes Specflow different from upstream Spec Kit

Specflow is a fork of the official `specify` CLI with the following additions:

### 1. Auto-chained pipeline

The generated `specify` skill chains `clarify → plan → tasks → analyze → implement → review → merge`
in a single session. Upstream stops at every step and asks the human to invoke the next one.
Specflow only stops twice: when clarification is genuinely required, and once before merging.

The chain is invoked through the bundled `/specflow` skill:

```
/specflow specify "<feature description>"
```

When the idea is still fuzzy and you can't yet write that one-line description, start one phase
earlier with the optional **step 0**:

```
/specflow brainstorm "<rough idea>"
```

`brainstorm` runs a discovery dialogue (one question at a time, 2–3 approaches, design approval),
then chains into `specify` with the agreed brief — so `brainstorm → specify → clarify → …` flows in
one session. It reuses the bundled `brainstorming` skill for the dialogue; when your brief is
already clear, skip it and start at `specify`.

Two checkpoints inside the chain:

- **STOP #1 — clarify** runs after `clarify`. If `spec.md` still has `[NEEDS CLARIFICATION]`
  markers, the model surfaces the top 3 questions and waits. Once you answer, the chain resumes
  automatically. If there are no markers, the chain continues silently.
- **STOP #2 — pre-merge** runs after `review`. The model summarises the work (files changed, tests,
  open risks, business outcome) and asks `Ready to merge?` before invoking `merge`. Reply `yes` to
  finish.

#### Linking a feature to a backlog issue

Pass `--issue <id>` to `/specflow specify` (or to the bundled `create-new-feature.sh`) to record the
originating backlog issue in `.specflow/feature.json`:

```
/specflow specify "Fix the off-by-one in pagination" --issue 42
```

After `/specflow merge` fast-forwards the branch onto `main` and you push, the merge phase reads
`feature.json.linked_issue`, runs `cascade-check.sh` (github / gitlab) to confirm no sub-issues
block the close, asks `Close issue #42 on the board now? (yes/no)`, and on `yes` flips the project
column to `Done` via `move.sh` then dispatches the `product-owner` agent to post a close comment
with the merged commit range and `gh issue close --reason completed`. The board stays in sync with
`main` instead of drifting.

`--issue` is opt-in; existing feature trees without the field skip the auto-close silently.

To opt out of the chain entirely (run only `specify` and stop):

```
/specflow specify --manual "<feature description>"
```

#### Mid-chain re-entry

Any phase other than `specify` can also enter the chain when invoked mid-flow — useful for two real
workflows:

- **Manual review between early phases** — read `spec.md` after `specify` lands, then
  `/specflow clarify N` resumes the chain through `plan → tasks → … → STOP #2`.
- **Context-budget recovery** — open a fresh session after compaction and run
  `/specflow implement N` to pick up the tail (`→ review → STOP #2`).

The default is **context-aware**: if downstream artefacts under `.specflow/specs/<feature>/` are
missing, the chain fires; if they exist, the invocation is treated as a single-phase re-run (so
regenerating `plan.md` doesn't accidentally cascade through the rest). Two explicit overrides when
the default guesses wrong:

- `/specflow <phase> N --continue` — force the chain regardless of artefact state.
- `/specflow <phase> N --once` — force one-shot regardless.

#### Lite chain (small-feature shortcut)

For small, single-file features (markdown documentation, agent definitions, README / AGENTS / CLAUDE
/ CHANGELOG tweaks), the chain runs in a lighter shape that skips `clarify` and `tasks`:

```
specify → plan → analyze → implement → review → merge
```

Selection happens once, in `phases/specify.md`:

- The router's `--lite` / `--full` flag forces the shape and skips the heuristic.
- Otherwise the brief is scored against `phases/lite-heuristic.md` (file-path hints like `.md` /
  `AGENTS.md`, verb hints like `write` / `document`, subject hints like `doc` / `paragraph`, brief
  length, suppressors like `API` / `migration` / `auth`). On a positive score the user is prompted
  once: `This brief looks small — run the lite chain? [Y/n]`.
- The chosen shape persists to `.specflow/feature.json` as `workflow_shape: "lite" | "full"`.
  Downstream phases consult it at every chain transition. Backward-compat: absent field treated as
  `"full"`.

In lite mode STOP #1 is n/a (no `clarify` phase runs) — `specify` makes informed guesses for
ambiguities and records them in the spec's Assumptions section. STOP #2 (pre-merge) behaves
identically to the full chain.

```
/specflow specify --lite "Document the OSS/proprio boundary in AGENTS.md"
/specflow specify --full "Add OAuth2 login"   # opt out of auto-detected lite
```

The `/specflow-auto` slash command is kept for one release as a deprecation alias and will be
removed in the next major version.

### 2. `review` phase post-implement

After `implement`, the generated workflow runs a dedicated `review` phase that checks structure
(architecture boundaries, silent error swallowing, leaked internal IDs, cache layering, test
coverage) and the quality gates (format, lint, typecheck, tests). If `review` flags something, the
loop is `implement → review → fix → re-review` — also automatic.

### 3. Developer agent doctrine

Every scaffold ships a `developer` agent that implements tasks from `tasks.md`. The agent operates
under a strict doctrine that applies to every task, regardless of project stack:

**Domain Model gate (NON-NEGOTIABLE)** — before writing a single line of code, the developer reads
the `## Domain Model` block in `spec.md` (spec path) or in the Product Owner's `/backlog brief`
output (direct-implementation path). If the block is absent, empty, or still contains template
placeholders, the agent halts and returns `BLOCKED` with reason
`awaiting:product-owner-domain-brief`. The `implement` phase skill enforces the same gate — it reads
the section at step 3 and surfaces the same BLOCKED report with a recommendation to run
`/specflow clarify` first. The `clarify` phase cannot advance while the Domain Model is incomplete,
and `specify` step 5.7 is responsible for populating the full block (Bounded context, Vocabulary,
Entities, Value objects, Invariants, Out of scope) rather than just listing key entities.

**Test-Driven Development (NON-NEGOTIABLE)** — red → green → refactor on every implementation. No
business logic ships untested. If the project has no test infrastructure, the developer bootstraps
the language-idiomatic test runner (Vitest for TS/JS, Pytest for Python, JUnit for Java, `go test`
for Go, `cargo test` for Rust, PHPUnit for PHP, RSpec for Ruby, etc.) as part of the task and
records it explicitly in the `Decisions` block of the completion report.

**Domain-Driven Design (NON-NEGOTIABLE)** — every change respects the project's domain boundaries.
Domain layer stays pure (no I/O, no framework). Application layer holds use cases and ports.
Infrastructure layer holds adapters. Presentation talks only to use cases. Cross-bounded-context
bleed-through is forbidden — split or use an anti-corruption layer.

**Boy Scout Rule with escalation** — small in-scope cleanups (≤ 1 file, ~15 lines of diff, no public
API change) are done in the same PR and noted in `Decisions`. Larger out-of-scope cleanups are
logged in a `Tech debt surfaced` block of the completion report rather than ballooning the PR. The
Product Owner reads that block and opens a classified tech-debt ticket (`tech-debt` label, default
Size XS/S, Priority P3, bumped to P2 on correctness/security risk) for each item.

**SOLID / DRY / KISS / YAGNI** — explicitly required. Framework-specific patterns (Repository, DI,
React hooks, MVC controllers) come from the constitution's Back-end and Front-end pattern blocks.
**No silent catches** — every `catch` either logs at ERROR/WARN or re-throws. **In-code
documentation** — doc-comments on every function, method, or class encoding a business rule or
non-obvious design decision, in the idiomatic format for the language.

### 4. Backlog as product source of truth

A Product Owner agent gates every mutation, and supports three backends:

- **Local Markdown** (`--backlog local`, default) — index at `.specflow/backlog.md`, task files at
  `.specflow/backlog/NNN-slug.md` (typed frontmatter: id, title, category, priority, complexity,
  status, parent, depends_on, spec, tags, created). Sub-tasks reference their parent via
  `parent: "#NNN"`.
- **GitHub Issues + Projects** (`--backlog github`) — the agent talks directly to the backend via
  `gh` CLI; epics use the native sub-issues API. Read paths use
  `gh issue list/view --json
  projectItems` (REST-ish CLI projection of Project V2 fields, ~1–2
  GraphQL points per call), and raw `gh api graphql` is reserved for the one operation with no CLI
  equivalent (`gh project
  item-edit`'s underlying `updateProjectV2ItemFieldValue` mutation). Keeps
  backlog grooming under the shared 5,000-points-per-hour GitHub API quota. No local mirror, no sync
  command — the remote is the source of truth.
- **GitLab Issues** (`--backlog gitlab`) — the agent talks to GitLab via `glab` CLI. Status is
  tracked via scoped `Status::*` labels rather than a native column field; sub-tasks use a
  `parent::#NNN` scoped label (Free-tier compatible — native GitLab Epics are Premium-only).
  Otherwise the model mirrors the GitHub backend (no local mirror, no sync command).

The user picks one backend per project. The chosen backend is recorded in `.specflow/installed.lock`
so the PO knows which one to use without auto-detection.

**Semantic label bootstrap.** For GitHub and GitLab backends, `specflow init` scaffolds
`.specflow/scripts/backlog/ensure-labels.sh`. Run it once to seed seven canonical labels —
`security`, `refactor`, `docs`, `tech-debt`, `dx`, `performance`, `dependency` — into the remote
repo. Idempotent; never edits or deletes existing labels. The GitHub default `bug` label is verified
but never re-created. The full reference lives in `.specflow/LABELS.md` next to the install —
including a guidance note for local backend users on tagging via task-file frontmatter.

**Mandatory classification — every groomed item is sized, prioritised, typed, and labelled.** The PO
classifies every item it creates or clarifies along four axes — Size, Priority, Issue Type (`Task` /
`Bug` / `Feature`), and at least one label — before the item is done; classification is a gate, not
optional polish. On a GitHub project with native `Priority` / `Size` single-select fields and native
Issue Types, the bundled
`.specflow/scripts/backlog/set-field.sh <issue> <Priority|Size|IssueType> <value>` writes each to
its native field or type — and the PO **never** also applies a `priority:*` / `size:*` / `type:*`
label on an item that already carries the native value. Labels are a strict fallback for projects or
orgs without the native field/type; they are not a peer signal. `set-field.sh` exit codes tell the
caller which path applies: `0` = set, `10` = field/type absent (fall back to label), `11` = value
unrecognised, `12` = issue not on the project / not in the repo. `detect-fields.sh` (run once per
groom) emits the field/option IDs into env vars for case-insensitive matching. On GitLab the four
axes are scoped labels via `glab`; on the local Markdown backend they live in task-file frontmatter.

**Bounded context (soft fifth axis)** — a `domain:<context>` label (e.g. `domain:checkout`) is
optional on mono-domain projects but the `## Domain Model` block in every `/backlog brief` output is
always mandatory. Items touching ≥ 2 bounded contexts automatically trigger the epic detection
heuristic with reason "cross-bounded-context".

**`/backlog brief` — Domain Model is mandatory.** Every brief the PO generates for a developer MUST
include a `## Domain Model` block with: Bounded context, Vocabulary (ubiquitous language), Entities
(with aggregate root flag), Value objects, Invariants, and Out of scope. A brief without this block
is incomplete — the PO clarifies with the user before issuing it. If a `spec.md` is attached, the
block is written into the spec too (the spec template carries the section).

**Tech-debt intake protocol.** When a developer's completion report carries a `Tech debt surfaced`
block, the PO parses it, deduplicates against the current backlog, and opens one classified ticket
per surfaced item: `tech-debt` label, default Size XS or S, Priority P3 (bumped to P2 when the item
involves correctness or security risk). This is automatically triggered — no manual step required.

**Epics & sub-tasks.** Big work that needs decomposition lives as a parent **epic** with one or more
**sub-tasks**. The link mechanism differs per backend, but the contract is the same: parents cannot
close while any child is still open.

| Backend | Parent → child link                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| local   | `parent: "#NNN"` in the child's frontmatter, plus a `## Sub-tasks` cross-link in the parent file                   |
| github  | Native sub-issues API — children render automatically under the parent's "Sub-issues progress" field on Project V2 |
| gitlab  | Scoped label `parent::#NNN` on the child (Free-tier compatible)                                                    |

Create a child on any backend with the bundled `add.sh --parent <num>` flag — the script writes the
link, attaches to the project/board, and refuses (exit 3) when the named parent doesn't exist:

```bash
.specflow/scripts/backlog/add.sh "Child title" "Child body" "" --parent 42
```

The bundled `cascade-check.sh <num>` (github + gitlab) is the close gate — exits 11 with the open
children listed when close is unsafe, exits 12 (informational) when the parent is already closed so
callers don't issue a redundant `close` and 422, exits 3 when the parent doesn't exist, exits 0 when
all children are closed. The PO runs it before `gh issue close` / `glab issue close`. The local
backend uses an inline `grep` equivalent.

A companion `propagate-parent-status.sh` keeps the parent's board column honest as children move: a
child entering **In progress** or **In review** promotes a stalled parent (Backlog or Ready → In
progress), and once every child reaches **Done** the parent rolls up to Done. A child moving to
**Ready** is deliberately a no-op — Ready means groomed-and-waiting, not active work, so it must not
promote the parent.

The Product Owner agent **proactively** proposes epic decomposition during `/backlog add` and during
grooming whenever a request crosses ≥2 subsystems, has more than 5 acceptance-criteria bullets, or
carries trigger phrases like "break down", "phased", "rewrite", "end-to-end". Obvious splits get
auto-created; ambiguous ones get a concrete sub-task list back as a question. You don't have to ask
for the breakdown — the PO surfaces it on its own.

### 5. Claude Code plugin distribution

Specflow ships a first-class Claude Code plugin (`specflow-plugin`) available via the Claude Code
marketplace:

```
/plugin install mkrlabs/specflow-plugin
```

The plugin gives any Claude Code user instant access to the full Specflow slash-command suite and
sub-agents — no binary, no `specflow init` required. The plugin assets (the consolidated `specflow`
router skill with 19 phase docs including the five `audit-*` axes — `security` / `performance` /
`accessibility` from Epic #302 and `architecture` / `dependencies` from Epic #320, the
`specflow-review` auto-invoke alias, the deprecated `specflow-auto` alias, and 15 sub-agents
including the manual-only `performance-auditor`, `a11y-auditor`, `architecture-auditor`, and
`dependency-auditor` introduced with the audit family) are namespaced under `/specflow-plugin:*` so
they coexist with project-local copies without collision.

When both the plugin and the binary are in use, `specflow upgrade` detects the plugin and
auto-migrates vanilla on-disk agents and command files (backed up, then deleted — the plugin serves
them going forward). `specflow check --project` warns when covered files are missing and the plugin
is not installed, with a recovery hint.

### 6. Bundled `specflow-expert` agent

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

### 7. Bundled `security-auditor` agent — two modes

Every scaffold also ships a `security-auditor` agent with two dispatch shapes:

1. **PR review** — spawned by the `review-coordinator` during `/specflow review`. Audits the diff
   against eight rules (secrets in source, input validation, authz, injection, path traversal, SSRF,
   silent catches, internal-ID exposure) and emits a `FINDING` / `VERDICT` report.
2. **Alert triage** — invoked by the maintainer's `/release` flow when the `security-preflight`
   workflow surfaces open GitHub-side alerts (secret-scanning, dependabot, code-scanning, private
   advisories). The agent decides per-alert: open a backlog ticket via the PO, dismiss via
   `gh api -X PATCH` with a documented `resolution=` reason, or escalate to the user.

The triage mode is release-time only and uses a tightly-constrained `Bash` grant — only the three
`gh api` alert-dismissal endpoints are permitted. End users never trigger this mode; PR review
remains the user-facing path.

### 8. Bundled `ui-ux-designer` agent

Every scaffold also ships a `ui-ux-designer` agent that owns a single source of truth — the
project's `DESIGN.md` — that every other agent consults to keep generated UI on-brand. Three modes
auto-select from `DESIGN.md` state:

1. **Discovery** — when `DESIGN.md` is absent. The agent runs a 2-4 question interview (project +
   audience, visual mood, brand seed, optional stack hint) and writes a complete first `DESIGN.md`
   from a canonical template covering typography, palette (light + dark with WCAG-AA contrast
   rules), 4-point spacing scale, radius / shadow tokens, component primitives, and motion.
2. **Edit** — when `DESIGN.md` is present and the dispatch is a refactor request. The agent edits
   the spec in place with a one-line rationale per change and a Decision-log append.
3. **Audit** — when the dispatch contains the word `audit`. The agent scans
   `**/*.{tsx,jsx,vue,
   svelte,html,css,scss}` under `src/` for literal hex colours, off-system
   fonts, and off-grid spacing values, reports drift in a
   `| File | Line | Found | Expected token | Severity |` table, and emits `clean` / `drift_minor` /
   `drift_major`.

The agent is **manual-dispatch only** (`disable-model-invocation: true`) — design decisions are
intentional and the agent never auto-runs. It produces Markdown, never code; the developer agent is
what translates `DESIGN.md` into a Tailwind theme, CSS vars, or component library. `DESIGN.md` is
NOT scaffolded by `specflow init`; it materialises on the agent's first invocation when the user
actually wants a design system, so backend-only and CLI-only projects don't carry stub spec files
they never read.

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

## Contributing

### Agent adoption

Every `feat:` PR body must include an `## Agent adoption` section with a `` ```prompt `` fenced
block. The release pipeline extracts these into a structured `### Adoption guide` block on the
GitHub Release; `specflow-expert review-upgrade` plays them back in the user's project after
`specflow upgrade`.

See `docs/contributing.md#agent-adoption` for the convention and examples. The CI workflow
`.github/workflows/pr_adoption_lint.yml` enforces presence.

### Release notes shape

GitHub Releases bodies are auto-generated by `scripts/gen-changelog.ts` and follow this structure:

1. `### Features` — `feat:` commits, one bullet per commit.
2. `### Bug fixes` — `fix:` commits.
3. `### Adoption guide` — one block per `feat:` PR that has a `## Agent adoption` section in its PR
   body. Format:

````
**#NNN — Feature title**

<prose paragraph from the PR body>

```prompt
<ready-to-paste adoption prompt>
```
````

Consumed by `specflow-expert review-upgrade` (Phase 4 of the upgrade adoption flow).

4. `### Internal / chores` — `chore:` / `refactor:` / `docs:` / `test:` etc., collapsed under a
   `<details>` block.

If a `feat:` PR is merged without `## Agent adoption`, `gen-changelog.ts` emits a stderr warning
during the release workflow. The release still ships; the missing entry can be amended manually in
the GitHub Release body.

## Upgrades & adoption

`specflow upgrade` updates templates in place and prints a handoff line inviting the user to review
what changed via the `specflow-expert` agent.

### Files written

- `.specflow/upgrade-pending.json` — a marker recording the upgrade range:

```json
{
  "from": "1.4.0",
  "to": "1.6.0",
  "at": "2026-05-16T14:33:00.000Z"
}
```

Written on every successful apply. On chained upgrades, the existing marker's `from` is preserved.
Consumed by `specflow-expert review-upgrade` and by `specflow reconcile`. Deleted by the agent at
the end of a successful review.

- `.specflow/upgrade-staging/<path>` — for every file the upgrade preserved (i.e., on-disk version
  was customized vs. lock SHA), the upstream (bundled-template) version is written here under the
  same relative path. The on-disk project file is untouched. The staging directory is the source for
  `specflow reconcile` (see below).

Both are gitignored (`templates/core/root/.gitignore` ships the lines).

### Handoff line

`specflow upgrade` ends with:

```
✓ upgraded to templates 1.4.0 → 1.6.0

→ Walk through what's new with your AI:
`@specflow-expert review-upgrade`
```

An AI agent that sees `.specflow/upgrade-pending.json` in a project should proactively suggest
running `@specflow-expert review-upgrade`.

### `specflow reconcile`

Per-file post-upgrade reconciliation. Run after `specflow upgrade` for each file that was preserved
(customized locally — see the `Upgrades & adoption` section for context).

```
specflow reconcile --status
Print JSON listing files currently pending reconciliation. Reads
`.specflow/upgrade-staging/`. Output:
{
  "pending": [".claude/agents/developer.md", ...],
  "stagingDir": ".specflow/upgrade-staging" | null
}

specflow reconcile <path> --accept-upstream
Take the new template version for <path>. Backs up the local file to
`<path>.specflow.bak`, copies upstream content from
`.specflow/upgrade-staging/<path>` into place, and updates the lock
SHA. Removes the staging entry.

specflow reconcile <path> --accept-current
Keep the local customized version. Re-stamps the lock SHA to match
on-disk content, so the next upgrade does not re-flag this file as
preserved. Removes the staging entry.
```

`specflow-expert review-upgrade` is the recommended way to walk through reconciliation interactively
— it surfaces a `keep / take / merge / view / skip` choice per file and dispatches the `developer`
subagent for intelligent merges.

### `specflow-expert review-upgrade`

Dispatching `@specflow-expert review-upgrade` triggers a 7-step guided workflow inside the
`specflow-expert` agent:

1. **Read marker** — reads `.specflow/upgrade-pending.json`; exits with instructions if absent.
2. **Fetch releases** — fetches GitHub Release bodies for every tag in `(from, to]` and parses each
   `### Adoption guide` section into structured adoption prompts. Falls back to the vendored
   snapshot if the GitHub API is unreachable.
3. **Present plan** — shows releases in range, adoption prompts count, and files pending
   reconciliation (`specflow reconcile --status`). Offers to create a branch
   `specflow-upgrade-v{to}` for review-as-PR.
4. **Walk adoption prompts** — presents each prompt one by one with four options: `[a]` run it
   (dispatches `developer` agent), `[s]` skip, `[c]` show raw prompt, `[q]` quit.
5. **Reconcile customized files** — for each file pending reconciliation, shows a diff summary and
   offers `[k]` keep local, `[t]` take upstream, `[m]` intelligent merge (dispatches `developer`),
   `[v]` view full diff, `[s]` skip.
6. **Cleanup** — when both walks complete with nothing skipped, deletes the marker and (if on the
   review branch) commits a summary. Skipped items are left on disk for the next `review-upgrade`
   run.

Trigger keyword: `review-upgrade` in the dispatch message.

## Repository

Source, releases, and issue tracker:
**[github.com/mkrlabs/specflow](https://github.com/mkrlabs/specflow)**.

The `AGENTS.md` file at the repo root is the canonical context document for any future Claude Code,
Codex, or other agent session contributing to the project itself.
