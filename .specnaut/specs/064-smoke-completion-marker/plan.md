# A smoke script that aborts is never a pass

Item: #748. Brief: no line of the risk threshold fires (§ 2, Surfaces).

## 1. Task and out of scope

On macOS's `/bin/bash` 3.2, a smoke script that dies on an unset variable under an EXIT trap exits
with the trap's status. Measured on 3.2.57 on 2026-11-05:

- `set -euo pipefail` plus `trap true EXIT` exits 0;
- `set -uo pipefail` plus a trap ending `exit $rc` exits 127.

So `run-all.sh` reads an aborted script as a pass and prints `ALL CHECKS PASSED`. The outcome:

- a script that did not reach its verdict fails the suite, whatever its exit status says;
- the same holds for `audit.sh`, and for `run-all.sh`'s own abort.

**Out of scope:** the syntax-error case, already guarded by `bash -n`; removing the EXIT traps;
forgery by someone who edits the suite. On a fork pull request the contributor runs their own
`run-all.sh`, so the marker guards against mistakes, not adversaries, and needs no token.

## 2. Guardrails

### Decision table

| The decision                     | Its single home                                                                                                                                                                                                                                                                                                                                                   | What would duplicate it                                                      |
| :------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| A script reached its verdict     | one helper in `scripts/smoke/_common.sh`, called by `finish` and by `audit.sh` at its only clean exit (`exit 0`, line 453)                                                                                                                                                                                                                                        | a second writer; a marker written anywhere but at a verdict                  |
| What a marker holds              | `${0##*/}`, the running script's own file name, written with `>`; no argument, no label                                                                                                                                                                                                                                                                           | `finish`'s banner text; a label table in `run-all.sh`                        |
| Whose marker a process may write | `_common.sh` reads `SMOKE_DONE` once when sourced, into an unexported variable, and unsets it, so no child can write its parent's marker. The helper writes nothing when `BASH_SUBSHELL` is non-zero                                                                                                                                                              | an exported variable; a write from `( … )` or `$( … )`                       |
| How a verdict is read            | one function in `run-all.sh` (for example `run_checked <script> [args…]`): a pass is exit 0 **and** a marker whose content equals the script's name byte for byte. Exit 0 with no marker, or the wrong one, fails as `aborted before its verdict`. The loop and the audit step both call it                                                                       | the two copy-pasted pass/fail blocks today; a check on the exit status alone |
| The marker directory             | `run-all.sh`: one `mktemp -d` per run, fatal if it fails, never read from the environment or exported. Each child gets `SMOKE_DONE=<dir>/<script>` as a prefix assignment                                                                                                                                                                                         | a fixed path; a glob in the cleanup                                          |
| `run-all.sh`'s own exit          | one EXIT trap, a function, installed once and unconditionally before the directory exists. It sets `rc=$?` first, restores the bundle if a backup was taken, removes the directory with `rm -rf -- "$dir"` when `dir` is non-empty, and raises `rc` to 1 if the restore failed while `rc` was 0. Then `exit "$rc"`. The trap may raise the status, never lower it | a second `trap … EXIT`; a trap whose last command sets the status            |

**What the marker proves:** that `finish` or `audit.sh`'s verdict was reached, not that every check
above it ran. Two scripts call `finish` early, on failure paths, and those exit 1.

`.specnaut/release/preflight.sh` calls `audit.sh` without `SMOKE_DONE` and reads its exit code,
which is truthful because `audit.sh` sets no EXIT trap. It is unaffected.

### Constitution

- **§ I, § XI:** fixtures use invented names.
- **§ IV:** one half, plus the pointer commit.

### Surfaces

The smoke suite, which is test tooling and is not shipped (the bundle is built from `templates/`).
**Surfaces added or widened: none.** Checked: no shipped template, command, input, file in a
consuming project, dependency or agent surface changes. The `bash:5` container is a one-off run by
hand, never committed.

### Sizes

`wc -l` on `main`: `_common.sh` 249, `run-all.sh` 219, `audit.sh` 453, `smoke-toolbox.sh` 330,
`README.md` (lists what `_common.sh` owns: the marker makes it seven). `audit.sh` and
`smoke-toolbox.sh` are over their target and may not grow: the marker call joins the `exit 0` line,
and the tests do not go into `smoke-toolbox.sh`.

## 3. Done, as runnable checks

The tests live in a new `tests/scripts/run_all_marker_test.ts`. CI runs `deno task test` on ubuntu,
macos and windows, so macos-latest gates `/bin/bash` 3.2 on every run.

**The seam:** the test copies `run-all.sh` and `_common.sh` byte for byte into
`<tmp>/scripts/smoke/`. Fixtures go under existing `SUITE_FILES` names, so the list is not edited,
next to a stub `audit.sh`. It runs `--no-bundle --only <member>`, so a test never regenerates the
tracked bundle (the restore test bundles through a `deno` shim, in its throwaway tree). Bash is
`/bin/bash` on darwin and `bash` elsewhere. A `bash` shim for that binary goes first on PATH, and
each fixture prints `BASH_VERSINFO`, which the test asserts. Windows is ignored, with the reason
stated.

| Requirement                | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| :------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positive control           | a fixture that calls `finish`, with a stub audit that reaches its verdict: `ALL CHECKS PASSED`, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Abort is a failure (3.2)   | a fixture that dies on an unset variable under an EXIT trap: the exact line `❌ <script> — aborted before its verdict`, no `ALL CHECKS PASSED`, exit non-zero                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Not the exit status alone  | a fixture that exits 0 without `finish`: same line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A child cannot stand in    | a fixture that runs a child smoke script **of the same name** to its verdict, then either dies under an `rm` EXIT trap or exits 0: fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A subshell cannot stand in | a fixture running `( finish X )`, then either dying on an unset variable or exiting 0: fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `audit.sh` covered         | a stub `audit.sh` that exits 0 without reaching its verdict fails `run-all.sh` with the same line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `run-all.sh`'s own abort   | a copy with an unset variable after the trap is set: it echoes a unique token first, the test requires that token, and the exit is non-zero                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A failed restore fails     | a green run whose bundle cannot be put back (a `deno` shim leaves it read-only): exit 1, the backup kept under the given TMPDIR, holding the original; skipped as root                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Red-probes                 | each mutant changed the file and parses. Reading the exit status alone: the abort, exit-0, child, subshell and audit tests go red. Not unsetting `SMOKE_DONE`: both child tests. No subshell guard: both subshell tests. `finish` not marking: the positive control and the audit test. Not removing the marker directory: the positive control. Removing `exit "$rc"`, or not raising `rc` on a failed restore: the restore test. Reading `rc` after the cleanup: the own-abort test and every failing one. The abort variants are red on 3.2 only; the `exit 0` variants, the audit stub and the restore test on 3.2 and on bash 5.2.37 (container) |
| Linux                      | the unset-variable fixture is run once on bash 5 in a container by hand, and the result is stated in the commit; so is the whole test file, run once in a Deno container (bash 5.2.37, uid 1000), with its red-probes                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Whole                      | `deno task test`, fmt, lint, shellcheck, the smoke suite, `audit.sh --since main`; read in a separate call before landing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Measured on 3.2.57, while writing the own-abort test:** removing the trap's `exit "$rc"` leaves
that test green. Under `set -uo` (no `-e`), an abort on an unset variable exits 1 whatever the
trap's last command returns, and a bare `exit` inside a trap reuses the status from before it. On
that path the line is defensive. The trap lowers the status only by calling `exit` with 0 or with an
`rc` read after the cleanup, so the own-abort test is red-probed with that mutant. The one path
where `exit "$rc"` alone keeps the status non-zero is a failed restore after a green run: `finish`
has exited 0, and the trap's raise is the only thing that makes it 1. The restore test is that
fixture.

## 4. Audit findings

### Architecture (`architect-expert`, fail, 3 HIGH, all folded)

Claims I checked: `smoke-all-harnesses.sh` builds its label at run time and `smoke-audit.sh` says
`SMOKE-AUDIT`; `--only` refuses names outside `SUITE_FILES`; `audit.sh`'s only clean verdict is
`exit 0` at line 453, and it sets no trap.

- **Accepted:** the marker holds the script's own name, compared with `$script`; the Deno test and
  its seam; the audit check rewritten so it can go red; the positive control and exact failure
  lines; one function that reads verdicts; the sizes; the limit of what the marker proves; the
  README.

### Security (`security-expert`, needs_followup, 1 MEDIUM, 3 LOW, all folded)

Does not cross the threshold.

- **Accepted:**
  - an inherited `SMOKE_DONE`, closed by read-once-and-unset (`smoke-audit.sh` runs `audit.sh` as a
    child 17 times);
  - the trap may raise the status, never lower it;
  - `mktemp -d` is fatal;
  - no write from a subshell;
  - the threat model stated in § 1.
- **The seats overlapped** on the marker's content. The security seat proposed the first
  `BASH_SOURCE` frame outside `_common.sh`, the architecture seat `${0##*/}`. The plan takes `$0`:
  it names the running script whatever sourced the helper, and it is one expansion.

## 5. Open questions

None.
