---
name: backlog
description: Manage Specflow's product backlog directly on GitHub Project #4 ("Specflow", org mkrlabs). Spans three repos — `specflow`, `specflow-cloud`, `specflow-monorepo` — that all feed the same board. Use when the user asks to "list the backlog", "add to the backlog", "what's next", "move task X to in-progress / done", "open an issue for Y", or any backlog/project management on these repos. Source of truth is GitHub — there is no local markdown copy.
allowed-tools: Bash(gh *) Bash(${CLAUDE_SKILL_DIR}/scripts/*.sh) Bash(jq *) Bash(column *) Bash(sort *)
---

# Backlog skill — Specflow (GitHub Project #4)

The backlog lives on **GitHub Project #4 "Specflow"** (org-owned by `mkrlabs`), backed by issues in **three linked repos: `mkrlabs/specflow`, `mkrlabs/specflow-cloud`, `mkrlabs/specflow-monorepo`**. All three feed the same board with the same Status / Priority / Size / IssueType fields. There is no local markdown mirror. Everything goes through `gh` CLI — wrappers in `scripts/` cover the common cases; raw `gh api graphql` is documented below for one-offs.

## All mutations go through the Product Owner agent

The main session does not call `add.sh`, `move.sh`, `clarify-comment.sh`, or `gh issue {create,close,edit}` against this repo directly. **Dispatch the `product-owner` subagent** for any mutation: creating issues, clarifying bodies, moving status columns, closing items. The PO is the single owner of the backlog lifecycle (see `.claude/agents/product-owner.md`).

This skill's scripts are the **toolbox** the PO uses. The main session may call the read-only ones (`list.sh`, `view.sh`) directly to inspect state, but every write goes through the PO.

## Project handles

| Thing           | Value                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| Linked repos    | `mkrlabs/specflow` · `mkrlabs/specflow-cloud` · `mkrlabs/specflow-monorepo`                             |
| Project number  | `4` (owner: `mkrlabs`, org-owned)                                                                       |
| Project node ID | `PVT_kwDOBv46cs4BV4Gz`                                                                                  |
| Status field ID | `PVTSSF_lADOBv46cs4BV4GzzhRQrX8`                                                                        |
| Status options  | Backlog `f75ad846` · Ready `61e4505c` · In progress `47fc9ee4` · In review `df73e18b` · Done `98236657` |

If the project layout changes, refresh with:

```bash
gh project field-list 4 --owner mkrlabs --format json | jq '.fields[] | select(.name=="Status")'
gh project view 4 --owner mkrlabs --format json | jq '.id'
```

## Scripts (preferred path)

Every script accepts an optional `--repo <short>` flag where `<short>` is one of `specflow` (default), `specflow-cloud`, `specflow-monorepo`. Owner is always `mkrlabs`. `list.sh` is the exception — it queries all three repos by default and `--repo` filters down to one.

```bash
.claude/skills/backlog/scripts/list.sh                                              # all repos, every open item not in Done
.claude/skills/backlog/scripts/list.sh Backlog                                      # all repos, filter by Status
.claude/skills/backlog/scripts/list.sh --repo specflow-cloud Ready                  # one repo, filter by Status
.claude/skills/backlog/scripts/view.sh [--repo <short>] <issue-number>              # one item + comments
.claude/skills/backlog/scripts/add.sh [--repo <short>] "<title>" [body] [labels]    # creates issue + attaches to project
.claude/skills/backlog/scripts/move.sh [--repo <short>] <issue-number> <Status>     # Status = Backlog|Ready|"In progress"|"In review"|Done
.claude/skills/backlog/scripts/clarify-comment.sh [--repo <short>] <issue> "<msg>"  # leave a question on the issue
.claude/skills/backlog/scripts/set-field.sh [--repo <short>] <issue> <Priority|Size|IssueType> <value>  # set native classification — see "Classification" below
```

For closing or editing, just use `gh` directly — no wrapper needed:

```bash
gh issue close  <num> --repo mkrlabs/<short> --reason completed     # or not_planned
gh issue reopen <num> --repo mkrlabs/<short>
gh issue edit   <num> --repo mkrlabs/<short> --title "…" --body "…" --add-label "…" --remove-label "…"
```

## API quota — prefer REST/CLI over raw GraphQL

GitHub's GraphQL and REST APIs share the same 5,000-points-per-hour authenticated quota, but complex GraphQL queries score much higher per call than REST/CLI equivalents. Past versions of these scripts ran hand-rolled `repository.issues[].projectItems[].fieldValues[]` queries that were the main rate-limit offender; the current scripts use `gh issue list/view --json projectItems` (the gh CLI's REST-ish JSON projection, ~1–2 points per call) for read paths and reserve raw `gh api graphql` only for surfaces with no CLI equivalent (`updateProjectV2ItemFieldValue` mutations, exposed via `gh project item-edit`, and the small targeted item-ID lookup in `move.sh` / `set-field.sh`).

Order of preference for any new backlog tool: `gh issue` / `gh project item-edit` CLI → `mcp__github__*` REST tools (agent context) → small targeted `gh api graphql` only when no CLI/MCP equivalent exists.

## Conventions

- **Titles** — short imperative phrases ("Add docx skill", not "I want to add a docx skill"). Lowercase OK; no leading emoji.
- **Bodies** — once clarified, follow `## Why` / `## Acceptance criteria` / `## Out of scope` / optional `## Notes`. Keep it tight: half a page beats a vague essay.
- **Labels** — at least one classifying label per item, from the default GitHub label set. See "Classification" below.
- **Drafts** (project items with no underlying issue) are not used. Every task is a real issue.
- **Closing** — close the issue, don't just move to Done. The repo's issue history is the audit trail.

## Classification — mandatory on every item

Every issue the PO creates or clarifies MUST exit with all four axes set — this is a gate, not polish:

| Axis | How | Values |
| --- | --- | --- |
| Size | `set-field.sh <num> Size <value>` | `XS` `S` `M` `L` `XL` |
| Priority | `set-field.sh <num> Priority <value>` | `P0` `P1` `P2` `P3` |
| Issue Type | `set-field.sh <num> IssueType <value>` | `Task` `Bug` `Feature` |
| Label | `gh issue edit <num> --add-label <label>` | default GitHub label set only |

`Priority` / `Size` are native Project #4 single-select fields; `Issue Type` is a native `mkrlabs`-org concept. `set-field.sh` writes all three — **never** also apply a `priority:*` / `size:*` / `type:*` label on an item that already carries the native field or type. `set-field.sh` exit codes: `0` ok · `10` field/type absent (fall back to a label) · `11` value unrecognised · `12` issue not on the project / repo.

## When NOT to use this skill

- The user is implementing a backlog item — that's normal coding work; only return here when they want to update the item's status afterwards.
- The user asks about a backlog outside the three `mkrlabs/specflow*` repos — this skill is hard-wired to Project #4.

## Troubleshooting

- `gh: Not Found (HTTP 404)` on a project command → confirm `gh auth status` shows the `project` scope. If missing: `gh auth refresh -s project`.
- An issue is on the repo but not on the project board → `gh project item-add 4 --owner mkrlabs --url <issue-url>` (the underlying call works even though `item-list` may not).
- The Status field/option IDs above don't match a query result → the project layout was edited; refresh with the commands at the top of this file and update both the table and `scripts/move.sh`.
