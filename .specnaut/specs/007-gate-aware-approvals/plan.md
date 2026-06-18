# Implementation Plan: Gate-aware approval STOPs + headless VM mode

**Feature**: `007-gate-aware-approvals` | **Spec**: [spec.md](./spec.md) | **Issue**:
mkrlabs/specflow#359

## Summary

No new client code — reuse the #358 `specflow gate` command. Add guarded remote branches to the two
approval checkpoints in the bundled chain templates: a `plan_approval` gate at the plan checkpoint
and a `merge_approval` gate at pre-merge STOP #2. On approve → resume; on reject/non-answer → halt
cleanly. Add a headless-VM-mode doc composing remote mode + the clarify/plan/merge gates into an
unattended run. Re-bundle + sync the plugin mirror; respect the Windsurf 12k workflow cap.

## Technical Context

- **Edits** (templates, no TS):
  - `templates/core/skills/specflow/phases/auto-chain.md` — STOP #2 gains a remote branch
    (`merge_approval` gate) + a new "plan approval checkpoint (remote mode)" subsection; both
    guarded by `specflow gate status`. Off-path text unchanged.
  - `templates/core/skills/specflow/phases/plan.md` — a short note that, in remote mode, the chain
    raises a plan-approval gate after planning (pointer to auto-chain).
  - `docs/headless-vm-mode.md` (NEW) — enable remote mode, launch via `/goal` or `claude -p`,
    resolve gates remotely, prerequisite fallback.
- **Plumbing**: `deno task bundle` regenerates `src/templates_bundle.ts`; `cp` the edited phase
  files to `plugin/skills/specflow/phases/` (the byte-identical mirror); keep each emitted Windsurf
  workflow < 12000 chars (auto-chain/plan have headroom; verify).
- **Answer mapping**: `plan_approval`/`merge_approval` answer is `{approved, note?}`. approve →
  resume; reject (+note) → halt + report (comment-and-revise); the gate command surfaces
  timeout/cancel via exit code (3/4) → halt.

## Constitution Check

- **§ I/§ II**: reuses the #358 command + public contract only; gate payloads carry plan/PR
  summaries (project-authored, public), never a Cloud-internal identifier. **PASS**.
- No new dependency/code; both checkpoints fully behind the default-off switch (no regression). **No
  violations.**

## Project Structure

```
templates/core/skills/specflow/phases/auto-chain.md   # EXTEND — plan + merge approval remote branches
templates/core/skills/specflow/phases/plan.md         # EXTEND — remote plan-approval note
docs/headless-vm-mode.md                              # NEW — unattended operating mode
plugin/skills/specflow/phases/{auto-chain,plan}.md    # synced mirrors
src/templates_bundle.ts                               # regenerated
tests/integration/headless_docs_test.ts              # NEW — doc/bundle integrity assertions
```

## Phase 0 — Research

See [research.md](./research.md): checkpoint→gate-type mapping, approve/reject/revise semantics,
STOP-never-auto-proceeds invariant, and where each STOP lives.

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — the two approval decisions + the resume/halt control table.
- [contracts/README.md](./contracts/README.md) — reuses `docs/api/gates.md` + the #358
  `specflow gate` CLI surface; no new contract.
- [quickstart.md](./quickstart.md) — the gate-raise invocations + the headless-mode walkthrough.

## Phase 2 — Tasks

See [tasks.md](./tasks.md).
