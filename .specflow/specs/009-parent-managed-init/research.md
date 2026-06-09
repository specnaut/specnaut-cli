# Phase 0 Research — Parent-managed detection

All unknowns were resolved by an `architect`-agent pass over the current `apps/specflow` source. No
`NEEDS CLARIFICATION` markers remain.

## D1 — Where detection injects into `init`

- **Decision**: Resolve detection in the **handler** (`cli/handlers/init_handler.ts` `runInit()`)
  and pass a new `parentManaged: boolean` on `InitProjectInput`; the use case applies a bundle
  filter.
- **Rationale**: `InitProjectUseCase` already follows "handler resolves all inputs (harness,
  backlogBackend), use case executes". Detection is one more resolve-before-call. Keeps the use-case
  constructor stable (no new dep every test must stub) and mirrors upgrade, which reads the decision
  from the lock.
- **Alternatives considered**: Injecting `ParentWorkspaceReader` directly into the use case —
  rejected: forces every existing use-case test to stub a new dep and spreads FS concerns into the
  application layer's call graph for no benefit.
- **Seam**: filter runs in `InitProjectUseCase.execute()` immediately after
  `harness.mapBundle(...)`, before `writer.writeBundle(...)` and before lock-entry construction (so
  the lock is built from the filtered set — FR-012).

## D2 — Where detection injects into `upgrade`

- **Decision**: `UpgradeProjectUseCase` reads a new `lock.parentManaged` field and filters
  `fullBundle` before computing `destPaths`/`bundle`. On a **legacy lock** lacking the field, the
  upgrade handler re-runs detection via the port and persists the result into the rewritten lock.
- **Rationale**: The lock is read first in upgrade anyway; caching the decision there avoids a
  filesystem walk on every upgrade and makes the suppression deterministic regardless of whether
  `.claude/` happens to exist on disk. Re-deriving from "is `.claude/` absent?" would be fragile
  (could be coincidental).
- **Alternatives considered**: Always re-walk the FS on upgrade — rejected: wasteful and couples
  upgrade to live workspace layout that may have moved.

## D3 — How to identify "agentic" paths to suppress

- **Decision**: A pure predicate `isAgenticPath(dest)` over the **already-harness-mapped bundle
  keys** (the destination strings), matching prefixes `.claude/skills/`, `.claude/agents/`,
  `.claude/commands/`.
- **Rationale**: `CoreCategory` (`agent`/`skill`/`phase`/…) only maps to `.claude/` paths inside
  `claude_harness.ts`; other harnesses map the same categories elsewhere. The destination string is
  the stable, harness-resolved truth. `plugin_coverage.ts` is the in-repo precedent for path-prefix
  predicates over the `.claude/` space.
- **Alternatives considered**: Filtering on `CoreCategory` before mapping — rejected: leaks
  harness-mapping knowledge into the filter and would wrongly suppress non-`.claude` harness
  targets. Note `.claude/settings.json`, `AGENTS.md`, `.gitignore`, all `.specflow/` paths do
  **not** match → always provisioned.

## D4 — Install manifest shape & FR-012

- **Decision**: `.specflow/installed.lock` (YAML), type `InstalledLock` in
  `src/domain/installed_lock.ts` (`parseLock`/`serializeLock`;
  `entries: dest → {sha256, installedAt, templatesVersion}`). Add `readonly parentManaged?: true`,
  serialized as `parent_managed: true`, key omitted when false/absent.
- **Rationale**: Because the use case builds `lockEntries` from the **filtered** bundle, agentic
  dests never enter `entries` — FR-012 satisfied with no extra bookkeeping. The boolean field only
  caches the decision for upgrade. `LockStore` read/write signatures unchanged.
- **Alternatives considered**: A separate "suppressed paths" list in the lock — rejected: redundant;
  absence from `entries` already encodes it, and a cached boolean is enough for upgrade.

## D5 — Reading `deno.json` workspace members & the upward walk

- **Decision**: New `ParentWorkspaceReader` port; adapter walks `dirname` upward to root, and at
  each ancestor checks `.specflow/` exists AND `deno.json` `workspace: string[]` has a member that,
  resolved relative to the ancestor and `Deno.realPath`-canonicalised, equals the canonicalised
  `targetDir`.
- **Rationale**: No existing code parses workspace members or walks parents for this purpose (the
  only upward walk, in `fs_staging_store.ts`, is for empty-dir cleanup — not reusable). A dedicated
  port keeps the walk testable and the use cases pure. `Deno.realPath` on both sides handles
  relative paths and symlinks (FR-004).
- **Alternatives considered**: Inline `Deno.*` in the handler — rejected: unit-untestable, violates
  ports discipline. Supporting `package.json`/Cargo workspaces — out of scope; spec pins the
  Deno-workspace mechanism.

## D6 — Override marker semantics

- **Decision**: Presence of `target/.specflow/standalone.yml` short-circuits detection to `false`
  (full provisioning). Contents are irrelevant.
- **Rationale**: Spec FR-008 + edge case: a mere marker is the signal; requiring a schema would add
  friction for an escape hatch. The port exposes `hasStandaloneOverride()` so the domain decision
  function stays pure.

## D7 — Test strategy

- **Decision**: Pure predicates → `tests/domain/parent_managed_test.ts`. Use-case suppression →
  extend `tests/application/{init,upgrade}_project_test.ts` with a fake reader / lock field. C1–C5 →
  `tests/integration/{init,upgrade}_parent_managed_test.ts` building parent fixtures
  programmatically in `Deno.makeTempDir` (a parent dir with `.specflow/` + `deno.json`
  `workspace: ["./child"]`), per the existing `init_test.ts` / `upgrade_test.ts` precedent.
- **Rationale**: Mirrors the established two-tier test pattern (in-memory fakes for units, temp
  dirs + `runSpecflow` for integration). Fixtures are built in-test, not stored statically — matches
  upgrade test precedent.
