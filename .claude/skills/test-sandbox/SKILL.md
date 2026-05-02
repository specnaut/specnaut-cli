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
