import { resolve } from "@std/path";
import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import { FsUpgradeMarkerStore } from "../../infrastructure/fs_upgrade_marker_store.ts";
import {
  crossesMajorBoundary,
  MIGRATION_GUIDE_PATH,
  MIGRATION_GUIDE_URL,
} from "../../domain/major_boundary.ts";
import { mergeMarker } from "../../domain/upgrade_marker.ts";
import { UpgradeProjectUseCase } from "../../application/upgrade_project.ts";
import { findHarness } from "../harnesses.ts";
import { DenoFsReader } from "../../infrastructure/fs_reader.ts";
import { DenoFsWriter } from "../../infrastructure/deno_fs_writer.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import {
  inspectLegacyConfigDir,
  migrateLegacyConfigDir,
} from "../../infrastructure/fs_legacy_migrator.ts";
import { FsPluginDetector } from "../../infrastructure/fs_plugin_detector.ts";
import { FsParentWorkspaceReader } from "../../infrastructure/fs_parent_workspace_reader.ts";
import { FsPreserveStore } from "../../infrastructure/fs_preserve_store.ts";
import { resolvePreserveDeclarations } from "./preserve_resolution.ts";
import { isAgenticPath, isParentManaged } from "../../domain/parent_managed.ts";
import { CORE_BUNDLE, TEMPLATES_VERSION } from "../../templates_bundle.ts";
import { renderUnifiedDiff } from "../../domain/diff.ts";
import type { UpgradePlan } from "../../domain/upgrade_plan.ts";
import type { BacklogBackend, InstalledLock } from "../../domain/installed_lock.ts";
import { sha256Hex } from "../../domain/sha256.ts";

export type UpgradeIntent = {
  kind: "upgrade";
  dryRun: boolean;
  force: boolean;
  backlog: BacklogBackend | null;
  resetBaseline: boolean;
  /**
   * `--reset-preserved` (spec 011 / issue #367): ignore preserve declarations
   * for this upgrade so declared files follow normal upgrade rules. Never the
   * default; reported per overridden file.
   */
  resetPreserved: boolean;
};

type SwitchResult = {
  readonly switched: boolean;
  readonly from: BacklogBackend;
  /**
   * Project-relative paths of every `.specnaut.bak` this switch left behind —
   * from the overwrites AND from the deletes. The caller prints them; the
   * function itself never writes to stdout.
   */
  readonly backups: ReadonlyArray<string>;
};

/**
 * One-shot routine: switch the recorded backlog backend, re-render the
 * bundled backlog skill files for the new backend, and update the lock.
 *
 * Existing user data (markdown files for local, GitHub issues for github)
 * is NOT migrated — the caller logs that explicitly.
 */
export async function switchBacklogBackend(
  projectDir: string,
  newBackend: BacklogBackend,
  /**
   * The escape hatch the refusal below advertises. It used to advertise a flag
   * that never reached this function — the signature took two parameters and
   * the call site passed two — so re-running with `--force` re-entered the
   * identical throw. An error message naming a remedy that does not exist is
   * worse than one naming none: it sends the reader in a circle.
   */
  force = false,
): Promise<SwitchResult> {
  const lockStore = new FsLockStore();
  const lock = await lockStore.read(projectDir);
  if (lock === null) {
    throw new Error(
      "no .specnaut/installed.lock found. Run `specnaut init --here --force` first.",
    );
  }
  const from = lock.backlogBackend;
  if (from === newBackend) return { switched: false, from, backups: [] };

  const harness = findHarness(lock.harness);
  if (!harness) throw new Error(`unknown harness in lock: ${lock.harness}`);

  // A parent-managed target inherits agentic files (incl. the backlog skill)
  // from the providing workspace — they were never written locally (FR-012).
  // Drop agentic dests from both bundles so a backend switch neither writes
  // nor re-tracks them in the lock. Mirrors UpgradeProjectUseCase's filtering.
  const dropAgentic = (b: Record<string, { content: string; executable: boolean }>) =>
    lock.parentManaged
      ? Object.fromEntries(Object.entries(b).filter(([dest]) => !isAgenticPath(dest)))
      : b;

  const newBundle = dropAgentic(harness.mapBundle(CORE_BUNDLE, {
    backlogBackend: newBackend,
    versionScheme: lock.versionScheme,
    specBackend: lock.specBackend,
    specAutogen: lock.specAutogen,
  }));
  const oldBundle = dropAgentic(harness.mapBundle(CORE_BUNDLE, {
    backlogBackend: from,
    versionScheme: lock.versionScheme,
    specBackend: lock.specBackend,
    specAutogen: lock.specAutogen,
  }));

  const writer = new DenoFsWriter();
  const reader = new DenoFsReader();

  // Identify backlog-skill + backlog-script destinations by diffing the two
  // bundles: any path that differs (or is exclusive to one bundle) is part
  // of the backlog skill surface.
  const partial: Record<string, { content: string; executable: boolean }> = {};
  const oldOnly = new Set<string>();
  for (const [dest, file] of Object.entries(newBundle)) {
    const oldFile = oldBundle[dest];
    if (oldFile === undefined || oldFile.content !== file.content) {
      partial[dest] = file;
    }
  }
  for (const dest of Object.keys(oldBundle)) {
    if (newBundle[dest] === undefined) oldOnly.add(dest);
  }

  // Customization guard: refuse to switch if any of the on-disk skill files
  // were customized vs the recorded SHA. Force-overwrite is the user's
  // escape hatch.
  const customized: string[] = [];
  for (const dest of Object.keys(partial)) {
    const onDisk = await reader.readText(projectDir, dest);
    if (onDisk === null) continue;
    const lockEntry = lock.entries.get(dest);
    if (!lockEntry) {
      // FAIL CLOSED. This used to `continue`, which reads as "no entry, nothing
      // to compare, carry on" — and carrying on means the write below runs with
      // `backupExisting: false`. So a file the lock cannot speak for was
      // overwritten without a backup, precisely because nothing was known about
      // it.
      //
      // Since #572 an unwritten preserve with no prior entry deliberately gets
      // no entry, which grew that population: the very files a user edited are
      // the ones the lock stops describing. Absence of evidence is not evidence
      // of vanilla, and `--force` is the escape hatch that already exists for a
      // deliberate overwrite.
      customized.push(dest);
      continue;
    }
    const sha = await sha256Hex(onDisk);
    if (sha !== lockEntry.sha256) customized.push(dest);
  }
  if (customized.length > 0 && !force) {
    throw new Error(
      `refusing to switch backlog backend: the following files were customized locally:\n` +
        customized.map((c) => `  - ${c}`).join("\n") +
        `\n\nReview the diffs, then re-run \`specnaut upgrade --backlog ${newBackend} --force\` ` +
        `to overwrite them (existing files are backed up to *.specnaut.bak).`,
    );
  }

  // The refusal above promises "existing files are backed up to *.specnaut.bak".
  // This passed `false`, so the promise was false — inert only while the force
  // path was unreachable, and this change is about making that path reachable.
  // Order matters: wiring `--force` before this would have converted a refusal
  // into a silent data-loss button, on exactly the edits the refusal protects.
  //
  // Keyed on `force`, and only on `force`, because that is the exact scope of
  // the promise: a switch that clears the guard has proved every dest it
  // overwrites is vanilla, and copying files Specnaut generated and can
  // regenerate buried the one backup that matters under thirty that do not.
  const report = await writer.writeBundle(partial, projectDir, {
    overwrite: true,
    backupExisting: force,
  });
  // A switch removes the files the old backend owned — on `local → github`
  // that is `.specnaut/backlog.md`, the user's entire backlog. Unconditional
  // here, unlike the write above: the customization guard walks only what gets
  // WRITTEN, so nothing has established that a dest about to be deleted is
  // vanilla. Both reports are kept: a backup nobody is told about is
  // indistinguishable from a deletion, and "items were NOT migrated
  // automatically" reads as "they are gone" when the line that says where they
  // went is missing.
  const removed = oldOnly.size > 0
    ? await writer.deletePaths([...oldOnly], projectDir, { backupExisting: true })
    : null;

  const updatedEntries = new Map(lock.entries);
  for (const [dest, file] of Object.entries(partial)) {
    updatedEntries.set(dest, {
      sha256: await sha256Hex(file.content),
      installedAt: new Date().toISOString(),
      templatesVersion: TEMPLATES_VERSION,
    });
  }
  for (const dest of oldOnly) updatedEntries.delete(dest);

  const newLock: InstalledLock = {
    version: 2,
    harness: lock.harness,
    backlogBackend: newBackend,
    versionScheme: lock.versionScheme,
    specBackend: lock.specBackend,
    specAutogen: lock.specAutogen,
    templatesVersion: lock.templatesVersion,
    entries: updatedEntries,
    // Preserve the parent-managed decision across a backend switch — dropping
    // it would silently re-enable agentic provisioning on the next upgrade
    // (009-parent-managed-init / FR-012). Mirrors upgrade_project.ts:301 and
    // init_project.ts:181.
    ...(lock.parentManaged ? { parentManaged: true as const } : {}),
  };
  await lockStore.write(projectDir, newLock);
  return {
    switched: true,
    from,
    backups: [...report.backups, ...(removed?.backups ?? [])].map((b) => b.backupPath),
  };
}

/**
 * @param written Dests this run actually wrote. Empty for a dry run, which has
 *   nothing to report but the forecast — there, the plan IS the outcome.
 */
function renderSummary(
  plan: UpgradePlan,
  from: string,
  to: string,
  written: ReadonlySet<string> = new Set(),
) {
  const groups = {
    auto: plan.filter((a) => a.kind === "auto-update"),
    // A preserve the run then wrote is not a preserve — `--force` overwrites
    // the whole `customized` bucket, and rendering the plan verbatim reported
    // every one of those files as "not touched" while their content had just
    // been replaced (#519). Split them out before anything reads this group.
    preserve: plan.filter((a) => a.kind === "preserve" && !written.has(a.dest)),
    overwritten: plan.filter((a) => a.kind === "preserve" && written.has(a.dest)),
    added: plan.filter((a) => a.kind === "add-new"),
    unchanged: plan.filter((a) => a.kind === "unchanged"),
    removed: plan.filter((a) => a.kind === "remove" && !a.wasCustomized),
    orphanPreserved: plan.filter((a) => a.kind === "remove" && a.wasCustomized),
    migrated: plan.filter((a) => a.kind === "migrate-to-plugin"),
    deferred: plan.filter((a) => a.kind === "defer-to-plugin"),
  };

  console.log(
    `\n${bold("specnaut upgrade")} — templates ${dim(from)} → ${cyan(to)}\n`,
  );

  if (groups.auto.length > 0) {
    console.log(bold("  auto-update (unchanged locally)"));
    for (const a of groups.auto) console.log(green(`    ✓ ${a.dest}`));
    console.log();
  }
  if (groups.added.length > 0) {
    console.log(bold("  new files to add"));
    for (const a of groups.added) console.log(green(`    + ${a.dest}`));
    console.log();
  }
  if (groups.overwritten.length > 0) {
    console.log(bold("  overwritten (was customized — previous content backed up)"));
    for (const a of groups.overwritten) console.log(cyan(`    ↻ ${a.dest}`));
    console.log();
  }
  // Customized files split into two states that read identically today and
  // need opposite responses. One is settled — you edited it, upstream has not
  // moved, nothing is missing. The other is an update that was published and
  // never arrived, and will never arrive on its own: the lock entry froze with
  // the file, so every later run reaches the same verdict. Reporting both as
  // "customized locally" is what let five files in this project's own install
  // sit three months behind, referencing agents that had been deleted, while
  // every run printed a clean success.
  //
  // Split by REASON first. The `settled`/`behind` repair above was applied to
  // the `customized` population only, and a declared preserve returned from
  // `buildUpgradePlan` before `staleSince` was ever computed — so it carried
  // none, landed in `settled` by construction, and printed under a heading
  // asserting the two things a declaration makes unverifiable: that the file
  // was customized (it was declared) and that upstream had not moved (nobody
  // had looked). A guard repaired once, blind to the branch that never
  // reaches the fix.
  const customized = groups.preserve.filter((a) =>
    a.kind === "preserve" && a.reason === "customized"
  );
  const declared = groups.preserve.filter((a) => a.kind === "preserve" && a.reason === "declared");
  const settled = customized.filter((a) => a.kind === "preserve" && !a.staleSince);
  const behind = customized.filter((a) => a.kind === "preserve" && a.staleSince);

  const declaredIn = (state: string) =>
    declared.filter((a) => a.kind === "preserve" && a.declaredDrift === state);
  const declCurrent = declaredIn("current");
  const declBehind = declaredIn("behind");
  const declNoBaseline = declaredIn("no-lock-entry");
  const declDropped = declaredIn("dropped-upstream");

  if (declCurrent.length > 0) {
    console.log(bold("  preserved by declaration — level with upstream"));
    for (const a of declCurrent) console.log(green(`    ✓ ${a.dest}`));
    console.log();
  }
  if (declBehind.length > 0) {
    console.log(
      bold("  preserved by declaration, and BEHIND — upstream moved since the freeze"),
    );
    console.log(
      dim(
        "    A declaration is a maintenance obligation, and this is the only" +
          " place it is reported:\n    a declared path is never staged, so" +
          " `specnaut reconcile --status` cannot list it.",
      ),
    );
    for (const a of declBehind) {
      if (a.kind !== "preserve") continue;
      const since = a.declaredFrozenAt
        ? ` ${
          dim(
            `(frozen at v${a.declaredFrozenAt.templatesVersion}, ${
              a.declaredFrozenAt.installedAt.slice(0, 10)
            })`,
          )
        }`
        : "";
      console.log(yellow(`    ⚠ ${a.dest}${since}`));
      console.log(dim(`        diff it: specnaut diff ${a.dest}`));
    }
    console.log(
      dim(
        "    Nothing here is applied automatically, and the declaration still" +
          " wins over --force.\n    Re-read each against upstream and drop the" +
          " preserve line if its reason has expired.\n",
      ),
    );
  }
  if (declNoBaseline.length > 0) {
    console.log(bold("  preserved by declaration — no baseline recorded, cannot compare"));
    console.log(
      dim('    The lock carries no entry for these, so "level with upstream" would be a guess.'),
    );
    for (const a of declNoBaseline) console.log(yellow(`    ? ${a.dest}`));
    console.log();
  }
  if (declDropped.length > 0) {
    console.log(bold("  preserved by declaration — upstream no longer ships this path"));
    for (const a of declDropped) console.log(yellow(`    ⚠ ${a.dest}`));
    console.log();
  }

  if (settled.length > 0) {
    console.log(bold("  customized locally (not touched)"));
    for (const a of settled) {
      const tag = a.kind === "preserve" && a.pluginAvailable
        ? ` ${dim("[plugin available — reconcile manually]")}`
        : "";
      console.log(yellow(`    ⚠ ${a.dest}${tag}`));
    }
    console.log();
  }
  if (behind.length > 0) {
    console.log(bold("  customized, and behind — an update was published and never applied"));
    // Grouped by the version each file froze at, not listed flat. Files rarely
    // freeze one at a time: a single out-of-band edit — a repo-wide rename, a
    // bulk sed — strands a whole set at the same version on the same day. Seeing
    // them share a freeze point names the event that caused it, which a flat
    // list repeating the same date on every line actively hides.
    const byFreeze = new Map<string, typeof behind>();
    for (const a of behind) {
      if (a.kind !== "preserve" || !a.staleSince) continue;
      const key = `${a.staleSince.templatesVersion}\u0000${a.staleSince.installedAt.slice(0, 10)}`;
      const bucket = byFreeze.get(key);
      if (bucket) bucket.push(a);
      else byFreeze.set(key, [a]);
    }
    for (const [key, files] of byFreeze) {
      const [version, day] = key.split("\u0000");
      console.log(
        dim(
          `    last written by v${version} on ${day} — every upgrade since has skipped ` +
            `${files.length === 1 ? "it" : `these ${files.length}`}:`,
        ),
      );
      for (const a of files) {
        console.log(yellow(`      ⚠ ${a.dest}`));
        console.log(dim(`          specnaut reconcile ${a.dest} --accept-upstream`));
      }
    }
    console.log(
      dim(
        `    All ${behind.length} at once: specnaut upgrade --reset-baseline` +
          ` (keeps a .specnaut.bak of each).\n`,
      ),
    );
  }
  if (groups.removed.length > 0) {
    console.log(bold("  removed (no longer in templates)"));
    for (const a of groups.removed) console.log(red(`    ✗ ${a.dest}`));
    console.log();
  }
  if (groups.orphanPreserved.length > 0) {
    console.log(bold("  removed but customized (not touched without --force)"));
    for (const a of groups.orphanPreserved) console.log(yellow(`    ⚠ ${a.dest}`));
    console.log();
  }
  if (groups.migrated.length > 0) {
    console.log(bold("  migrated to specnaut-plugin plugin (backed up + removed)"));
    for (const a of groups.migrated) console.log(cyan(`    → ${a.dest}`));
    console.log();
  }
  if (groups.deferred.length > 0) {
    console.log(bold("  deferred to specnaut-plugin plugin (was missing on disk)"));
    for (const a of groups.deferred) console.log(dim(`    · ${a.dest}`));
    console.log();
  }

  console.log(
    dim(
      // The declared buckets are counted here too. Scoping `settled`/`behind`
      // to the customized population left this tail printing "0 preserved,
      // 0 behind" on a run that had just reported a declared path as behind —
      // the same silence this change removes, one line further down, where a
      // reader skimming the summary is most likely to stop.
      `  ${groups.auto.length} auto-update, ${settled.length + declCurrent.length} preserved, ` +
        `${behind.length + declBehind.length} behind, ` +
        (groups.overwritten.length > 0 ? `${groups.overwritten.length} overwritten, ` : "") +
        `${groups.added.length} added, ${groups.removed.length} removed, ` +
        `${groups.orphanPreserved.length} orphan-preserved, ${groups.migrated.length} migrated, ` +
        `${groups.deferred.length} deferred, ${groups.unchanged.length} unchanged`,
    ),
  );
}

export async function runUpgrade(intent: UpgradeIntent): Promise<number> {
  const projectDir = resolve(Deno.cwd());

  // Rebrand migration: move a legacy `.specflow/` tree to `.specnaut/` before
  // the lock is read, so existing projects upgrade transparently.
  //
  // This is a real `rename()`, so it is gated on `--dry-run` — it used to run
  // eleven lines above the first dry-run guard, which meant a preview silently
  // moved the managed tree and then reported "no files written". A dry-run on a
  // legacy project now refuses rather than migrating: previewing the plan means
  // reading the lock, and the lock is only addressable at the current path.
  if (intent.dryRun) {
    const state = await inspectLegacyConfigDir(projectDir);
    if (state === "both") {
      console.error(
        red("error: both .specflow/ (legacy) and .specnaut/ exist — remove one before continuing"),
      );
      return 2;
    }
    if (state === "legacy-only") {
      console.error(red("error: this project still uses the legacy .specflow/ directory."));
      console.error(
        "  --dry-run will not move it, and the plan cannot be computed until it moves.",
      );
      console.error("  Run `specnaut upgrade` (without --dry-run) to migrate and upgrade in one");
      console.error("  step, or move it yourself first:  mv .specflow .specnaut");
      return 2;
    }
  } else {
    const migration = await migrateLegacyConfigDir(projectDir);
    if (migration.kind === "symlinked") {
      console.error(
        red(
          `error: ${migration.path} is a symlink — refusing to continue.\n` +
            `  Specnaut writes its whole config tree under .specnaut/, and a link there ` +
            `sends every one of those writes, and a recursive delete, outside this project.\n` +
            `  Replace the link with a real directory, or run Specnaut where the directory is.`,
        ),
      );
      return 2;
    }
    if (migration.kind === "conflict") {
      console.error(
        red("error: both .specflow/ (legacy) and .specnaut/ exist — remove one before continuing"),
      );
      return 2;
    }
    if (migration.kind === "migrated") {
      console.log(dim("↳ migrated .specflow/ → .specnaut/ (legacy config dir)"));
    }
  }

  if (!intent.dryRun) {
    if (intent.backlog !== null) {
      try {
        const { switched, from, backups } = await switchBacklogBackend(
          projectDir,
          intent.backlog,
          intent.force,
        );
        if (switched) {
          console.log(
            dim(`↳ switched backlog backend: ${from} → ${intent.backlog}`),
          );
          console.log(
            dim(
              `  existing items in the previous backend were NOT migrated automatically.`,
            ),
          );
          for (const b of backups) console.log(dim(`  kept a copy at ${b}`));
        } else {
          console.log(dim(`↳ already using backend: ${intent.backlog} — nothing to switch`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(red(`error: ${msg}`));
        return 2;
      }
    }
  }

  // Parent-managed decision for the upgrade path. The use case reads
  // `lock.parentManaged` directly; only when the lock predates the field (a
  // legacy lock) do we re-derive once via the reader and pass an override so
  // suppression is deterministic — and the use case persists it into the
  // rewritten lock (009-parent-managed-init / FR-007).
  let parentManagedOverride: boolean | undefined;
  const lockForDetection = await new FsLockStore().read(projectDir);
  if (lockForDetection !== null && lockForDetection.parentManaged === undefined) {
    const parentReader = new FsParentWorkspaceReader();
    const standaloneOverride = await parentReader.hasStandaloneOverride(projectDir);
    const providingAncestor = await parentReader.findProvidingAncestor(projectDir);
    parentManagedOverride = isParentManaged(providingAncestor, standaloneOverride);
  }

  // Preserve declarations (spec 011 / issue #367). Resolve the manifest against
  // the bundle dests for the lock's harness/backend so we can warn ineffective
  // declarations (FR-008) and build the predicate the use case threads into the
  // plan. The parent-managed agentic filter is applied first so a declared
  // agentic path in a parent-managed sub-repo is a clean no-op (D8). When
  // `--reset-preserved` is passed, the predicate is forced off (FR-005).
  let declaredKnown: ReadonlyArray<string> = [];
  if (lockForDetection !== null) {
    const harnessForPreserve = findHarness(lockForDetection.harness);
    if (harnessForPreserve) {
      const mapped = harnessForPreserve.mapBundle(CORE_BUNDLE, {
        backlogBackend: lockForDetection.backlogBackend,
        versionScheme: lockForDetection.versionScheme,
        specBackend: lockForDetection.specBackend,
        specAutogen: lockForDetection.specAutogen,
      });
      const parentManaged = (parentManagedOverride ?? lockForDetection.parentManaged) ?? false;
      const bundleDests = parentManaged
        ? Object.keys(mapped).filter((d) => !isAgenticPath(d))
        : Object.keys(mapped);
      const store = new FsPreserveStore();
      // A manifest that exists but declares nothing used to produce no output
      // at all — identical to having no manifest, so a maintainer read the
      // silence as protection while their files were refreshed. Advisory only:
      // it never changes the exit code, per the store's own contract.
      const diagnosis = await store.diagnose(projectDir);
      if (diagnosis !== null && diagnosis.kind !== "ok") {
        const why = diagnosis.kind === "unparseable"
          ? "not valid YAML"
          : diagnosis.kind === "missing-key"
          ? "no top-level `preserved:` key (a bare list is not one either)"
          : "`preserved:` is present but holds no usable paths";
        console.error(
          yellow(
            `warn: .specnaut/preserve.yml — ${why}; nothing is being preserved`,
          ),
        );
      }
      const cfg = await store.read(projectDir);
      const { known, unknown } = resolvePreserveDeclarations(cfg, bundleDests);
      declaredKnown = known;
      for (const path of unknown) {
        console.error(
          yellow(`warn: ${path} — declared preserved but not a managed file (ignored)`),
        );
      }
    }
  }
  const declaredSet = intent.resetPreserved ? new Set<string>() : new Set(declaredKnown);
  const isDeclaredPreserved = (dest: string): boolean => declaredSet.has(dest);

  const useCase = new UpgradeProjectUseCase({
    reader: new DenoFsReader(),
    writer: new DenoFsWriter(),
    lockStore: new FsLockStore(),
    core: CORE_BUNDLE,
    templatesVersion: TEMPLATES_VERSION,
    findHarness,
    pluginDetector: new FsPluginDetector(),
  });

  let result;
  try {
    result = await useCase.execute({
      projectDir,
      dryRun: intent.dryRun,
      force: intent.force,
      resetBaseline: intent.resetBaseline,
      isDeclaredPreserved,
      ...(parentManagedOverride !== undefined ? { parentManagedOverride } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`error: ${msg}`));
    return 2;
  }

  // Before the up-to-date short-circuit: a run with nothing else to do is
  // precisely where a refusal would otherwise vanish.
  for (const refusal of result.refusals) {
    console.log(yellow(`⚠ ${refusal}`));
  }

  if (result.status === "up-to-date") {
    console.log(green(`✓ already up to date (templates ${result.currentVersion})`));
    return 0;
  }

  const written: ReadonlySet<string> = new Set(
    result.status === "applied" ? result.written : [],
  );
  renderSummary(result.plan, result.fromVersion, result.toVersion, written);

  // Sections Specnaut owns inside files the user owns (#466). `AGENTS.md` is
  // never rewritten by an upgrade, so the one section that has to reach an
  // existing project is grafted in under its own fence — and said out loud,
  // because a paragraph that appears in an always-loaded file without a word
  // of explanation is indistinguishable from an overwrite.
  for (const section of result.managedSections) {
    const verb = result.status === "planned"
      ? (section.kind === "added" ? "would add" : "would refresh")
      : (section.kind === "added" ? "added" : "refreshed");
    console.log(cyan(
      `${verb} the Specnaut-managed "${section.label}" section in ${section.dest}` +
        " — everything you wrote is untouched",
    ));
  }

  // Declared-preserve notices (FR-004) — one line per declared file kept.
  const declaredPreserves = result.plan.filter(
    (a) => a.kind === "preserve" && a.reason === "declared",
  );
  for (const a of declaredPreserves) {
    console.log(cyan(`preserved ${a.dest} — declared in .specnaut/preserve.yml`));
  }
  // `--reset-preserved` overrides (FR-005) — one line per declaration ignored.
  if (intent.resetPreserved) {
    for (const path of declaredKnown) {
      console.log(yellow(`override ${path} — --reset-preserved overrode the declaration`));
    }
  }

  // `customized` only. A declared preserve already got its own line above, and
  // the advice below does not apply to it: `--force` will NOT overwrite a
  // declared path (only `--reset-preserved` lifts it), and `--reset-baseline`
  // is irrelevant to a file nobody is claiming was edited. Printing a diff for
  // it under that banner told the maintainer two different things about the
  // same path in one run (#474).
  const preserves = result.plan.filter(
    (a) => a.kind === "preserve" && a.reason === "customized",
  );
  if (preserves.length > 0 && !intent.force) {
    console.log(
      dim(
        "\nFor customized files, review the diff below and merge manually if desired.\n" +
          "Re-run with --force to overwrite them (edits will be backed up to .specnaut.bak).\n",
      ),
    );
    // Resolve the harness from the lock to render diffs in the correct file tree.
    const lockStore = new FsLockStore();
    const lock = await lockStore.read(projectDir);
    const harness = lock ? findHarness(lock.harness) : null;
    const previewBundle = harness && lock
      ? harness.mapBundle(CORE_BUNDLE, {
        backlogBackend: lock.backlogBackend,
        versionScheme: lock.versionScheme,
        specBackend: lock.specBackend,
        specAutogen: lock.specAutogen,
      })
      : {};
    for (const action of preserves) {
      const file = previewBundle[action.dest];
      if (!file) continue;
      const diskContent = await new DenoFsReader().readText(projectDir, action.dest);
      if (diskContent === null) continue;
      console.log(bold(`\n---- diff: ${action.dest} ----`));
      console.log(renderUnifiedDiff(
        diskContent,
        file.content,
        `local (current)`,
        `binary (${result.toVersion})`,
      ));
    }
  }

  if (result.status === "planned") {
    console.log(dim("\n(dry-run — no files written)"));
    return 0;
  }

  if (result.backups.length > 0) {
    console.log();
    for (const b of result.backups) {
      console.log(dim(`↳ backed up ${b} → ${b}.specnaut.bak`));
    }
  }
  if (result.linksMoved.length > 0) {
    console.log();
    for (const b of result.linksMoved) {
      console.log(
        dim(
          `↳ ${b} was a SYMLINK — the link was moved to ${b}.specnaut.bak, not its content.\n` +
            `  Your file is still where the link pointed. Restoring the backup restores a pointer.`,
        ),
      );
    }
  }
  console.log();
  console.log(green(`✓ upgraded to templates ${result.fromVersion} → ${result.toVersion}`));

  // A run whose only outcome is skips still printed a bare green tick. That is
  // the line people read, and it said the work was done. Name what was left,
  // right where the eye lands, or the group above goes unread.
  // Only files the run left alone. A `--force` run delivers the whole behind
  // bucket, and this warning still fired for every one of them — telling the
  // reader that "nothing will deliver them on a later run" about updates the
  // same command had just applied, which reads as a failure and invites a
  // pointless second pass (#519).
  const leftBehind = result.plan.filter(
    (a) => a.kind === "preserve" && a.staleSince && !written.has(a.dest),
  );
  if (leftBehind.length > 0) {
    console.log(
      yellow(
        `⚠ ${leftBehind.length} file${leftBehind.length === 1 ? "" : "s"} did not receive ` +
          `${leftBehind.length === 1 ? "an update" : "updates"} published for ` +
          `${leftBehind.length === 1 ? "it" : "them"} — see "customized, and behind" above. ` +
          `Nothing will deliver ${leftBehind.length === 1 ? "it" : "them"} on a later run.`,
      ),
    );
  }

  // A breaking upgrade is the one moment `UPGRADING.md` exists for, and until
  // now the binary never named it — the only inbound links were the README and
  // one published release body, neither of which somebody mid-upgrade is
  // reading (#481). Printed only when the major actually changes, so it stays
  // meaningful instead of becoming a line people learn to skip.
  if (crossesMajorBoundary(result.fromVersion, result.toVersion)) {
    console.log();
    console.log(
      yellow(`⚠ this crossed a major version — read the migration guide before you continue:`),
    );
    console.log(`  ${MIGRATION_GUIDE_PATH}  ·  ${MIGRATION_GUIDE_URL}`);
  }

  // Write the upgrade-pending marker (preserves original `from` if a
  // marker already exists from a previous unreconciled upgrade).
  const markerStore = new FsUpgradeMarkerStore();
  const existing = await markerStore.read(projectDir);
  const merged = mergeMarker(existing, {
    from: result.fromVersion,
    to: result.toVersion,
    at: new Date().toISOString(),
  });
  await markerStore.write(projectDir, merged);

  // Handoff: tell the user how to invoke the agent-assisted review.
  console.log();
  console.log("→ Walk through what's new with your AI:");
  console.log("  `@specnaut-guide review-upgrade`");
  console.log();
  console.log(dim(
    "  (proposes a review branch, plays adoption prompts for each new\n" +
      "   feature, and helps you reconcile any customized files)",
  ));
  return 0;
}
