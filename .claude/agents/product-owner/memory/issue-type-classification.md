---
name: issue-type-classification
description: How to set native GitHub Issue Types (Task/Bug/Feature) on mkrlabs/specflow issues — use set-field.sh, which PATCHes the REST issues API
type: reference
---

## Contract

Setting Issue Type is mandatory on every created or clarified issue, alongside Size, Priority, and a label.

## Mechanism

**Use `set-field.sh <num> IssueType <Task|Bug|Feature>`** — as of epic #241 the
helper handles it in one call. Same exit-code contract as Priority/Size:
`0` ok, `10` repo/org has no such native type, `11` value unrecognised,
`12` issue not found.

Under the hood it does a single REST PATCH (`gh issue edit --type` is not in
the pinned CLI version). REST takes the type **name** directly — no org/issue
node-ID resolution, ~1 quota point vs the GraphQL `updateIssue` path:

```bash
gh api -X PATCH repos/mkrlabs/specflow/issues/<N> -f type=Feature --jq '.type.name'
# read the current type:
gh api repos/mkrlabs/specflow/issues/<N> --jq '.type.name'
```

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
