# Contract — Parent-managed detection for init/upgrade

CLI-internal contract (no wire/HTTP surface). Mirrors the source contract in
`mkrlabs/specflow-monorepo:.specflow/specs/002-centralize-skills-agents/contracts/parent-managed-detection.md`
(C1–C5) and binds it to concrete `apps/specflow` seams.

## 1. Detection port — `ParentWorkspaceReader`

```ts
interface ParentWorkspaceReader {
  findProvidingAncestor(targetDir: string): Promise<string | null>;
  hasStandaloneOverride(targetDir: string): Promise<boolean>;
}
```

**`findProvidingAncestor` contract**

- Walks `dirname(targetDir)` upward to filesystem root.
- Returns the canonical path of the **first** ancestor `A` such that:
  - `A/.specflow/` exists (directory), **and**
  - `A/deno.json` exists and its `workspace` array contains ≥1 member whose path, resolved relative
    to `A` and canonicalised (`Deno.realPath`), equals the canonicalised `targetDir`.
- Returns `null` if no such ancestor exists or the root is reached.
- Tolerates missing/unparseable `deno.json` at an ancestor (treat as non-match, keep walking).

**`hasStandaloneOverride` contract**

- Returns `true` iff `targetDir/.specflow/standalone.yml` exists. Contents ignored.

## 2. Decision function (pure)

```ts
isParentManaged(providingAncestor: string | null, standaloneOverride: boolean): boolean
```

- `standaloneOverride === true` ⇒ `false` (override always wins).
- else ⇒ `providingAncestor !== null`.

## 3. Bundle filter

```ts
isAgenticPath(dest: string): boolean   // .claude/skills|agents|commands prefixes
```

- **init** (`InitProjectUseCase.execute`): after `harness.mapBundle(...)`, if `input.parentManaged`,
  drop every entry whose `dest` satisfies `isAgenticPath`. Build `writeBundle` input AND lock
  entries from the filtered bundle.
- **upgrade** (`UpgradeProjectUseCase.execute`): after `fullBundle` is built, if the target is
  parent-managed (per lock), drop agentic entries before computing `destPaths`/`bundle`. Never plan,
  write, or "restore" a suppressed path.

## 4. Lock-schema change

- `InstalledLock` gains `parentManaged?: true`; YAML key `parent_managed`, emitted only when set.
- For a parent-managed target the `entries` map contains **no** agentic keys.
- Legacy locks (no key) parse to `undefined`; upgrade re-derives once via the port and persists the
  result.

## 5. Handler wiring

- `init_handler.runInit`: call the reader, compute the decision, set
  `InitProjectInput.parentManaged`. On `true`, print exactly once:
  `parent-managed workspace detected — skills/agents inherited from parent`.
- `upgrade_handler.runUpgrade`: take `lock.parentManaged` if present; else re-derive via the reader
  and persist into the rewritten lock.

## 6. Acceptance mapping (C1–C5 ⇄ tests ⇄ SC/FR)

| Contract                                           | Test                                                                                                                 | Asserts                                                                                               | Spec               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------ |
| **C1** member target ⇒ init writes 0 agentic files | `tests/integration/init_parent_managed_test.ts::parent-managed suppresses agentic`                                   | 0 files under `target/.claude/skills` & `target/.claude/agents`; `.specflow/` present; notice printed | SC-001, FR-005/006 |
| **C2** standalone ⇒ unchanged provisioning         | `…::standalone provisions normally`                                                                                  | skills/agents written; parity with baseline                                                           | SC-002, FR-009/010 |
| **C3** upgrade on parent-managed ⇒ no resurrection | `tests/integration/upgrade_parent_managed_test.ts::no agentic resurrection`                                          | upgrade updates `.specflow/`; 0 agentic files; no `.claude/` recreated                                | SC-003, FR-007     |
| **C4** `standalone.yml` ⇒ forced full provisioning | `tests/integration/init_parent_managed_test.ts::override forces full`                                                | skills/agents written despite enclosing workspace                                                     | SC-004, FR-008     |
| **C5** manifest has no agentic entries             | `tests/integration/upgrade_parent_managed_test.ts::lock has no agentic entries` (+ unit in `installed_lock_test.ts`) | `installed.lock` entries exclude `.claude/skills`/`.claude/agents`; `parent_managed: true` present    | SC-005, FR-012     |

Unit coverage backing the above:

- `tests/domain/parent_managed_test.ts` — `isParentManaged` truth table (override wins; null ⇒
  false; ancestor ⇒ true) + `isAgenticPath` prefix matrix.
- `tests/application/init_project_test.ts` — fake reader → filtered `written` set + filtered lock
  entries.
- `tests/application/upgrade_project_test.ts` — `lock.parentManaged=true` → filtered bundle; legacy
  lock → re-derive path.
- `tests/domain/installed_lock_test.ts` — `parent_managed` round-trips; absence ⇒ `undefined`.
