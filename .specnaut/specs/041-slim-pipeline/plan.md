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

_Architecture and security, kept separate — to be filled._

## 5. Open questions

None for the user: the epic's rulings (2026-10-28: slim is the default; 2026-10-29: no eval) settle
scope and mechanism.

Decided here: `--full` is the explicit request for the 12-section plan; the risk threshold is a data
migration, a new authentication or authorisation surface, or a change to a public interface other
projects consume.
