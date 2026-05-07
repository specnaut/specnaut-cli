---
name: backlog
description: Manage this project's backlog — add, list, view, move, and clarify items. The backend is fixed at init time and recorded in `.specflow/installed.lock`. Run `specflow upgrade --backlog <new>` to switch.
---

# Backlog skill

Use this skill when the user says "add to backlog", "list backlog", "what's
next?", "move task X to in-progress", or any backlog mutation. The exact
flow depends on the backend chosen at `specflow init` (or the most recent
`specflow upgrade --backlog <name>`).

## All mutations go through the Product Owner agent

The main session does **not** run the scripts directly. Dispatch the
`product-owner` subagent for any mutation: creating items, clarifying
bodies, moving status, closing. The PO is the single owner of the backlog
lifecycle (see `.claude/agents/product-owner.md`).

The scripts under `.specflow/scripts/backlog/` are the toolbox the PO
uses. The main session may call the read-only ones (`list.sh`, `view.sh`)
to inspect state, but every write goes through the PO.

<!-- BEGIN: backend=local -->
## Backend: local Markdown files

This project's backlog lives entirely on disk under `.specflow/`. No remote
service required.

| Path | Purpose |
|---|---|
| `.specflow/backlog.md` | Top-level index — one line per item with status |
| `.specflow/backlog/<NNN>-<slug>.md` | One file per item (frontmatter + body) |

### Scripts (preferred path)

```bash
.specflow/scripts/backlog/list.sh [Status]            # all items, optional Status filter
.specflow/scripts/backlog/view.sh <number>            # one item + body
.specflow/scripts/backlog/add.sh "<title>" [body]     # create new item, auto-numbered
.specflow/scripts/backlog/move.sh <number> <Status>   # Backlog|Ready|In progress|In review|Done
.specflow/scripts/backlog/clarify-comment.sh <num> "<question>"
```

### Conventions

- Items are numbered sequentially (`001`, `002`, …) — the `add.sh` script
  picks the next free number.
- Status is tracked in each item's YAML frontmatter and mirrored in the
  index for fast listing.
- **Closing** an item = move to `Done`. The file stays on disk as the
  audit trail; nothing is deleted.
- Bodies follow `## Why` / `## Acceptance criteria` / `## Out of scope`.
- Titles are short imperatives ("Add docx skill", not "I want to add a docx skill").
<!-- END: backend=local -->

<!-- BEGIN: backend=github -->
## Backend: GitHub Issues + Project

This project's backlog lives on a GitHub Project linked to issues in the
configured repo. Configuration is read from `.specflow/backlog-config.yml`
at runtime — fill in `repo` and `project_number` before running any
mutation.

### Configuration file

```yaml
# .specflow/backlog-config.yml
repo: myorg/myproject              # GitHub repo (owner/name)
project_number: 4                   # GitHub Project V2 number
project_node_id: ""                 # cached on first run
status_field_id: ""                 # cached on first run
```

The PO will refresh `project_node_id` / `status_field_id` automatically
on first invocation if they are blank.

### Scripts (preferred path)

```bash
.specflow/scripts/backlog/list.sh [Status]            # all items, optional Status filter
.specflow/scripts/backlog/view.sh <number>            # one issue + comments
.specflow/scripts/backlog/add.sh "<title>" [body] [labels-csv]
.specflow/scripts/backlog/move.sh <number> <Status>   # sets Project Status field
.specflow/scripts/backlog/clarify-comment.sh <num> "<question>"
```

For closing or editing, just use `gh` directly:

```bash
gh issue close  <num> --repo <repo> --reason completed     # or not_planned
gh issue edit   <num> --repo <repo> --title "…" --body "…"
```

### Conventions

- **Titles** — short imperative phrases. Lowercase OK; no leading emoji.
- **Bodies** — `## Why` / `## Acceptance criteria` / `## Out of scope`.
- **Closing** — close the issue (don't just move to Done). The repo's
  issue history is the audit trail.
- **Drafts** are not used. Every task is a real issue.

### Prerequisites

The `gh` CLI must be authenticated with the `project` scope. If
`gh project` returns 404, run `gh auth refresh -s project`.
<!-- END: backend=github -->

## When NOT to use this skill

- The user is implementing a backlog item — that's normal coding work;
  return here only when they want to update its status afterwards.
- The user asks about another project's backlog — this skill is wired to
  this project only.
