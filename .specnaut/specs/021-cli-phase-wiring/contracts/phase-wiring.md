# Contract — phase wiring

## A. Pull-on-entry (consuming phase docs, `spec-backend=cloud` block)

For each of `implement.md`, `review.md`, `analyze.md`, `tasks.md`, the cloud block prepends a single
materialisation step before any spec-reading:

```
<!-- BEGIN: spec-backend=cloud -->
**Materialise the spec (cloud backend):** run `specnaut spec pull <task>` ONCE now. The tabs are
written to the gitignored `.specnaut/specs/.cache/<task>/`; read the spec from there as files.
If the pull fails (offline/auth), stop with its message — do not proceed against an empty spec.
<!-- END: spec-backend=cloud -->
<!-- BEGIN: spec-backend=local -->
…unchanged pre-feature content…
<!-- END: spec-backend=local -->
```

- `implement.md`: the pull precedes the existing Lot 2 cloud step
  (`create-new-feature.sh --branch-only`).
- Local block: byte-identical to the pre-feature doc (golden test guards this).

## B. Auto-generation (task-creation guidance)

Rendered guidance (honoured by the agent that creates tasks) when `spec_autogen && cloud`:

```
After creating the task, ALSO generate its spec now: run the cloud `specify` flow for the new
task (branch-free). If generation fails, report it and continue — the task remains created
(auto-generation is never fatal to task creation).
```

Default (`spec_autogen` absent/false) or local backend: no auto-generation; task creation unchanged.

## C. Parallel authoring (guidance)

A note in the relevant skill/phase doc: cloud `specify` creates no branch, so several task specs can
be authored concurrently (by a user or an agent fleet) with no git-branch collision — drive one
`specify` per task in parallel.

## D. Lock field

`installed.lock` gains `spec_autogen: <bool>` (absent → `false`). Read by the rendered guidance; set
at init or by editing the lock. No new command required.

## Non-goals

The `spec pull`/`push` commands + cloud `specify` (Lot 2); the Cloud store/API (Lot 1); Web UI (Lot
3).
