# Orphan spec detection — the chain, inspected at rest

The chain moves a feature forward in one session. This check reads it across the project at rest,
and names the verb each stalled feature is missing. It reads spec artefacts and prescribes `/task`
verbs, so it is the pipeline's, not the backlog's.

Run it when asked to audit the spec pipeline, and from a grooming pass when the project keeps specs
locally — `task/groom.md` step 4 is the caller, under the same `.specnaut/specs/` condition.

Walk `.specnaut/specs/` (if present) and surface any feature directory missing its next step:

- Has `plan.md`, and its branch is not merged into the base branch → "needs `/task implement`".

**Legacy, pre-3.x only** — kept deliberately, not an oversight:

- Has `spec.md` but no `plan.md` → "needs `/task plan`". 3.x writes no `spec.md` (removed in
  2.0.0), so this matches only a feature directory a 1.x project left behind — exactly the thing
  worth surfacing. `tests/templates/removed_artefacts_test.ts` carries the matching allowlist entry.
- Has `tasks.md`: written before the `tasks` verb was folded into `implement`; read it as part of
  the plan, never as a step still owed.

This is read-only: never delete or modify spec files. A shipped feature's directory **is** removed —
by `phases/merge-close.md` step 8, at the merge, under the authorisation that closed the issue. A
reporter that edits what it walks cannot be trusted about what it found.
