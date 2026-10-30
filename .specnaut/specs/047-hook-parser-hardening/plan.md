# Plan: Harden the hook command parser — #711 part B

**Branch**: `047-hook-parser-hardening` | **Date**: 2026-10-30 | **Backlog item**:
[specnaut-cli#711 — Harden the merge scripts: follow-ups from the cli#677 review](https://github.com/specnaut/specnaut-cli/issues/711),
child of epic #674. Part A (scripts) landed at 7e307914.

**Full plan** — the hooks are an agent instruction surface that run on their own (step 4b).

## 1. Task and out of scope

The remaining #711 items in `templates/harness-specific/shared/hooks/`: `_simple.sh` wrapper options
that take a value (`exec -a <name>`, `env -S`/`-P <value>`, `bash --rcfile <file>`) and
`/usr/bin/time`, `nice --adjustment` unwrapping; `xargs -I <placeholder>` and `find … {}`
placeholders; `_command.sh` `cmd_parse`: a bare case-arm `)` inside an unquoted `$(…)`, `if(…)` read
as a glob group (false gate), `$(…)` inside an unquoted heredoc body (skipped by the parser, run by
bash), `[[ $x =~ ^(a|b)$ ]]` (`|` inside the group ends a segment — false gate); `guard_ieq`
non-ASCII case folding (`land-feature.ſh` on APFS); the remaining reach forms in
`guard_merge_scripts_test.ts`; hook tests that tell a Codex "deny" from a crash. **Out**: new
guards, the Windows backslash test-path item (separate, tests only).

## 2. Guardrails

| The decision                                                      | Its single home                               | What would duplicate it              |
| :---------------------------------------------------------------- | :-------------------------------------------- | :----------------------------------- |
| How a command line splits into segments and words                 | `_command.sh` `cmd_parse`                     | a second tokenizer in a guard        |
| Which wrapper is unwrapped, and how many of its words it consumes | `_simple.sh`                                  | per-guard wrapper lists              |
| Case-insensitive name match                                       | `_guard.sh` `guard_ieq`                       | `tr`/`nocasematch` inline in a guard |
| When the parser cannot read a line safely                         | `CMD_OPAQUE` → the guard's fail-closed branch | a guard deciding "probably fine"     |

Rule for every ambiguity: **fail closed** (opaque → gated) unless the form is proven safe by a test;
a false gate is a MEDIUM, a bypass is a HIGH. Constitution: the hooks are Specnaut's own must-hold
enforcement (§ XII's merge hold). **Surfaces added or widened: none** — the parser narrows what it
lets through; the false-gate fixes widen only for forms proven to run nothing listed.

## 3. Done, as runnable checks

`deno task test` (`--allow-read --allow-write --allow-run --allow-env`), fmt, lint,
`gen-hooks --check` (SHA256SUMS regenerated), `smoke-hooks.sh`, `audit.sh`, size ratchet. Every
item: a gated row and, where it was a false gate, an allowed row, on Claude Code and Codex; each
seen red first. Codex deny vs crash: a hook test asserts the deny's own reason text, not only the
exit.

## 4. Audit findings

_(security-expert)_

## 5. Open questions

None: every item is in #711's approved AC.
