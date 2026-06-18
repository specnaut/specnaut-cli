# Data Model — Preserve per-project customisations

Phase 1 structures for issue #367. All types are TypeScript on Deno; domain types are pure (no I/O,
no Deno globals). Paths are project-relative, forward-slash, matching the bundle's destination-path
form.

## PreserveConfig (domain — `src/domain/preserve_config.ts`, pure)

```ts
export type PreserveConfig = {
  /** Project-relative destination paths the maintainer has declared preserved. */
  readonly preserved: ReadonlyArray<string>;
};

export const EMPTY_PRESERVE_CONFIG: PreserveConfig = { preserved: [] };

/** Parse `.specnaut/preserve.yml`. Unparseable / empty ⇒ EMPTY_PRESERVE_CONFIG (never throws). */
export function parsePreserveConfig(yaml: string): PreserveConfig;

/** Serialize to canonical YAML (stable key order, trailing newline). */
export function serializePreserveConfig(cfg: PreserveConfig): string;
```

**Normalisation rule**: `parsePreserveConfig` trims each entry, drops blanks and duplicates, and
normalises a leading `./` away and backslashes to forward slashes, so membership tests against the
bundle's destination paths are exact. A non-list / malformed document degrades to
`EMPTY_PRESERVE_CONFIG` (the handler emits a warn) — it never aborts a refresh.

## PreserveStore (port — `src/application/ports.ts`)

```ts
export interface PreserveStore {
  /** Reads `.specnaut/preserve.yml`; absent file ⇒ EMPTY_PRESERVE_CONFIG. */
  read(projectDir: string): Promise<PreserveConfig>;
  write(projectDir: string, cfg: PreserveConfig): Promise<void>;
}
```

Adapter `FsPreserveStore` (`src/infrastructure/fs_preserve_store.ts`) mirrors `FsLockStore`:
try/catch `Deno.errors.NotFound` → `EMPTY_PRESERVE_CONFIG`. Tests use an in-memory fake.

## UpgradeAction.preserve — extended (domain — `src/domain/upgrade_plan.ts`)

```ts
| {
    kind: "preserve";
    dest: string;
    reason: "customized" | "declared";   // ← "declared" is new
    pluginAvailable: boolean;
  }
```

```ts
export type UpgradePlanOptions = {
  // ...existing fields (pluginInstalled, isPluginCovered, ...)
  /** True when the maintainer declared `dest` preserved in .specnaut/preserve.yml. */
  readonly isDeclaredPreserved?: (dest: string) => boolean;
};
```

**Branch ordering in `computeUpgradePlan`** (declared check first):

1. `isDeclaredPreserved(dest)` → `preserve / reason:"declared"` (wins over unchanged, auto-update,
   and plugin-migration).
2. existing plugin-migration branch (`covered && vanilla → migrate-to-plugin`).
3. existing customised branch (`diskSha !== lockSha → preserve / reason:"customized"`).
4. existing `auto-update` / `unchanged` / `add-new` / `remove` branches.

## InitProjectInput / InitResult — extended (application — `src/application/init_project.ts`)

```ts
export type InitProjectInput = {
  // ...existing fields
  /** Destination paths to leave untouched on a forced refresh. Absent ⇒ today's behaviour. */
  readonly preservedPaths?: ReadonlySet<string>;
};

export type InitResult = {
  // ...existing fields
  /** Paths skipped because they were declared preserved (for the handler's per-file notice). */
  readonly preserved: ReadonlyArray<string>;
};
```

`InitProjectUseCase.execute` builds `bundleToWrite` = `bundle` minus `preservedPaths`, calls
`writer.writeBundle(bundleToWrite, …)`, and reports the removed set as `preserved`.

## DivergenceResult / DiffProjectResult (application — `src/application/diff_project.ts`)

```ts
export type DivergenceResult =
  | { kind: "differs"; dest: string; diskContent: string; bundledContent: string }
  | { kind: "matches"; dest: string }
  | { kind: "missing"; dest: string }; // declared/lock-tracked on disk but absent from new bundle

export type DiffProjectInput = {
  readonly projectDir: string;
  /** When true, restrict to paths whose on-disk SHA differs from the lock SHA. */
  readonly onlyCustomised: boolean;
};

export type DiffProjectResult = {
  readonly results: ReadonlyArray<DivergenceResult>;
  readonly fromVersion: string; // installed templates version the bundle was mapped for
};
```

`DiffProjectUseCase` depends on `FsReader` + `LockStore` + `findHarness` only — **no `FsWriter`**
(read-only invariant). Rendering of `differs` results uses the existing `renderUnifiedDiff`
(`src/domain/diff.ts`) in `diff_handler.ts`.

## RefreshMode (value object — conceptual)

```ts
type RefreshMode = "normal" | "force" | "force-reset-preserved";
```

Modelled for clarity; in code the intent is threaded as a predicate/empty-set from the handler (D6),
so the domain never branches on the mode. Only `force-reset-preserved` may overwrite a preserved
file.

## Entity / state summary

- **Project installation** [aggregate root] — identified by `installed.lock`; owns the managed-file
  set and (now) the `preserve.yml` declarations. Enforces: a declared file is never silently
  overwritten.
- **Managed file** — identified by destination path. Two orthogonal axes:
  - content: `vanilla` (disk SHA = bundle SHA) | `customised` (disk SHA ≠ lock SHA)
  - declaration: `declared-preserved` | `not-declared`
- A refresh's treatment of a file is a pure function of (content axis, declaration axis, refresh
  mode, plugin coverage), resolved by the branch ordering above.
