---
name: test-sandbox
description: Spin up controlled test environments (Vite, Next-style brownfield, empty greenfield) under the gitignored `sandbox/` directory and run Specflow against them using the current source tree (not the installed binary). Use whenever you need to manually validate the UX of `specflow init` / `upgrade` / `check` on a real-world project shape, reproduce a brownfield bug, or eyeball cross-harness output side-by-side. Each script is idempotent.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/*.sh) Bash(${CLAUDE_SKILL_DIR}/scripts/*.sh *) Bash(deno *) Bash(ls *) Bash(find *) Bash(cat *) Bash(diff *) Bash(rm *) Bash(npm *) Bash(git *)
---

# test-sandbox skill — Specflow UX testing toolbox

When you need to verify how `specflow init`, `specflow upgrade`, etc. behave on real-world project shapes — without recompiling the binary or installing it system-wide — use this skill.

Each script bootstraps a controlled scenario inside `sandbox/<name>/` (the `sandbox/` dir is gitignored at the repo root, so nothing leaks to commits), then optionally runs Specflow against it from the current source tree (`deno run --allow-all src/main.ts ...`). That way you're testing the working-tree behaviour, not the released binary.

## When to use

- Manual UX validation of a fix or feature before / after merging (e.g. brownfield `.gitignore` merge — that's exactly how PR #7 was caught and validated).
- Reproducing an issue reported on a real project shape (Vite, Next, etc.) without leaving the repo.
- Cross-harness comparison: same project, all 8 harnesses, eyeball the output trees side by side.

## Scripts

```bash
.claude/skills/test-sandbox/scripts/bootstrap-vite.sh <name>      # Vite React-TS scaffold
.claude/skills/test-sandbox/scripts/bootstrap-empty.sh <name>     # empty greenfield (git init + stub package.json)
.claude/skills/test-sandbox/scripts/run-init.sh <name> <harness>  # specflow init --here --ai <harness> (uses current source)
.claude/skills/test-sandbox/scripts/inspect.sh <name>             # summarize specflow output paths in sandbox/<name>/
.claude/skills/test-sandbox/scripts/compare-harnesses.sh <name>   # bootstrap once + run all 8 harnesses on copies, print summaries
.claude/skills/test-sandbox/scripts/clean.sh [<name>]             # wipe one scenario or the whole sandbox/ tree
```

`<harness>` ∈ `claude` (default) | `cursor` | `codex` | `gemini` | `windsurf` | `copilot` | `opencode` | `antigravity`.

### Smoke tests for bundled features

These wrap a fresh `init --ai claude --backlog local` and exercise specific feature surfaces. Each prints a `✓` / `❌` line per check and exits 0 on full pass, 1 on any failure — usable as guard rails in pre-release runs or after a refactor that touches bundled artefacts.

```bash
.claude/skills/test-sandbox/scripts/smoke-features.sh <name>          # presence + frontmatter checks for every feature shipped after v0.9 (specflow-expert protocols, LABELS.md, etc.)
.claude/skills/test-sandbox/scripts/smoke-backlog-local.sh <name>     # add → list → move → view → clarify-comment round-trip on the local backend
.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh <name>    # github-backend script presence (set-field, detect-fields, ensure-labels) + SKILL.md references
.claude/skills/test-sandbox/scripts/smoke-hooks.sh <name>             # fire each bundled hook with synthetic stdin, verify behavior + soft-warn semantics
.claude/skills/test-sandbox/scripts/smoke-picker.sh <name>            # drive the interactive arrow-key picker over a real PTY (requires python3)
.claude/skills/test-sandbox/scripts/smoke-all-harnesses.sh <name>     # init across all 8 harnesses, assert each scaffold is correct (auto-cleans on exit)
```

Run all six back-to-back for a comprehensive post-refactor smoke:

```bash
bash .claude/skills/test-sandbox/scripts/smoke-features.sh feat
bash .claude/skills/test-sandbox/scripts/smoke-backlog-local.sh backlog
bash .claude/skills/test-sandbox/scripts/smoke-backlog-github.sh ghback
bash .claude/skills/test-sandbox/scripts/smoke-hooks.sh hooks
bash .claude/skills/test-sandbox/scripts/smoke-picker.sh picker
bash .claude/skills/test-sandbox/scripts/smoke-all-harnesses.sh allharness
```

`smoke-all-harnesses.sh` is the cross-harness coverage gate: it bootstraps a
fresh empty project per harness, runs `specflow init --here --no-git --ai
<harness> --backlog local`, and asserts the harness-specific output root
exists AND `.specflow/installed.lock` declares the right harness. Prints
`✓ <harness>: scaffold ok` on pass and `❌ <harness>: <reason>` on fail. A
trap on EXIT cleans up every `sandbox/<name>-<harness>/` directory it
created, success or failure — no orphans.

`smoke-picker.sh` uses Python's `pty` module to allocate a real pseudo-TTY for the
`specflow init` subprocess so `Deno.stdin.isTerminal()` returns true and the
interactive code path actually runs (a normal piped subprocess would fall back
to the non-TTY numeric prompt). It scripts arrow-down + enter keystrokes,
captures the rendered frames, and asserts that the highlight moved correctly
and the resulting init landed the right harness + backlog backend.

## Typical workflows

### Validate a brownfield fix before merging

```bash
bash .claude/skills/test-sandbox/scripts/bootstrap-vite.sh demo
bash .claude/skills/test-sandbox/scripts/run-init.sh demo claude
bash .claude/skills/test-sandbox/scripts/inspect.sh demo
cat sandbox/demo/.gitignore                       # eyeball the merged result
```

### Reproduce an issue across all harnesses

```bash
bash .claude/skills/test-sandbox/scripts/compare-harnesses.sh demo
ls sandbox/                                       # demo, demo-claude, demo-cursor, …
```

### Reset between runs

```bash
bash .claude/skills/test-sandbox/scripts/clean.sh demo            # one project
bash .claude/skills/test-sandbox/scripts/clean.sh                 # everything under sandbox/
```

### Hands-off UX pass — dispatch the QA agent

For a fresh-eyes audit (bootstrap + init + inspect + report) without
running each script yourself, dispatch the `qa-tester` subagent (defined
at `.claude/agents/qa-tester.md`). It reads the public docs at
`specflow.makerlabs.dev/llms.txt`, runs Specflow against a clean Vite
scenario as a brand-new user would, and writes a checklist report to
`sandbox/qa-report-<stamp>.md` listing every blocker / friction / nit. The
agent never modifies the codebase — it only reports.

## Conventions

- Sandbox scenarios always live under `sandbox/<name>/`. The `sandbox/` directory is gitignored at the repo root — never commit anything from it.
- Scripts run `deno run --allow-all` on `src/main.ts` so you're testing the working tree, **not** the installed `specflow` binary. To test the released binary instead, run `specflow` directly without going through this skill.
- All scripts are idempotent. Re-running is always safe; pre-existing `sandbox/<name>/` is wiped before re-bootstrapping.
- Bootstrap scripts skip `npm install` — Specflow's filesystem ops don't depend on `node_modules` being populated, and skipping the install keeps each scenario fast and small.

## When NOT to use

- If you just need to run the existing automated test suite, `deno task test` covers it — no skill needed.
- If you're doing repo-wide refactors with no UX-facing change (template restructuring, harness internals), this skill won't surface anything the unit tests don't already.
- Don't use the bootstrapped projects as scratchpads for unrelated work — they're meant to be ephemeral test fixtures, wiped between scenarios.
