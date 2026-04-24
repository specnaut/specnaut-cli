import type { ConfigStore, InteractivePrompt, SubprocessRunner } from "./ports.ts";
import type { SyncConfig } from "../domain/sync_config.ts";
import { GhCli } from "../infrastructure/gh_cli.ts";

export type ConfigureSyncInput = {
  projectDir: string;
  repoHint: string;
};

export type ConfigureSyncDeps = {
  store: ConfigStore;
  prompt: InteractivePrompt;
  runner: SubprocessRunner;
};

type GqlProject = { id: string; number: number; title: string };
type GqlField = { id: string; name: string; dataType: string };
type GqlFieldsResponse = {
  data: {
    node: { fields: { nodes: GqlField[] } };
  };
};

export class ConfigureSyncUseCase {
  constructor(private readonly deps: ConfigureSyncDeps) {}

  async execute(input: ConfigureSyncInput): Promise<SyncConfig> {
    const { store, prompt, runner } = this.deps;
    const gh = new GhCli(runner);

    if (!(await gh.isAvailable())) {
      throw new Error("gh CLI required — install from https://cli.github.com");
    }
    if (!(await gh.isAuthenticated())) {
      throw new Error("gh not authenticated — run 'gh auth login' first");
    }

    const projects = await this.listProjects(gh);

    let project: SyncConfig["sync"]["project"] = null;
    if (projects.length > 0) {
      const choices = [
        ...projects.map((p) => ({
          label: `#${p.number} — ${p.title}`,
          value: String(p.number),
        })),
        { label: "No project — issues only", value: "__none__" },
      ];
      const picked = await prompt.select("Which project to sync to?", choices);
      if (picked !== "__none__") {
        const chosen = projects.find((p) => String(p.number) === picked)!;
        project = await this.configureProject(gh, prompt, chosen);
      }
    }

    const cfg: SyncConfig = {
      version: 1,
      sync: {
        provider: "github",
        repo: input.repoHint,
        project,
        label_prefix: "backlog/",
      },
    };
    await store.write(input.projectDir, cfg);
    return cfg;
  }

  private async listProjects(gh: GhCli): Promise<GqlProject[]> {
    const query = `query { viewer { projectsV2(first: 50) { nodes { id number title } } } }`;
    const res = await gh.graphql<{
      data: { viewer: { projectsV2: { nodes: GqlProject[] } } };
    }>(query);
    return res.data.viewer.projectsV2.nodes;
  }

  private async configureProject(
    gh: GhCli,
    prompt: InteractivePrompt,
    project: GqlProject,
  ): Promise<NonNullable<SyncConfig["sync"]["project"]>> {
    const query = `query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field { id name dataType }
              ... on ProjectV2SingleSelectField { id name dataType }
              ... on ProjectV2IterationField { id name dataType }
            }
          }
        }
      }
    }`;
    const res = await gh.graphql<GqlFieldsResponse>(query, { id: project.id });
    const fields = res.data.node.fields.nodes;

    const resolveField = async (message: string, preferredName: string): Promise<string> => {
      const exact = fields.find((f) => f.name === preferredName);
      const choices = fields.map((f) => ({
        label: `${f.name} (${f.dataType})`,
        value: f.name,
      }));
      return await prompt.select(
        message,
        exact
          ? [
            { label: `${exact.name} (${exact.dataType})`, value: exact.name },
            ...choices.filter((c) => c.value !== exact.name),
          ]
          : choices,
      );
    };

    const status = await resolveField("Status field", "Status");
    const priority = await resolveField("Priority field", "Priority");
    const complexity = await resolveField("Complexity field", "Complexity");

    return {
      number: project.number,
      owner: project.title.split(" ")[0],
      fieldMap: { status, priority, complexity },
    };
  }
}
