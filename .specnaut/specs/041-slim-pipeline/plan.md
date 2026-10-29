# Brief — Slim the /task pipeline: brief by default, tasks folded into implement

Backlog item: specnaut-cli#676 "Slim the /specnaut pipeline: brief by default, fold tasks into
implement, drop extension blocks" (https://github.com/specnaut/specnaut-cli/issues/676), child of
epic specnaut-cli#674. Branch: `041-slim-pipeline`. Applies the static audit on #674 to the
pipeline's phase docs. Kevin's 2026-10-29 ruling replaces the eval: this lands on a green suite, no
content guard weakened, and bytes reported before and after.

Written as the brief this change makes the default.

## 1. Task and out of scope

**Task.** The default `/task` chain becomes `plan` (a 5-part brief) → `implement` (which carries
`tasks`' two real rules) → `review` → `merge`. Concretely:

- `plan.md` writes the brief below by default; the 12-section plan only on request
  (`/task plan --full`) or past the risk threshold it states. `plan-audits.md` is folded in: `plan`
  dispatches the seats, and their questions live in the seats' own plan-audit protocol.
- `tasks` stops being a verb. `tasks.md` and `tasks-template.md` leave the bundle (upgrade prunes
  them as orphans); an existing `tasks` addendum resolves to `implement`; `/task tasks` is a retired
  address pointing at `/task implement`.
- `implement.md` drops the ignore-file catalogue, the T001/[P] execution prose and the extension
  hooks; it keeps "fix what you find", "freeze then review", cloud setup and the epic pointer, and
  gains: carry the brief's decision table, extract an over-size file first, size your own subagent
  team under a cap.
- `auto-chain.md` keeps the one-stop policy and a short anti-stop list; the remote-mode gates move
  to `remote-gates.md` and orphan-spec detection to `orphan-specs.md`, both loaded on demand.
- `quality-gates`, `merge-squash`, `epic-loop`, `epic-commits` and `constitution` are trimmed of
  rationale the rule does not need. The extension-hook blocks go from every phase.
- `developer` reads the brief's guardrails and done checks; its
  `awaiting:product-owner-domain-brief` block on plan § 5/§ 6 goes (this lands before #678, so it
  carries that change).

**Out of scope.** `merge`, `merge-close`, `epic-fixups` as scripts (#677). The review fan-out and
the agent roster (#678). The always-on files and other skills (#679).

## 2. Guardrails

| The decision                                         | Its single home                                                                                        | What would duplicate it                       |
| :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------- | :-------------------------------------------- |
| What a brief contains, and when the full plan is due | `templates/core/skills/task/phases/plan.md`                                                            | a second list in `implement.md` or the router |
| The questions each seat asks of a plan               | the seat's own file: `architect-expert.md`, `security-expert.md`, `performance-expert.md` § plan audit | the questions restated in `plan.md`           |
| Who settles a technical fork                         | `plan.md` § "Who decides" (moved from `plan-audits.md`)                                                | a second rule in `auto-chain.md`              |
| Which verbs route                                    | the router's verb table + `ROUTABLE_PHASES` (`src/domain/addendum_audit.ts`)                           | a verb named in prose only                    |
| Where a `tasks` addendum now resolves                | `SKILL_DOC_RENAMES` / the addenda registry (`src/domain/addendum_audit.ts`)                            | a special case in the router                  |
| That `/task tasks` is retired                        | the `specnaut` router's Retired addresses table                                                        | a "tasks moved" note in each phase            |
| The chain's stops                                    | `auto-chain.md`                                                                                        | the stop rules restated in each phase         |
| Remote-mode gates                                    | `remote-gates.md`                                                                                      | gate commands left in `auto-chain.md`         |

Constitution: every phase keeps the first-line reference (#685's guard). § I/§ XI: nothing private
or consumer-specific. Size: every touched file shrinks or stays; none grows past its target.

## 3. Done, as runnable checks

- `deno task test` green: the phase-doc locks rewritten where their rule moved, never deleted with
  their file (`chain_stops_test`, `merge_squash_by_scope_test`, `test_tiers_test`,
  `routable_phases_test`, `phase_mentions_resolve_test`, `phase_addenda_test`, the local goldens,
  `init_test` / `init_codex_test`, `plugin_sync_test`, `plugin_coverage.ts`,
  `groom_delegates_orphan_specs_test`, `constitution_first_test`).
- A new upgrade test: a project with `tasks.md` installed and a `tasks` addendum upgrades with the
  file pruned and the addendum carried to `implement`.
- `size-ratchet.sh --since <base>` passes.
- Bytes before and after, measured at `af339c1d`: the `/task` skill (router + every doc under
  `phases/`) **131,353 B**; the read set of one standalone feature (router, plan, plan-audits,
  tasks, implement, review, merge, merge-squash, merge-close, auto-chain) **96,687 B**. The audit's
  target for the read set is ~27 KB; this slice owns plan / tasks / implement / auto-chain, and #677
  and #678 own merge and review.

## 4. Audit findings

### Architecture (`architect-expert`, 2026-10-29): fail, 2 HIGH · 4 MEDIUM · 2 LOW — all accepted

Verified against the tree: `implement.md` passes `--require-tasks`; `SKILL_DOC_RENAMES` carries the
`specnaut/tasks.md` and `specnaut/plan-audits.md` rows.

| Finding                                                                                                               | Decision                                                                                                                                                                                                                                                                                                                                              |
| :-------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH — a `tasks`→`implement` row in `SKILL_DOC_RENAMES` would move bytes and lock identity, breaking three invariants | A separate `PHASE_FOLDS` registry in `src/domain/addendum_audit.ts` moves only the addendum address, resolved to its end (`specnaut/tasks` and `task/tasks` → `task/implement`); `renameOf` / `addendumRenames` read both; the two dead doc rows are deleted (their vanilla copies prune as orphans); the never-chain invariant spans both registries |
| HIGH — `specs/NNN/tasks.md` has no home; implement, orphan detection, the cockpit and `developer` break               | The artefact sequence's home is `phases/orphan-specs.md` (rewritten, not moved); `implement` stops passing `--require-tasks`; the scripts keep the flag as a no-op with a stderr note; the cockpit drops `tasks`; `developer.md` updated                                                                                                              |
| MEDIUM — `/task tasks` retired where the `/task` router never looks; `/specnaut tasks` would chain                    | The router's unknown-verb rule checks the `specnaut` Retired addresses table first (a pointer); `/specnaut tasks` points straight at `/task implement`; a lock: no successor is itself retired                                                                                                                                                        |
| MEDIUM — `plan-audits` retirement, the perf seat's Mode 3 and the hot-path trigger have no home; questions unpinned   | Each seat's Mode 3 states its own questions (`performance-expert.md` gains one); the dispatch trigger stays in `plan.md`; a test reads each Mode 3 for its questions                                                                                                                                                                                  |
| MEDIUM — remote gates lost if the check moves with the procedure; positional loader list                              | `auto-chain.md` keeps the check and the pointer at both points; the router's contract-doc list becomes a table; `CONTRACT_DOCS` gains `remote-gates` (plan, review) and `orphan-specs` (groom); the phase floor is derived                                                                                                                            |
| MEDIUM — the cockpit's phase list is checked against nothing                                                          | `tasks` removed; one lock compares it with the router's chainable verbs plus `merge`                                                                                                                                                                                                                                                                  |
| LOW — a folded addendum names steps of a retired phase                                                                | The upgrade note says to re-anchor them in `implement`                                                                                                                                                                                                                                                                                                |
| LOW — the `--full` path drifts                                                                                        | `plan-template.md` names no `tasks.md`; `developer` finds the decision table by heading                                                                                                                                                                                                                                                               |

### Security (`security-expert`, 2026-10-29): needs follow-up, 2 MEDIUM · 2 LOW — all accepted

| Finding                                                                                   | Decision                                                                                                                                                                                                                              |
| :---------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MEDIUM — "audits are mandatory" not anchored to the brief path                            | `plan.md` step 6: the audits run on every plan, brief or full; a test asserts `plan.md` dispatches `security-expert` unconditionally                                                                                                  |
| MEDIUM — the `--full` trigger misses most new attack surfaces, judged by the author alone | The threshold is "adds or widens a trust boundary", the list written out; the brief carries a required "Surfaces added or widened" line; the security seat can require the full plan                                                  |
| LOW — a user's own extension hook stops silently                                          | `upgrade` prints one line when `.specnaut/extensions.yml` exists, pointing at `.specnaut/addenda/task/<phase>.md`; only the prose extension blocks go — harness hooks (`.specnaut/hooks/`, `.codex/hooks.json`, Claude settings) stay |
| LOW — no fallback where a harness cannot dispatch; two pointers at `plan-audits.md`       | `plan.md` says to answer each seat's Mode 3 inline, kept separate; the seats' "Spawned by" lines point at `plan.md`                                                                                                                   |

## 5. Open questions

None for the user: the epic's rulings (2026-10-28: slim is the default; 2026-10-29: no eval) settle
scope and mechanism.

Decided here: `--full` is the explicit request for the 12-section plan; the risk threshold is a data
migration, a new authentication or authorisation surface, or a change to a public interface other
projects consume.
