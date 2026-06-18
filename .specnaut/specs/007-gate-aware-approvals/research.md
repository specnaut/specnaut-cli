# Research: Gate-aware approval STOPs + headless VM mode

## D1 — Checkpoint → gate-type mapping

**Decision**: plan checkpoint → `plan_approval` gate (payload `{summary, planRef?, context?}`);
merge checkpoint (STOP #2) → `merge_approval` gate (payload `{summary, prUrl?, context?}`). Both
raised via `specflow gate raise` (#358). **Rationale**: the contract's two approval types map 1:1
onto the two checkpoints; reusing the existing command means zero new client code. **Alternatives**:
a single generic `decision` gate (rejected — loses the typed approve/reject + the contract's
approval shape).

## D2 — approve / reject / comment-and-revise semantics

**Decision**: the answer is `{approved: boolean, note?}`. `approved:true` → resume the chain;
`approved:false` → halt and report (the `note`, when present, is the revision request).
**Rationale**: matches the contract; "comment-and-revise" is a reject-with-note, and revision is a
deliberate fresh run, not an auto-loop (avoids unbounded self-revision). **Alternatives**:
auto-revise loop (rejected — could thrash; a human asked for changes, so a human/agent re-runs
intentionally).

## D3 — STOP-never-auto-proceeds invariant

**Decision**: a STOP proceeds ONLY on an explicit `approved:true` (gate command exit 0 + parsed
approval). Every other outcome — reject, timeout (exit 3), cancelled (exit 4), error (1/5) — halts
the chain cleanly with the reason. **Rationale**: FR-004/SC-002/SC-003 — an approval checkpoint that
proceeded on ambiguity would defeat its purpose. **Alternatives**: proceed on timeout (rejected —
ships unreviewed work).

## D4 — Where the STOPs live + minimal edits

**Decision**: STOP #2 is in `phases/auto-chain.md` (§ "STOP #2 — Pre-merge validation"); the plan
checkpoint is added there as a new remote-only subsection between the silent `plan` gate and
`tasks`. `plan.md` gets a one-line pointer. Edits are guarded remote branches; off-path text is
byte-identical. **Rationale**: FR-005/FR-008/SC-004 — keep the local chain unchanged and the diff
auditable. **Alternatives**: a parallel remote chain doc (rejected — duplicates chain mechanics,
drifts).

## D5 — Headless VM mode is documentation composing existing parts

**Decision**: a new `docs/headless-vm-mode.md` describes enabling remote mode (`SPECFLOW_REMOTE` /
config), launching unattended (`/goal "<end state>"` or `claude -p "/specflow specify …"`), where
the clarify/plan/merge gates surface for remote resolution, and the unmet-prereq fallback. No new
runtime. **Rationale**: FR-006 — the mode is the composition of #358 + this feature; the value is a
clear runbook, not more code. **Alternatives**: a bespoke `specflow run --headless` command
(rejected — `/goal` + `claude -p` already provide the unattended driver; a new command would
duplicate them).
