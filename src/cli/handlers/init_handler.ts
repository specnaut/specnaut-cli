import { resolve } from "@std/path";
import { bold, dim, green, red, yellow } from "@std/fmt/colors";
import { InitProjectUseCase } from "../../application/init_project.ts";
import { findHarness } from "../harnesses.ts";
import { DenoFsWriter } from "../../infrastructure/deno_fs_writer.ts";
import { DenoGit } from "../../infrastructure/deno_git.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import { CORE_BUNDLE } from "../../templates_bundle.ts";

export type InitIntent = {
  kind: "init";
  projectName: string | null;
  here: boolean;
  noGit: boolean;
  ai: "claude" | "cursor" | "codex" | "gemini" | "windsurf";
  force: boolean;
};

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

  const harness = findHarness(intent.ai);
  if (!harness) {
    console.error(red(`error: unknown harness '${intent.ai}'`));
    return 2;
  }

  console.log(`Initializing into ${bold(targetDir)}`);

  const useCase = new InitProjectUseCase({
    writer: new DenoFsWriter(),
    git: new DenoGit(),
    lockStore: new FsLockStore(),
    harness,
    core: CORE_BUNDLE,
    ensureDir: (path) => Deno.mkdir(path, { recursive: true }),
  });

  const result = await useCase.execute({
    targetDir,
    initGit: !intent.noGit,
    force: intent.force,
  });

  if (result.status === "conflicts") {
    console.error(
      red(`error: target already contains ${result.conflicts.length} specflow-managed file(s):`),
    );
    for (const c of result.conflicts) console.error(red(`  - ${c}`));
    console.error(
      "\nSpecflow v0.1 does not yet support upgrading an existing project. " +
        "Remove these files or run init into a clean directory.",
    );
    return 3;
  }

  for (const w of result.warnings) console.error(yellow(`warn: ${w}`));
  for (const b of result.backups) console.log(dim(`↳ backed up ${b} → ${b}.specflow.bak`));
  console.log(green(`✓ wrote ${result.filesWritten} files`));
  console.log("\nNext steps:");
  console.log(`  1. Edit ${bold("AGENTS.md")} and ${bold(".specflow/memory/constitution.md")}`);
  console.log(`  2. Open the project in ${harness.displayName}`);
  console.log(`  3. Run ${bold('/backlog add "<first task title>"')}`);
  return 0;
}
