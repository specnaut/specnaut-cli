import { join } from "@std/path";
import { makeRepo, type Run, type Sandbox } from "./hook_sandbox.ts";

/** Shared by the protect-constitution tests (spec 038 US4): the project and the verdict. */

export const HOOK = "protect-constitution.sh";
export const C = "docs/constitution.md";
export const UI = ".specnaut/ui.yml";
export const SELF = ".specnaut/hooks/_paths.sh";

/** A deny counts only with the refusal the decision prints: a crash exits 2 too. */
export function verdict(r: Run): string {
  if (r.code === 2 && r.stderr.startsWith("specnaut protect-constitution: this call")) {
    return "deny";
  }
  if (r.code === 0 && r.stdout === "") return "allow";
  if (r.code === 0 && JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === "ask") {
    return "ask";
  }
  return `exit ${r.code}: ${r.stdout} ${r.stderr}`;
}

/** A project with the four guarded files, an installed hook, and a link to the constitution. */
export async function project(sb: Sandbox): Promise<string> {
  const repo = await makeRepo(sb, { mode: "auto" });
  await Deno.mkdir(join(repo, "docs"));
  await Deno.mkdir(join(repo, ".specnaut", "hooks"));
  await Deno.mkdir(join(repo, "src"));
  for (
    const f of [C, ".specnaut/size-limits.yml", ".specnaut/boundaries.yml", UI, SELF, "src/a.ts"]
  ) await Deno.writeTextFile(join(repo, f), "x\n");
  await Deno.symlink(join(repo, C), join(repo, "rules-link"));
  await Deno.link(join(repo, C), join(repo, "rules-hardlink"));
  return repo;
}
