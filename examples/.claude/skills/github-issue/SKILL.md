---
name: github-issue
description: Create, list, and close GitHub issues from task descriptions or AI conversation context. Use when the user asks to "create an issue", "open an issue", "github issue", "push this task as an issue", or "create issues for Copilot".
---

# GitHub Issue — Create Issues from Tasks & Conversations

Create well-structured GitHub issues from task descriptions, AI conversation context, or ad-hoc requests. Designed to produce issues that are detailed enough for GitHub Copilot to pick up via a linked pull request.

## When to Use

- When the user describes a task and wants it tracked as a GitHub issue
- After an AI conversation where a feature or fix was discussed but not implemented
- When the user wants to batch-create issues from a list of tasks
- When the user wants to close or clean up issues

## Tool Priority — MCP first, gh CLI fallback

**Always check if the GitHub MCP is available before falling back to scripts.**

| Method | When to use |
|--------|-------------|
| `mcp__github__issue_write` | **Preferred** — MCP is active in the session (check deferred tools list) |
| `mcp__github__list_issues` / `mcp__github__search_issues` | **Preferred** — MCP active |
| `bash .claude/skills/github-issue/scripts/*.sh` | Fallback when MCP is not loaded |

To check if MCP is available, use `ToolSearch` with `query: "select:mcp__github__issue_write"`. If the tool loads, use it. If not, fall back to the `gh` CLI scripts below.

**Why MCP first?** Structured responses (no text parsing), better error handling, type-safe, direct API access. The `gh` CLI is always available as a fallback and is required for custom GraphQL operations (e.g., `addBlockedBy` Relationships API) not exposed by the MCP.

### Creating an Issue via MCP (preferred)

```
mcp__github__issue_write({
  owner: "owner",
  repo: "repo",
  title: "feat: add dark mode toggle",
  body: "## Context\n...\n## Acceptance Criteria\n- [ ] ...",
  labels: ["enhancement", "frontend"]
})
```

### Listing Issues via MCP (preferred)

```
mcp__github__list_issues({ owner, repo, state: "open", per_page: 10 })
mcp__github__search_issues({ query: "repo:owner/repo label:bug is:open" })
```

## Prerequisites (for gh CLI fallback)

- `gh` CLI installed and authenticated (`gh auth status`)

## Procedure

### Creating an Issue

When the user describes a task or asks to create an issue, execute the **create-issue.sh** script:

```bash
# Interactive — Claude builds title and body from conversation context
bash .claude/skills/github-issue/scripts/create-issue.sh \
  --title "feat: add dark mode toggle to settings page" \
  --body "$(cat <<'EOF'
## Context

This task was identified during a conversation about improving the UI/UX of the settings page.

## Description

Add a dark mode toggle switch to the user settings page. The toggle should:
- Persist the preference in the user's profile
- Apply the theme change immediately without page reload
- Default to the system preference if no user preference is set

## Acceptance Criteria

- [ ] Toggle component renders on settings page
- [ ] Theme preference is saved to the database
- [ ] Theme applies immediately on toggle
- [ ] System preference is used as default

## Technical Notes

- Use the existing `useTheme` hook
- Store preference in `users.theme_preference` column (needs migration)
- Leverage Tailwind dark mode classes

---
*Created from AI conversation context*
EOF
)" \
  --label "enhancement" \
  --label "frontend"
```

### How to Build the Issue Body

When creating an issue from conversation context, Claude MUST structure the body as follows:

1. **Context** — Why this issue exists (conversation summary, user request, bug report)
2. **Description** — What needs to be done, written clearly enough for Copilot to understand
3. **Acceptance Criteria** — Checkboxes defining "done"
4. **Technical Notes** — Implementation hints: relevant files, patterns, constraints
5. **Footer** — `*Created from AI conversation context*`

This structure is critical — it gives GitHub Copilot enough context to generate a meaningful PR.

### Listing Issues

```bash
# List open issues (default: 10)
bash .claude/skills/github-issue/scripts/list-issues.sh

# List more issues
bash .claude/skills/github-issue/scripts/list-issues.sh --limit 25

# Filter by label
bash .claude/skills/github-issue/scripts/list-issues.sh --label "bug"

# Filter by assignee
bash .claude/skills/github-issue/scripts/list-issues.sh --assignee "@me"
```

### Closing an Issue

```bash
# Close by number
bash .claude/skills/github-issue/scripts/close-issue.sh 42

# Close with a reason
bash .claude/skills/github-issue/scripts/close-issue.sh 42 --reason "completed"

# Close as not-planned
bash .claude/skills/github-issue/scripts/close-issue.sh 42 --reason "not planned"

# Delete an issue (requires admin)
bash .claude/skills/github-issue/scripts/close-issue.sh 42 --delete
```

## Copilot Workflow

The intended workflow is:

```
Conversation with AI  →  /github-issue  →  Issue created
                                               ↓
                                         Create branch & PR
                                               ↓
                                         Copilot picks up the issue
                                               ↓
                                         Review & merge
```

To maximize Copilot's effectiveness, ensure:
- The issue title starts with a conventional prefix (`feat:`, `fix:`, `refactor:`, `docs:`)
- Acceptance criteria are explicit checkboxes
- Technical notes reference real file paths and patterns from the codebase

## Edge Cases

- If MCP is not active, fall back to the `gh` CLI scripts — never fail silently
- If `gh` is not authenticated either, prompt the user to run `gh auth login`
- If no title is provided, Claude MUST generate one from the conversation context
- If no labels exist in the repo, skip labeling gracefully
- If the issue already exists (duplicate title check), warn the user before creating
- For operations not covered by MCP (GraphQL mutations like `addBlockedBy`), always use `gh api graphql`
