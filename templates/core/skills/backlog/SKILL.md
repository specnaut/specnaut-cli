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
.specflow/scripts/backlog/set-field.sh <num> <Priority|Size|IssueType> <value>  # set the native Project V2 field / org Issue Type; exit codes 10/11/12 signal label fallback
.specflow/scripts/backlog/ensure-labels.sh                                 # idempotently bootstrap the 7 Specflow semantic labels (security/refactor/docs/tech-debt/dx/performance/dependency)
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
- **Classification is mandatory — every created or clarified item
  exits with Size, Priority, Issue Type, and at least one label.**
  `Priority` / `Size` are native Project V2 single-select fields;
  `Issue Type` (`Task` / `Bug` / `Feature`) is a native org-level
  concept. Write all three through `set-field.sh` and **NEVER also
  apply a matching `priority:*` / `size:*` / `type:*` label on an item
  that already carries the native field or type** — that dual-signal
  drift is exactly what the helper exists to prevent. Labels are
  reserved as a strict fallback for projects / orgs without the native
  field or type. Non-zero exit codes tell the caller which fallback
  applies: `10` = field / type absent (use the label), `11` = present
  but the value is unrecognised (for Priority/Size, add the option to
  the field then re-run; for Issue Type, fix the call), `12` = issue
  not on the project / not in the repo.

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

## Epics & sub-tasks

Big work that needs decomposition lives as a parent **epic** with one or
more **sub-tasks**. The link mechanism differs per backend, but the PO
contract is the same: parents cannot close while any child is open.

| Backend | Parent → child link | Discoverability |
|---|---|---|
| local | `parent: "#NNN"` in the child's frontmatter, plus a `## Sub-tasks` cross-link added to the parent file's body | `grep -l 'parent: "#042"' .specflow/backlog/*.md` lists every child of #042 |
| github | Native sub-issues API (`gh api -X POST .../issues/<parent>/sub_issues`) | Project V2 boards render the children automatically under the parent's `Sub-issues progress` field |
| gitlab | Scoped label `parent::#NNN` on the child (Free-tier compatible; native Epics are Premium-only) | `glab issue list --label "parent::#042" --opened` lists every child of #042 |

**Creating a child:** `add.sh --parent <num>` does the right thing on
every backend — writes the link, attaches to the project/board, and
fails fast if the named parent doesn't exist (exit 3).

**Closing a parent:** `cascade-check.sh <num>` (github + gitlab) is the
close gate — exits 11 with the open children listed when close is
unsafe, exits 0 when all children are closed. The PO must run it before
`gh issue close` / `glab issue close`. The local backend uses an
inline grep equivalent.

**Auto-detection:** the bundled `product-owner` agent proactively
detects epic-worthy requests (>5 AC bullets, scope crosses ≥2
subsystems, trigger phrases like "break down" / "phased" / "as an
epic") and either auto-decomposes or proposes a concrete sub-task list
— see the "Epic detection heuristic" section in
`.claude/agents/product-owner.md`.

## When NOT to use this skill

- The user is implementing a backlog item — that's normal coding work;
  return here only when they want to update its status afterwards.
- The user asks about another project's backlog — this skill is wired to
  this project only.
