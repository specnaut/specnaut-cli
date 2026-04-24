---
name: speckit
description: Dispatcher intelligent pour les commandes Speckit. Permet de cibler une spec par son numéro ou nom partiel et d'exécuter automatiquement la bonne commande speckit (specify, plan, tasks, clarify, analyze, checklist, implement, review).
---

# Speckit Runner Skill

This skill gives you a **single entry point** to run any speckit command on any
feature spec. Instead of manually finding the spec path and loading the command
file, just use a natural shortcut.

## Usage

When the user types something like:

```
/speckit <command> <spec-identifier>
```

or

```
speckit.<command> <spec-identifier>
```

**Examples:**

```
/speckit tasks 001
/speckit analyze multi-role
/speckit implement registration
/speckit checklist 001-multi-role-registration
/speckit specify new "User profile editing"
```

## How it works

### Step 1: Parse the user's request

Extract two pieces from the user input:

1. **Command** — one of: `specify`, `plan`, `tasks`, `clarify`, `analyze`,
   `checklist`, `implement`, `review`, `constitution`, `taskstoissues`
2. **Spec identifier** — can be:
   - A number: `001` → matches `specs/001-*`
   - A partial name: `multi-role` → matches `specs/*multi-role*`
   - A full name: `001-multi-role-registration` → exact match
   - The word `new` → indicates a new spec (only for `specify`)
   - Empty → list all available specs and ask user to pick

### Step 2: Find the spec directory

Use the helper script to resolve the spec:

```bash
# Run from project root
bash .claude/skills/speckit/scripts/find-spec.sh <identifier>
```

The script returns JSON:

```json
// Found
{"found":true,"count":1,"specs":[{"dir":"/abs/path/specs/001-multi-role-registration","name":"001-multi-role-registration","has_spec":true,"has_plan":true,"has_tasks":true}]}

// Not found
{"found":false,"count":0,"specs":[]}

// List all (no argument)
bash .claude/skills/speckit/scripts/find-spec.sh
```

**Match rules:**

- If **exactly 1 match** → use it
- If **multiple matches** → show the options and ask the user to pick
- If **no match** → tell the user no spec found, show available specs
- If **"new"** → proceed with `speckit.specify` to create a new spec

### Step 3: Load the command

Once you have the spec directory, load the corresponding command file:

```
.agents/commands/speckit.<command>.md
```

Map of commands to files:

| User shortcut   | Command file                                |
| :-------------- | :------------------------------------------ |
| `specify`       | `.agents/commands/speckit.specify.md`       |
| `plan`          | `.agents/commands/speckit.plan.md`          |
| `tasks`         | `.agents/commands/speckit.tasks.md`         |
| `clarify`       | `.agents/commands/speckit.clarify.md`       |
| `analyze`       | `.agents/commands/speckit.analyze.md`       |
| `checklist`     | `.agents/commands/speckit.checklist.md`     |
| `implement`     | `.agents/commands/speckit.implement.md`     |
| `review`        | `.agents/commands/speckit.review.md`        |
| `constitution`  | `.agents/commands/speckit.constitution.md`  |
| `taskstoissues` | `.agents/commands/speckit.taskstoissues.md` |

### Step 4: Execute with context

1. **Read the command file** using `view_file`
2. **Set the context**: The spec directory path is now known, so any
   `$ARGUMENTS` in the command can be populated
3. **Follow the command's instructions** exactly as written in the command file,
   with the identified spec as the target

### Step 5: Shortcut — If no command is specified

If the user just types `/speckit 001` or `/speckit multi-role` without a command
name, **show the spec status dashboard**:

```
📋 Spec: 001-multi-role-registration

Available artifacts:
  ✅ spec.md        — Feature specification
  ✅ plan.md        — Implementation plan
  ✅ tasks.md       — Task breakdown (33 tasks)
  ✅ research.md    — Technical decisions
  ✅ data-model.md  — Data model
  ✅ quickstart.md  — Validation guide
  ✅ checklists/    — Quality checklists

Available commands:
  /speckit clarify 001    — Clarify spec ambiguities
  /speckit plan 001       — Generate/update implementation plan
  /speckit tasks 001      — Generate/update task breakdown
  /speckit analyze 001    — Cross-artifact consistency check
  /speckit checklist 001  — Generate quality checklist
  /speckit implement 001  — Start implementation
  /speckit review 001     — Run quality checks (format, lint, typecheck, tests)
```

Check each file's existence and show ✅ or ⬜ accordingly.

## Edge Cases

- **Constitution command**: Does not need a spec identifier (it's project-wide).
  If user types `/speckit constitution`, just load the constitution command
  directly.
- **New spec**: If user types `/speckit specify new "Feature name"`, proceed
  with `speckit.specify` using the feature name as input.
- **Command typos**: If the command doesn't match exactly, try fuzzy matching
  (e.g., `task` → `tasks`, `check` → `checklist`, `impl` → `implement`, `rev` →
  `review`).

## Auto Mode (default for `/speckit specify`)

When the user invokes `/speckit specify <description>` (the entry point for a
brand-new feature), the skill **auto-chains the entire SpecKit workflow** in
the same session, only stopping at two well-defined checkpoints. This is the
default behavior — opt out with the `--manual` flag.

### Chain order

```
specify  →  clarify  →  plan  →  tasks  →  analyze  →  implement  →  review  →  merge
            ▲                                                                      ▲
            └─ STOP #1: only if [NEEDS CLARIFICATION] questions exist              │
                                                                                   │
                                  STOP #2: always — final validation before merge ─┘
```

```
Under --copilot: specify → clarify → plan → tasks → analyze → handoff → exit
                         ▲ STOP #1                             ▲ STOP #3 (Copilot takes over)
```

### How to chain

After each phase completes, **invoke the next command via the `Skill` tool**
without waiting for the user. Example: after `/speckit.specify` writes
`spec.md`, immediately invoke `Skill(skill: "speckit.clarify", args: "<feature_id>")`.
Continue this loop until you reach STOP #2.

### STOP #1 — Clarification checkpoint

After `/speckit.clarify` finishes its scan:

- **If zero `[NEEDS CLARIFICATION]` markers were found** → continue silently to
  `/speckit.plan` without bothering the user. Log a one-line "✓ no clarifications
  needed, proceeding to plan" so the user sees the chain advancing.
- **If questions exist** → present them to the user one at a time per the
  `/speckit.clarify` workflow. Wait for answers. Once all answers are recorded
  and the spec is updated, **resume the chain automatically** by invoking
  `/speckit.plan`.

### Silent gates between phases

These phases run automatically without user prompts unless they fail hard:

- `/speckit.plan` — generates plan + research + data-model + contracts + quickstart
- `/speckit.tasks` — generates tasks.md
- `/speckit.analyze` — cross-artifact consistency check
  - **If only LOW/MEDIUM findings** → log a brief summary and continue
  - **If CRITICAL findings** → stop, surface them to the user, and ask whether
    to fix (loop back to plan/tasks) or proceed anyway
- `/speckit.implement` — runs the full agent team (developer → review-coordinator → fixes → quality gates)
  - The implement workflow already has its own internal review loop, so a
    failing review gate is auto-routed to the developer for fixes within
    `implement` itself
- `/speckit.review` — final post-implement quality scan (architecture, silent
  errors, ID exposure, cache, tests, format, lint, typecheck, full test suite)

### STOP #2 — Pre-merge validation checkpoint

After `/speckit.review` passes, **always stop and present a compact summary**
before invoking `/speckit.merge`. The summary must include:

- Feature name and branch
- Files created / modified (count + key paths)
- Tests added (count) and full-suite status
- Known deviations from `tasks.md` and their rationale
- Open risks / deferred items
- One-line business outcome ("does this feature deliver what the spec promised?")

Then ask explicitly:

> "Tout est prêt pour merge. Tu valides ? (oui pour lancer `/speckit.merge`,
> non pour rester sur la branche)"

Wait for the user's explicit confirmation. Only on "oui" / "yes" / "go" do you
invoke `/speckit.merge`. After merge, the chain ends — do **not** auto-push to
`origin main`. The merge command itself asks the push question.

### Skipped by default

- **`/speckit.checklist`** — extra UX/security checklists are opt-in. The
  `requirements.md` checklist created by `/speckit.specify` is sufficient for
  most features. Only invoke `/speckit.checklist` if the user explicitly asks.

### Opt out: `--manual` flag

If the user invokes `/speckit specify --manual <description>`, run
`/speckit.specify` only and stop. The user drives the next steps manually,
phase by phase. This restores the legacy behavior.

### Opt in: `--copilot` flag (cloud handoff)

When the user invokes `/speckit specify --copilot "<description>"`, the
chain **diverges from the default auto mode** after Phase 2 (`analyze`):

```
specify → clarify → plan → tasks → analyze → STOP #3 → handoff → exit
          ▲ STOP #1 (unchanged)                        ▲
                                     STOP #3: push, open draft PR, assign Copilot
```

The chain does NOT run `implement`, `review`, or `merge` locally. Those
phases are delegated to GitHub Copilot Coding Agent in the cloud.

**Prerequisite:** the feature must already exist as a backlog task with a
synced GitHub Issue (label `backlog/NNN`). If not, the bootstrap fails
loudly — run `/backlog add <title>` and `/backlog sync <NNN>` first.

**Behavior:**
1. **Phase 1 — Bootstrap.** Before running `specify`, invoke
   `.claude/skills/speckit/scripts/create-linked-branch.py --backlog-id NNN
   --slug <slug>`. The script resolves the GitHub Issue, calls
   `createLinkedBranch`, fetches the branch, and checks it out. The
   remote branch is now natively linked to the issue in GitHub's UI.

2. **Phase 2 — Auto-chain.** Run the existing auto-chain:
   `specify → clarify → plan → tasks → analyze`. Every artifact lands
   under `specs/<issue-number>-<slug>/` on the linked branch. STOP #1
   behaves identically to the default mode. If `analyze` surfaces
   CRITICAL findings, abort and surface them to the user — do not
   hand a broken spec to Copilot.

3. **Phase 3 — Handoff.** Invoke
   `.claude/skills/speckit/scripts/handoff-to-copilot.py
   --feature-dir <dir> --issue-number <NN> --branch <branch>
   --title "<feature title>"`. The script commits specs, pushes the
   branch, opens a draft PR with the templated body, and posts a
   `@copilot` mention to trigger the Coding Agent.

4. **Exit.** Print the PR URL and the preview URL (still deploying).
   Warn the user that the branch now belongs to Copilot — any further
   local commits will conflict.

**Dogfooding policy:** this flag is new. Use it exclusively on backlog
tasks ≤ 3 pts for the first two runs, then ≤ 5 pts for the following
month. Do not use on ≥ 8 pt features until Copilot's track record is
established on this repo.

### Opt out: existing-feature commands

`/speckit clarify`, `/speckit plan`, `/speckit tasks`, `/speckit analyze`,
`/speckit implement`, `/speckit review`, `/speckit merge` invoked directly
(not via the auto chain) **stay one-shot** — they do NOT auto-chain. The auto
chain is exclusively triggered by the `/speckit specify` entry point. This way
existing-feature workflows (re-planning, re-implementing a partial feature)
remain manual and predictable.

### Context budget warning

The full chain runs in a single conversation and consumes context. For
large features (≥13 pts or ≥30 tasks), watch for context pressure during
`/speckit.implement` — that phase already delegates to a developer sub-agent
with isolated context, but the parent loop still tracks each phase boundary.
If the chain hits compaction mid-way, the user can resume from the last
completed phase manually.

### Failure handling within the chain

- **Hard failure in any silent gate** (plan/tasks/analyze/implement/review):
  stop, surface the error, ask the user how to proceed. Do not silently
  retry — the user must see what broke.
- **`tasks.md` blockers reported by the developer agent during implement**:
  the implement workflow already has a fix loop. Do not intercept.
- **Clarify produces more than 5 questions**: present the top 3 as per the
  `/speckit.clarify` quota; the rest can be asked later.

## Quick Reference

```
/speckit                           → List all specs
/speckit 001                       → Show spec 001 status dashboard
/speckit specify "My feature"      → Auto-chain full workflow (default)
/speckit specify --manual "X"      → Create spec only, no auto-chain
/speckit clarify 001               → One-shot clarify (no auto-chain)
/speckit tasks 001                 → Regenerate tasks for spec 001
/speckit analyze multi-role        → Run analyze on matching spec
/speckit constitution              → Open constitution (no spec needed)
/speckit checklist 001             → Generate extra checklist (opt-in)
```
