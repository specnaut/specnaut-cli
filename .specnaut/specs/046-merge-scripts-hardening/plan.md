# Plan: Harden the merge scripts — part A (scripts, phase docs, tests)

**Branch**: `046-merge-scripts-hardening` | **Date**: 2026-10-30 | **Backlog item**:
[specnaut-cli#711 — Harden the merge scripts: follow-ups from the cli#677 review](https://github.com/specnaut/specnaut-cli/issues/711),
child of epic #674. Part B (the hook parser items under `_simple.sh` / `_command.sh` / `guard_ieq`)
is a second branch on the same issue.

**Full plan** — the scripts push to a remote and delete directories in users' projects (step 4b).

## 1. Task and out of scope

Every MEDIUM and LOW item of #711 that touches `templates/core/specnaut/scripts/bash/`
(`base-branch.sh`, `land-feature.sh`, `epic-status.sh`, `fold-fixups.sh`, `remove-spec.sh`),
`templates/core/skills/task/scripts/*/close-shipped.sh`, the phase docs `merge.md`,
`merge-close.md`, `epic-fixups.md`, `epic-commits.md`, `_listed.sh`'s blank-line rule, and the tests
under `tests/scripts/` and the merge-doc locks. **Out**: the hook-parser items (part B), new merge
behaviour, `smoke-features.sh`'s size (#703).

## 2. Guardrails

| The decision                                  | Its single home                                                           | What would duplicate it          |
| :-------------------------------------------- | :------------------------------------------------------------------------ | :------------------------------- |
| The base branch, and that it exists on origin | `base-branch.sh`                                                          | a fallback guess in any caller   |
| Every exit a script can produce               | the script's header table; the phase doc maps it (one mapping per script) | a second, divergent table        |
| Epic vs standalone                            | `epic-status.sh` exit (merge.md step 1 calls it)                          | merge.md's own `grep '^Epic: #'` |
| remove-spec's conditions                      | `remove-spec.sh`                                                          | merge-close.md restating them    |
| close-shipped per backend                     | one shared body (`_close_shipped.sh` or similar) + backend-specific calls | four near-identical copies       |
| Rebase on a non-fast-forward                  | the phase decides (§ XII)                                                 | asking the user                  |

Constitution: § XII (engineering decisions are not asked), § X (backlog truth: a close is never
reported for nothing), § I. **Surfaces added or widened: none** — checked: the scripts keep their
remotes, refspecs and deletion scope; exits change, which callers map.

## 3. Done, as runnable checks

`deno task test` (`--allow-read --allow-write --allow-run --allow-env`), fmt, lint,
`gen-hooks --check`, `go test ./...`, `scripts/smoke/smoke-merge.sh`, the backend smokes,
`audit.sh`, the size ratchet. Each #711 checkbox in scope maps to a test seen red first.

## 4. Audit findings

_(architect-expert, security-expert)_

## 5. Open questions

None: every item is in #711's approved AC. Decided: a missing `origin/HEAD` makes `base-branch.sh`
verify the fallback exists on origin (`git ls-remote --heads origin <b>`) and exit 3 otherwise;
land-feature exit 6 → the phase rebases onto `origin/<base>`, re-runs the gates and lands again.
