import { resolve } from "@std/path";
import { green, red, yellow } from "@std/fmt/colors";
import {
  ListPendingReconciliationsUseCase,
  type ReconcileMode,
  ReconcilePathUseCase,
} from "../../application/reconcile_path.ts";
import { DenoFsReader } from "../../infrastructure/fs_reader.ts";
import { DenoFsWriter } from "../../infrastructure/deno_fs_writer.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import { FsStagingStore } from "../../infrastructure/fs_staging_store.ts";

export type ReconcileIntent =
  | { kind: "reconcile-status" }
  | { kind: "reconcile-path"; path: string; mode: ReconcileMode };

export async function runReconcile(intent: ReconcileIntent): Promise<number> {
  const projectDir = resolve(Deno.cwd());

  if (intent.kind === "reconcile-status") {
    // Through the use case, not `FsStagingStore.list()` directly: the raw tree
    // also holds copies `reconcile <path>` refuses, and listing those left a
    // queue no command could empty (#613).
    const pending = await new ListPendingReconciliationsUseCase({
      reader: new DenoFsReader(),
      lockStore: new FsLockStore(),
      stagingStore: new FsStagingStore(),
    }).execute(projectDir);
    const stagingDir = pending.length > 0 ? ".specnaut/upgrade-staging" : null;
    console.log(JSON.stringify({ pending, stagingDir }, null, 2));
    return 0;
  }

  const useCase = new ReconcilePathUseCase({
    reader: new DenoFsReader(),
    writer: new DenoFsWriter(),
    lockStore: new FsLockStore(),
    stagingStore: new FsStagingStore(),
  });
  const result = await useCase.execute({
    projectDir,
    path: intent.path,
    mode: intent.mode,
  });

  switch (result.status) {
    case "ok": {
      const verb = intent.mode === "accept-upstream" ? "took upstream" : "kept local";
      console.log(green(`✓ reconciled ${intent.path} — ${verb}`));
      return 0;
    }
    case "no-marker":
      console.error(red(`error: no .specnaut/installed.lock — run \`specnaut init\` first`));
      return 2;
    case "no-staging":
      console.error(red(`error: no pending reconciliation for ${intent.path}`));
      console.error(
        yellow(`(run \`specnaut reconcile --status\` to see pending paths)`),
      );
      return 2;
    case "no-lock-entry":
      console.error(red(`error: ${intent.path} is not tracked by Specnaut`));
      return 2;
    case "no-project-file":
      console.error(red(`error: project file ${intent.path} does not exist on disk`));
      return 2;
  }
}
