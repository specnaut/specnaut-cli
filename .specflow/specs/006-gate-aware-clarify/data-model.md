# Data Model: Gate-aware clarify phase

No persistence. The new shapes are the parser intent and the command's I/O contract.

## GateIntent (parser)

```ts
{
  kind: "gate";
  sub: "status" | "raise" | "cancel";
  apiUrl: string | null;       // --api-url override (else read from backlog-config.yml)
  // raise:
  type?: string;               // --type (clarification|decision|plan_approval|merge_approval|agent_unblock)
  title?: string;              // --title
  payload?: string;            // --payload (raw JSON string; parsed in the handler)
  task?: number;               // --task (optional task number)
  // cancel:
  id?: string;                 // positional gate id
}
```

## Command I/O contract (the phase↔CLI surface)

| Command            | stdout (success)                                                 | exit codes                                                                |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `gate status`      | `{ "enabled": true, "remote": true }`                            | `0` remote on · `2` off · `5` not Cloud-linked                            |
| `gate raise …`     | the answer JSON, e.g. `{ "text": "…" }` or `{ "choiceId": "B" }` | `0` answered · `3` unresolved · `4` cancelled · `5` no_remote · `1` other |
| `gate cancel <id>` | `{ "state": "cancelled" }`                                       | `0` ok · `1` error                                                        |

Mapping to #357 `ResolutionOutcome`: `answered→0`, `unresolved→3`, `cancelled→4`,
`error{no_remote}→5`, any other `error→1`. The answer JSON is the gate's `answer` object verbatim
(public wire fields only).

## Question → gate mapping (clarify phase)

| Clarify question form         | Gate `type`     | payload                                                     | answer read                      |
| ----------------------------- | --------------- | ----------------------------------------------------------- | -------------------------------- |
| Multiple-choice (2–5 options) | `decision`      | `{ question, options:[{id,label,description?}], context? }` | `answer.choiceId` → option label |
| Free-form (≤5 words)          | `clarification` | `{ question, context? }`                                    | `answer.text`                    |

The phase builds `options[]` from its A/B/C table (id = the letter, label = the option text), raises
the gate, and on exit 0 reads the answer JSON to obtain the chosen option / text, then integrates it
with the existing Clarifications rules.
