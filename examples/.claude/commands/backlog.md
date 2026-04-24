---
description: Manage the product backlog — list tasks, get next recommendations, add/update tasks, groom priorities. Delegates to the Product Owner agent.
---

## User Input

```text
$ARGUMENTS
```

## Dispatch Logic

Parse the user input to determine the sub-command:

| Input Pattern       | Action                                     |
| ------------------- | ------------------------------------------ |
| _(empty)_ or `list` | Show the backlog overview                  |
| `next`              | Recommend top 3 tasks with workflow advice |
| `add <title>`       | Create a new backlog task                  |
| `update <id>`       | Update an existing task                    |
| `estimate <id>`     | Estimate complexity for a task             |
| `status`            | Show dashboard summary                     |
| `groom`             | Full grooming session                      |
| `brief <id>`        | Generate PO business brief for a task      |
| `sync`              | Push all tasks to GitHub Issues + Kanban   |
| `sync <id>`         | Push a single task to GitHub Issues        |
| `<number>`          | Show details for task with that ID         |

## MANDATORY: Always Go Through the Product Owner Agent

**You MUST spawn the `product-owner` agent for ANY `/backlog` invocation —
including short-circuit cases where "you already know the answer."** Never
bypass the agent to save tokens, even for a trivial add. The PO agent owns:

- The mutation semantics (frontmatter schema, index placement, Summary table)
- The business context to fill in the task properly
- The mandatory **GitHub Sync Hook** directive that must fire after mutations

If you (the orchestrator) write task files directly without the PO agent, you
WILL forget the sync hook. This has already happened. Do not repeat it.

**This rule also applies when `/backlog` is implicitly invoked** — e.g., when
any other workflow (brainstorm, speckit, manual user request) results in a
backlog mutation. Route it through the PO agent every time.

## Execution

1. **Read** `tasks/backlog.md` to understand current state.

2. **Spawn the product-owner agent** with the appropriate sub-command:

   ```
   @product-owner

   The user ran `/backlog [sub-command]`.

   Current backlog index: [paste backlog.md content]

   Execute the [sub-command] as defined in your instructions.

    IMPORTANT:
    - Keep conversational responses in the user's language when appropriate
    - Write all persisted backlog artifacts in English
    - Task titles, task file bodies, frontmatter content, and backlog index
       entries must always be in English

   IMPORTANT for `/backlog next`:
   - For each recommended task, advise on the workflow:
     - If complexity ≥ 8 or new entities/complex flow → recommend:
       `/speckit specify <task title>`
     - If complexity ≤ 5 or simple wiring/fix/refactor → recommend:
       direct implementation on main branch
   - Provide business context for each recommendation
   - Include the exact command to start
   ```

3. **After the agent completes**, verify that `tasks/backlog.md` was updated if
   any changes were made (add, update, groom).

4. **Auto-commit all backlog changes.** If any files were created or modified
   (task files in `tasks/backlog/`, `tasks/backlog.md`), you MUST commit them
   immediately — never leave backlog changes uncommitted. Use a commit message
   like `chore(backlog): add task NNN — <short title>` or
   `chore(backlog): update task NNN — <what changed>`. Stage only the
   backlog-related files (`tasks/backlog.md`, `tasks/backlog/*.md`).

4b. **Auto-sync to GitHub Issues — NON-NEGOTIABLE.** After committing backlog
   changes from `add`, `update`, `groom`, or any sub-command that mutates
   task files, you MUST run the sync script. This is not conditional on the
   PO agent reminding you — YOU (the orchestrator) own this step. Missing
   the sync creates silent divergence between filesystem and GitHub, which
   the user only discovers hours later.

   **Verification checklist before ending the turn:**
   - [ ] Did this turn create or modify any file in `tasks/backlog/`?
   - [ ] Did this turn modify `tasks/backlog.md`?
   - [ ] If yes to either → did you run `sync-to-github.py --id NNN`?
   - [ ] Did the script report "Created" or "Updated" successfully?

   If you skipped the sync, run it now before responding to the user.

   Run:

   ```bash
   # Sync only the affected task (faster)
   python3 .claude/skills/backlog/scripts/sync-to-github.py --id NNN

   # Or sync all tasks (after groom)
   python3 .claude/skills/backlog/scripts/sync-to-github.py
   ```

   This is a one-way push (MD → GitHub). The script is idempotent: it uses
   `backlog/NNN` labels to detect existing issues and updates them in place.
   On `add`, sync only the new task. On `update`/`groom`, sync the affected
   tasks. The `sync` sub-command (see Quick Reference) runs a full sync.

   **Note on GitHub tooling:** The sync script uses `gh` CLI (via subprocess)
   because it requires custom GraphQL mutations (`addBlockedBy` Relationships
   API, Project V2 field writes) not exposed by the GitHub MCP. For simple
   one-off operations (reading an issue, adding a comment), prefer the MCP
   tools (`mcp__github__issue_write`, `mcp__github__list_issues`) if active.
   Check availability with `ToolSearch("select:mcp__github__issue_write")`.

5. **If the user selects a task**, the PO generates a business brief
   automatically and:
   - For SpecKit tasks: the brief is embedded in the spec
   - For direct tasks: the brief is provided to the developer as context

## Quick Reference

```text
/backlog              — View the full backlog
/backlog next         — What should I work on next? (with workflow advice)
/backlog add <title>  — Add a new task
/backlog update <id>  — Update task status/priority
/backlog estimate <id> — Get complexity estimate
/backlog status       — Dashboard summary
/backlog groom        — Full grooming session
/backlog brief <id>   — Generate business brief for developers
/backlog sync         — Push all tasks to GitHub Issues + Project #3 Kanban
/backlog sync <id>    — Push a single task (e.g., /backlog sync 065)
/backlog <id>         — View task details (e.g., /backlog 15)
```
