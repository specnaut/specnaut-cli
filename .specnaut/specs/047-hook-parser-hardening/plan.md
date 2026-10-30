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

Security (fail: 5 HIGH · 1 MEDIUM, reproduced over ~55 forms in zsh and bash 3.2). All accepted;
they **widen § 1** and supersede it where they differ.

**The decision that shapes all of them: unknown means opaque.** The parser stays a deny list (a
`gh api` POST, an alias or a renamed script stay out of its reach — the stated limit, below), so
every form it cannot read with certainty marks the line `CMD_OPAQUE` and the guard gates it. No more
"skip one word" defaults.

- **HIGH 1 — wrappers** (`_simple.sh`): match wrapper names on their basename (`/usr/bin/env X`,
  `/usr/bin/nice`, `/usr/bin/time`); each wrapper has the list of options it accepts and which take
  a value (`exec -a`; `env -u -C -P`; `time -o -f`; `nice -n --adjustment`, then `--`;
  `sudo -T -R`); **any other option → opaque**; `env -S`/`--split-string*` → opaque;
  `bash --rcfile|--init-file V` skips V and treats it as a script that runs; prefix words `coproc`,
  `nocorrect`, `repeat N`; `function NAME { … }` handled.
- **HIGH 2 — parser frames** (`_command.sh`): `case` as a command word inside an `s`/`d` frame →
  opaque; `_cmd_heredoc_open` records whether the delimiter was quoted, and an unquoted body holding
  `$(` or a backtick → opaque.
- **HIGH 3 — `listed()`** (`_listed.sh`): any position flagged by `_listed_expands` matches its list
  word (not only the first); a command run by `xargs` gets a trailing `$` word (stdin completes it);
  `gh release new` joins the release list; "a git subcommand the shell rewrites" and the `!` alias
  rule move into `cmd_git` (`_git.sh`) so guard-merge and guard-release share one home.
- **HIGH 4 — stdin shells and eval-likes** (`_simple.sh`) → opaque: an operand of `/dev/stdin`,
  `/dev/fd/*`, `/proc/*/fd/*` or a stripped `<(`; `source` with no operand; `sudo -s|-i` with no
  command; `trap` with an action; `mapfile|readarray -C`; a word holding `[$(` or `[` + backtick;
  zsh `${(` flags holding `e`; `BASH_ENV=`/`ENV=` values read as scripts.
- **HIGH 5 — non-ASCII** (`_listed.sh`): do not fold; `*[![:print:]]*` under `LC_ALL=C` joins
  `_listed_expands`, so any byte ≥ 0x80 in a command word gates it. `guard_ieq` stays ASCII-only.
- **MEDIUM 6 — false gates** (`_command.sh`): a reserved word directly followed by `(` (`if(`,
  `then(`, `while(`) ends the segment and opens a subshell; `[[ … ]]` is its own mode
  (`| ( ) < > & ;` are word characters, `$(`/backtick still open, only a word that is exactly `]]`
  ends it; end of line first → opaque); `command -v|-V` allowed.
- Already safe, kept as allowed rows: `command -p`, `builtin eval|source`, `. ./x`, `cat < <(…)`,
  `<<<$(…)`, `$'…'`, `{a,b}`.
- **Stated limit, filed separately:** a check inside `land-feature.sh` / `remove-spec.sh` themselves
  (merge mode + this turn's approval) would hold whatever the spelling, but the approval stamp is
  keyed by the session id only the hook receives — a design item of its own, not this branch.

Order: pass 1 = HIGH 1, 4, 5 (`_simple.sh`, `_listed.sh`); pass 2 = HIGH 2, 3, MEDIUM 6, the
remaining reach forms, and Codex deny vs crash (`_command.sh`, `_git.sh`, guard-release, tests).

## 5. Open questions

None: every item is in #711's approved AC.
