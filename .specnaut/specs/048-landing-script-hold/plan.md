# 048 — The landing scripts hold `merge: manual` themselves

Backlog: specnaut-cli#714, child of epic cli#674. Follows cli#711 part B (spec 047), whose § 4
states the limit this closes: the landing hook is a deny list over command spellings, so a renamed
copy, an alias, a task runner or the next parser gap reaches `land-feature.sh` unheld.

## 1. What changes

Under `merge: manual`, `land-feature.sh` and `remove-spec.sh` refuse to run (exit 13) unless the
user's own prompt in this turn approved `merge` — the same approval stamp the landing hook reads.
They do it whatever the command line looked like, so every spelling of the unedited scripts is held.

**Who is held** — only a run inside a harness session Specnaut hooks:

| Situation                                                                                                         | Result            |
| :---------------------------------------------------------------------------------------------------------------- | :---------------- |
| No `CLAUDE_CODE_SESSION_ID` and no `CODEX_SESSION_ID` (a person in a terminal, an unhooked harness)               | runs              |
| No `.specnaut/hooks/guard-merge.sh` in the project (nothing could ever write the approval)                        | runs              |
| `merge-mode.sh --strict` prints `auto`                                                                            | runs              |
| manual, and the stamp for this session says `kind: merge`                                                         | runs              |
| manual, anything else — no stamp, another session's, a `release` stamp, unreadable stamp, no `jq`, a malformed id | **held, exit 13** |

The key is the session id, never `CLAUDECODE` (IDE terminals set it too).

## 2. Decisions

| Decision                              | Choice                                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                                                                                                                               |
| :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| How the script finds the approval     | The session id both harnesses export to Bash children — `CLAUDE_CODE_SESSION_ID` (Claude Code docs: matches the hook payload's `session_id`), `CODEX_SESSION_ID` (Codex `exec_env.rs::inject_session_env`, same `SessionId` the hooks receive) — locates the existing stamp | No new token and no new writer. The id is a locator, not a secret: the trust is in the stamp, still written only by `approve-on-prompt.sh`                                                                                                                                                        |
| A one-shot token exported by the hook | Rejected                                                                                                                                                                                                                                                                    | Adds nothing against a model acting on purpose: the weak point is then the script itself, which it can edit                                                                                                                                                                                       |
| Where the stamp path is computed      | Duplicated in the new helper, with a parity test                                                                                                                                                                                                                            | `_approval.sh` must not call a core script the model can write: on Codex that would let the model redirect where the hook reads, breaking the one real boundary (the sandbox refuses its writes to `$XDG_STATE_HOME`)                                                                             |
| Turn scope                            | None in the script (no turn id is exported); the Stop hook deleting the stamp is the turn boundary                                                                                                                                                                          | Same scope Claude's stamp already has                                                                                                                                                                                                                                                             |
| Codex id mismatch                     | If `CODEX_SESSION_ID` ever differs from the hook's `session_id`, the run is held, never allowed                                                                                                                                                                             | Fail closed; manual means held                                                                                                                                                                                                                                                                    |
| `guard-merge.sh` on a listed script   | `approval_require` instead of `approval_gate`                                                                                                                                                                                                                               | Today a click in Claude's ask modes lets the command through and the script would then refuse it. With `approval_require`, a turn whose prompt said `merge` gets the same single click; one without it is denied up front — what AGENTS.md already promises. Raw `git push` keeps `approval_gate` |
| `fold-fixups.sh`                      | Not held                                                                                                                                                                                                                                                                    | It never lands on the base                                                                                                                                                                                                                                                                        |
| Exit code                             | 13 in both scripts (free in both)                                                                                                                                                                                                                                           | One meaning: held by manual                                                                                                                                                                                                                                                                       |

## 3. Threat model

**Buys:** every run of the _unedited_ scripts is held, whatever the spelling — the class each
cli#711 round kept finding.

**Does not buy** (stated, not fixed here):

- `gh api` merges, `gh pr merge`, raw `git push` the parser misses — they never run the scripts; the
  parser alone covers them.
- A model that edits the script or a copy (`.specnaut/scripts/` is writable from Bash), unsets the
  id, or points `XDG_STATE_HOME` at a stamp it wrote — deliberate circumvention, spec 036 § 6.
- On Claude the model's shell is not sandboxed, so it can write the stamp itself: a speed bump, as
  today.

**Consequences to accept:** a user's own `! bash land-feature.sh` inside Claude Code is held unless
their prompt said `merge` that turn; on Codex with untrusted hooks the landing goes from unenforced
to held. Both are what `manual` means.

## 4. Surfaces

- **New** `templates/core/specnaut/scripts/bash/merge-hold.sh` (~70 lines) + manifest entry;
  `plugin/` mirror.
- `land-feature.sh`, `remove-spec.sh`: `if ! bash "$here/merge-hold.sh"; then exit 13; fi` after the
  usage check (the `if` keeps the ERR trap from turning it into 12); exit table gains 13; the
  header's "it does not read the mode" is replaced.
- `templates/core/skills/task/phases/merge.md`, `merge-close.md`: a row for 13 — quote it, name
  `merge`, stop on the branch.
- `guard-merge.sh`: the `approval_require` arm for listed scripts; the "limit" header names the
  backstop; `merge-commands.txt` comment. Codegen: `SHA256SUMS`, `codex/hooks.json`, bundle.
- Issue cli#714's body lists `gh api` among the forms the script check holds — reworded through the
  product-owner.

## 5. Tests

- `tests/scripts/merge_hold_test.ts` (new), both harness env vars; stamps minted by the real
  `approve-on-prompt.sh`: no id → 0; auto → 0; no hooks dir → 0; manual + no stamp → 13; manual +
  merge stamp → 0; `release` stamp, another session's, malformed id, no `jq` → 13.
- `tests/scripts/landing_hold_test.ts` (new): a copy `ship.sh` of `land-feature.sh` beside the real
  scripts, manual, no stamp → exit 13, the hold's own stderr marker, origin's base unchanged; and
  `guard-merge.sh` _allows_ `bash .specnaut/scripts/bash/ship.sh` — proof the parser misses that
  spelling and the script is what held it.
- `guard_merge_scripts_test.ts`: Claude default mode, no approval, a listed script → denied, not
  asked.
- Parity: the helper's stamp path equals `_approval.sh`'s for the same
  root/session/`XDG_STATE_HOME`, including a Windows `C:\…` value.
- Red-probe every new row; task permissions, never `-A`. Bash 3.2.

Size: ~80 / ~120 / ~117 lines for the helper and the two scripts; new tests under 300.

## 6. Order

T1 helper + its tests → T2 the two call sites, exit 13, phase docs, copy-spelling test → T3 the
`guard-merge.sh` arm, codegen, parity test.

## 7. Open questions

None for the user: `manual` already means "held until the user says merge"; this enforces it in one
more place.

## 8. Audit findings — binding, they supersede §§ 1–6 where they differ

Architecture (fail: 2 HIGH · 5 MEDIUM · 3 LOW) and security (needs follow-up: 2 MEDIUM · 3 LOW).
Every finding below is accepted unless it says rejected.

**The reader lives in the hooks.** The stamp reader is a new executable,
`.specnaut/hooks/merge-approved.sh`. It is never registered as a hook, but it is listed in
SHA256SUMS and run through codegen. It sources `_guard.sh`/`_approval.sh`, so `guard_root`, the
stamp path, the JSON read and `approval_session_ok` each have one owner. The core helper
`merge-hold.sh` calls it.

This replaces the duplicated path and its parity test (architecture HIGH 2 and MEDIUM 1). The root
is the hook's own `pwd -P` derivation, never the caller's `$here` or the git toplevel. The security
audit's conditions:

- **(a)** A separate no-turn function in `_approval.sh` (`approved_session <kind>`), never a flag on
  `approved()`. A test proves that guard-merge on Codex with no `turn_id` still denies.
- **(b)** The core caller requires a positive token (below).
- **(c)** Reader missing while `guard-merge.sh` is present → held, never "no hooks".
- **(d)** The reader is in SHA256SUMS, not in `hooks.json`.

**Positive allow only** (security F1). `merge-hold.sh` prints exactly `merge-hold: run` as its last
line on every allow row. Both call sites require exit 0 **and** that line:

```
[ "$(bash "$here/merge-hold.sh")" = "merge-hold: run" ] || exit 13
```

The helper uses no `local x=$(…)`. A test runs a mutated helper (`set -u` abort under an EXIT trap,
which bash 3.2 exits 0) and gets 13.

**Exit 13 names its remedy** (architecture MEDIUM, security F5). It prints one stderr line saying
what releases it:

- reply `merge`;
- on Codex: "if you typed merge, the prompt hook did not run — trust the hooks with `/hooks`";
- install `jq`;
- run `specnaut upgrade` (helper or reader missing).

The `merge.md` / `merge-close.md` rows say "quote its line; it names the remedy". Under `auto`, a
missing helper is still 13 with the upgrade line.

**Resume after a held spec removal** (architecture MEDIUM). `merge-close.md` step 4 held by 13 means
the landing and the close stand and only the removal is held. On the next `merge`, run step 4 only,
never the landing.

**One arm for every landing** (architecture MEDIUM, security F4). `guard-merge.sh`'s single
`approval_gate` call becomes `approval_require` for every reason: listed scripts, `gh pr merge` /
`glab mr merge`, and raw git landing on the base. A denied model has no less-strict spelling to fall
back to, and it matches AGENTS.md ("a 'yes'… does not release it"). A test covers the mixed command
`bash land-feature.sh && git push origin main` → denied, not asked, in Claude default mode.

**The id can be scrubbed** (security F2).

- (a) § 3 "Buys" now reads "every run of the unedited scripts **from a process that still carries
  the session id**". Scrubbed environments go under "Does not buy": `env -i`, sudo `env_reset`,
  tmux/screen send-keys, launchd/cron/at, a harness version that stops exporting it.
- (b) The parser gates any command that unsets or assigns `CLAUDE_CODE_SESSION_ID`,
  `CODEX_SESSION_ID` or `XDG_STATE_HOME`, or that uses `env -i`. `unset` joins export/declare in
  `_cmd_env`. `HOME` is left out because it is too common.
- (c) When the helper allows with no id while `CLAUDECODE` or `CODEX_SANDBOX*` is set, it prints
  `merge-hold: no session id in the environment — not held` on stderr.
- (d) _Rejected:_ walking up the process ancestry. It is platform-specific (MSYS cannot see native
  processes), and (b)+(c) already make the accidental case visible.
- (e) The live probe: on Claude Code, `CLAUDE_CODE_SESSION_ID` was read in a hooked session and
  equals that session's id (2026-10-30). On Codex the claim rests on source (`exec_env.rs`
  `inject_session_env`) and has not been run. A mismatch is fail-closed (held), recorded as a known
  risk.

**Bounded stamp age** (security F3). The helper holds when the stamp's mtime is older than 60
minutes (hook-written; the Codex sandbox refuses the model's touch). This bounds the turn widening
on Codex, where the script has no turn id. A test covers it.

**The hold's files are gated for edits** (architecture HIGH 1). `protect-generated.sh` adds
`.specnaut/scripts/bash/{merge-hold,land-feature,remove-spec}.sh`, with `protect_generated_test.ts`
rows. The reader is already covered by `.specnaut/hooks/**`.

**Tests added** (architecture MEDIUM):

- Positive call-site landings: manual with a `merge` stamp, and auto with an id set.
- Every script test clears both id variables unless it sets them.
- Mint a stamp → Stop → 13.
- Both ids set: Claude's wins, tested.
- The same session under another root → 13.
- `merge-mode.sh` failing → held.
- Helper missing → 13 with the upgrade line.
- `hook_sandbox.ts` copies `merge-hold.sh`.

**LOW findings:**

- The mirror is `plugin/skills/task/phases/{merge,merge-close}.md`, not a `plugin/` script.
- The manifest entry follows `land-feature.sh`'s shape.
- `smoke-merge.sh` checks for `merge-hold.sh`.
- Headers updated: `merge-mode.sh` ("three callers"), `_approval.sh` (it hashes `GUARD_ROOT`).
- § 3 names the consequences: Codex users re-trust the hooks after the upgrade, and an install with
  a customised `land-feature.sh` gets no hold.

**Order:**

- T1: `approved_session` + the reader + `merge-hold.sh` + their tests.
- T2: the call sites, exit 13, the phase docs and mirrors, the copy-spelling and positive tests.
- T3: `guard-merge.sh` `approval_require` + the parser's id/XDG gate + `protect-generated.sh`,
  codegen, smoke.
