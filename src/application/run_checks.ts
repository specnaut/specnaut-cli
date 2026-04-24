import type { EnvironmentProbe, ProjectInspector } from "./ports.ts";
import type { CheckResult } from "../domain/check_result.ts";

export type RunChecksInput = {
  projectDir: string | null;
  templatesVersion: string;
};

export type RunChecksDeps = {
  env: EnvironmentProbe;
  inspector: ProjectInspector;
};

export class RunChecksUseCase {
  constructor(private readonly deps: RunChecksDeps) {}

  async execute(input: RunChecksInput): Promise<CheckResult> {
    const [git, gh, deno] = await Promise.all([
      this.deps.env.probeGit(),
      this.deps.env.probeGh(),
      this.deps.env.probeDeno(),
    ]);
    const environment = [git, gh, deno];

    const project = input.projectDir === null
      ? []
      : await this.deps.inspector.inspect(input.projectDir, input.templatesVersion);

    return { environment, project };
  }
}
