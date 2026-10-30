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

Both seats ran on 9e46c8be; all findings accepted. They **supersede** §§ 2 and 5 where they differ.

### Security (needs_followup: 3 MEDIUM · 1 LOW)

- **MEDIUM — `ls-remote --heads origin <b>` fails open** (tail match: `main` matches
  `refs/heads/team/main`; no match still exits 0). **MEDIUM — a network call in `base-branch.sh`
  sits on the `merge: manual` guard's path** (offline → exit 3 → `merge-mode --strict` skips the
  base copy → HEAD's `auto` wins). Decision: **`base-branch.sh` stays local-only.**
  `land-feature.sh`, which already fetches, asks origin for its default with
  `GIT_TERMINAL_PROMPT=0 git ls-remote --symref origin HEAD` and requires an exact match of
  `refs/heads/<base>` with the base it was given; any failure → exit 3 (could not answer). And
  `merge-mode.sh --strict` treats an unknown base as `manual` (fail closed), with a test.
- **MEDIUM — the exit-6 rebase policy loops or lands unreviewed commits** (by line 44 the branch
  already contains `origin/<base>`, so exit 6 means the _local_ base has commits origin lacks).
  Decision: exit 6 does **not** rebase: the script prints `origin/<base>..<base>` and the phase
  stops on that fact (§ XII forbids asking a craft question, not stopping on a blocker). Exit 5
  (behind origin): the phase rebases only when it applies cleanly; on a conflict it aborts and the
  branch goes back to `review`.
- **LOW — `remove-spec.sh` must report untracked files, never delete them** (they are in no commit;
  deleting them is not lossless). After `git rm`, list `git ls-files -o -z -- "$dir"` (ignored files
  included), print them quoted, and do not report "removed" while files remain.
- **INFO** — the shared close-shipped body is sourced from `$here`, never a cwd-relative path;
  `cascade-check.sh` stderr may pass through, its stdout (issue titles) stays discarded.
- § 2's "Surfaces added or widened: none" is struck: `land-feature.sh` gains one read-only network
  query to origin, on a path that already fetches.

### Architecture (needs_followup: 4 MEDIUM · 1 LOW)

- **MEDIUM — shared close-shipped body.** One source file
  `templates/core/skills/task/scripts/_close_shipped.sh` listed four times in
  `templates/manifest.json`, once per backend (a backend-less entry breaks `backend_gating_test`).
  It owns argument checks, the loop, the DONE/OPEN/FAILED/RECONCILED lines and exits 0/2/20/21; each
  backend wrapper defines `confirm_closed` and `reconcile` and sources it from `$here`. local and
  cloud may share one wrapper source.
- **MEDIUM — audit and smokes.** A named `_surfaces.sh` row maps the helper to the four backend
  smokes; the smokes' text greps (`move.sh" "$n" Done`, `-ne 12`, `/cascade-check.sh` absent) become
  behaviour checks, done in the commit **before** the refactor.
- **MEDIUM — one exit-table home per script.** Each script's full exit table lives in its header;
  exactly one phase doc maps it (merge.md for land-feature/epic-status, merge-close.md for
  remove-spec/close-shipped, epic-fixups.md for fold-fixups); others point. Epic membership after
  re-entry is decided in `epic-status.sh`: exit 14 while `.specnaut/feature.json` names an epic →
  its own new exit; merge.md routes it to a stop.
- **MEDIUM — commit order.** (1) smokes to behaviour checks; (2) base-branch / merge-mode /
  land-feature exits with their doc mappings, mirror and bundle together; (3) epic-status and
  fold-fixups; (4) remove-spec; (5) the close-shipped refactor (manifest, surfaces, bundle) in one
  commit; (6) the remaining tests and `_listed.sh` blank-line rule (part A owns `_listed.sh` and
  `guard_merge_scripts_test.ts`; part B does not touch them).
- **LOW** — six existing backlog-script manifest entries carry a `name` that does not match their
  suffix: the four new entries get correct names; the six go to the backlog.

## 5. Open questions

None: every item is in #711's approved AC; the decisions above replace the two in the first draft.
