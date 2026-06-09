# Phase 1 Data Model — Parent-managed detection

Bounded context: **CLI provisioning**. All types are CLI-internal; nothing crosses the OSS/Cloud
HTTP boundary.

## Domain types (pure — `src/domain/parent_managed.ts`)

### `ParentManagedDecision` (value object)

| Field                | Type             | Meaning                                                   |
| -------------------- | ---------------- | --------------------------------------------------------- |
| `isParentManaged`    | `boolean`        | Final decision: suppress agentic files?                   |
| `providingWorkspace` | `string \| null` | Canonical path of the first providing ancestor, or `null` |

Computed by the pure function:

```
isParentManaged(providingAncestor: string | null, standaloneOverride: boolean): boolean
  = standaloneOverride ? false : providingAncestor !== null
```

- **Invariant**: `standaloneOverride === true` ⇒ result is always `false` (override wins — FR-008).
- **Invariant**: pure — no `Deno.*`; all filesystem facts are passed in as arguments.

### Agentic-path predicate

```
isAgenticPath(dest: string): boolean
  = dest.startsWith(".claude/skills/")
 || dest.startsWith(".claude/agents/")
 || dest.startsWith(".claude/commands/")
```

- Operates on **harness-mapped destination strings**, not `CoreCategory`.
- Non-matches (always provisioned): every `.specflow/**` path, `AGENTS.md`, `.gitignore`,
  `.claude/settings.json`, and any non-`.claude` harness target.
- **Invariant**: the predicate never depends on repo identity (FR-010/FR-011).

## Application port (`src/application/ports.ts`)

### `ParentWorkspaceReader`

```
interface ParentWorkspaceReader {
  // Walk parents of targetDir to filesystem root; return the canonical path of
  // the first ancestor that has .specflow/ AND a deno.json whose `workspace`
  // member list resolves (canonically) to targetDir. null if none.
  findProvidingAncestor(targetDir: string): Promise<string | null>;

  // True iff targetDir/.specflow/standalone.yml exists.
  hasStandaloneOverride(targetDir: string): Promise<boolean>;
}
```

- The **only** abstraction that touches the filesystem for detection.
- Concrete adapter: `FsParentWorkspaceReader` (`src/infrastructure/`).
- Fakeable in unit tests by returning canned ancestor / override values.

## Manifest extension (`src/domain/installed_lock.ts`)

`InstalledLock` gains one optional field:

| Field           | Type                | YAML key         | When written                                              |
| --------------- | ------------------- | ---------------- | --------------------------------------------------------- |
| `parentManaged` | `true \| undefined` | `parent_managed` | only when the target is parent-managed; omitted otherwise |

- `serializeLock`: emit `parent_managed: true` only when set.
- `parseLock`: missing key ⇒ `undefined` (legacy locks parse cleanly).
- `entries` map is **unchanged in shape** but, for a parent-managed target, contains **no**
  `.claude/skills`/`.claude/agents`/`.claude/commands` keys (they were filtered before lock
  construction) — this is the FR-012 guarantee.
- `LockStore` port signatures unchanged.

## State / flow

```
init:
  handler → reader.hasStandaloneOverride(target)         \
          → reader.findProvidingAncestor(target)          >── isParentManaged() → decision
          → InitProjectInput{ parentManaged: decision }   /
  use case → bundle = mapBundle(...); if parentManaged: bundle = filter(bundle, !isAgenticPath)
           → writeBundle(bundle); lock.entries = from(bundle); lock.parentManaged = decision||undefined

upgrade:
  handler → lock = read()
          → parentManaged = lock.parentManaged ?? (legacy: re-derive via reader, persist)
  use case → if parentManaged: fullBundle = filter(fullBundle, !isAgenticPath)
           → never recreates .claude/ for suppressed paths
```

## Validation rules

- Member-path comparison uses canonical absolute paths on both sides (FR-004).
- Detection resolves on the **first** providing ancestor; ancestors above are not consulted.
- An ancestor with `.specflow/` but no matching member, or with a matching member but no
  `.specflow/`, does **not** qualify.
