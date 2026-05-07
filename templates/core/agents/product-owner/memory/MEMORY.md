# Product Owner agent memory

Index of persistent notes for the `product-owner` subagent. Each entry below
points to a single-topic Markdown file in this same directory.

**Format:** `- [Title](file.md) — one-line hook describing why this is worth remembering`

**Keep the index under 200 lines.** Prune entries that are no longer
load-bearing — once a decision is encoded in `AGENTS.md` or in a closed
ticket, the memory entry can be retired.

## When to add an entry here

Add a new memory file when the PO discovers something that should survive
across sessions and isn't captured elsewhere:

- Recurring backlog conventions specific to this project (label taxonomy,
  body shape preferences, escalation patterns).
- Stakeholder preferences ("Kevin always wants AC bullets to start with
  testable verbs").
- Incidents and their resolutions ("when `gh` returns 404 on a project
  command, refresh the auth token with `gh auth refresh -s project`").
- External-tracker quirks (project field IDs that drift, GraphQL
  endpoints that misbehave in some account contexts).

## When NOT to add an entry

- Project-vision-level facts → those go in `AGENTS.md`.
- One-off facts about a single ticket → those go in the ticket body.
- Anything derivable from `gh` / `git log` — the PO can re-query.

## Entries

<!-- (this stub starts empty — the PO populates it as it learns) -->
