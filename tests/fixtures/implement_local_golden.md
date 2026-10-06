
## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before implementation)**:
- Check if `.specnaut/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_implement` key
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue normally
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** attempt to interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- For each executable hook, output the following based on its `optional` flag:
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Pre-Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **Mandatory hook** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Pre-Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}
    
    Wait for the result of the hook command before proceeding to the Outline.
    ```
- If no hooks are registered or `.specnaut/extensions.yml` does not exist, skip silently

## Outline

1. Run `.specnaut/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` from repo root and parse FEATURE_DIR and AVAILABLE_DOCS list. All paths must be absolute. For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. Load and analyze the implementation context:
   - **REQUIRED**: Read tasks.md for the complete task list and execution plan
   - **REQUIRED**: Read plan.md for tech stack, architecture, and file structure
   - **REQUIRED**: Read the domain model in the plan's technical-context section. If the section is absent, empty, or still contains `[NEEDS CLARIFICATION]` markers / template placeholders → halt and report BLOCKED with reason `awaiting:product-owner-domain-brief`. The developer agent refuses to write code without this brief — its "First action" checklist (step 4) reads the block and returns the same BLOCKED reason. Recommend re-running `/specnaut plan` to fill it before re-attempting `/specnaut implement`.
   - Read `plan.md` section 6 for the domain model — entities, value objects, invariants
   - Read `plan.md` section 8 for the surfaces touched and the interface contracts
   - **Read `plan.md` section 5 — the 🔒 decision table — and treat it as binding.** A decision
     may not be implemented anywhere but its named home. If the code seems to want a second
     spelling, the plan is amended first; it is not resolved at the keyboard.
   - **REQUIRED**: apply `.specnaut/memory/size-limits.md` § **implement** to every task and brief.

3. **Project Setup Verification**:
   - **REQUIRED**: Create/verify ignore files based on actual project setup:

   **Detection & Creation Logic**:
   - Check if the following command succeeds to determine if the repository is a git repo (create/verify .gitignore if so):

     ```sh
     git rev-parse --git-dir 2>/dev/null
     ```

   - Check if Dockerfile* exists or Docker in plan.md → create/verify .dockerignore
   - Check if .eslintrc* exists → create/verify .eslintignore
   - Check if eslint.config.* exists → ensure the config's `ignores` entries cover required patterns
   - Check if .prettierrc* exists → create/verify .prettierignore
   - Check if .npmrc or package.json exists → create/verify .npmignore (if publishing)
   - Check if terraform files (*.tf) exist → create/verify .terraformignore
   - Check if .helmignore needed (helm charts present) → create/verify .helmignore

   **If ignore file already exists**: Verify it contains essential patterns, append missing critical patterns only
   **If ignore file missing**: Create with full pattern set for detected technology

   **Common Patterns by Technology** (from plan.md tech stack):
   - **Node.js/JavaScript/TypeScript**: `node_modules/`, `dist/`, `build/`, `*.log`, `.env*`
   - **Python**: `__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `dist/`, `*.egg-info/`
   - **Java**: `target/`, `*.class`, `*.jar`, `.gradle/`, `build/`
   - **C#/.NET**: `bin/`, `obj/`, `*.user`, `*.suo`, `packages/`
   - **Go**: `*.exe`, `*.test`, `vendor/`, `*.out`
   - **Ruby**: `.bundle/`, `log/`, `tmp/`, `*.gem`, `vendor/bundle/`
   - **PHP**: `vendor/`, `*.log`, `*.cache`, `*.env`
   - **Rust**: `target/`, `debug/`, `release/`, `*.rs.bk`, `*.rlib`, `*.prof*`, `.idea/`, `*.log`, `.env*`
   - **Kotlin**: `build/`, `out/`, `.gradle/`, `.idea/`, `*.class`, `*.jar`, `*.iml`, `*.log`, `.env*`
   - **C++**: `build/`, `bin/`, `obj/`, `out/`, `*.o`, `*.so`, `*.a`, `*.exe`, `*.dll`, `.idea/`, `*.log`, `.env*`
   - **C**: `build/`, `bin/`, `obj/`, `out/`, `*.o`, `*.a`, `*.so`, `*.exe`, `*.dll`, `autom4te.cache/`, `config.status`, `config.log`, `.idea/`, `*.log`, `.env*`
   - **Swift**: `.build/`, `DerivedData/`, `*.swiftpm/`, `Packages/`
   - **R**: `.Rproj.user/`, `.Rhistory`, `.RData`, `.Ruserdata`, `*.Rproj`, `packrat/`, `renv/`
   - **Universal**: `.DS_Store`, `Thumbs.db`, `*.tmp`, `*.swp`, `.vscode/`, `.idea/`

   **Tool-Specific Patterns**:
   - **Docker**: `node_modules/`, `.git/`, `Dockerfile*`, `.dockerignore`, `*.log*`, `.env*`, `coverage/`
   - **ESLint**: `node_modules/`, `dist/`, `build/`, `coverage/`, `*.min.js`
   - **Prettier**: `node_modules/`, `dist/`, `build/`, `coverage/`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
   - **Terraform**: `.terraform/`, `*.tfstate*`, `*.tfvars`, `.terraform.lock.hcl`
   - **Kubernetes/k8s**: `*.secret.yaml`, `secrets/`, `.kube/`, `kubeconfig*`, `*.key`, `*.crt`

4. Parse tasks.md structure and extract:
   - **Task phases**: Setup, Tests, Core, Integration, Polish
   - **Task dependencies**: Sequential vs parallel execution rules
   - **Task details**: ID, description, file paths, parallel markers [P]
   - **Execution flow**: Order and dependency requirements

5. Execute implementation following the task plan:
   - **Phase-by-phase execution**: Complete each phase before moving to the next
   - **Respect dependencies**: Run sequential tasks in order, parallel tasks [P] can run together  
   - **Follow TDD approach**: Execute test tasks before their corresponding implementation tasks
   - **File-based coordination**: Tasks affecting the same files must run sequentially
   - **Validation checkpoints**: Verify each phase completion before proceeding

6. Implementation execution rules:
   - **Setup first**: Initialize project structure, dependencies, configuration
   - **Tests before code**: If you need to write tests for contracts, entities, and integration scenarios
   - **Core development**: Implement models, services, CLI commands, endpoints
   - **Integration work**: Database connections, middleware, logging, external services
   - **Polish and validation**: Unit tests, performance optimization, documentation

7. Progress tracking and error handling:
   - Report progress after each completed task
   - Halt execution if any non-parallel task fails
   - For parallel tasks [P], continue with successful tasks, report failed ones
   - Provide clear error messages with context for debugging
   - Suggest next steps if implementation cannot proceed
   - **IMPORTANT** For completed tasks, make sure to mark the task off as [X] in the tasks file.

8. Completion validation:
   - Verify all required tasks are completed
   - Check that implemented features match the original specification
   - Validate that tests pass and coverage meets requirements
   - Confirm the implementation follows the technical plan
   - Report final status with summary of completed work

Note: tasks.md incomplete or missing → suggest `/specnaut tasks` first.

10. **Check for extension hooks**: After completion validation, check
    `hooks.after_implement` in `.specnaut/extensions.yml` and follow the same
    procedure as the pre-hook block above — same parse, same `enabled` default,
    same refusal to evaluate a `condition`, same silent skip when absent. Two
    differences only: the key is `after_implement`, and the emitted wording is
    `**Optional Hook**` / `**Automatic Hook**` (no "Pre-").
## An epic runs as a loop, not as one implementation

When the item being worked is an **epic with open sub-issues**, read
`phases/epic-loop.md` and follow it: one commit per child on the epic's
branch, the fast gate after each, and no return to the user between children.
It carries the commit format and the gate tiers by reference. On a standalone
item none of it applies — implement and commit as usual.

## 🔒 What you find while building, you fix while building

You will hit things the task did not name: a stale comment, a guard with no
test, a message promising something the code does not do, a helper that swallows
an error. **Fix them, in this branch, in their own commit.** That is the job, not
an interruption to it.

Log one instead of fixing it only when it needs a **product decision**, crosses a
**boundary this task does not touch**, needs a **migration**, or the fix is
**larger than the task itself** — and then say, in one sentence, why. Anything
that clears that bar is significant enough to be opened at **P0 or P1**.

A run that lands one task and leaves four behind has made the backlog longer than
it found it. Do that a few times and the backlog is the work, and the work never
happens.

## Ending this phase — freeze, then INVOKE `review`, same turn

**An implementation that has not been through review is not finished.** `review` is this phase's
mandatory last act, not a separate thing the user has to ask for.

1. **Freeze the tree.** Reviewers and suites read the working tree live, and only you know whether
   it is still moving. Name the commit, stop every implementer agent still holding the tree, then
   gate. A lingering agent row is a live teammate, not a leftover — it can write into a tree
   somebody is about to freeze.
2. **Invoke `review` yourself, in the same turn.** Your own next action.

**This boundary is not a stop.** "The audits found a lot, should I re-confirm scope?" is not a
reason — the findings were folded into the plan and the plan was approved, and that approval covers
what the plan now says. Neither is "the user has been checkpointing each step": answering a question
is not a request to be asked another one.

Pause only when the run was started with `--manual`.
