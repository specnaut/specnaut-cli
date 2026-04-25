import { resolve } from "@std/path";
import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import { UpgradeProjectUseCase } from "../../application/upgrade_project.ts";
import { findHarness } from "../../application/harnesses.ts";
import { DenoFsReader } from "../../infrastructure/fs_reader.ts";
import { DenoFsWriter } from "../../infrastructure/deno_fs_writer.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import { CORE_BUNDLE, TEMPLATES_VERSION } from "../../templates_bundle.ts";
import { renderUnifiedDiff } from "../../domain/diff.ts";
import type { UpgradePlan } from "../../domain/upgrade_plan.ts";

export type UpgradeIntent = {
  kind: "upgrade";
  dryRun: boolean;
  force: boolean;
};

function renderSummary(plan: UpgradePlan, from: string, to: string) {
  const groups = {
    auto: plan.filter((a) => a.kind === "auto-update"),
    preserve: plan.filter((a) => a.kind === "preserve"),
    added: plan.filter((a) => a.kind === "add-new"),
    unchanged: plan.filter((a) => a.kind === "unchanged"),
  };

  console.log(
    `\n${bold("specflow upgrade")} — templates ${dim(from)} → ${cyan(to)}\n`,
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
  if (groups.preserve.length > 0) {
    console.log(bold("  customized locally (not touched)"));
    for (const a of groups.preserve) console.log(yellow(`    ⚠ ${a.dest}`));
    console.log();
  }

  console.log(
    dim(
      `  ${groups.auto.length} auto-update, ${groups.preserve.length} preserved, ` +
        `${groups.added.length} added, ${groups.unchanged.length} unchanged`,
    ),
  );
}

export async function runUpgrade(intent: UpgradeIntent): Promise<number> {
  const projectDir = resolve(Deno.cwd());

  const useCase = new UpgradeProjectUseCase({
    reader: new DenoFsReader(),
    writer: new DenoFsWriter(),
    lockStore: new FsLockStore(),
    core: CORE_BUNDLE,
    templatesVersion: TEMPLATES_VERSION,
    findHarness,
  });

  let result;
  try {
    result = await useCase.execute({
      projectDir,
      dryRun: intent.dryRun,
      force: intent.force,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`error: ${msg}`));
    return 2;
  }

  if (result.status === "up-to-date") {
    console.log(green(`✓ already up to date (templates ${result.currentVersion})`));
    return 0;
  }

  renderSummary(result.plan, result.fromVersion, result.toVersion);

  const preserves = result.plan.filter((a) => a.kind === "preserve");
  if (preserves.length > 0 && !intent.force) {
    console.log(
      dim(
        "\nFor customized files, review the diff below and merge manually if desired.\n" +
          "Re-run with --force to overwrite them (edits will be backed up to .specflow.bak).\n",
      ),
    );
    // Resolve the harness from the lock to render diffs in the correct file tree.
    const lockStore = new FsLockStore();
    const lock = await lockStore.read(projectDir);
    const harness = lock ? findHarness(lock.harness) : null;
    const previewBundle = harness ? harness.mapBundle(CORE_BUNDLE) : {};
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
      console.log(dim(`↳ backed up ${b} → ${b}.specflow.bak`));
    }
  }
  console.log();
  console.log(green(`✓ upgraded to templates ${result.toVersion}`));
  return 0;
}
