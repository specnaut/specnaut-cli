# AGENTS.md — Specnaut CLI

> Working contract for every session in this repository (Claude Code, Codex, …). Read it first.

## What Specnaut is

Specnaut scaffolds, inside a user's project, the files their AI harness reads: skills, agents,
templates, scripts, the always-on `AGENTS.md`. It ships as a native binary.

**Specnaut never talks to an LLM and never orchestrates an agent at runtime.** The user's harness
consumes the generated files. A change that would make the binary call a model is out of scope.

Design target: frontier models on **Claude Code** and **OpenAI Codex**, following those two
harnesses' own conventions. Other registered harnesses keep working on a best-effort basis and are
never a design constraint.

## Consumer agnosticism — non-negotiable

> **Specnaut is a tool other projects consume. Those projects are none of Specnaut's business.**

No project that uses Specnaut, was used to design Specnaut, or belongs to whoever is writing the
commit may leave a trace here: not its name, its vendors (payment processors, feature-flag services,
auth providers), its infrastructure (hostnames, stack names, cloud resource ids), or its business
material (backlogs, roadmaps, incidents). In code, tests, fixtures, docs, specs, commit messages,
agent or skill definitions, or an `examples/` folder.

1. **Never vendor a real project's configuration as reference material.** Describe the mechanism;
   write a synthetic, obviously fictional example.
2. **Attribute to nothing.** "Modeled on a reference setup", never "modeled on `<project>`". Public
   prior art whose mention is the point (upstream Spec Kit, Claude Code) is the exception.
3. **Invent your examples.** Neutral placeholders only (`acme`, `example.com`, `my-app`). A real
   vendor appears only if Specnaut itself integrates with it.

**Before any commit:** _would this line tell a stranger what an unrelated project is called, who it
pays, or how it is built?_ If yes, it does not belong here.

**A violation is an incident, not a typo.** Removing it at `HEAD` leaves it in history, tags and PR
refs; it needs a history rewrite, and where releases are immutable every affected version is burned.
This has happened here.

## Where the authoritative lists live

Read these rather than any list in prose — prose lists here have drifted before.

- Harnesses: `src/cli/harnesses.ts` (`specnaut init --help` prints them).
- Backlog backends: `src/domain/backlog_strategies/`.
- Bundled skills, agents, templates: `templates/` and `templates/manifest.json`.
- Phases of `/specnaut` and their order: `templates/core/skills/specnaut/SKILL.md`.
- Version and changes: `deno.json`, `gh release list -R specnaut/specnaut-cli`.

## Conventions for work on this repo

- Layering under `src/`: `domain/` (pure), `application/` (use cases + ports), `infrastructure/`
  (adapters), `cli/` (presentation). Tests mirror `src/`.
- A Go port lives beside the TypeScript source (`cmd/specnaut/`, `internal/`, `templates.go`). The
  black-box harness in `parity/` compares the two binaries. Run `go test ./...` before you commit a
  change to it, or to `templates/manifest.json`, which the port reads too.
- Adding a harness is additive: one adapter under `src/infrastructure/harness/`, registered in
  `src/cli/harnesses.ts`. Nothing in the CLI surface or the bundle is harness-specific by default.
- Templates are bundled into the binary by `scripts/bundle-templates.ts`. **Never hand-edit
  `src/templates_bundle.ts`**; run `deno task bundle`. Files under `plugin/` mirror `templates/`
  byte for byte (`tests/plugin/plugin_sync_test.ts`).
- Run tests with the task's permissions: `deno task test`, or for one file
  `deno test --allow-read --allow-write --allow-run --allow-env <file>`. `deno test -A` hides the
  permission errors the task hits.
- A new assertion is shown red by mutating the code it guards before it is trusted.
- The pre-commit hook (`hooks/pre-commit`, installed by `deno task setup`) runs `deno fmt --check`,
  `deno lint`, `deno task bundle` and `deno check src/main.ts`. It must be green before every
  commit.
- A `feat` commit carries an `## Agent adoption` section in its body; check it with
  `deno run --allow-run scripts/check-adoption.ts --from main --to HEAD`.
