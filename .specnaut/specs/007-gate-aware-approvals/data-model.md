# Data Model: Gate-aware approval STOPs + headless VM mode

No persistence, no new types. The shapes are the two approval decisions (from the public contract)
and the chain's resume/halt control.

## Approval decisions (contract value objects)

```jsonc
// plan_approval / merge_approval answer (docs/api/gates.md)
{ "approved": true,  "note": "optional" }   // approve
{ "approved": false, "note": "revise X" }   // reject / comment-and-revise
```

Payloads raised by the chain:

```jsonc
// plan checkpoint
{ "summary": "<plan summary>", "planRef": "<spec/plan path>", "context": "<short>" }
// merge checkpoint (STOP #2)
{ "summary": "<change summary>", "prUrl": "<pr or diff ref>", "context": "<short>" }
```

## Checkpoint control table

| Checkpoint               | Gate             | `specflow gate raise` exit / answer | Chain action                                             |
| ------------------------ | ---------------- | ----------------------------------- | -------------------------------------------------------- |
| Plan (remote)            | `plan_approval`  | exit 0 + `{approved:true}`          | resume → `tasks`                                         |
| Plan (remote)            | `plan_approval`  | exit 0 + `{approved:false,note}`    | halt + report note (revise)                              |
| Merge / STOP #2 (remote) | `merge_approval` | exit 0 + `{approved:true}`          | run `/specflow merge`                                    |
| Merge / STOP #2 (remote) | `merge_approval` | exit 0 + `{approved:false,note}`    | halt on branch + report                                  |
| Either (remote)          | —                | exit 3/4 (timeout/cancelled)        | halt cleanly with the reason                             |
| Either (remote)          | —                | exit 5 (no prereqs)                 | report `specflow cloud login`, fall back to local prompt |
| Either (off)             | —                | (no gate raised)                    | current local behaviour verbatim                         |

Invariant: the chain advances past a STOP only on `exit 0 && approved === true`. Every other path
halts — never auto-approve.
