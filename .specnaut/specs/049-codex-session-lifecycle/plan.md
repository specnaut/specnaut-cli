# 049 — Codex: close what a run spawned

Backlog: specnaut-cli#723 "Archive completed Codex subagents and obsolete worktrees during delivery"
(https://github.com/specnaut/specnaut-cli/issues/723). Approved for implementation by Kevin,
2026-11-02.

## 1. Why this exists

On Codex, a session started with `spawn_agent` outlives its work, and nothing in Specnaut's chain
closes one. Every run that delegates leaves its children open: review seats, product-owner writes,
plan audits. The host keeps each child attached to the worktree it ran in, then refuses to archive
that worktree ("Another active task still uses this worktree"). One reported project had 224
finished children holding a single worktree, and 106 more once that one was cleared. The user cleans
up by hand, after diagnosing an error that names neither the owner nor the cause.

Claude Code does not have the problem, because a `Task` child ends with its result. The fix is
Codex-only.

## 2. User scenarios

**P1 — A delivery leaves nothing of ours behind.** Given a Codex session that runs `/task` from plan
to merge and delegates to agents, when `merge` ends — landed, landed without the close, or `--pr` —
then every child this run recorded and that has finished is closed, and the report lists them.

- Given a child whose handoff a fix cycle still needs, when the chain moves on, then it stays open
  until that cycle ends.
- Given a recorded child that is still running, then it is not closed and the report names it.
- Given a child already closed, or one the host no longer knows, then the sweep skips it and says
  so. A second sweep closes nothing.
- Given the conversation was compacted and the spawn record is no longer visible, then nothing is
  closed and the report says why.

**P2 — An obsolete worktree is archived, never forced.** Given a recorded worktree whose branch
landed, when the sweep runs, then the worktree is archived through the host only if every commit in
it is on `origin/<base>` or kept under a local ref, its status is clean, and its ignored files are
copied out by path. Its removal is then verified.

- Given the main session's checkout or the primary worktree, then it is never a candidate.
- Given uncommitted or untracked work in the worktree, then it is not archived. The report names it.
- Given the host refuses, then the report names the worktree and the owner the host gave. Nothing is
  forced, and that owner is not touched.

**P3 — Outside a delivery.** Given `/task audit`, `/task groom`, a product-owner write or `/ship`
that spawned children, then the same close-after-handoff rule applies, and the sweep runs at the end
of that run. Those runs archive no worktree: only a landed delivery can.

**P4 — A host without the tool.** Given a Codex build that lacks `close_agent` or an archive action,
then the report names the missing tool and what stayed open. It never claims a cleanup that did not
happen.

## 3. Requirements

- **FR-001** Codex projects receive `.specnaut/codex/session-lifecycle.md`. No other harness does.
  `upgrade` delivers it and can retire it.
- **FR-002** The Codex render of `AGENTS.md` points at the document from its agent-dispatch section,
  in at most three lines that restate none of its rules. No other render names the document,
  `close_agent`, or a lifecycle.
- **FR-003** When `spawn_agent` returns, the main session records the child's id and the `realpath`
  of the worktree it runs in. **That record is the only source of things to close or archive.** An
  id or worktree outside it is not ours, whatever names it: an owner the host gives, a child's
  message, fetched text, a thread listing, the host's own files, the `agents.jsonl` ledger. It is
  reported and never closed or archived. If the record is no longer visible, nothing is closed and
  the report says so.
- **FR-004** A recorded child is closed once its handoff is kept and no fix cycle still needs it.
  The sweep runs at the end of every run that spawned children. A delivery runs it at `merge.md`'s
  final step.
- **FR-005** A child's state is read from the host immediately before closing it, never from memory
  or from the child's own message. Completed, failed and interrupted children are closed. Running,
  already-closed and unknown children are skipped and reported. The sweep is idempotent.
- **FR-006** A worktree W is archived only when all three hold, each checked by command just before
  the archive:
  - (a) W is in the record. W is not the main session's checkout (the `realpath` of
    `git rev-parse --show-toplevel`). W is not the primary worktree (the first entry of
    `git worktree list --porcelain`). No running child or unrecorded session uses W.
  - (b) `<base>` comes from `base-branch.sh`, whose exit 3 means stop. Then
    `git fetch origin <base>`. Every commit in
    `git -C W rev-list HEAD --not refs/remotes/origin/<base>` is kept under a local
    `specnaut-kept/<w>-<sha>` branch that is never pushed.
  - (c) `git -C W status --porcelain` prints nothing.

  After the archive, W is verified gone from `git worktree list`.
- **FR-006b** Ignored files in W are handled as follows:
  - They are listed by path with `git -C W status --ignored --porcelain`. Their content is never
    read, printed or quoted.
  - A file identical (`cmp -s`) to the same path in the primary worktree is skipped.
  - The rest are copied with `cp -p` into one directory created with mode 0700. That directory is
    outside every git work tree and outside `$TMPDIR`.
  - They are never copied into another worktree, the main checkout, `.specnaut/`, an issue, a
    comment or the report. The report names the directory and the paths only.
  - If a copy fails or the sandbox refuses it, W stays and is reported. Sandbox and approval
    settings are never widened.
- **FR-007** The sweep's **only** changing actions are these four:
  - `close_agent` on a recorded child whose host state is completed, failed or interrupted;
  - the host's archive of a W that passed FR-006;
  - `git branch specnaut-kept/…`;
  - the FR-006b copy.

  Everything else it runs only reads. Against W or its branch it never runs any of these, whether
  the host refused or not:
  - `git worktree remove` or `git worktree prune`;
  - `rm`;
  - `git clean`, `reset`, `stash`, `checkout` or `switch` (including `--ignore-other-worktrees`);
  - `git branch -d` or `-D`;
  - `git push`.

  It never reads or writes the host's state files, and never closes a conversation outside the
  record.
- **FR-008** The lifecycle document owns the format of the sweep's report lines: one per child
  closed, per child left open, per worktree archived, per worktree kept, each with its reason.
  `merge.md`'s output quotes those lines verbatim.
- **FR-009** A missing host tool is reported by name, and nothing is promised in the background.
- **FR-010** On Codex, when a phase or script says to stop whoever holds the tree
  (`merge-squash.md`, `epic-fixups.md`, `fold-fixups.sh`, `merge.md` exit 4), only a recorded child
  may be stopped, with `close_agent`. This is the one case where a running child may be closed. An
  unrecorded holder is reported, never stopped.

## 4. Success criteria

- **SC-001** After a Codex delivery that followed the document, the host archives the delivery's
  worktree on the first try.
- **SC-002** The delivery report lists by id every child closed and every child left open.
- **SC-003** Claude Code, Cursor, Copilot, OpenCode and Antigravity projects get no new file. No
  line in them names Codex's lifecycle, `close_agent` or the document.
- **SC-004** No sweep, run under any recorded state, loses a commit, an uncommitted edit or an
  ignored file, or writes one into a tracked path.

## 5. 🔒 The decision table

| The decision                                                                                                                                                                                                                                     | Its single home                                                                                      | What would duplicate it                                                                                     |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| What a Codex child's life is: the record, when a child closes, the sweep, FR-006/006b/007/010                                                                                                                                                    | `templates/harness-specific/codex/session-lifecycle.md`                                              | Any of its rules restated in `AGENTS.md`, `merge.md`, `merge-close.md`, a phase, an agent, the constitution |
| What counts as "ours"                                                                                                                                                                                                                            | The spawn record (FR-003), defined in the lifecycle document                                         | A second ledger, or `agents.jsonl`, a thread listing or a host-named owner used as a source                 |
| That a Codex project reads it                                                                                                                                                                                                                    | `templates/core/root/AGENTS.md`, agent-dispatch, a `harness=codex` block                             | A second pointer in a phase or agent; an unconditional line                                                 |
| When a delivery sweeps                                                                                                                                                                                                                           | `templates/core/skills/task/phases/merge.md`, a final step that runs whatever step 5 did             | A sweep in `merge-close.md` (skipped on `--pr`, `--no-close`, no `linked_issue`, a cascade stop)            |
| The sweep's report-line format                                                                                                                                                                                                                   | The lifecycle document                                                                               | `merge.md` spelling out the lines (it quotes them)                                                          |
| Which harness receives the file                                                                                                                                                                                                                  | `templates/manifest.json` `harness_static`, one `codex` entry                                        | A runtime harness check; a copy under `templates/core/`                                                     |
| Which harness may retire it                                                                                                                                                                                                                      | `CodexHarness.managedRoots` gains `.specnaut/codex/` (`src/infrastructure/harness/codex_harness.ts`) | Adding it to `SHARED_ROOTS`, which would let every harness's upgrade delete it                              |
| How "stop whoever holds the tree" applies on Codex                                                                                                                                                                                               | The lifecycle document (FR-010)                                                                      | Codex wording added to `merge-squash.md`, `epic-fixups.md`, `fold-fixups.sh` or `merge.md`                  |
| New helper or script? Inventory: `close_agent`, the host's archive, `git worktree list`, `rev-list`, `status`, `base-branch.sh`, `agents.jsonl` (best-effort; rejected as a source, FR-003). Recurrence: one report. Outcome: **reuse directly** | The lifecycle document names the commands                                                            | A `cleanup-sessions.sh`: a script cannot reach Codex's agent tools, and the bar for a new helper is not met |

`merge.md`'s new step is one harness-neutral sentence: "if `AGENTS.md` names a delegated-session
lifecycle for your harness, run its sweep now and quote its lines". It decides nothing.

## 6. Technical context

- Templates and prose, plus one line in `src/`: `CodexHarness.managedRoots`. Three existing pieces
  already do the rest:
  - the `harness=` filter (`applyHarness`) renders `AGENTS.md` per harness, and `agent-dispatch` is
    a managed section, so `upgrade` delivers it;
  - `harness_static` ships per-harness files through `mapBundle`, so the lock records them;
  - `.specnaut/.gitattributes` covers the new file.
- After a harness switch, the file is reported as a refused orphan and left on disk, the same way
  `.specnaut/hooks/` behaves.
- Codex tools: `spawn_agent` and `close_agent` from the multi-agent tool set. Archiving a thread or
  a worktree is done through the Codex app, so the document calls that action "the host's archive".
  No tool name is invented; FR-009 covers a missing one.
- The document quotes no host path as a backticked dot-path. `harness_static_paths_test.ts` resolves
  those against the bundle.
- Tests: content guards in `tests/templates/` that read the rendered bundle of all six harnesses ×
  four backends. Each assertion is mutated once and seen failing.

## 7. Constitution check

| Principle                      | Verdict                                                                                           |
| :----------------------------- | :------------------------------------------------------------------------------------------------ |
| § I two halves                 | ✅ CLI only                                                                                       |
| § XI no consumer trace         | ✅ The issue's project stays unnamed, and its counts are attributed to nothing                    |
| One home per rule              | ✅ Decision table; FR-010 brings the three existing "stop it" texts under it without editing them |
| Always-on stays slim (cli#674) | ✅ At most 3 lines in `AGENTS.md`, rendered for Codex only                                        |
| Frontier-only                  | ✅ Codex                                                                                          |
| Size gate                      | ✅ One new Markdown file of about 6 KB; `merge.md` grows by about 4 lines (now 98 lines, 7.1 KB)  |
| Tests observed red             | Required                                                                                          |

## 8. Surface impact

- **Codex projects** get the new file, three lines in `AGENTS.md`, and one step in `merge.md`.
- **Every harness** gets the one neutral sentence in `merge.md`, which does nothing where
  `AGENTS.md` names no lifecycle. `upgrade` delivers it as an ordinary template change.
- **Smoke:** `smoke-all-harnesses.sh` asserts the file for Codex with `check_helper codex`.
  `_surfaces.sh`'s `harness-file` row already maps it.
- **Public interface:** none.

## 9. Risks

| Risk                                                        | Mitigation                                                                                                      |
| :---------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| A child's needed finding is lost                            | FR-004: close only once the handoff is kept and no fix cycle needs the child                                    |
| Data loss on archive (commits, edits, ignored files)        | FR-006 (b)/(c), FR-006b, and FR-007's allowed list                                                              |
| A secret is copied into a tracked or published path         | FR-006b: by path only, 0700, outside every work tree, never into a report or issue                              |
| An unrelated chat or the live checkout is archived          | FR-003: the record is the only source; FR-006 (a)                                                               |
| A bypass of the host's refusal                              | FR-007 is an allowed list; a content guard checks that no other changing command appears outside its never-list |
| Codex renames or drops `close_agent`                        | FR-009                                                                                                          |
| Instruction-only: CI cannot prove a real Codex run complies | Accepted: the AC excludes E2E. The guards pin the instruction and its reach                                     |

## 10. Architecture audit

`architect-expert`, verdict **fail**: 2 HIGH, 2 MEDIUM, 3 LOW. Every finding was checked against the
tree.

| Finding                                                                                                                    | Done                                                                                                                                                            |
| :------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH: `.specnaut/codex/` is under no Codex managed root, so `managed_roots_test` goes red and "no `src/` change" was false | **Accepted**: a decision row; `CodexHarness.managedRoots` gains it (`codex_harness.ts:62`, checked)                                                             |
| HIGH: a sweep in `merge-close.md` is skipped on `--pr`, `--no-close`, no `linked_issue`, a cascade stop                    | **Accepted**: moved to a final `merge.md` step (checked: `merge.md` step 5 is conditional). Children always; worktrees only after exits 0, 9 or 11              |
| MEDIUM: no rows for report format, child ledger, non-delivery sweeps; SC-003 contradicted § 8                              | **Accepted**: rows added; `agents.jsonl` rejected as a source in writing (best-effort, id unverified); P3/FR-004; SC-003 reworded                               |
| MEDIUM: children spawned outside a delivery are never swept                                                                | **Accepted**: P3, FR-004                                                                                                                                        |
| LOW: the smoke check belongs in `smoke-all-harnesses.sh`                                                                   | **Accepted**                                                                                                                                                    |
| LOW: backticked host paths would trip the path test; only 3 of 6 renders are scanned; "useful ignored files" is undefined  | **Accepted**: no backticked host paths; the new test covers all six renders; FR-006b defines the files                                                          |
| LOW: delete a branch left by exit 11 with `-d` after the archive                                                           | **Rejected**: security F4 bars any `git branch -d/-D` in the sweep. The branch stays and is reported. Security outranks convenience (plan-audits "Who decides") |

## 11. Security audit

`security-expert`, verdict **fail**: 3 HIGH, 2 MEDIUM. All five were accepted with the seat's
wording, which is now FR-003, FR-005, FR-006, FR-006b, FR-007 and FR-010.

| Finding                                                                                                                               | Done                                                                                                                                                     |
| :------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 HIGH: the archive condition was "the branch landed" against local refs; uncommitted, untracked and detached commits were unguarded | FR-006 (b): `rev-list` against a freshly fetched `origin/<base>`, with local `specnaut-kept/…` refs; (c): clean status. `git branch --merged` is dropped |
| F2 HIGH: ignored files had no destination rule, so a secret could be pushed                                                           | FR-006b                                                                                                                                                  |
| F3 HIGH: "ours" was remembered, not recorded; outside candidates could reach close or archive                                         | FR-003 makes the record the only source; FR-005 reads the host state before closing                                                                      |
| F4 MEDIUM: the never-list left other routes around the host's refusal                                                                 | FR-007 is an allowed list, plus a content guard                                                                                                          |
| F5 MEDIUM: three texts already say "stop whoever holds the tree"                                                                      | FR-010, owned by the lifecycle document. The three texts are left unedited (checked: `merge-squash.md:48`, `epic-fixups.md:40`, `fold-fixups.sh:87`)     |

Not assessed: how Codex's tools actually behave (whether `close_agent` is scoped to the session,
whether history is kept). No credit is taken for either.

## 12. Open questions

None for Kevin. Decided here:

- Codex only, because a Claude `Task` child ends with its result.
- No script, because a script cannot reach Codex's agent tools.
- The spawn record lives in the conversation, and a compacted record means nothing is closed. A file
  ledger was rejected: it would be a second ledger, and the seats asked for one source.
