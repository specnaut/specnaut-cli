import type { SubprocessRunner } from "../application/ports.ts";

export type IssueSummary = {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly labels: ReadonlyArray<string>;
};

export type CreateIssueInput = {
  repo: string;
  title: string;
  bodyPath: string;
  labels: ReadonlyArray<string>;
};

export type EditIssueInput = {
  repo: string;
  number: number;
  title?: string;
  bodyPath?: string;
  addLabels?: ReadonlyArray<string>;
  removeLabels?: ReadonlyArray<string>;
};

export class GhCli {
  constructor(private readonly runner: SubprocessRunner) {}

  async isAvailable(): Promise<boolean> {
    const res = await this.runner.run("gh", ["--version"]);
    return res.code === 0;
  }

  async isAuthenticated(): Promise<boolean> {
    const res = await this.runner.run("gh", ["auth", "status"]);
    return res.code === 0;
  }

  async listIssues(repo: string, labelPrefix: string): Promise<IssueSummary[]> {
    const res = await this.runner.run("gh", [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,state,labels",
    ]);
    if (res.code !== 0) {
      throw new Error(`gh issue list failed: ${res.stderr.trim()}`);
    }
    const raw = JSON.parse(res.stdout) as Array<
      { number: number; state: string; labels: Array<{ name: string }> }
    >;
    return raw
      .map((r) => ({
        number: r.number,
        state: r.state.toLowerCase() as "open" | "closed",
        labels: r.labels.map((l) => l.name),
      }))
      .filter((r) => r.labels.some((l) => l.startsWith(labelPrefix)));
  }

  async createIssue(input: CreateIssueInput): Promise<number> {
    const args = [
      "issue",
      "create",
      "--repo",
      input.repo,
      "--title",
      input.title,
      "--body-file",
      input.bodyPath,
    ];
    for (const label of input.labels) args.push("--label", label);
    const res = await this.runner.run("gh", args);
    if (res.code !== 0) {
      throw new Error(`gh issue create failed: ${res.stderr.trim()}`);
    }
    const match = res.stdout.match(/\/issues\/(\d+)\s*$/);
    if (!match) {
      throw new Error(`gh issue create: cannot parse issue number from ${res.stdout}`);
    }
    return Number(match[1]);
  }

  async editIssue(input: EditIssueInput): Promise<void> {
    const args = ["issue", "edit", String(input.number), "--repo", input.repo];
    if (input.title !== undefined) args.push("--title", input.title);
    if (input.bodyPath !== undefined) args.push("--body-file", input.bodyPath);
    for (const label of input.addLabels ?? []) args.push("--add-label", label);
    for (const label of input.removeLabels ?? []) args.push("--remove-label", label);
    const res = await this.runner.run("gh", args);
    if (res.code !== 0) throw new Error(`gh issue edit failed: ${res.stderr.trim()}`);
  }

  async closeIssue(
    repo: string,
    number: number,
    reason: "completed" | "not_planned",
  ): Promise<void> {
    const res = await this.runner.run("gh", [
      "issue",
      "close",
      String(number),
      "--repo",
      repo,
      "--reason",
      reason,
    ]);
    if (res.code !== 0) throw new Error(`gh issue close failed: ${res.stderr.trim()}`);
  }

  async reopenIssue(repo: string, number: number): Promise<void> {
    const res = await this.runner.run("gh", [
      "issue",
      "reopen",
      String(number),
      "--repo",
      repo,
    ]);
    if (res.code !== 0) throw new Error(`gh issue reopen failed: ${res.stderr.trim()}`);
  }

  async graphql<T>(query: string, fields: Record<string, string> = {}): Promise<T> {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [k, v] of Object.entries(fields)) args.push("-f", `${k}=${v}`);
    const res = await this.runner.run("gh", args);
    if (res.code !== 0) throw new Error(`gh api graphql failed: ${res.stderr.trim()}`);
    return JSON.parse(res.stdout) as T;
  }
}
