import type { ApplyResult, BacklogSyncTarget, SubprocessRunner } from "../application/ports.ts";
import type { BacklogTask } from "../domain/backlog/task.ts";
import type { ExistingIssue, SyncAction } from "../domain/backlog/sync_plan.ts";
import type { SyncConfig } from "../domain/sync_config.ts";
import { GhCli } from "./gh_cli.ts";

export class GitHubBacklogSyncTarget implements BacklogSyncTarget {
  private readonly gh: GhCli;

  constructor(runner: SubprocessRunner) {
    this.gh = new GhCli(runner);
  }

  async listExisting(config: SyncConfig): Promise<Map<string, ExistingIssue>> {
    const prefix = config.sync.label_prefix;
    const issues = await this.gh.listIssues(config.sync.repo, prefix);
    const out = new Map<string, ExistingIssue>();
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idRe = new RegExp(`^${escaped}(\\d{3})$`);
    for (const issue of issues) {
      for (const label of issue.labels) {
        const m = idRe.exec(label);
        if (m) {
          out.set(m[1], { id: m[1], number: issue.number, state: issue.state });
          break;
        }
      }
    }
    return out;
  }

  async apply(action: SyncAction, config: SyncConfig): Promise<ApplyResult> {
    try {
      switch (action.kind) {
        case "skip":
          return { ok: true, issueNumber: -1, action: "skip" };

        case "create": {
          const number = await this.doCreate(action.task, config);
          return { ok: true, issueNumber: number, action: "create" };
        }

        case "update": {
          await this.doUpdate(action.task, action.issueNumber, config);
          return { ok: true, issueNumber: action.issueNumber, action: "update" };
        }

        case "close": {
          await this.gh.closeIssue(config.sync.repo, action.issueNumber, action.reason);
          return { ok: true, issueNumber: action.issueNumber, action: "close" };
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg, action: action.kind, taskId: action.task.id };
    }
  }

  private labelsFor(task: BacklogTask, config: SyncConfig): string[] {
    return [
      `${config.sync.label_prefix}${task.id}`,
      `priority/${task.priority}`,
      `category/${task.category}`,
      ...task.tags,
    ];
  }

  private async writeBodyToTmp(task: BacklogTask): Promise<string> {
    const tmpFile = await Deno.makeTempFile({ prefix: "specflow-body-", suffix: ".md" });
    await Deno.writeTextFile(tmpFile, renderIssueBody(task));
    return tmpFile;
  }

  private async doCreate(task: BacklogTask, config: SyncConfig): Promise<number> {
    const bodyPath = await this.writeBodyToTmp(task);
    try {
      return await this.gh.createIssue({
        repo: config.sync.repo,
        title: task.title,
        bodyPath,
        labels: this.labelsFor(task, config),
      });
    } finally {
      await Deno.remove(bodyPath).catch(() => {});
    }
  }

  private async doUpdate(task: BacklogTask, number: number, config: SyncConfig): Promise<void> {
    const bodyPath = await this.writeBodyToTmp(task);
    try {
      await this.gh.editIssue({
        repo: config.sync.repo,
        number,
        title: task.title,
        bodyPath,
        addLabels: this.labelsFor(task, config),
      });
    } finally {
      await Deno.remove(bodyPath).catch(() => {});
    }
  }
}

function renderIssueBody(task: BacklogTask): string {
  const meta = [
    `**Backlog ID:** \`${task.id}\``,
    `**Category:** ${task.category}`,
    `**Priority:** ${task.priority}`,
    `**Complexity:** ${task.complexity} pts`,
    `**Status:** \`${task.status}\``,
    task.spec ? `**Spec:** ${task.spec}` : null,
    task.dependsOn.length > 0 ? `**Depends on:** ${task.dependsOn.join(", ")}` : null,
    `**Created:** ${task.created}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return `<!-- managed by specflow backlog sync — edits here will be overwritten -->\n\n${meta}\n\n---\n\n${task.body.trim()}\n`;
}
