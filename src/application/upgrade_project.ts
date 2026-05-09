import type { FsReader, FsWriter, Harness, LockStore, PluginDetector } from "./ports.ts";
import type { Bundle, TemplateFile } from "../domain/template.ts";
import { sha256Hex } from "../domain/sha256.ts";
import type { InstalledLock, LockEntry } from "../domain/installed_lock.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import { computeUpgradePlan, type UpgradePlan } from "../domain/upgrade_plan.ts";
import { canonicalBlockBody, extractBlock } from "../domain/merge_block.ts";
import { isPluginCoveredPath } from "../domain/plugin_coverage.ts";

/** The plugin name used for both the install probe and the cache directory. */
export const PLUGIN_NAME = "specflow-plugin";

export type UpgradeProjectInput = {
  projectDir: string;
  dryRun: boolean;
  force: boolean;
  /**
   * `--reset-baseline` flag. Heals stale lock SHAs left by older binaries
   * (and any other source of disk/lock divergence) by trusting the
   * on-disk content as the new baseline. Existing files where
   * `diskSha != lockSha` get their lock SHA force-reset; the plan then
   * compares disk vs bundle directly. Use after the user confirms they
   * never edited the affected files.
   */
  resetBaseline?: boolean;
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

export type UpgradeProjectDeps = {
  reader: FsReader;
  writer: FsWriter;
  lockStore: LockStore;
  core: CoreBundle;
  templatesVersion: string;
  findHarness: (key: string) => Harness | null;
  /**
   * Optional plugin probe. Drives the binary → plugin migration table —
   * when the plugin is installed and the harness is `claude`, vanilla
   * on-disk agent / skill files are auto-migrated (backed up + deleted;
   * plugin serves them going forward) and customized files are
   * preserved with a "plugin available" warning. Tests omit this dep
   * to skip migration entirely.
   */
  pluginDetector?: PluginDetector;
  now?: () => Date;
};

export class UpgradeProjectUseCase {
  constructor(private readonly deps: UpgradeProjectDeps) {}

  async execute(input: UpgradeProjectInput): Promise<UpgradeProjectResult> {
    const { reader, writer, lockStore, core, templatesVersion, findHarness } = this.deps;

    const lock = await lockStore.read(input.projectDir);
    if (lock === null) {
      throw new Error(
        "no .specflow/installed.lock found. Run `specflow init --here --force` to enable upgrades.",
      );
    }
    const harness = findHarness(lock.harness);
    if (!harness) {
      throw new Error(`unknown harness in lock: ${lock.harness}`);
    }
    const fullBundle = harness.mapBundle(core, { backlogBackend: lock.backlogBackend });

    // JSON-merged files (e.g. `.claude/settings.json`) are user-owned: we
    // never overwrite them, only graft our entries in. They live outside
    // the lock-tracked plan and are re-merged at the end as a flat write.
    const jsonMergedBundle: Bundle = {};
    const bundle: Bundle = {};
    for (const [dest, file] of Object.entries(fullBundle)) {
      if (file.mergeJson !== undefined) {
        jsonMergedBundle[dest] = file;
      } else {
        bundle[dest] = file;
      }
    }

    const destPaths = new Set<string>([
      ...Object.keys(bundle),
      ...lock.entries.keys(),
    ]);
    const diskShas = new Map<string, string>();
    for (const dest of destPaths) {
      const content = await reader.readText(input.projectDir, dest);
      if (content === null) continue;
      // For mergeable files we hash the *block content only* (not the whole
      // user-owned file) so the SHA is comparable against the lock entry,
      // which also stores only the block content.
      const file = bundle[dest];
      if (file?.mergeBlock !== undefined) {
        const block = extractBlock(content, file.mergeBlock) ?? "";
        diskShas.set(dest, await sha256Hex(block));
      } else {
        diskShas.set(dest, await sha256Hex(content));
      }
    }

    const newShas = new Map<string, string>();
    for (const [dest, file] of Object.entries(bundle)) {
      const shaInput = file.mergeBlock !== undefined
        ? canonicalBlockBody(file.content)
        : file.content;
      newShas.set(dest, await sha256Hex(shaInput));
    }

    const pluginInstalled = this.deps.pluginDetector !== undefined &&
      await this.deps.pluginDetector.isPluginInstalled(PLUGIN_NAME);
    const plan = computeUpgradePlan(
      diskShas,
      lock,
      newShas,
      {
        pluginInstalled,
        isPluginCovered: (dest) => isPluginCoveredPath(lock.harness, dest),
        isSkipIfExists: (dest) => bundle[dest]?.skipIfExists === true,
        resetBaseline: input.resetBaseline ?? false,
      },
    );

    const hasActualWork = plan.some((a) =>
      a.kind === "auto-update" ||
      a.kind === "add-new" ||
      a.kind === "migrate-to-plugin" ||
      a.kind === "defer-to-plugin" ||
      (a.kind === "preserve" && input.force) ||
      (a.kind === "remove" && (!a.wasCustomized || input.force))
    );
    if (!hasActualWork && plan.every((a) => a.kind === "unchanged")) {
      return { status: "up-to-date", currentVersion: lock.templatesVersion };
    }

    if (input.dryRun) {
      return {
        status: "planned",
        plan,
        fromVersion: lock.templatesVersion,
        toVersion: templatesVersion,
      };
    }

    const toWrite: Bundle = {};
    for (const action of plan) {
      if (
        action.kind === "auto-update" ||
        action.kind === "add-new" ||
        (action.kind === "preserve" && input.force)
      ) {
        const file = bundle[action.dest];
        if (file) toWrite[action.dest] = file;
      }
    }

    const backupReport = await writer.writeBundle(toWrite, input.projectDir, {
      overwrite: true,
      backupExisting: input.force,
    });

    // JSON-merged files are not part of the plan; re-graft the bundled
    // entries into whatever the user has on disk (idempotent — already-
    // present entries are skipped by the merge logic). Greenfield case
    // is handled too: writeBundle will just write the bundled content
    // when no file is present.
    if (Object.keys(jsonMergedBundle).length > 0) {
      await writer.writeBundle(jsonMergedBundle, input.projectDir, {
        overwrite: true,
        backupExisting: false,
      });
    }

    const cleanRemovals = plan
      .filter((a): a is Extract<typeof a, { kind: "remove" }> =>
        a.kind === "remove" && !a.wasCustomized
      )
      .map((a) => a.dest);
    const customizedRemovals = plan
      .filter((a): a is Extract<typeof a, { kind: "remove" }> =>
        a.kind === "remove" && a.wasCustomized
      )
      .map((a) => a.dest);

    let extraBackups: ReadonlyArray<{ dest: string; backupPath: string }> = [];
    if (cleanRemovals.length > 0) {
      const r = await writer.deletePaths(cleanRemovals, input.projectDir, {
        backupExisting: false,
      });
      extraBackups = [...extraBackups, ...r.backups];
    }
    if (input.force && customizedRemovals.length > 0) {
      const r = await writer.deletePaths(customizedRemovals, input.projectDir, {
        backupExisting: true,
      });
      extraBackups = [...extraBackups, ...r.backups];
    }

    // Plugin migrations: vanilla file on disk + plugin installed →
    // backup + delete; plugin serves the file going forward. Always
    // back up (the on-disk copy is exactly what the plugin will serve,
    // but the user may want to recover it later if they uninstall the
    // plugin).
    const pluginMigrations = plan
      .filter((a): a is Extract<typeof a, { kind: "migrate-to-plugin" }> =>
        a.kind === "migrate-to-plugin"
      )
      .map((a) => a.dest);
    if (pluginMigrations.length > 0) {
      const r = await writer.deletePaths(pluginMigrations, input.projectDir, {
        backupExisting: true,
      });
      extraBackups = [...extraBackups, ...r.backups];
    }

    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    // Dests handed off to the plugin are dropped from the new lock —
    // the binary is no longer the owner of those files.
    const droppedToPlugin = new Set<string>(
      plan
        .filter((a) => a.kind === "migrate-to-plugin" || a.kind === "defer-to-plugin")
        .map((a) => a.dest),
    );
    const updatedEntries = new Map<string, LockEntry>();
    for (const [dest] of newShas) {
      if (droppedToPlugin.has(dest)) continue;
      const existing = lock.entries.get(dest);
      const sha = await shaOfBundle(bundle[dest]);
      const wrote = toWrite[dest] !== undefined;
      updatedEntries.set(dest, {
        sha256: wrote ? sha : existing?.sha256 ?? sha,
        installedAt: wrote ? now : (existing?.installedAt ?? now),
        templatesVersion: wrote
          ? templatesVersion
          : (existing?.templatesVersion ?? templatesVersion),
      });
    }
    const newLock: InstalledLock = {
      version: 2,
      harness: lock.harness,
      backlogBackend: lock.backlogBackend,
      templatesVersion,
      entries: updatedEntries,
    };
    await lockStore.write(input.projectDir, newLock);

    return {
      status: "applied",
      plan,
      fromVersion: lock.templatesVersion,
      toVersion: templatesVersion,
      backups: [...backupReport.backups, ...extraBackups].map((b) => b.dest),
    };
  }
}

async function shaOfBundle(file: TemplateFile | undefined): Promise<string> {
  if (!file) return "";
  // Mirror init_project's hash logic: mergeBlock files are hashed on the
  // *block body* only, not the full file. Keeping these two paths in
  // lockstep is critical — a divergence here is what caused #163's
  // false-positive "customized" reports on `.gitignore` upgrades.
  const shaInput = file.mergeBlock !== undefined ? canonicalBlockBody(file.content) : file.content;
  return await sha256Hex(shaInput);
}
