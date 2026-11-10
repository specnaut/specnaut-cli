# Plan — remove the approval-hook leftovers from the hook tests (cli#743)

Linked item: specnaut-cli#743 "Remove dead approval-hook leftovers from the hook tests" —
https://github.com/specnaut/specnaut-cli/issues/743. Branch `069-hook-test-leftovers`, base
`origin/main` @ `e42e4910`.

Brief (step 4a): test-only code and prose; no shipped file, agent surface or trust boundary changes.

## 1. Task and out of scope

Remove, from the test harness only, what served the approval hooks v9.1.0 removed — every element
the item's acceptance criteria list, each re-verified to have no reader on this base before it goes:
`stampDir`, `approve`, `stamps`, the `encodeHex` import, `Sandbox.state` and its `XDG_STATE_HOME`
entry (`tests/templates/hooks/hook_sandbox.ts`); the three `user_prompt_submit*.json` fixtures; the
`guard-merge` / `guard-release` entries of `REFUSALS` (`windows_test.ts`); the `"ask"` branch of
`verdict()` (`windows_test.ts`, `protect_generated_test.ts`); the `skills` option of `RepoOptions`;
and the three stale prose passages the item quotes.

**Out of scope** (the item names them; they stay): `makeRepo`'s `mode` argument; `guard-merge.sh` as
an example path in `protect_generated_test.ts` and `tests/scripts/backslash_path_test.ts`;
`RETIRED_HOOK_SCRIPTS` and the upgrade-removal tests; `.specnaut/specs/`.

## 2. Requirements

| Id   | Requirement                                                                                                                                        | Check                                                                                    |
| :--- | :------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| FR-1 | Each removed symbol has no reader on this base, re-verified by `git grep -n '<symbol>'` before removal; the output is recorded in the commit body. | the grep log                                                                             |
| FR-2 | No assertion is weakened: the diff deletes unreachable code and text only.                                                                         | review of the diff: no `assert*` line removed except inside a removed unreachable branch |
| FR-3 | `deno task test` green; `deno task fmt:check` and lint clean.                                                                                      | the gates                                                                                |

## 3. Guardrails

| The decision     | Its single home          | What would duplicate it                             |
| :--------------- | :----------------------- | :-------------------------------------------------- |
| Which hooks ship | `templates/` (unchanged) | a test helper modelling a hook that no longer ships |

Constitution: § I — public repo, nothing private named. **Surfaces added or widened: none** —
checked: `git diff --stat` touches only `tests/`.

## 4. Done

`deno task test` (task permissions), `deno task fmt:check`, `git status` clean afterwards. One
commit: `test(hooks): drop the approval-stamp helpers and fixtures nothing reads` with
`Closes #743`.

## 5. Audit findings

The seats were not dispatched for this item — a deviation from step 6, taken because the change is a
test-only deletion with no shipped surface; their questions are answered here, and the review seats
still run on the diff: **architecture** — no layer, port or production module touched, one home
unchanged; **security** — no trust boundary, input, secret or agent surface touched; the hook guards
themselves (`protect-generated.sh`, `guard-dispatch-model.sh`) keep every case. Both: pass.

## 6. Open questions

None.
