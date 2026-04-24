# Specflow `upgrade` — Design

**Date**: 2026-04-25 **Status**: draft, awaiting review **Feature**: template-upgrade
(post-release-ready) **Prerequisites**: v0.1 release-ready bundle merged on `main` (156 tests green)

---

## 1. Objectives and non-objectives

### Objectives

1. Add `specflow upgrade [--dry-run] [--force]` which updates the templates of an existing project
   to the version embedded in the current binary.
2. **Never silently overwrite** a user's local customization.
3. Automatically detect unchanged files and update them without prompting.
4. For customized files, display a **clear diff** between the current template (in the binary) and
   the disk content, then let the user decide (manual).
5. Persist a SHA256 snapshot of the installed templates in `.specflow/installed.lock` to enable
   reliable modification detection.

### Non-objectives

- **3-way automatic merge** — rejected in brainstorm (option B).
- **Generalized `init --force`-style backup** — rejected (option C).
- **Rollback of the upgrade** — if the user wants to cancel, `git restore` or `git checkout` does
  the job.
- **Incremental sync** (diff between 2 template versions) — simple full compare is enough in v0.1.
- **Binary update** — that's `self-update`, not `upgrade`.

---

## 2. CLI surface

```
specflow upgrade [--dry-run] [--force]
```

- No flag: interactive upgrade. Shows a summary and asks for confirmation before writing.
- `--dry-run`: shows what would be done, no writing.
- `--force`: for customized files, overwrite anyway (with backup `.specflow.bak` — reuses the
  existing mechanism from Task 7 of the previous feature).

### Output

```
specflow upgrade — templates 0.2.0 → 0.3.0

  auto-update (unchanged locally)
    ✓ .claude/commands/speckit.specify.md
    ✓ .claude/commands/speckit.plan.md
    ✓ .specify/templates/spec-template.md
    ✓ tasks/backlog.md
    … and 25 others

  customized locally (not touched)
    ⚠ AGENTS.md
    ⚠ .specify/memory/constitution.md
    ⚠ .claude/agents/product-owner.md

  new files to add
    + .claude/commands/speckit.new-command.md

  29 auto-updated, 3 preserved (customized), 1 added.

For customized files, review the diff below and merge manually if desired.
Re-run with --force to overwrite them (your edits will be backed up to .specflow.bak).

---- diff: AGENTS.md ----
--- binary (0.3.0)
+++ local
@@ -5,6 +5,15 @@
 ## Tech stack
...
```

Exit 0 if nothing failed; exit 1 otherwise.

---

## 3. DDD architecture

```
src/
├── domain/
│   ├── installed_lock.ts       # NEW — InstalledLock value object
│   │                            #       (map filename → { sha256, installedAt })
│   └── upgrade_plan.ts         # NEW — UpgradeAction union + computePlan()
├── application/
│   ├── ports.ts                # MODIFY — add LockStore port
│   └── upgrade_project.ts      # NEW — UpgradeProjectUseCase
├── infrastructure/
│   └── fs_lock_store.ts        # NEW — FsLockStore via @std/yaml on .specflow/installed.lock
├── cli/
│   ├── parser.ts               # MODIFY — add upgrade intent
│   ├── help.ts                 # MODIFY
│   └── handlers/
│       └── upgrade_handler.ts  # NEW — renders diff + confirm
└── main.ts                     # MODIFY — dispatch upgrade intent

Also:
src/application/init_project.ts  # MODIFY — init writes the lock file too
```

---

## 4. Domain — `InstalledLock`

```typescript
export type LockEntry = {
  readonly sha256: string;
  readonly installedAt: string; // ISO 8601
  readonly templatesVersion: string;
};

export type InstalledLock = {
  readonly version: 1;
  readonly templatesVersion: string; // templates version at last install/upgrade
  readonly entries: ReadonlyMap<string, LockEntry>;
};
```

Format YAML on disk (`.specflow/installed.lock`):

```yaml
version: 1
templates_version: 0.2.0
entries:
  ".claude/commands/speckit.specify.md":
    sha256: "abc123..."
    installed_at: "2026-04-25T10:00:00Z"
    templates_version: "0.2.0"
  "AGENTS.md":
    sha256: "def456..."
    installed_at: "2026-04-25T10:00:00Z"
    templates_version: "0.2.0"
```

Each entry tracks which version of templates this file came from. Supports future scenarios where
partial upgrades happen (e.g. user upgraded before, some files are already from 0.3.0).

Pure domain helpers:

- `parseLock(yaml: string): InstalledLock`
- `serializeLock(lock: InstalledLock): string`
- `computeSha256(content: string): Promise<string>` — reuse pattern from self-update

---

## 5. Domain — `UpgradePlan`

```typescript
export type UpgradeAction =
  | { kind: "auto-update"; dest: string; oldSha: string; newSha: string }
  | { kind: "preserve"; dest: string; reason: "customized" }
  | { kind: "add-new"; dest: string }
  | { kind: "unchanged"; dest: string }; // identical content already on disk

export type UpgradePlan = ReadonlyArray<UpgradeAction>;
```

Algorithm `computeUpgradePlan(currentFiles, lock, newBundle)`:

```
for each file in newBundle:
  let diskSha = sha256(content on disk) or null if not present
  let lockSha = lock.entries[file]?.sha256
  let newSha  = sha256(newBundle[file].content)

  if file not on disk:
    if file not in lock: "add-new" (brand new in this templates version)
    else: "add-new" (user deleted it; we re-add)

  else if diskSha == newSha:
    "unchanged" (already up to date)

  else if lockSha == null:
    "preserve" (no lock record — safer to not touch)

  else if diskSha == lockSha:
    "auto-update" (user hasn't changed the file since install)

  else:
    "preserve" (user customized — don't touch)
```

All pure. Testable without IO.

### Edge case — file removed from new bundle

If a path exists in the lock but NOT in the new bundle (we deleted a template in an upstream
revision), the use case emits no action for that path: we leave the file on disk (it's the user's
copy now) and **remove the entry from the updated lock**. Not a regular `UpgradeAction` variant —
handled as a cleanup step during `applied`.

---

## 6. Application — `UpgradeProjectUseCase`

```typescript
export type UpgradeProjectInput = {
  projectDir: string;
  dryRun: boolean;
  force: boolean;
};

export type UpgradeProjectResult =
  | { status: "up-to-date"; currentVersion: string }
  | {
    status: "planned";
    plan: UpgradePlan;
    fromVersion: string;
    toVersion: string;
  }
  | {
    status: "applied";
    plan: UpgradePlan;
    fromVersion: string;
    toVersion: string;
    backups: ReadonlyArray<string>;
  };
```

Orchestration:

1. Load lock via `LockStore.read(projectDir)` → if missing, abort with message "this project was
   initialized before upgrade support; run `specflow init --force` to re-init with lock tracking".
2. Compare `lock.templatesVersion` vs `TEMPLATES_VERSION` (binary). If equal AND no user edits
   detected → `up-to-date`, exit early.
3. Load current file contents via `FsReader` (new small port OR reuse DenoFsWriter with added
   `readFile`).
4. `computeUpgradePlan(currentFiles, lock, TEMPLATES)` → plan.
5. If `dryRun` → return `planned`.
6. Else apply:
   - For each `auto-update`: write new content via FsWriter + update lock entry.
   - For each `add-new`: write + add lock entry.
   - For each `preserve` (without `--force`): skip.
   - For each `preserve` (with `--force`): write via FsWriter with `backupExisting: true` + update
     lock entry + track backups.
7. Persist updated lock via `LockStore.write()`.
8. Return `applied`.

### Port additions

```typescript
export interface LockStore {
  read(projectDir: string): Promise<InstalledLock | null>;
  write(projectDir: string, lock: InstalledLock): Promise<void>;
  lockPath(projectDir: string): string;
}

export interface FsReader {
  readText(projectDir: string, rel: string): Promise<string | null>;
}
```

`FsReader` is a new tiny port so the use case can sha-compare without pulling Deno APIs in. The
existing `FsWriter` is responsible for writing.

---

## 7. Infrastructure

### `FsLockStore`

- Implements `LockStore` via `@std/yaml` on `.specflow/installed.lock`.
- `read` returns `null` when the file doesn't exist (not a fatal error — just means the project
  pre-dates lock tracking).
- `write` creates `.specflow/` if absent.

### `FsReader` adapter

- Thin wrapper around `Deno.readTextFile` that returns `null` on `NotFound`.
- Can be added as a method on the existing `DenoFsWriter` class if we want to avoid proliferation,
  but cleaner as its own adapter.

### `FsWriter` integration

The existing `DenoFsWriter.writeBundle` already supports `backupExisting`. No new method needed. The
use case simply assembles a partial bundle (only the files to update) and calls
`writeBundle(partial, projectDir, { overwrite: true, backupExisting: input.force })`.

---

## 8. Init modifications

`specflow init` currently writes templates but does NOT create `installed.lock`. This must change:

1. Add a `SubprocessRunner`-free SHA256 util in `src/domain/sha256.ts` (we already have `sha256Hex`
   inline in self-update — extract it).
2. After `writer.writeBundle` succeeds, compute the SHA of each written file's content (we have them
   in memory — the bundle values), assemble an `InstalledLock` with the current
   `TEMPLATES_VERSION` + now() timestamp, and persist via `LockStore.write()`.
3. `InitProjectUseCase` grows a `lockStore: LockStore` dependency.
4. `InitResult.initialized` gets a `lockWritten: boolean` (for logging).

### Upgrade-before-lock fallback

For users who `init`'d before this feature lands: their `.specflow/installed.lock` is missing.
`upgrade` prints a clear message:

```
error: no .specflow/installed.lock found.
This project was initialized before upgrade support existed.
To enable future upgrades, run:
  specflow init --here --force
(Your customizations will be backed up to .specflow.bak files.)
```

Exit 2.

---

## 9. Diff rendering

For each `preserve` action, the handler renders a unified diff using a tiny pure implementation:

- Use `@std/fs` / roll our own minimal line-diff (we have two strings; split by `\n`; compute
  LCS-based diff; emit `---`/`+++` headers).
- Alternative: shell out to `diff` if present; fallback to a line-by-line count summary if not.

**Decision: roll our own**, ~50 LOC in `src/domain/diff.ts`. Pure, testable, no shell dep. Not
trying to match `git diff` pixel-for-pixel — a readable unified-ish diff is enough.

---

## 10. Tests

### Domain

- `tests/domain/installed_lock_test.ts` — YAML round-trip, missing entries, legacy format rejection
  (3 tests)
- `tests/domain/upgrade_plan_test.ts` — 6 tests covering each UpgradeAction kind + mixed scenarios
- `tests/domain/diff_test.ts` — 4 tests (identical, one-line change, additions, deletions)

### Application

- `tests/application/upgrade_project_test.ts` — 5 tests with fake FsReader + fake LockStore + fake
  FsWriter (up-to-date, plan-only dry-run, apply with customizations preserved, force overwrite with
  backups, missing-lock error)

### Infrastructure

- `tests/infrastructure/fs_lock_store_test.ts` — 3 tests (read null, write+read round-trip, format
  preservation)

### Integration

- `tests/integration/upgrade_test.ts` — 2 tests: init-then-upgrade no-op path,
  init-then-modify-then-upgrade with diff output on stdout

Target: 23 new tests, 156 → 179.

---

## 11. Dependencies between changes

Order:

1. Extract shared `sha256Hex` to `src/domain/sha256.ts` (already live in self-update)
2. Add `InstalledLock` domain + YAML parse/serialize
3. Add `LockStore` port + `FsLockStore` adapter
4. Modify `InitProjectUseCase` + init_handler to write lock
5. Add `UpgradePlan` domain + `computeUpgradePlan`
6. Add `diff` domain util + tests
7. Add `FsReader` port + adapter
8. Add `UpgradeProjectUseCase`
9. Add `upgrade` intent in parser + help + main dispatch
10. Add `upgrade_handler.ts` (renders diff + confirm prompt)
11. Integration test
12. Doc update (`templates/claude/commands/…` — probably nothing, but README gets an Upgrade
    section)

~12 tasks. Estimated ~1600 LOC src + ~900 tests.

---

## 12. Risks and open questions

1. **Pre-existing installs without lock**: resolved in section 8 — clean error with upgrade path via
   `init --force`.
2. **Lock file drift vs disk**: if user deletes a file, the lock still contains it. Decision: on
   upgrade, if file missing on disk AND still in lock → emit `add-new` action to re-add (assumes
   user's deletion was accidental OR the re-add is harmless). User can always `--dry-run` first.
3. **Diff rendering on binary files**: templates are all text. Not a concern.
4. **Large diffs flooding the terminal**: if a `preserve` diff is huge (>200 lines), truncate
   display and hint at saving to a file. Edge case — acceptable in v1.
5. **Concurrent lock corruption**: no locking mechanism. If user runs two `upgrade` in parallel,
   last-writer wins. Acceptable (CLI, no multi-process workflow expected).
6. **`.specflow/installed.lock` in git**: should be committed (like `package-lock.json`) so team
   upgrades stay consistent. Add to bundled `.gitignore` as a NEGATIVE (`!.specflow/installed.lock`)
   — but actually the current `.gitignore` doesn't ignore `.specflow/` so no change needed. The
   config.yml.local is already the only ignored thing.

---

## 13. Next step

After validation of this design, move to `writing-plans` for a plan broken down per section 11.
