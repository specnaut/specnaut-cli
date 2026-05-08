import { resolve } from "@std/path";
import { bold, dim, green, red, yellow } from "@std/fmt/colors";
import { InitProjectUseCase } from "../../application/init_project.ts";
import { findHarness } from "../harnesses.ts";
import { type HarnessKey, pickHarness, pickHarnessInteractive } from "../harness_picker.ts";
import { pickBacklogBackend, pickBacklogBackendInteractive } from "../backlog_picker.ts";
import { makeStdinSelectIO } from "../select.ts";
import type { BacklogBackend } from "../../domain/installed_lock.ts";
import { findBacklogStrategy } from "../../domain/backlog_strategies/registry.ts";
import { DenoFsWriter } from "../../infrastructure/deno_fs_writer.ts";
import { DenoGit } from "../../infrastructure/deno_git.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import { CORE_BUNDLE } from "../../templates_bundle.ts";

export type InitIntent = {
  kind: "init";
  projectName: string | null;
  here: boolean;
  noGit: boolean;
  ai: HarnessKey | null;
  backlog: BacklogBackend | null;
  force: boolean;
};

async function resolveHarnessKey(
  explicit: HarnessKey | null,
): Promise<HarnessKey> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickHarness({
      readLine: () => prompt("Choose [1-8]:"),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
  }
  const picked = await pickHarnessInteractive(makeStdinSelectIO());
  if (picked === null) {
    console.error(red("aborted."));
    Deno.exit(130);
  }
  return picked;
}

async function resolveBacklogBackend(
  explicit: BacklogBackend | null,
): Promise<BacklogBackend> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickBacklogBackend({
      readLine: () => prompt("Choose [1-3]:"),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
  }
  const picked = await pickBacklogBackendInteractive(makeStdinSelectIO());
  if (picked === null) {
    console.error(red("aborted."));
    Deno.exit(130);
  }
  return picked;
}

async function writeBacklogConfigStub(
  targetDir: string,
  backend: BacklogBackend,
): Promise<void> {
  const strategy = findBacklogStrategy(backend);
  const stub = strategy.initConfigStub();
  if (stub === null) return; // local: zero-config, nothing to write

  const path = `${targetDir}/.specflow/backlog-config.yml`;
  try {
    await Deno.stat(path);
    return; // don't clobber an existing config
  } catch {
    // not present → write the stub
  }
  await Deno.mkdir(`${targetDir}/.specflow`, { recursive: true });
  await Deno.writeTextFile(path, stub);
  for (const msg of strategy.initConfigMessages()) {
    console.log(dim(msg));
  }
}

export async function runInit(intent: InitIntent): Promise<number> {
  const cwd = Deno.cwd();

  let targetDir: string;
  if (intent.here) {
    targetDir = cwd;
  } else if (intent.projectName) {
    targetDir = resolve(cwd, intent.projectName);
  } else {
    console.error(red("error: `specflow init` requires a project name or --here"));
    return 2;
  }

  const aiKey = await resolveHarnessKey(intent.ai);
  const harness = findHarness(aiKey);
  if (!harness) {
    console.error(red(`error: unknown harness '${aiKey}'`));
    return 2;
  }

  const backlogBackend = await resolveBacklogBackend(intent.backlog);

  console.log(`Initializing into ${bold(targetDir)}`);

  const useCase = new InitProjectUseCase({
    writer: new DenoFsWriter(),
    git: new DenoGit(),
    lockStore: new FsLockStore(),
    harness,
    backlogBackend,
    core: CORE_BUNDLE,
    ensureDir: (path) => Deno.mkdir(path, { recursive: true }),
  });

  const result = await useCase.execute({
    targetDir,
    initGit: !intent.noGit,
    force: intent.force,
  });

  if (result.status === "conflicts") {
    const n = result.conflicts.length;
    const noun = n === 1 ? "file" : "files";
    console.error(red(`error: ${n} ${noun} would be overwritten:`));
    for (const c of result.conflicts) console.error(red(`  - ${c}`));
    console.error("");
    if (result.lockExists) {
      console.error(
        `This project was previously initialised by Specflow — run ${
          bold("specflow upgrade")
        } to update the managed files in place.`,
      );
    } else {
      console.error(
        `Re-run with ${bold("specflow init --here --force")} to overwrite ` +
          "(existing files are backed up to *.specflow.bak).",
      );
    }
    return 3;
  }

  for (const w of result.warnings) console.error(yellow(`warn: ${w}`));
  for (const b of result.backups) console.log(dim(`↳ backed up ${b} → ${b}.specflow.bak`));
  const mergedSuffix = result.filesMerged.length > 0
    ? ` (+ merged: ${result.filesMerged.join(", ")})`
    : "";
  console.log(green(`✓ wrote ${result.filesWritten} files${mergedSuffix}`));

  await writeBacklogConfigStub(targetDir, backlogBackend);
  console.log("\nNext steps:");
  console.log(
    `  1. Open the project in ${harness.displayName}, then run ${
      bold("/specflow.constitution")
    } to scaffold your project's guiding principles`,
  );
  console.log(
    `  2. Edit ${bold("AGENTS.md")} and refine ${
      bold(".specflow/memory/constitution.md")
    } for your stack`,
  );
  console.log(
    `  3. Run ${bold('/specflow.specify "<feature description>"')} to scaffold your first feature`,
  );
  console.log(`  4. Use ${bold('/backlog add "<task title>"')} for follow-up work`);
  return 0;
}
