# Tasks: Gate-aware clarify phase

**Feature**: `006-gate-aware-clarify` | **Spec**: [spec.md](./spec.md) | **Plan**:
[plan.md](./plan.md) **Repo**: `apps/specflow` (`mkrlabs/specflow`, issue #358)

Standing gate after every code task:
`deno task check && deno lint && deno fmt --check && deno task test`.

## Phase A — `specflow gate` command surface

- [x] **T001** `src/cli/parser.ts`: add `GateIntent` to the `Intent` union
      (`sub: status|raise|cancel`, `apiUrl`, `type?`, `title?`, `payload?`, `task?`, `id?`);
      register string opts (`type`, `title`, `payload`, `task`) and a `gate` parse block validating
      `sub`. (FR-001)
- [x] **T002** `src/cli/handlers/gate_handler.ts` (NEW): `runGate(intent)` — load `CloudConfig` +
      `defaultCredentialStore`, build session via `makeGateSession`; dispatch `status` (exit 0/2/5),
      `raise` (open→await→apply → answer JSON on stdout; outcome→exit 0/3/4/5/1), `cancel` (exit
      0/1). Parse `--payload` JSON defensively (bad JSON → exit 1, clear message). (FR-002, FR-003,
      FR-007)
- [x] **T003** `src/main.ts`: dispatch `case "gate"` → dynamic-import `runGate`.

## Phase B — Gate-aware clarify template

- [x] **T004** `templates/core/skills/specflow/phases/clarify.md`: add a guarded remote branch in
      step 4 — when `specflow gate status` is 0, raise each accepted question as a gate
      (MC→`decision` with options, free-form→`clarification`), await, read the answer JSON,
      integrate via the existing Clarifications rules; idempotent (skip an already-logged
      clarification); off ⇒ existing local loop verbatim. Leave caps / deferral / Domain-Model exit
      gate untouched. (FR-004…FR-006, FR-008)
- [x] **T005** `deno task bundle` to regenerate `src/templates_bundle.ts`; mirror the edit into
      `.claude/skills/specflow/phases/clarify.md` (monorepo working copy) if present.

## Phase C — Tests (no network)

- [x] **T006** `[P]` `tests/cli/gate_parser_test.ts`: `gate status|raise|cancel` parse into the
      right intent; unknown sub → `unknown`; opts captured. (FR-001)
- [x] **T007** `[P]` `tests/integration/gate_command_test.ts`: drive `main.ts` `gate raise` with an
      injected resolving-backend fetch + fake clock → answer JSON on stdout, exit 0; assert
      timeout→3, cancelled→4, no-creds→5; assert **no Cloud-internal id in stdout** (§ I). (SC-001,
      SC-004, SC-005)

## Phase D — Validation & review

- [x] **T008** Full standing gate green; confirm the clarify off-path tests (if any) unchanged and
      the template diff is confined to the guarded remote branch (SC-003).
- [x] **T009** Boundary review (§ I): grep handler + tests for internal identifiers/backend strings;
      confirm only public answer fields + CLI exit codes surface.

## Dependencies

```
A (T001–T003) → B (T004–T005) → C (T006–T007) → D
```

Within C, T006/T007 are `[P]`. The injected-fetch seam for the integration test reuses #357's
`makeGateSession({fetchFn, now, sleep, env})`.
