# Plan: the Cloud backend's view.sh prints the creation time (#740)

## Task and out of scope

`plan`, `resume` and `groom` read an item's creation time from the backend's `view.sh`. The GitHub
script prints it first; the Cloud script prints nothing, so those phases have no time to read on
that backend. After this change `view.sh <n>` prints `created:<TAB><ISO-8601>` as its first line.

The versioned HTTP contract names no creation-time field, and a public script may only depend on
what the contract names (constitution I and II). So the API gains a documented `createdAt` on task
objects, as other objects in the contract already carry, and lands first.

Out of scope: the `gitlab` and `local` backends, any other new contract field.

## Guardrails

| The decision                                                                                                                 | Its single home                                                                             | What would duplicate it                                                 |
| :--------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------- |
| Where the time comes from: the API's answer, never computed locally                                                          | `templates/core/skills/task/scripts/cloud/view.sh`                                          | a `date` call or a default timestamp in a script or phase               |
| A response without the field prints `created:`, a tab and `—`                                                                | same file                                                                                   | a second fallback in a phase; an exit code for an old server            |
| The line is first, ahead of any task text                                                                                    | same file, with `tests/scripts/view_sh_test.ts`                                             | a `created:` printed after the title or the body                        |
| What may print on `created:`: UTC, seconds, `Z`, or `—`. Anything else from the server is refused, and a fraction is dropped | `templates/core/skills/task/scripts/cloud/view.sh`, held by `tests/scripts/view_sh_test.ts` | a check in a phase; a value printed as the API sent it                  |
| A reader that finds `—` passes `<n>` alone and says the date filter was off                                                  | the header of `wip-audit.sh`, which `groom.md` already calls the one definition             | a rule restated in `plan.md`, `resume.md`, `groom.md` or `implement.md` |
| Field name and format on the wire                                                                                            | the API's contract header, in the private half                                              | a second spelling such as `created_at` or an epoch number               |

New script or helper: none. `jq_lf` and `cloud_curl` are reused as they are.

Constitution: I and II hold, because the script reads a named contract field only, and landing order
is API, then CLI, then pointer (IV). An old server is safe: the fallback line is what it gets.

Surfaces: the Cloud `view.sh` output and one additive field on a versioned API.

**Surfaces added or widened: one new untrusted input, and a public interface.** The server's string
is new input that a phase turns into a command argument, and the output of a scaffolded script
changes. The audit found this past the threshold for a full plan; this document is that plan. The
validator in `view.sh` bounds the input: `cloud_curl`'s normalisation (`CLOUD_JSON`) makes it one
plain line, and the shape check leaves only digits and fixed separators.

Readers: `plan`, `resume`, `groom`, `implement`. Parsers of the old first line: none found.

Touched, with `wc -l` before the change: `cloud/view.sh` 25, `backlog.md` 278 (and its plugin
mirror), `phases/plan.md` and `phases/implement.md` (one pointer each, with their mirrors),
`wip-audit.sh` 155, `tests/scripts/view_sh_test.ts` 94, `tests/scripts/cloud_stub.ts` 44,
`tests/scripts/cloud_stub_server.ts` 76, `tests/scripts/cloud_curl_test.ts` 319 (target 300; its
harness moves to `cloud_stub.ts`, so it shrinks), and the regenerated `src/templates_bundle.ts`.

## Done, as runnable checks

- `tests/scripts/view_sh_test.ts`: first line; position ahead of a task whose body holds a
  `created:` line; a response without the field; each observed red first.
- `tests/scripts/view_sh_test.ts`: a millisecond value, whole seconds, and each refused value (a
  command substitution, a leading dash, a number, an object, `false`, an empty string) with exit 0.
- `tests/scripts/cloud_curl_test.ts` still green, with `createdAt` in its dirty answer so the
  normalisation check exercises the new line.
- `deno task test` with the task's permissions; `scripts/smoke/audit.sh` is not needed, no template
  path is added.
- An older API answers without the field, and gets the `—` line.

## Audit findings

### Architecture

Accepted:

- One shape on every backend, translated in `view.sh`; the Cloud stub serves a millisecond value.
- A reader rule for `—`, homed in the `wip-audit.sh` header.
- The dirty stub answer carries `createdAt`. `cloud_curl_test.ts` may not grow, so its harness moves
  to `cloud_stub.ts`.
- Scope is every task read; create and update acknowledgements are excluded.

### Security

Accepted:

- "Surfaces: none" was wrong: this is new untrusted input that reaches an agent-composed command.
  Bounded by the validator in `view.sh`, in the shell rather than in the normalising jq filter.
- The brief credited `jq_lf`; the normalisation is `CLOUD_JSON` in `cloud_curl`. Corrected.

Clean, per the seat: terminal escapes, a forged extra line, the `wip-audit.sh` argument and
arithmetic contexts; a false date is bounded by a hostile server already owning the board.

## Open questions

None.
