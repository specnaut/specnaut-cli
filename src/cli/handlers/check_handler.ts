import { resolve } from "@std/path";
import { bold, green, red, yellow } from "@std/fmt/colors";
import { RunChecksUseCase } from "../../application/run_checks.ts";
import { DenoSubprocessRunner } from "../../infrastructure/deno_subprocess.ts";
import { DenoEnvironmentProbe } from "../../infrastructure/deno_environment_probe.ts";
import { FsProjectInspector } from "../../infrastructure/fs_project_inspector.ts";
import { FsPluginDetector } from "../../infrastructure/fs_plugin_detector.ts";
import { TEMPLATES_VERSION } from "../../templates_bundle.ts";
import { type CheckOutcome, worstStatusOf } from "../../domain/check_result.ts";

export type CheckIntent = { kind: "check"; projectMode: boolean };

function symbol(outcome: CheckOutcome): string {
  switch (outcome.status) {
    case "pass":
      return green("✓");
    case "warn":
      return yellow("⚠");
    case "fail":
      return red("✗");
  }
}

function renderSection(title: string, outcomes: ReadonlyArray<CheckOutcome>) {
  console.log(`\n${bold(title)}\n`);
  const width = outcomes.reduce((max, o) => Math.max(max, o.name.length), 0);
  for (const o of outcomes) {
    console.log(`  ${o.name.padEnd(width)}  ${symbol(o)} ${o.message}`);
  }
}

export async function runCheck(intent: CheckIntent): Promise<number> {
  const runner = new DenoSubprocessRunner();
  const env = new DenoEnvironmentProbe(runner);
  const inspector = new FsProjectInspector(new FsPluginDetector());

  const projectDir = intent.projectMode ? resolve(Deno.cwd()) : null;
  const uc = new RunChecksUseCase({ env, inspector });
  const result = await uc.execute({ projectDir, templatesVersion: TEMPLATES_VERSION });

  console.log(`${bold("specflow check")}`);
  renderSection("environment", result.environment);
  if (result.project.length > 0) {
    renderSection(`project (${projectDir})`, result.project);
  }

  const all = [...result.environment, ...result.project];
  const worst = worstStatusOf(all);
  console.log();
  if (worst === "pass") {
    console.log(green("All checks passed."));
    return 0;
  }
  if (worst === "warn") {
    console.log(yellow("Checks completed with warnings."));
    return 0;
  }
  console.log(red("Checks FAILED."));
  return 1;
}
