import { join } from "@std/path";
import { git, sandbox } from "./git_sandbox.ts";

/** spec 042 — the shipped-feature layout remove-spec.sh runs against, shared by its two test files. */

export const BRANCH = "007-feature";

export async function shipped(featureDir = `.specnaut/specs/${BRANCH}`) {
  const sb = await sandbox();
  await sb.commit(`.specnaut/specs/${BRANCH}/plan.md`, "# plan\n", "plan(7): x");
  await sb.commit("src/app.ts", "export {};\n", "feat(7): x");
  await sb.commit(
    ".specnaut/feature.json",
    JSON.stringify({ feature_directory: featureDir, linked_issue: 7 }) + "\n",
    "chore: feature pointer",
  );
  await git(sb.work, "push", "--quiet", "origin", "main");
  return sb;
}

/** HEAD, the index and the worktree, so "nothing changed" is one comparison. */
export async function state(work: string) {
  return [
    await git(work, "rev-parse", "HEAD"),
    await git(work, "status", "--porcelain"),
  ];
}

/** Every file on disk under `dir`, followed through links — what a refusal must leave in place. */
export async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string, rel: string) => {
    for await (const e of Deno.readDir(at)) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      const info = await Deno.stat(join(at, e.name));
      if (info.isDirectory) await walk(join(at, e.name), p);
      else out.push(`${p}:${await Deno.readTextFile(join(at, e.name))}`);
    }
  };
  await walk(dir, "");
  return out.sort();
}
