# Upgrade orphan-file handling — design spec

**Goal.** Make `specflow upgrade` clean up files that were previously installed by Specflow but no
longer exist in the new templates bundle. Today such files are silently dropped from the lock and
left on disk, and the `computeUpgradePlan` doc-comment even acknowledges the gap ("Files that exist
in the lock but NOT in the new bundle are ignored here (caller handles the lock cleanup separately)"
— but the caller doesn't).

**Why.** As Specflow templates evolve, files get removed (e.g. a command is renamed or split).
Without orphan handling, every release that drops a file leaves a stale artefact behind in every
existing project, and the lock loses its source-of-truth status because tracked files vanish from it
without any on-disk reflection. Catching this now — while we have only one user (Kevin) — is cheap
and prevents a real defect once Specflow ships to others.

**Shipping.** Binary `0.6.0-alpha.1 → 0.6.0-alpha.2`, templates unchanged at `0.7.0`. Patch release.

---

## Three orphan states (orphan = entry in lock, missing from new bundle)

| Disk state                                  | Lock state | Action                                                     |
| ------------------------------------------- | ---------- | ---------------------------------------------------------- |
| Matches lock SHA (clean — never customized) | drop       | Delete the file                                            |
| Diverges from lock SHA (user customized)    | drop       | Preserve unless `--force`; with `--force`: backup + delete |
| Not on disk (user already deleted)          | drop       | Silently drop the lock entry (no action emitted)           |

In every case, the orphan entry leaves the new lock. The lock continues to record only files
Specflow currently manages.

---

## Action kind addition

`src/domain/upgrade_plan.ts` gains one variant:

```typescript
export type UpgradeAction =
  | { kind: "auto-update"; dest: string; oldSha: string; newSha: string }
  | { kind: "preserve"; dest: string; reason: "customized" }
  | { kind: "add-new"; dest: string }
  | { kind: "unchanged"; dest: string }
  | { kind: "remove"; dest: string; oldSha: string; wasCustomized: boolean };
```

A single new kind (`remove`) carries a `wasCustomized` flag so the use case and CLI handler can
branch on whether to require `--force` and whether to back up the file before deletion.

`computeUpgradePlan` is extended: after the existing loop over `newShas`, it iterates `lock.entries`
keys that are NOT in `newShas`. For each:

- If the file is on disk → emit `remove` with `wasCustomized = (diskSha !==
  lockSha)`.
- If the file is not on disk → emit nothing (the entry just gets dropped from the new lock).

The doc-comment is updated to reflect the new behaviour.

---

## Use-case behaviour

`UpgradeProjectUseCase.execute()`:

For each `remove` action:

| `wasCustomized` | Without `--force`                                                        | With `--force`                         |
| --------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| `false`         | Delete the file (no backup; matches lock SHA so no user content is lost) | Same                                   |
| `true`          | Preserve on disk; warn in the summary                                    | Backup to `.specflow.bak`, then delete |

Lock writeback: the new `updatedEntries` map iterates `newShas` (as today) PLUS any `remove` action
whose file was preserved (customized + no `--force`) … actually no — even preserved orphan files
should leave the lock, because Specflow no longer claims them. After the upgrade, a preserved
customized orphan is just a user-owned file that Specflow doesn't track. The next upgrade sees it as
not-in-lock and not-in-bundle, which is correct ("not ours, never has been from now on").

So the lock writeback rule is unchanged in shape: iterate `newShas` to build the new lock. Orphan
entries are dropped regardless of whether their file was deleted or preserved on disk.

---

## `FsWriter` port extension

`src/application/ports.ts`:

```typescript
export interface FsWriter {
  detectConflicts(bundle: Bundle, targetDir: string): Promise<string[]>;
  writeBundle(
    bundle: Bundle,
    targetDir: string,
    options: { overwrite?: boolean; backupExisting?: boolean },
  ): Promise<BackupReport>;
  deletePaths(
    paths: ReadonlyArray<string>,
    targetDir: string,
    options: { backupExisting: boolean },
  ): Promise<BackupReport>;
}
```

`deletePaths` returns the same `BackupReport` shape as `writeBundle` for symmetry. The use case can
append the two reports' `backups` arrays into the final result the CLI handler renders.

`DenoFsWriter` implements it: for each path, optionally rename to `<path>.specflow.bak`, then delete
(or just delete when `backupExisting:
false`). Missing files are silently skipped (defensive — user
might have removed them between plan computation and apply).

The use case calls `deletePaths` once per group:

```typescript
const cleanRemovals = plan
  .filter((a) => a.kind === "remove" && !a.wasCustomized)
  .map((a) => a.dest);
const customizedRemovals = plan
  .filter((a) => a.kind === "remove" && a.wasCustomized);

if (cleanRemovals.length > 0) {
  await writer.deletePaths(cleanRemovals, projectDir, { backupExisting: false });
}
if (input.force && customizedRemovals.length > 0) {
  const customizedPaths = customizedRemovals.map((a) => a.dest);
  const r = await writer.deletePaths(customizedPaths, projectDir, { backupExisting: true });
  backupReport.backups = [...backupReport.backups, ...r.backups];
}
```

---

## CLI handler summary

`upgrade_handler.ts`'s `renderSummary` adds two groups:

```
  removed (no longer in templates)
    ✗ .claude/commands/specflow.deprecated.md

  removed but customized (not touched without --force)
    ⚠ .claude/agents/old-agent.md
```

The trailing summary line includes the new categories:

```
3 auto-update, 0 preserved, 1 added, 1 removed, 1 orphan-preserved, 12 unchanged
```

When `--force` is set, customized orphans run through the same delete path as clean ones, so they
don't appear in "removed but customized" — they show up in the backups list at the end of the run.

---

## Has-actual-work re-check

`UpgradeProjectUseCase` currently treats the upgrade as "up-to-date" when:

```typescript
const hasActualWork = plan.some((a) =>
  a.kind === "auto-update" || a.kind === "add-new" ||
  (a.kind === "preserve" && input.force)
);
if (!hasActualWork && plan.every((a) => a.kind === "unchanged")) {
  return { status: "up-to-date", currentVersion: lock.templatesVersion };
}
```

This needs widening: a `remove` action (clean, or customized + force) is also "actual work":

```typescript
const hasActualWork = plan.some((a) =>
  a.kind === "auto-update" ||
  a.kind === "add-new" ||
  (a.kind === "preserve" && input.force) ||
  (a.kind === "remove" && (!a.wasCustomized || input.force))
);
```

The `up-to-date` early return's `every((a) => a.kind === "unchanged")` is also widened to allow
`remove`-customized actions when `--force` is absent (those are no-ops without the flag, so the
project is "as up-to-date as it can be").

Actually simpler: skip the `every` clause and trust `hasActualWork`:

```typescript
if (!hasActualWork) {
  return { status: "up-to-date", currentVersion: lock.templatesVersion };
}
```

If the plan contains only `unchanged` and `preserve` (without force) and `remove`-customized
(without force), there's nothing to do.

---

## Testing

### `tests/domain/upgrade_plan_test.ts` (+3 tests)

1. `computeUpgradePlan` emits `remove` with `wasCustomized: false` when a lock entry is missing from
   `newShas`, the file is on disk, and `diskSha === lockSha`.
2. Same scenario but `diskSha !== lockSha` → emits `remove` with `wasCustomized: true`.
3. Lock entry missing from `newShas` AND missing from `diskShas` → no action emitted (entry is just
   dropped silently).

### `tests/application/upgrade_project_test.ts` (+3 tests)

4. Clean orphan + no `--force`: `writer.deletePaths` is called with the orphan path, no backup; lock
   no longer contains the entry; result `applied`.
5. Customized orphan + no `--force`: `writer.deletePaths` is NOT called for that path; file stays on
   disk; lock no longer contains the entry; result `applied` (or `up-to-date` if it was the only
   difference).
6. Customized orphan + `--force`: `writer.deletePaths` called with `backupExisting: true`; result
   includes the backup path; lock no longer contains the entry.

### `tests/infrastructure/deno_fs_writer_test.ts` (+2 tests)

7. `deletePaths` deletes specified files; missing files silently skipped.
8. `deletePaths` with `backupExisting: true` writes `.specflow.bak` files for the deleted ones.

### `tests/integration/upgrade_test.ts` (+1)

9. End-to-end: spawn `specflow upgrade` against a project whose lock contains an entry no longer in
   the bundle (synthesized by hand-editing the lock to add a fake entry, since the real bundle
   doesn't have orphans). Assert the file is deleted and the lock is rewritten without the entry.

### Updated tests

Existing tests: any test that asserted on the _exact_ lock entry count after an upgrade may need to
widen its assertion if it didn't already cover the new path. The current upgrade tests are mostly
behavioural and shouldn't break.

### Expected count

Current 288 plus 3 (plan) plus 3 (use case) plus 2 (writer) plus 1 (integration) equals **297**.

---

## Out of scope

- Undo/restore: backups go to `.specflow.bak` as today. No new restore command.
- Retroactive cleanup of pre-existing alpha.X projects: this fix only affects upgrades from
  `0.6.0-alpha.2` forward. A user who upgraded through earlier versions and accumulated stale files
  won't have them cleaned up unless those files reappear in a future bundle (won't happen) or they
  manually re-init.
- A dedicated "specflow doctor" / "specflow clean" command for reconciliation against the current
  bundle. Possible later brick.
- Suppressing the `remove`/`remove-customized` summary blocks when the groups are empty: just skip
  the heading like the existing `groups.auto`, `groups.added`, `groups.preserve` checks already do.

---

## Release plan

1. Branch `fix/upgrade-orphans` from main.
2. Implement: domain (action kind + plan logic) → port + adapter (`deletePaths`) → use case → CLI
   handler → tests → integration.
3. Verify full suite green; manual smoke against a project with a hand-injected orphan lock entry.
4. Squash-merge to main.
5. Bump binary `0.6.0-alpha.1 → 0.6.0-alpha.2`; templates unchanged at `0.7.0`. Tag
   `v0.6.0-alpha.2`; push main + tag.
