---
name: backlog
description: Manage this project's backlog — add, list, view, move, and clarify items. The backend is fixed at init time and recorded in `.specflow/installed.lock`. Run `specflow upgrade --backlog <new>` to switch.
argument-hint: [list|next|add|update|estimate|status|groom|brief] [args]
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

### Two paths to GitHub: MCP (preferred) and shell (always available)

Two ways to talk to GitHub from this project. Pick whichever fits your
setup; the skill works either way.

#### A. GitHub MCP — preferred when available

If the **GitHub MCP server is wired up in Claude Code**, the PO
subagent should call its tools directly: `mcp__github__issue_write`,
`mcp__github__issue_read`, `mcp__github__add_issue_comment`,
`mcp__github__list_issues`, `mcp__github__search_issues`, etc. They
return structured data, no shell parsing needed.

Two ways to enable the GitHub MCP:

1. **Claude Code cloud connector (recommended)** — open a Claude Code
   session in this project, run `/mcp`, choose **GitHub**, and complete
   the OAuth flow. No file lives in this repo for that — it's stored
   in your Claude Code account.

2. **Self-hosted MCP** — add the official server to the project's
   `.mcp.json` (creates the file if absent). Specflow does NOT scaffold
   this for you because it requires Node + a GitHub token; do it
   manually:

   ```json
   {
     "mcpServers": {
       "github": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-github"],
         "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
       }
     }
   }
   ```

   Then restart your Claude Code session.

#### B. Shell scripts — always available

The `gh` CLI scripts under `.specflow/scripts/backlog/` are scaffolded
unconditionally and work without MCP. They wrap `gh issue` / `gh
project` calls and read configuration from `backlog-config.yml`.

```bash
.specflow/scripts/backlog/list.sh [Status]            # all items, optional Status filter
.specflow/scripts/backlog/view.sh <number>            # one issue + comments
.specflow/scripts/backlog/add.sh "<title>" [body] [labels-csv]
.specflow/scripts/backlog/move.sh <number> <Status>   # sets Project Status field
.specflow/scripts/backlog/clarify-comment.sh <num> "<question>"
.specflow/scripts/backlog/detect-fields.sh                                 # discover native Priority/Size single-select fields → env lines
.specflow/scripts/backlog/set-field.sh <num> <Priority|Size> <value>       # set the native Project V2 field; exit codes 10/11/12 signal label fallback
```

For closing or editing, use `gh` directly:

```bash
gh issue close  <num> --repo <repo> --reason completed     # or not_planned
gh issue edit   <num> --repo <repo> --title "…" --body "…"
```

#### Decision rule for the PO subagent

When dispatched, the PO checks tool availability at runtime:

1. If `mcp__github__*` tools are visible in the session, prefer them.
2. Otherwise fall back to the shell scripts.

This means a project can switch from shell to MCP (or back) without any
Specflow change — the skill is path-aware.

### Conventions

- **Titles** — short imperative phrases. Lowercase OK; no leading emoji.
- **Bodies** — `## Why` / `## Acceptance criteria` / `## Out of scope`.
- **Closing** — close the issue (don't just move to Done). The repo's
  issue history is the audit trail.
- **Drafts** are not used. Every task is a real issue.
- **Priority / Size** — when the project has native single-select
  `Priority` and/or `Size` fields, prefer `set-field.sh` over text
  labels. Non-zero exit codes tell the caller when to fall back to
  labels: `10` = no such field on the project, `11` = field exists but
  the value option is missing (e.g. `priority:P3` on a 3-level field),
  `12` = issue not on the project.

### Prerequisites

For the **shell path**: the `gh` CLI must be authenticated with the
`project` scope. If `gh project` returns 404, run
`gh auth refresh -s project`.

For the **MCP path**: see "Two paths to GitHub" above.
<!-- END: backend=github -->

<!-- BEGIN: backend=gitlab -->
## Backend: GitLab Issues + scoped Status labels

This project's backlog lives on GitLab Issues, with workflow state
tracked via scoped labels (`Status::Backlog`, `Status::Ready`,
`Status::"In progress"`, `Status::"In review"`, `Status::Done`).
GitLab doesn't have a Project Status field equivalent to GitHub's
Projects V2 — scoped labels are the canonical way to model kanban-
style state on GitLab.

Configuration is read from `.specflow/backlog-config.yml` at runtime —
fill in `host` and `project_id` before running any mutation.

### Configuration file

```yaml
# .specflow/backlog-config.yml
host: gitlab.com         # or your self-hosted instance
project_id: ""           # numeric id (e.g. "12345") or path "group/project"
```

### Scripts (preferred path)

```bash
.specflow/scripts/backlog/list.sh [Status]            # all issues, optional Status:: filter
.specflow/scripts/backlog/view.sh <number>            # one issue + comments
.specflow/scripts/backlog/add.sh "<title>" [body] [labels-csv]
.specflow/scripts/backlog/move.sh <number> <Status>   # swaps the Status:: label
.specflow/scripts/backlog/clarify-comment.sh <num> "<question>"
```

For closing or editing, use `glab` directly:

```bash
glab issue close   <num> --repo <project_id>
glab issue update  <num> --repo <project_id> --title "…" --description "…"
```

### Conventions

- **Titles** — short imperative phrases. Lowercase OK; no leading emoji.
- **Bodies** — `## Why` / `## Acceptance criteria` / `## Out of scope`.
- **Status** — set by adding/swapping a `Status::*` scoped label.
  Scoped labels are mutually exclusive on the same scope, so swapping
  is atomic.
- **Closing** — close the issue (don't just move to Done). The repo's
  issue history is the audit trail.
- **Drafts** are not used. Every task is a real issue.

### Prerequisites

The `glab` CLI must be installed and authenticated.

- Install: https://gitlab.com/gitlab-org/cli
- Authenticate: `glab auth login` (use the same host as in
  `backlog-config.yml`)

The first time the PO runs against this project, it will create the 5
`Status::*` scoped labels if they don't exist (`Backlog`, `Ready`,
`In progress`, `In review`, `Done`).
<!-- END: backend=gitlab -->

## When NOT to use this skill

- The user is implementing a backlog item — that's normal coding work;
  return here only when they want to update its status afterwards.
- The user asks about another project's backlog — this skill is wired to
  this project only.
