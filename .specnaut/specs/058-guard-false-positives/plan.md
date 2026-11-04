# Plan: the guards stop firing on ordinary work, and one word stops covering two gates

Full plan: this changes hooks that run on their own (an agent instruction surface).

## 1. Why

A guard that fires on ordinary work teaches people to type the approval word to get unblocked. And
one word, `merge`, both lands a branch and rewrites the guards, including `disableAllHooks`.

Threat model, unchanged: the guards stop an agent acting by mistake, or by a spelling it did not
think of as landing. They do not stop an agent set on getting round them. A form that takes
deliberate obfuscation to reach is out of scope.

## 2. Requirements

| Id   | Requirement                                                                                                                                                                                                                                                                                                                                                                      |
| :--- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1 | `protect-generated` gates its switches under a new approval kind, `guards`, minted by the whole prompt `approve the guard change`. `merge` no longer releases them, and `guards` does not release a landing.                                                                                                                                                                     |
| FR-2 | `.specnaut/hooks/**` needs `guards` in `protect-constitution` too. Today it asks for `constitution` there and `merge` in `protect-generated`, and a stamp holds one kind, so an edit could never satisfy both in one turn.                                                                                                                                                       |
| FR-3 | An opaque line holds in `guard-merge` and `guard-release` only when its text mentions what the guard gates: `git`, or an entry of its command list. An opaque line that names `git` still holds.                                                                                                                                                                                 |
| FR-4 | An unquoted heredoc body is read as what bash reads it as: a double-quoted string, through the same parser. A substitution in it is a command like any other, on one line or several; its prose names nothing. No opaque state for it.                                                                                                                                           |
| FR-5 | `protect-constitution`'s bare reads also take `ls`, `echo`, `printf`, `stat`, `:`, `git grep`, `git ls-files`, `git rev-parse`, and a `for` header none of whose words holds a glob or expansion. A redirection onto a guarded file is still judged first. A later command using the loop variable is still caught, because an expansion-only word names what the line mentions. |
| FR-6 | In `listed`, a first word that is only named variables (`$t.sh`, `"$CMD"`, `${X}`) matches an entry only when the line mentions `git` or that entry's first word (a script: its stem), or holds a `for` header over a glob or expansion. A substitution, glob, stdin word or non-ASCII byte stays fail-closed, and so does every position after the first.                       |
| FR-7 | Every refusal says what to type, per kind: the `guards` phrase has one home, in `_approval.sh`.                                                                                                                                                                                                                                                                                  |

## 3. Scenarios

Each row has a test that fails before the change. Under `merge: manual` for `guard-merge`.

| Line                                                                                                                                                                                 | Guard                   | Before  | After   |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------- | :------ | :------ |
| `eval "$X"`                                                                                                                                                                          | merge, release          | held    | allowed |
| `eval "git push"`                                                                                                                                                                    | merge, release          | held    | held    |
| `cat >f <<EOF` + a line with `` `date` `` + `EOF`                                                                                                                                    | merge, release          | held    | allowed |
| same, a line holds `` `git push` `` · a `$(` alone with `git push` on the next line                                                                                                  | merge, release          | held    | held    |
| `cat >f <<EOF` + prose naming the hooks folder + a line with `` `date` `` + `EOF`, then `gh issue create --body-file f`                                                              | constitution            | refused | allowed |
| same, a substitution in the body runs `rm` on the constitution                                                                                                                       | constitution            | refused | refused |
| `ls .specnaut/hooks` · `echo docs/constitution.md` · `for f in docs/constitution.md; do wc "$f"; done`                                                                               | constitution            | refused | allowed |
| `echo x >docs/constitution.md` · `for f in docs/constitution.md; do sed -i x "$f"; done` · `for f in docs/*.md; do sed -i x "$f"; done` · `rm docs/constitution.md`                  | constitution            | refused | refused |
| `for t in a b; do bash scripts/$t.sh; done`                                                                                                                                          | release                 | gated   | allowed |
| `for t in tag b; do bash scripts/$t.sh; done` · `for s in scripts/*.sh; do bash "$s"; done` · `G=git; "$G" push origin v1.0.0` · `gh "$X" create v1` · `gh $W v1` · `$(echo tag.sh)` | release                 | gated   | gated   |
| `merge`, then an edit to `.claude/settings.json`                                                                                                                                     | generated               | allowed | denied  |
| `approve the guard change`, then a landing                                                                                                                                           | merge                   | n/a     | denied  |
| `approve the guard change`, then an edit to `.specnaut/hooks/x`                                                                                                                      | generated, constitution | n/a     | allowed |

## 4. The decision table

| The decision                                                                                    | Its single home                                    | What would duplicate it                     |
| :---------------------------------------------------------------------------------------------- | :------------------------------------------------- | :------------------------------------------ |
| The words that mint each approval kind                                                          | `hooks/approve-on-prompt.sh`                       | a phrase matched in a guard                 |
| Whether a line mentions what a list gates, for an opaque line and a variable command word alike | `_listed_names` in `hooks/_listed.sh`              | a regex in `guard-merge` or `guard-release` |
| How a heredoc body is read                                                                      | `_cmd_heredocs` in `hooks/_command.sh`             | a guard re-reading heredocs                 |
| What is a bare read                                                                             | `_pc_read_only` in `hooks/protect-constitution.sh` | an allowlist elsewhere                      |
| How a command word matches a list entry                                                         | `listed` in `hooks/_listed.sh`                     | an expansion check in a guard               |
| The `guards` kind's refusal text                                                                | `APPROVAL_GUARDS_HOW` in `hooks/_approval.sh`      | the phrase spelled in a guard               |

Reuse: `_listed_names` extends `_listed.sh`, which both guards already source, and the heredoc body
goes through the existing `cmd_parse`. No new file.

**Rejected.** Resolving `for` values in the parser: a second reader of the shell's expansion, for a
case the mention test answers. Removing the opaque gate outright: a line that names `git` is exactly
what it exists for. Judging heredocs by the lines holding a substitution: a `$(` alone on a line
hides the command on the next, and it needs new state in a file over its size target.

## 5. Constitution check

Domain isolation and inward dependencies: not touched, these are shell hooks. No private-half or
consumer name in the change. A refused input that used to work is a major under the workspace's
versioning rule; the bump is decided at the release, from this commit.

## 6. Surfaces

- `templates/harness-specific/shared/hooks/`: `_command.sh`, `_listed.sh`, `_approval.sh`,
  `_baseline.sh`, `guard-merge.sh`, `guard-release.sh`, `protect-constitution.sh`,
  `protect-generated.sh`, `approve-on-prompt.sh`, and their generated checksum file.
- `tests/templates/hooks/`: new rows, and rows that pinned the old behaviour flipped, each with its
  reason.
- `UPGRADING.md`: the new phrase.
- **Surfaces added or widened: one, narrowed elsewhere.** A new approval kind and phrase, minted the
  same way as the others. The guards let through more lines: FR-3, FR-4, FR-5 and FR-6 each state
  what stays held. The Stop backstop (`_baseline.sh`) fingerprints the constitution and the three
  gate configs only, never `.specnaut/hooks/**`, so FR-5 keeps a globbed `for` header judged.

## 7. Risks

- A line that hides a landing behind a variable set outside it now passes `guard-merge`'s and
  `guard-release`'s reading. Accepted under the threat model; `land-feature.sh` and `remove-spec.sh`
  still hold themselves, and the forge's branch protection is the real wall.
- `echo x | xargs rm` was already a blind spot of the parser for `cat` and `grep`; `echo` joins
  them, and the Stop backstop remains behind it for the files it fingerprints.
- The landing hold's Stop check accepts `merge` or `gate-config` for a mode change: `guards` joins
  them, because `workflow.yml` is its file.

## 8. Done, as runnable checks

- `tests/templates/hooks/guard_false_positives_test.ts`: every row of § 3, mutant-probed.
- `deno task test`, `scripts/smoke/audit.sh --since <base>`, the parity harness, the size ratchet
  (`_command.sh` is over its target and must not grow).

## 9. Audit findings

**Architecture** (`architect-expert`: fail, then amended).

- HIGH, accepted: a `for` header holding a glob must stay judged; it was the only thing refusing
  `for f in docs/*.md; do sed -i … "$f"; done`. FR-5.
- HIGH, accepted: judging heredocs by line misses a multi-line `$(…)`. The seat's option is taken:
  the body goes through `cmd_parse`. FR-4. `:` joins the bare reads so its prose names nothing.
- MEDIUM, accepted: FR-6 dropped `git`, which is a rule and no list entry. One predicate. FR-6.
- MEDIUM, accepted: the `guards` refusal gets one home and a per-kind arm. `listed` is at its
  function limit, so the `except` check moves out.

**Security** (`security-expert`: fail, then amended).

- HIGH, accepted: `GIT="git -C x"; $GIT push origin main` would pass. Same fix as above.
- MEDIUM, accepted: `for s in scripts/*.sh; do bash "$s"; done` would run a listed script. FR-6.
- LOW, accepted: the multi-line substitution. FR-4.
- The Stop claim in §§ 6 and 7 overreached: corrected. The phrase is minted as safely as the others
  once `guards` joins the Stop loop, and it is never read by `approved_session`.

**Review** (both seats, on the code).

- Escaping every `"` of a heredoc body broke real quotes inside its substitutions, and could hide a
  push. Fixed: `cmd_parse` has a body mode that starts inside the quote, and a `"` is literal only
  outside a substitution.
- Loops over a command's output or `read` also keep FR-6 closed.
- `listed` and three test callbacks grew over target: shrunk. The opaque reason has one home.

## 10. Open questions

None.
