import { join } from "@std/path";
import { bundled } from "../integration/verify_scripts_fixture.ts";
import { git, type Run, run, type Sandbox, sandbox } from "./git_sandbox.ts";
import { withSpecnaut } from "./specnaut_shim.ts";

/**
 * The landing of a customised shipped skill (`land-feature.sh`, `_verifier.sh`'s
 * `record_approvals`), shared by the files that test it: a base holding the customised copy, the
 * digest a yes covers, and a `specnaut` on the PATH that answers some calls in place of the real one.
 */

export const SKILL = ".claude/skills/task/SKILL.md";
export const MINE = `${bundled(SKILL)}\nAsk before every merge.\n`;
export const SUBJECT = "chore(specnaut): approve customised skill content";

/** A base that already holds a customised shipped skill, and a feature branch with one commit. */
export async function customisedBase(): Promise<Sandbox> {
  const sb = await sandbox();
  await sb.commit(SKILL, MINE, "docs: our own task skill");
  await git(sb.work, "push", "--quiet", "origin", "main");
  await git(sb.work, "switch", "--quiet", "-c", "feature");
  await sb.commit("notes.md", "x\n", "docs: notes");
  return sb;
}

/** The INSTRUCTIONS_DIGEST the verifier prints in the clone, its names file removed. */
export async function digest(sb: Sandbox): Promise<string> {
  const out = (await run("bash", ["-c", "specnaut verify-scripts"], sb.work)).stdout;
  const field = (key: string) => out.match(new RegExp(`^${key} (.+)$`, "m"))?.[1] ?? "";
  await Deno.remove(field("NAMES_FILE"));
  return field("INSTRUCTIONS_DIGEST");
}

/** `land-feature.sh` with a yes to the digest the verifier prints now. */
export async function landWithYes(sb: Sandbox): Promise<Run> {
  return await sb.script("land-feature.sh", "--instructions-digest", await digest(sb));
}

/**
 * `land-feature.sh` with a yes, a `specnaut` first on the PATH, outside the repository, that runs
 * the bash `body` before it hands the call to the real one, `$REAL`: what an older or a broken
 * binary answers. A bash script found on the PATH: not on Windows, which resolves its tools
 * otherwise.
 */
export async function landWithVerifier(sb: Sandbox, body: string): Promise<Run> {
  const yes = await digest(sb);
  const dir = join(sb.root, "verifier");
  await Deno.mkdir(dir);
  const real = (await run("bash", ["-c", "command -v specnaut"], sb.work)).stdout.trim();
  const shim = `#!/usr/bin/env bash\nREAL='${real}'\n${body}\nexec "$REAL" "$@"\n`;
  await Deno.writeTextFile(join(dir, "specnaut"), shim);
  await Deno.chmod(join(dir, "specnaut"), 0o755);
  const path = `${dir}:${withSpecnaut(Deno.env.get("PATH"))}`;
  const script = ".specnaut/scripts/bash/land-feature.sh";
  return await run("bash", [script, "--instructions-digest", yes], sb.work, { PATH: path });
}
