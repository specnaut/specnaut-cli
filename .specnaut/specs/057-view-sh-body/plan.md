# Brief: view.sh returns the issue when run without a terminal (cli#739)

## 1. Task and out of scope

An agent running the GitHub backend's `view.sh` gets the issue: its fields, body and comments.
Today, outside a terminal, `gh issue view --comments` prints only the comments, so an issue with
none prints nothing and exits 0. In a terminal, nothing changes.

`plan.md`, `resume.md` and `groom.md` also read an item's creation time from `view.sh`, and gh's
plain output has none, so the script prints it. The code is corrected to match the documents.

Out of scope: the gitlab and local backends, and rendering issue text with our own jq.

## 2. Guardrails

| The decision                                   | Its single home                                     | What would duplicate it                                         |
| :--------------------------------------------- | :-------------------------------------------------- | :-------------------------------------------------------------- |
| What one GitHub item prints without a terminal | `templates/core/skills/task/scripts/github/view.sh` | a caller adding its own `gh issue view`, a second reader script |

Reuse: `gh issue view` directly. No new helper.

- Design: the first line is always `created:`, from `--json createdAt --jq`, ahead of any text an
  issue's author wrote. Then terminal stdout (`[ -t 1 ]`) keeps today's single `--comments` call;
  anywhere else, plain `gh issue view`, then `--comments`.
- Rejected: one `--json` call rendered by jq. It would lose the fields gh prints by version
  (`parent:`, `projects:`) and add a new sink for untrusted issue text. Rejected: always running
  plain plus comments. In a terminal `--comments` repeats the whole issue.
- Principles: nothing crosses the halves (§ I); no consumer names in tests (§ XI).
- Surfaces: one script, read-only, same exit behaviour: a failing `gh` call exits non-zero.
- **Surfaces added or widened: none.** Checked: same `gh` command family, same `$1` and `$REPO`
  quoting, no new input, no eval, no new parser of issue text.

## 3. Done, as runnable checks

- `tests/scripts/view_sh_test.ts`, run piped: title, state, parent and body print with no comments;
  comments print after the body when present; `created:` is the first line even when the body forges
  one; each `gh` call failing in turn exits non-zero. Each mutant-probed.
- The stub imitates gh as measured on gh 2.102.0, and the test says so. A direct piped run of the
  script against a real sub-issue, and a run under a terminal, are recorded at review.
- `deno task test`, smoke audit, parity harness, size ratchet.
- The workspace root's hand-maintained copy takes the same fix in its own commit.

## 4. Audit findings

**Architecture** (`architect-expert`: fail, then amended).

- HIGH, accepted: `created:` printed after the body could be forged by the body, and a future date
  makes `wip-audit.sh` read the item as `IDLE`. It now prints first, on a terminal too.
- MEDIUM, accepted: the checks skipped `state:` and `parent:`, and a stub failing every call stops
  at the first. The test now covers both and fails each call in turn.
- MEDIUM, to the backlog: `cloud/view.sh` prints no creation time either. Out of scope here.
- The `[ -t 1 ]` split matches gh's own test. No script parses today's output; smoke checks only
  that the file exists. Calls per view go from 1 to 3: accepted.

**Security** (`security-expert`: needs follow-up, then amended).

- MEDIUM, accepted: the same forgery, with a mutant-probed test. No sanitiser is needed: comments
  already reach agents through this script, and the docs say a body is never evidence.
- The full-plan threshold is not crossed: issue text goes to stdout, not to a shell, path or parser.

## 5. Open questions

None.
