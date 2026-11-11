import { resolve } from "@std/path";
import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import { FsUpgradeMarkerStore } from "../../infrastructure/fs_upgrade_marker_store.ts";
import { mergeMarker } from "../../domain/upgrade_marker.ts";
import { UpgradeProjectUseCase } from "../../application/upgrade_project.ts";
import { findHarness } from "../harnesses.ts";
import { DenoFsReader } from "../../infrastructure/fs_reader.ts";
import { DenoFsWriter } from "../../infrastructure/deno_fs_writer.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import { FsStagingStore } from "../../infrastructure/fs_staging_store.ts";
import {
  inspectLegacyConfigDir,
  migrateLegacyConfigDir,
} from "../../infrastructure/fs_legacy_migrator.ts";
import { FsPluginDetector } from "../../infrastructure/fs_plugin_detector.ts";
import { FsParentWorkspaceReader } from "../../infrastructure/fs_parent_workspace_reader.ts";
import { resolveUpgradePreserves } from "./upgrade_preserve.ts";
import { isParentManaged } from "../../domain/parent_managed.ts";
import { CORE_BUNDLE, TEMPLATES_VERSION } from "../../templates_bundle.ts";
import { renderUnifiedDiff } from "../../domain/diff.ts";
import { renderOutcome, renderSummary } from "./upgrade_summary.ts";
import { printUpgradeHookTrust } from "./hook_trust_note.ts";
import { type BacklogBackend, RemovedHarnessError } from "../../domain/installed_lock.ts";
import { switchBacklogBackend } from "./upgrade_backlog_switch.ts";
import { printReleaseNotes } from "./upgrade_notes.ts";

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
        if (err instanceof RemovedHarnessError) throw err; // main says it, exit 1
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
  const harness = lockForDetection ? findHarness(lockForDetection.harness) : null;
  if (lockForDetection !== null && lockForDetection.parentManaged === undefined) {
    const parentReader = new FsParentWorkspaceReader();
    const standaloneOverride = await parentReader.hasStandaloneOverride(projectDir);
    const providingAncestor = await parentReader.findProvidingAncestor(projectDir);
    parentManagedOverride = isParentManaged(providingAncestor, standaloneOverride);
  }

  const { known: declaredKnown, isDeclaredPreserved } = await resolveUpgradePreserves(
    projectDir,
    lockForDetection,
    (parentManagedOverride ?? lockForDetection?.parentManaged) ?? false,
    intent.resetPreserved,
  );

  const useCase = new UpgradeProjectUseCase({
    reader: new DenoFsReader(),
    writer: new DenoFsWriter(),
    lockStore: new FsLockStore(),
    stagingStore: new FsStagingStore(),
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
    if (err instanceof RemovedHarnessError) throw err; // main says it, exit 1
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
    // The JSON files are re-merged here too, so a plugin enabled on this path is said.
    for (const note of result.notes) console.log(yellow(`ℹ ${note}`));
    await printUpgradeHookTrust({ harness, projectDir }, result);
    console.log(green(`✓ already up to date (templates ${result.currentVersion})`));
    if (!intent.dryRun) printReleaseNotes(result);
    return 0;
  }

  const written: ReadonlySet<string> = new Set(
    result.status === "applied" ? result.written : [],
  );
  renderSummary(result.plan, result.fromVersion, result.toVersion, written, intent.force);
  // A plugin Specnaut enables runs code once installed: never added silently.
  if (result.status === "applied") {
    for (const note of result.notes) console.log(yellow(`ℹ ${note}`));
  }

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
    // The pre-run lock's harness and options (the run keeps them) pick the diffs' file tree.
    const previewBundle = harness && lockForDetection
      ? harness.mapBundle(CORE_BUNDLE, {
        backlogBackend: lockForDetection.backlogBackend,
        versionScheme: lockForDetection.versionScheme,
        specBackend: lockForDetection.specBackend,
        specAutogen: lockForDetection.specAutogen,
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

  await renderOutcome(result, { harness, projectDir });

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
  printReleaseNotes(result);

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
