import type { FsReader, FsWriter, Harness, LockStore } from "./ports.ts";
import type { Bundle, TemplateFile } from "../domain/template.ts";
import { sha256Hex } from "../domain/sha256.ts";
import type { InstalledLock, LockEntry } from "../domain/installed_lock.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import { computeUpgradePlan, type UpgradePlan } from "../domain/upgrade_plan.ts";
import { canonicalBlockBody, extractBlock } from "../domain/merge_block.ts";

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

export type UpgradeProjectDeps = {
  reader: FsReader;
  writer: FsWriter;
  lockStore: LockStore;
  core: CoreBundle;
  templatesVersion: string;
  findHarness: (key: string) => Harness | null;
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
    const bundle = harness.mapBundle(core);

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

    const plan = computeUpgradePlan(diskShas, lock, newShas);

    const hasActualWork = plan.some((a) =>
      a.kind === "auto-update" ||
      a.kind === "add-new" ||
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

    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    const updatedEntries = new Map<string, LockEntry>();
    for (const [dest] of newShas) {
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
  return await sha256Hex(file.content);
}
