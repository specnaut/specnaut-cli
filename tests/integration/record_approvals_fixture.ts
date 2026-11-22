import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { APPROVALS_FILE } from "../../src/domain/skill_approvals.ts";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import { bundled, git, verify } from "./verify_scripts_fixture.ts";
import { DENO_DIR } from "./spawn_env.ts";

/**
 * `specnaut record-approvals` run as `land-feature.sh` runs it, for the files that test it: HEAD
 * judged first, then recorded under a digest, and the file it writes read back and removed.
 */

export const TASK = ".claude/skills/task/SKILL.md";
export const SHIP = ".claude/skills/ship/SKILL.md";
export const MINE = `${bundled(TASK)}\nAsk before every merge.\n`;
export const line = async (text: string, path: string) => `${await sha256Hex(text)}  ${path}\n`;

let home: string | undefined;

/** An empty HOME for the CLI, made once, as `verify` has: the developer's git config stays out. */
function cliHome(): Record<string, string> {
  home ??= Deno.makeTempDirSync({ prefix: "record-approvals-home-" });
  return { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), DENO_DIR };
}

export type Recorded = { code: number; lines: string[]; file: string | null; stderr: string };

/** Judges `root`'s HEAD, then records under the digest `yes` (that run's own when absent). */
export async function record(root: string, yes?: string): Promise<Recorded> {
  const v = await verify(root);
  await Deno.remove(v.field("NAMES_FILE")!);
  const head = (await git(root, "rev-parse", "HEAD")).trim();
  const digest = yes ?? v.field("INSTRUCTIONS_DIGEST")!;
  const args = [
    "--instructions-digest",
    digest,
    "--head",
    head,
    "--base-tip",
    v.field("BASE_TIP")!,
  ];
  return await recordWith(root, args);
}

/** `specnaut record-approvals` in `root` with `args` as given, its new file read and removed. */
export async function recordWith(root: string, args: string[]): Promise<Recorded> {
  const r = await runSpecnaut(["record-approvals", ...args], { cwd: root, env: cliHome() });
  const lines = r.stdout.trimEnd().split("\n");
  const path = lines.find((l) => l.startsWith("APPROVALS_FILE "))?.slice(15);
  const file = path === undefined ? null : await Deno.readTextFile(path);
  if (path !== undefined) await Deno.remove(path);
  return { code: r.code, lines, file, stderr: r.stderr };
}

/** The work tree and HEAD are as the branch left them: the command writes neither. */
export async function untouched(root: string) {
  assertEquals((await git(root, "status", "--porcelain")).trim(), "");
  assertEquals(await Deno.stat(join(root, APPROVALS_FILE)).catch(() => null), null);
}
