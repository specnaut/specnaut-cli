# Implementation Plan: Gate-aware clarify phase

**Feature**: `006-gate-aware-clarify` | **Spec**: [spec.md](./spec.md) | **Issue**:
mkrlabs/specflow#358

## Summary

Add a thin `specflow gate` CLI command wrapping the #357 `GateSession`, then make the bundled
`clarify.md` phase gate-aware behind the remote switch. The command gives the markdown phase a
non-interactive way to raise a gate and block for a remote answer; the phase maps MC questions →
`decision` gates and free-form → `clarification` gates, integrates the answer with its existing spec
rules, and falls back to the local loop when remote mode is off.

## Technical Context

- **Runtime/arch**: Deno/TypeScript, hexagonal. New CLI handler `gate_handler.ts` (sibling of
  `cloud_handler.ts`), parser intent, `main.ts` dispatch. Domain reused from #357 unchanged.
- **Command shape**:
  - `specflow gate status [--api-url]` → exit 0 + JSON `{enabled, remote}` when remote mode on; exit
    non-zero when off or unconfigured. Lets the phase branch.
  - `specflow gate raise --type <t> --title <s> --payload <json> [--task N] [--api-url]` → open +
    await + apply; on `answered` prints the answer JSON to stdout, exit 0; `unresolved` → exit 3;
    `cancelled` → exit 4; `no_remote` → exit 5; other error → exit 1. Distinct codes are parseable.
  - `specflow gate cancel <id> [--api-url]` → cancel, exit 0/non-zero.
- **Wiring**: handler loads `CloudConfig` (`readCloudConfig`) + `defaultCredentialStore`, builds the
  session via `makeGateSession(...)` (#357), and drives it. All Cloud I/O already injectable there.
- **Template**: edit `templates/core/skills/specflow/phases/clarify.md` step 4 to add a guarded
  remote branch; re-run `deno task bundle` to refresh `src/templates_bundle.ts`. Mirror the edit
  into the monorepo working copy `.claude/skills/specflow/phases/clarify.md` if present.

## Constitution Check

- **§ I**: the command only re-emits the #357 client's typed answer (public wire fields) and
  CLI-owned status codes — no backend string/identifier. **PASS**.
- **§ II**: sole coupling remains the `/api/v1` contract via the #357 client. **PASS**.
- No new dependency; remote path fully behind the default-off switch (no regression). **No
  violations.**

## Project Structure

```
src/cli/handlers/gate_handler.ts   # NEW — `specflow gate <status|raise|cancel>`
src/cli/parser.ts                  # EXTEND — GateIntent + parse block + string opts
src/main.ts                        # EXTEND — dispatch case "gate"
templates/core/skills/specflow/phases/clarify.md  # EXTEND — guarded remote branch
src/templates_bundle.ts            # REGENERATED via `deno task bundle`
tests/cli/gate_parser_test.ts      # NEW — parse/validation
tests/integration/gate_command_test.ts  # NEW — end-to-end via main.ts with stub fetch
```

## Phase 0 — Research

See [research.md](./research.md): command exit-code scheme, status-detection contract, the
MC→decision / free→clarification mapping, idempotent re-run, and template-edit minimality.

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — GateIntent, the command's stdout/exit contract, the
  question→gate mapping.
- [contracts/README.md](./contracts/README.md) — the `specflow gate` CLI surface (the phase↔CLI
  contract) + pointer to `docs/api/gates.md`.
- [quickstart.md](./quickstart.md) — exercising the command + the gate-aware clarify path.

## Phase 2 — Tasks

See [tasks.md](./tasks.md).
