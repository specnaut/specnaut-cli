---
name: issue-type-classification
description: How to set native GitHub Issue Types (Task/Bug/Feature) on mkrlabs/specflow issues — gh issue edit --type is not supported; use GraphQL updateIssue mutation
type: reference
---

## Contract

Setting Issue Type is mandatory on every created or clarified issue, alongside Size, Priority, and a label.

## Mechanism

**Use `set-field.sh <num> IssueType <Task|Bug|Feature>`** — as of epic #241 the
helper wraps the whole flow (resolves the org type ID, resolves the issue node
ID, runs the mutation). Same exit-code contract as Priority/Size: `0` ok,
`10` org has no such type, `11` value unrecognised, `12` issue not found.

Under the hood it runs the `updateIssue` GraphQL mutation, since
`gh issue edit --type` is not supported in the pinned CLI version:

```bash
gh api graphql -f query='
mutation($issueId: ID!, $issueTypeId: ID!) {
  updateIssue(input: {id: $issueId, issueTypeId: $issueTypeId}) {
    issue { number issueType { name } }
  }
}' -f issueId="<node-id>" -f issueTypeId="<type-node-id>"
```

## mkrlabs org issue type IDs (verified 2026-05-14)

| Type    | ID                    |
|---------|-----------------------|
| Task    | `IT_kwDOBv46cs4BE7za` |
| Bug     | `IT_kwDOBv46cs4BE7zd` |
| Feature | `IT_kwDOBv46cs4BE7ze` |

## Classification heuristics

- **Feature** — new capability, new behavior, agent evolution, new command/flag.
- **Task** — internal work, docs-only, refactors, sync/bundle steps, test verification.
- **Bug** — unexpected behavior, regression, incorrect output.

## Mandatory classification checklist (every create or clarify)

1. `set-field.sh <num> Size <XS|S|M|L|XL>`
2. `set-field.sh <num> Priority <P0|P1|P2|P3>`
3. `set-field.sh <num> IssueType <Task|Bug|Feature>`
4. `gh issue edit --add-label <label>` (from: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix)
5. `move.sh <num> Ready` (only after body has ## Why / ## AC / ## Out of scope)

All five steps before final report. No exceptions.
