# /task — backlog verbs

`list`, `next`, `add`, `edit`, `close`, `estimate`, `status`, `brief` and `<id>`. The router
(`SKILL.md`, beside this file) dispatched here; `groom` has its own document, `groom.md`. The
backend is fixed at init time and recorded in `.specnaut/installed.lock`; run
`specnaut upgrade --backlog <new>` to switch.

| Input | Action |
| --- | --- |
| _(empty)_ or `list` | Backlog overview |
| `next` | Recommend the top 3 items, with workflow advice |
| `add <title>` | Create an item |
| `edit <id>` | Update an existing item — title, body, status, fields |
| `close <id> [--not-planned]` | Close the item: completed by default, not planned with the flag. Reopening undoes it; nothing is deleted. |
| `estimate <id>` | Estimate complexity |
| `status` | Dashboard summary |
| `brief <id>` | Product-owner business brief |
| `<number>` | Show that item |

Every write — `add`, `edit`, `close`, `estimate` — is dispatched to the `product-owner` agent. After
one, commit the backlog changes — `chore(backlog): add task NNN — <short title>`, or
`chore(backlog): update task NNN — <what changed>`. Stage only the files the product-owner agent
reports as touched. This applies to the local backend, where the backlog is files in the repo;
remote backends have nothing to commit.

The scripts under `.specnaut/scripts/backlog/` are the toolbox the PO uses. The main session may
call the read-only ones (`list.sh`, `view.sh`) to inspect state, but every write goes through the
PO.

<!-- BEGIN: backend=local -->
## Backend: local Markdown files

| Path | Purpose |
|---|---|
| `.specnaut/backlog.md` | Top-level index — one line per item with status |
| `.specnaut/backlog/<NNN>-<slug>.md` | One file per item (frontmatter + body) |

### Scripts

```bash
.specnaut/scripts/backlog/list.sh [Status]            # all items, optional Status filter
.specnaut/scripts/backlog/view.sh <number>            # one item + body
.specnaut/scripts/backlog/add.sh "<title>" [body]     # create new item, auto-numbered
.specnaut/scripts/backlog/move.sh <number> <Status>   # Backlog|Ready|In progress|In review|Done
.specnaut/scripts/backlog/clarify-comment.sh <num> "<question>"
```

### Conventions

- `add.sh` picks the next free number (`001`, `002`, …).
- Status lives in each item's frontmatter, mirrored in the index.
- **Closing** an item = move to `Done`. The file stays on disk as the
  audit trail; nothing is deleted.
- Bodies follow `## Why` / `## Acceptance criteria` / `## Out of scope`.
- Titles are short imperatives ("Add docx skill", not "I want to add a docx skill").
<!-- END: backend=local -->

<!-- BEGIN: backend=github -->
## Backend: GitHub Issues + Project

Fill in `repo` and `project_number` in `.specnaut/backlog-config.yml` before any mutation.

### Configuration file

```yaml
# .specnaut/backlog-config.yml
repo: myorg/myproject              # GitHub repo (owner/name)
project_number: <N>                # GitHub Project V2 number
```

Both are placeholders; resolve the number with
`gh project list --owner <org>`. A wrong `project_number` is invisible to
`list.sh` / `view.sh` — they address the board through `repo:` alone — and
refused up front by every writing script.

### Scripts

```bash
.specnaut/scripts/backlog/list.sh [Status]            # all items, optional Status filter
.specnaut/scripts/backlog/view.sh <number>            # one issue + comments
.specnaut/scripts/backlog/add.sh "<title>" [body] [labels-csv]
.specnaut/scripts/backlog/move.sh <number> <Status>   # sets Project Status field
.specnaut/scripts/backlog/clarify-comment.sh <num> "<question>"
.specnaut/scripts/backlog/detect-fields.sh            # native fields → env lines
.specnaut/scripts/backlog/groom-columns.sh [--set <key> <column|none>]  # columns grooming moves between
.specnaut/scripts/backlog/set-field.sh <num> <axis> <value>  # axes + exit codes: the product-owner's classification contract
.specnaut/scripts/backlog/ensure-labels.sh            # bootstrap the semantic labels (LABELS.md)
```

For closing or editing, use `gh` directly:

```bash
gh issue close  <num> --repo <repo> --reason completed     # or not_planned
gh issue edit   <num> --repo <repo> --title "…" --body "…"
```

#### Decision rule for the PO subagent

Prefer `mcp__github__*` tools when visible, else the scripts.

### Conventions

- **Titles** — short imperative phrases. Lowercase OK; no leading emoji.
- **Bodies** — `## Why` / `## Acceptance criteria` / `## Out of scope`.
- **Closing** — close the issue (don't just move to Done). The repo's
  issue history is the audit trail.
- **Drafts** are not used. Every task is a real issue.
- **Batch every mutation — fewest requests possible.** Creating /
  moving / closing / field-setting **multiple** items goes in **one
  batched `gh api graphql` multi-alias mutation** (`m1:`, `m2:`, …), or
  the REST batch equivalent — **never call-by-call**. Gather all node /
  field / option ids in one query, then emit a single mutation. N items
  → 1–2 requests, not N. This is the default (not an optimization): it
  is what keeps grooming inside GitHub's REST + GraphQL rate limits.
  Loop the per-item scripts only for a single item.
- **Classification is mandatory — every created or clarified item
  exits with Size, Priority, Issue Type, and at least one label.**
  `Priority` / `Size` are native Project V2 single-select fields;
  `Issue Type` (`Task` / `Bug` / `Feature`) is a native org-level
  concept. Write all three through `set-field.sh` and **NEVER also
  apply a matching `priority:*` / `size:*` / `type:*` label on an item
  that already carries the native field or type** — that dual-signal
  drift is exactly what the helper exists to prevent. Labels are
  reserved as a strict fallback for projects / orgs without the native
  field or type — or *temporarily* when the platform is rate-limiting and
  a native write cannot land; the native field is always the goal, so
  reconcile a label fallback back to it once unblocked. Which exit
  code takes the label is in the product-owner's classification contract.

### Prerequisites

`gh` authenticated with the `project` scope; on a 404 from `gh project`, run
`gh auth refresh -s project`.
<!-- END: backend=github -->

<!-- BEGIN: backend=gitlab -->
## Backend: GitLab Issues + scoped Status labels

Workflow state is a scoped label (`Status::Backlog`, `Status::Ready`,
`Status::"In progress"`, `Status::"In review"`, `Status::Done`). Fill in `host` and
`project_id` in `.specnaut/backlog-config.yml` before any mutation.

### Configuration file

```yaml
# .specnaut/backlog-config.yml
host: gitlab.com         # or your self-hosted instance
project_id: ""           # numeric id (e.g. "12345") or path "group/project"
```

### Scripts

```bash
.specnaut/scripts/backlog/list.sh [Status]            # all issues, optional Status:: filter
.specnaut/scripts/backlog/view.sh <number>            # one issue + comments
.specnaut/scripts/backlog/add.sh "<title>" [body] [labels-csv]
.specnaut/scripts/backlog/move.sh <number> <Status>   # swaps the Status:: label
.specnaut/scripts/backlog/clarify-comment.sh <num> "<question>"
```

For closing or editing, use `glab` directly:

```bash
glab issue close   <num> --repo <project_id>
glab issue update  <num> --repo <project_id> --title "…" --description "…"
```

### Conventions

- **Titles** — short imperative phrases. Lowercase OK; no leading emoji.
- **Bodies** — `## Why` / `## Acceptance criteria` / `## Out of scope`.
- **Status** — swap the `Status::*` scoped label (one per scope, so atomic).
- **Closing** — close the issue (don't just move to Done). The repo's
  issue history is the audit trail.
- **Drafts** are not used. Every task is a real issue.

### Prerequisites

`glab` installed and authenticated: `glab auth login` on the host in
`backlog-config.yml`. On its first run the PO creates the five `Status::*` labels
if they are missing.
<!-- END: backend=gitlab -->

<!-- BEGIN: backend=cloud -->
## Backend: Specnaut Cloud

### Configuration file

```yaml
# .specnaut/backlog-config.yml
backend: cloud
api_url: https://api.specnaut.com               # optional — defaults to Specnaut Cloud
project_key: CLOUD                              # the project's short key
```

**No token is stored here.** `specnaut cloud login` keeps credentials in the OS
keychain (or a `0600` file under `~/.specnaut`); for CI / headless runs, set
`SPECNAUT_CLOUD_TOKEN` instead.

### Scripts

```bash
.specnaut/scripts/backlog/list.sh [Status]            # all tasks (status = column), optional filter
.specnaut/scripts/backlog/view.sh <number>            # one task (status, priority, size, body)
.specnaut/scripts/backlog/add.sh "<title>" [body]     # create a task → returns KEY-N
.specnaut/scripts/backlog/move.sh <number> <Status>   # Backlog|Ready|"In Progress"|"In Review"|Done
.specnaut/scripts/backlog/clarify-comment.sh <number> "<question>"
.specnaut/scripts/backlog/columns.sh                  # live board column layout (order + name)
.specnaut/scripts/backlog/reconcile.sh [--reset|--seek-end] [--limit N]  # drain stage transitions
```

`move.sh` takes the column **name**. `reconcile.sh` prints each stage transition
since the per-project cursor (`.specnaut/.cloud-cursor-<KEY>`) and advances it.

### Prerequisites

`curl`, `jq` and the `specnaut` CLI on PATH; `specnaut cloud login` once (or
`SPECNAUT_CLOUD_TOKEN`).

### Stage reconcile (poll model)

Run `reconcile.sh` by hand or on a cadence (no daemon, no webhook). For each line
(`CREATED <n> -> <stage>` / `MOVED <n> <from> -> <to>`) the PO resolves the
destination against `columns.sh` (case-insensitive) and runs the mapped hook:

| Destination stage | Hook |
|---|---|
| **Backlog / Ready** (incl. `CREATED`) | **Classify** — ensure priority/size/type per the mandatory classification contract; skip if already set. |
| **In Review** | *(opt-in, off by default)* post a review-readiness checklist comment. |
| **Done** | *(opt-in, off by default)* post a closing-summary comment; run the board-hygiene check. |
| **In Progress** / any unmapped column | **No-op** — never invent behaviour for an unmapped stage. |

Rules: **idempotent** (delivery is at-least-once — read `view.sh` before
writing, never double-post or re-classify); **comments are opt-in** (if the
board posts its own stage comments, leave In Review / Done off to avoid
duplicates — classification is the always-on parity behaviour); **public API
only** (act through the `*.sh` wrappers; reference only column names + task
numbers). First run replays history — `reconcile.sh --seek-end` fast-forwards
an existing board to "from now".

### Not yet on the Cloud backend

- Epics / sub-tasks and label management: use the board UI.
<!-- END: backend=cloud -->

## Epics & sub-tasks

A parent **epic** cannot close while any **sub-task** is open.

| Backend | Parent → child link | Discoverability |
|---|---|---|
| local | `parent: "#NNN"` in the child's frontmatter, plus a `## Sub-tasks` cross-link added to the parent file's body | `grep -l 'parent: "#042"' .specnaut/backlog/*.md` lists every child of #042 |
| github | Native sub-issues API (`gh api -X POST .../issues/<parent>/sub_issues`) | Project V2 boards render the children automatically under the parent's `Sub-issues progress` field |
| gitlab | Scoped label `parent::#NNN` on the child (Free-tier compatible; native Epics are Premium-only) | `glab issue list --label "parent::#042" --opened` lists every child of #042 |

**Creating a child:** `add.sh --parent <num>` on every backend — writes the link,
attaches to the board, exits 3 if the parent does not exist.

**Closing a parent:** `cascade-check.sh <num>` (github + gitlab) is the close
gate — exits 11 listing the open children, 0 when all are closed. The PO must run
it before `gh issue close` / `glab issue close`; the local backend greps instead.

**Finding a child's parent:** `parent-of.sh <num>` (github + gitlab) prints the
parent's number and exits 0, exits **10** when the item has no parent, and exits 3
when it could not ask — never treat 3 as "no parent".

**Auto-detection:** the `product-owner` agent's "Epic detection heuristic".

## When NOT to use these verbs

- The user is implementing a backlog item — that's `/task implement`; return
  here only to update the item's status afterwards.
- The user asks about another project's backlog — these verbs are wired to
  this project only.
