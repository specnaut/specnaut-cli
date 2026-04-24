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

export type ProjectField = {
  id: string;
  name: string;
  dataType: "SINGLE_SELECT" | "NUMBER" | "TEXT" | "ITERATION" | "DATE";
  options?: Array<{ id: string; name: string }>;
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

  async getIssueNodeId(repo: string, number: number): Promise<string> {
    const [owner, name] = repo.split("/");
    const query =
      `query($owner: String!, $name: String!, $num: Int!) { repository(owner: $owner, name: $name) { issue(number: $num) { id } } }`;
    const res = await this.runner.run("gh", [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `num=${number}`,
    ]);
    if (res.code !== 0) throw new Error(`getIssueNodeId failed: ${res.stderr.trim()}`);
    const parsed = JSON.parse(res.stdout) as {
      data: { repository: { issue: { id: string } | null } };
    };
    const id = parsed.data.repository.issue?.id;
    if (!id) throw new Error(`Issue #${number} not found in ${repo}`);
    return id;
  }

  async resolveProjectNodeId(owner: string, number: number): Promise<string> {
    const query =
      `query($login: String!, $num: Int!) { user(login: $login) { projectV2(number: $num) { id } } organization(login: $login) { projectV2(number: $num) { id } } }`;
    const res = await this.graphql<{
      data: {
        user: { projectV2: { id: string } | null } | null;
        organization: { projectV2: { id: string } | null } | null;
      };
    }>(query, { login: owner, num: String(number) });
    const id = res.data.user?.projectV2?.id ?? res.data.organization?.projectV2?.id;
    if (!id) throw new Error(`Project #${number} not found for ${owner}`);
    return id;
  }

  async getProjectFields(projectNodeId: string): Promise<ProjectField[]> {
    const query =
      `query($id: ID!) { node(id: $id) { ... on ProjectV2 { fields(first: 50) { nodes { ... on ProjectV2Field { id name dataType } ... on ProjectV2SingleSelectField { id name dataType options { id name } } } } } } }`;
    const res = await this.graphql<{
      data: { node: { fields: { nodes: ProjectField[] } } };
    }>(query, { id: projectNodeId });
    return res.data.node.fields.nodes;
  }

  async addProjectItem(projectNodeId: string, contentNodeId: string): Promise<string> {
    const mutation =
      `mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: {projectId: $p, contentId: $c}) { item { id } } }`;
    const res = await this.graphql<{
      data: { addProjectV2ItemById: { item: { id: string } } };
    }>(mutation, { p: projectNodeId, c: contentNodeId });
    return res.data.addProjectV2ItemById.item.id;
  }

  async updateProjectNumberField(
    projectNodeId: string,
    itemNodeId: string,
    fieldNodeId: string,
    value: number,
  ): Promise<void> {
    const mutation =
      `mutation($p: ID!, $i: ID!, $f: ID!, $v: Float!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { number: $v } }) { projectV2Item { id } } }`;
    await this.graphql(mutation, {
      p: projectNodeId,
      i: itemNodeId,
      f: fieldNodeId,
      v: String(value),
    });
  }

  async updateProjectSingleSelectField(
    projectNodeId: string,
    itemNodeId: string,
    fieldNodeId: string,
    optionId: string,
  ): Promise<void> {
    const mutation =
      `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) { projectV2Item { id } } }`;
    await this.graphql(mutation, {
      p: projectNodeId,
      i: itemNodeId,
      f: fieldNodeId,
      o: optionId,
    });
  }
}
