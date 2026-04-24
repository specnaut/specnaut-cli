import { resolve } from "@std/path";
import { bold, dim, green, red, yellow } from "@std/fmt/colors";
import { SyncBacklogUseCase } from "../../application/sync_backlog.ts";
import { FsBacklogReader } from "../../infrastructure/fs_backlog_reader.ts";
import { FsConfigStore } from "../../infrastructure/fs_config_store.ts";
import { DenoSubprocessRunner } from "../../infrastructure/deno_subprocess.ts";
import { GitHubBacklogSyncTarget } from "../../infrastructure/github_backlog_sync.ts";

export type BacklogSyncIntent = {
  kind: "backlog-sync";
  singleId: string | null;
  dryRun: boolean;
  allowSecrets: boolean;
};

export async function runBacklogSync(intent: BacklogSyncIntent): Promise<number> {
  const projectDir = resolve(Deno.cwd());
  const store = new FsConfigStore();
  const config = await store.read(projectDir);
  if (config === null) {
    console.error(red("error: no config found at .specflow/config.yml"));
    console.error("Run `specflow backlog configure` first.");
    return 2;
  }

  const runner = new DenoSubprocessRunner();
  const target = new GitHubBacklogSyncTarget(runner);
  const reader = new FsBacklogReader();

  console.log(`${bold("specflow")} backlog sync ${dim(`(${config.sync.repo})`)}`);

  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir,
    config,
    dryRun: intent.dryRun,
    singleId: intent.singleId,
    allowSecrets: intent.allowSecrets,
  });

  if (intent.dryRun) {
    for (const a of result.plan) {
      const tag = a.kind === "skip"
        ? yellow(`⚠ ${a.task.id} skip (${a.reason})`)
        : a.kind === "create"
        ? green(`+ ${a.task.id} create`)
        : a.kind === "update"
        ? `↻ ${a.task.id} update #${a.issueNumber}`
        : `× ${a.task.id} close #${a.issueNumber}`;
      console.log(tag);
    }
    return result.failed > 0 ? 1 : 0;
  }

  for (let i = 0; i < result.outcomes.length; i++) {
    const o = result.outcomes[i];
    const a = result.plan[i];
    if (o.ok) {
      console.log(
        green(
          `✓ ${a.task.id} ${o.action}` +
            (o.issueNumber > 0 ? ` → issue #${o.issueNumber}` : ""),
        ),
      );
    } else {
      console.error(red(`✗ ${o.taskId} ${o.action} — ${o.error}`));
    }
  }
  console.log(
    dim(`\n${result.outcomes.length - result.failed} ok, ${result.failed} failed`),
  );
  return result.failed > 0 ? 1 : 0;
}
